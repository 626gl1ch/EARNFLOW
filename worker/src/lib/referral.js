/**
 * Referral system logic.
 * When a referee gets paid for a task, check if they have a referrer,
 * verify eligibility (e.g., within first 30 days), and credit the referrer.
 */

export async function processReferralBonus(supabase, refereeId, taskPayoutMinor, currency, completionId) {
  try {
    // 1. Fetch referee profile to check referred_by and created_at
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('referred_by, created_at')
      .eq('id', refereeId)
      .single();

    if (profErr || !profile || !profile.referred_by) {
      return; // No referrer or error
    }

    const referrerId = profile.referred_by;

    // 2. Check if referee is within their first month (30 days)
    const refereeJoined = new Date(profile.created_at).getTime();
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    if (refereeJoined < thirtyDaysAgo) {
      return; // Referral period expired (payouts only for first month)
    }

    // 3. Fetch the referral contract/rate
    const { data: referral, error: refErr } = await supabase
      .from('referrals')
      .select('*')
      .eq('referrer_id', referrerId)
      .eq('referee_id', refereeId)
      .single();

    if (refErr || !referral) {
      return; // No active referral record
    }

    // 4. Calculate bonus
    const bonusRate = parseFloat(referral.bonus_rate || 0.10); // default 10%
    const bonusAmountMinor = Math.floor(taskPayoutMinor * bonusRate);

    if (bonusAmountMinor <= 0) {
      return; // Bonus too small to credit
    }

    // 5. Insert ledger entry for the referrer (positive amount)
    const { error: ledgerErr } = await supabase
      .from('ledger_entries')
      .insert({
        user_id: referrerId,
        entry_type: 'referral_bonus',
        amount_minor: bonusAmountMinor,
        currency: currency,
        related_task_completion_id: completionId,
        memo: `Referral bonus from referee task completion`,
      });

    if (ledgerErr) {
      console.error('Failed to create referral ledger entry:', ledgerErr);
      return;
    }

    // 6. Update the total bonus accumulated on the referral record
    await supabase
      .from('referrals')
      .update({
        total_bonus_paid_minor: referral.total_bonus_paid_minor + bonusAmountMinor
      })
      .eq('id', referral.id);

  } catch (err) {
    console.error('Error processing referral bonus:', err);
  }
}

import { serviceClient } from '../lib/supabase.js';
import { processReferralBonus } from '../lib/referral.js';

/**
 * Cron: confirm-pending
 * Runs every hour via Cloudflare Cron Trigger.
 * Promotes task_completions where:
 *   status = 'pending_confirmation' AND confirmed_at <= NOW()
 * → calls complete_task RPC → moves balance from pending_minor to balance_minor
 *
 * This is the heart of the CPA confirmation state machine.
 * Networks have 24–720 hours to fire a reversal postback.
 * Once the window passes without a reversal, we credit the user.
 */
export async function confirmPendingCompletions(env) {
  const supabase = serviceClient(env);
  const now = new Date().toISOString();

  // Fetch all completions past their confirmation window, in batches of 100
  const { data: completions, error } = await supabase
    .from('task_completions')
    .select('id, user_id, task_id, tasks(payout_minor, currency)')
    .eq('status', 'pending_confirmation')
    .lte('confirmed_at', now)
    .limit(100);

  if (error) {
    console.error('[confirm-pending] fetch error:', error.message);
    return { error: error.message };
  }

  if (!completions || completions.length === 0) {
    return { processed: 0 };
  }

  let successCount = 0;
  let errorCount   = 0;

  for (const completion of completions) {
    // Move to verified first so complete_task RPC picks it up
    const { error: updateErr } = await supabase
      .from('task_completions')
      .update({ status: 'verified', completed_at: new Date().toISOString() })
      .eq('id', completion.id)
      .eq('status', 'pending_confirmation'); // optimistic lock — prevents double-processing

    if (updateErr) {
      console.error(`[confirm-pending] update error for ${completion.id}:`, updateErr.message);
      errorCount++;
      continue;
    }

    // Release from pending_minor and credit to balance_minor via the ledger trigger
    const { error: payErr } = await supabase.rpc('complete_task', {
      p_task_completion_id: completion.id,
    });

    if (payErr) {
      console.error(`[confirm-pending] complete_task error for ${completion.id}:`, payErr.message);
      // Rollback status to pending_confirmation so we retry next hour
      await supabase
        .from('task_completions')
        .update({ status: 'pending_confirmation' })
        .eq('id', completion.id);
      errorCount++;
      continue;
    }

    // Clear the pending_minor hold for this specific completion's amount atomically
    const payoutMinor = completion.tasks?.payout_minor || 0;
    if (payoutMinor > 0) {
      await supabase.rpc('adjust_pending_minor', {
        p_user_id: completion.user_id,
        p_amount_minor: -payoutMinor,
      });
    }

    // Fire referral bonus in background (5% of payout to referrer)
    try {
      await processReferralBonus(
        supabase,
        completion.user_id,
        completion.tasks?.payout_minor || 0,
        completion.tasks?.currency || 'NGN',
        completion.id
      );
    } catch (e) {
      console.error('[confirm-pending] referral bonus error:', e.message);
    }

    successCount++;
  }

  console.log(`[confirm-pending] processed ${successCount} payouts, ${errorCount} errors (${now})`);
  return { processed: successCount, errors: errorCount };
}

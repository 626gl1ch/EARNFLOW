import { serviceClient, getUserFromRequest } from '../lib/supabase.js';
import { resolveAccount, createTransferRecipient } from '../lib/paystack.js';

export async function handleWithdrawals(request, env, ctx, json, subpath) {
  const supabase = serviceClient(env);
  const { user } = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  // POST /api/withdrawals/resolve-account — verify bank details before requesting
  if (subpath === '/resolve-account' && request.method === 'POST') {
    const body = await request.json();
    const result = await resolveAccount(env, body);
    return json(result);
  }

  // POST /api/withdrawals — request a payout
  if ((subpath === '' || subpath === '/') && request.method === 'POST') {
    const body = await request.json();
    const { account_number, bank_code, account_name, amount_minor } = body;

    const { data: profile } = await supabase.from('profiles').select('country_code').eq('id', user.id).single();
    const { data: config } = await supabase
      .from('payout_config')
      .select('*')
      .eq('country_code', profile?.country_code || 'NG')
      .single();

    if (config && amount_minor < config.min_withdrawal_minor) {
      return json({ error: 'below_minimum', min_withdrawal_minor: config.min_withdrawal_minor }, 400);
    }

    // Check for unresolved fraud flags before allowing payout.
    const { data: flags } = await supabase
      .from('fraud_flags')
      .select('id')
      .eq('user_id', user.id)
      .eq('resolved', false)
      .in('severity', ['high', 'critical']);
    if (flags && flags.length > 0) {
      return json({ error: 'withdrawal_held', reason: 'pending_fraud_review' }, 403);
    }

    const recipient = await createTransferRecipient(env, {
      name: account_name,
      account_number,
      bank_code,
      currency: config?.currency || 'NGN',
    });

    if (!recipient.status) {
      return json({ error: 'recipient_creation_failed', message: recipient.message }, 400);
    }

    const { data: withdrawalId, error } = await supabase.rpc('request_withdrawal', {
      p_user_id: user.id,
      p_amount_minor: amount_minor,
      p_currency: config?.currency || 'NGN',
      p_method: 'paystack_bank',
      p_destination: { account_number, bank_code, recipient_code: recipient.data.recipient_code },
    });

    if (error) return json({ error: 'withdrawal_failed', message: error.message }, 400);

    // Actual transfer initiation happens in the nightly payout-batch cron
    // (see cron/payout-batch.js) so withdrawals can be reviewed/batched first.
    return json({ withdrawal_id: withdrawalId, status: 'requested' });
  }

  return null;
}

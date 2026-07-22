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
    const { method = 'paystack_bank', account_number, bank_code, account_name, wallet_address, network = 'TRC20', amount_minor } = body;

    const { data: profile } = await supabase.from('profiles').select('country_code').eq('id', user.id).single();
    const { data: config } = await supabase
      .from('payout_config')
      .select('*')
      .eq('country_code', profile?.country_code || 'NG')
      .single();

    const minWithdrawalMinor = config?.min_withdrawal_minor || 100000; // Default 1000 NGN (100,000 minor)

    if (amount_minor < minWithdrawalMinor) {
      return json({ error: 'below_minimum', min_withdrawal_minor: minWithdrawalMinor }, 400);
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

    let destinationPayload = {};
    let chosenMethod = method;

    if (method === 'crypto_usdt') {
      if (!wallet_address || String(wallet_address).trim().length < 15) {
        return json({ error: 'invalid_wallet_address', message: 'Please provide a valid USDT crypto wallet address.' }, 400);
      }
      destinationPayload = {
        network: String(network || 'TRC20').toUpperCase(),
        wallet_address: String(wallet_address).trim(),
      };
      chosenMethod = 'crypto_usdt';
    } else {
      // Paystack Bank
      const recipient = await createTransferRecipient(env, {
        name: account_name,
        account_number,
        bank_code,
        currency: config?.currency || 'NGN',
      });

      if (!recipient.status) {
        return json({ error: 'recipient_creation_failed', message: recipient.message }, 400);
      }

      destinationPayload = {
        account_number,
        bank_code,
        account_name,
        recipient_code: recipient.data.recipient_code,
      };
      chosenMethod = 'paystack_bank';
    }

    const { data: withdrawalId, error } = await supabase.rpc('request_withdrawal', {
      p_user_id: user.id,
      p_amount_minor: amount_minor,
      p_currency: config?.currency || 'NGN',
      p_method: chosenMethod,
      p_destination: destinationPayload,
    });

    if (error) return json({ error: 'withdrawal_failed', message: error.message }, 400);

    return json({ withdrawal_id: withdrawalId, status: 'requested', method: chosenMethod });
  }

  return null;
}

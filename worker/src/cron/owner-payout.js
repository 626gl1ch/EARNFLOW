import { serviceClient } from '../lib/supabase.js';
import { initiateTransfer, createTransferRecipient } from '../lib/paystack.js';

/**
 * Automates owner revenue payouts via Paystack Transfers.
 * Runs daily to transfer 50% platform profits directly to the owner's bank account.
 */
export async function runOwnerPayout(env) {
  const supabase = serviceClient(env);

  // 1. Get owner payout settings
  const { data: config } = await supabase
    .from('owner_payout_config')
    .select('*')
    .eq('id', 1)
    .single();

  if (!config || !config.auto_payout_enabled) {
    console.log('Owner auto payout disabled or unconfigured.');
    return;
  }

  // 2. Get owner wallet balance
  const { data: wallet } = await supabase
    .from('owner_wallets')
    .select('balance_minor, currency')
    .eq('id', 1)
    .single();

  if (!wallet || wallet.balance_minor < config.min_payout_minor) {
    console.log(`Owner balance ${wallet?.balance_minor || 0} below minimum payout threshold ${config.min_payout_minor}`);
    return;
  }

  const payoutAmount = wallet.balance_minor;

  if (config.payout_method === 'crypto_usdt') {
    if (!config.crypto_address) {
      console.error('Owner crypto payout destination unconfigured.');
      return;
    }

    const { data: withdrawalId, error: wErr } = await supabase.rpc('request_owner_withdrawal', {
      p_amount_minor: payoutAmount,
      p_currency: config.currency,
      p_destination: {
        method: 'crypto_usdt',
        network: config.crypto_network || 'TRC20',
        wallet_address: config.crypto_address,
      },
    });

    if (wErr || !withdrawalId) {
      console.error('Owner crypto withdrawal request error:', wErr?.message);
      return;
    }

    await supabase
      .from('owner_withdrawals')
      .update({ status: 'processing' })
      .eq('id', withdrawalId);

    console.log(`Successfully queued owner Crypto USDT payout of ${(payoutAmount / 100).toFixed(2)} ${config.currency} to ${config.crypto_address}`);
    return;
  }

  // Paystack Payout
  if (!config.bank_code || !config.account_number) {
    console.error('Owner Paystack bank details unconfigured.');
    return;
  }

  // 3. Ensure Paystack recipient code exists
  let recipientCode = config.recipient_code;
  if (!recipientCode) {
    const recipientRes = await createTransferRecipient(env, {
      name: config.account_name,
      account_number: config.account_number,
      bank_code: config.bank_code,
      currency: config.currency,
    });

    if (recipientRes.status && recipientRes.data?.recipient_code) {
      recipientCode = recipientRes.data.recipient_code;
      await supabase
        .from('owner_payout_config')
        .update({ recipient_code: recipientCode })
        .eq('id', 1);
    } else {
      console.error('Failed to create owner transfer recipient code:', recipientRes.message);
      return;
    }
  }

  // 4. Request owner withdrawal (security definer debit)
  const { data: withdrawalId, error: wErr } = await supabase.rpc('request_owner_withdrawal', {
    p_amount_minor: payoutAmount,
    p_currency: config.currency,
    p_destination: {
      method: 'paystack_bank',
      bank_code: config.bank_code,
      account_number: config.account_number,
      account_name: config.account_name,
      recipient_code: recipientCode,
    },
  });

  if (wErr || !withdrawalId) {
    console.error('Owner withdrawal request error:', wErr?.message);
    return;
  }

  // 5. Initiate Paystack transfer
  const ref = `earnflow_owner_${withdrawalId}`;
  const transferRes = await initiateTransfer(env, {
    amount_minor: payoutAmount,
    recipient_code: recipientCode,
    reason: 'EarnFlow Automated Owner Revenue Distribution',
    reference: ref,
  });

  if (transferRes.status) {
    await supabase
      .from('owner_withdrawals')
      .update({ status: 'processing', paystack_transfer_ref: ref })
      .eq('id', withdrawalId);
    console.log(`Successfully initiated owner payout of ${(payoutAmount / 100).toFixed(2)} ${config.currency}`);
  } else {
    // Reverse owner debit if transfer API rejected
    await supabase.from('owner_ledger_entries').insert({
      entry_type: 'owner_withdrawal_reversal',
      amount_minor: payoutAmount,
      currency: config.currency,
      related_withdrawal_id: withdrawalId,
      memo: `Failed owner transfer: ${transferRes.message}`,
    });

    await supabase
      .from('owner_withdrawals')
      .update({ status: 'failed', failure_reason: transferRes.message })
      .eq('id', withdrawalId);

    console.error('Owner transfer failed:', transferRes.message);
  }
}

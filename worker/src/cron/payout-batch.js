import { serviceClient } from '../lib/supabase.js';
import { initiateTransfer } from '../lib/paystack.js';

/** Runs nightly: sends approved withdrawals to Paystack and reconciles results. */
export async function runPayoutBatch(env) {
  const supabase = serviceClient(env);

  const { data: pending } = await supabase.from('withdrawals').select('*').eq('status', 'requested');

  for (const w of pending || []) {
    const reference = `earnflow_${w.id}`;
    const result = await initiateTransfer(env, {
      amount_minor: w.amount_minor,
      recipient_code: w.destination.recipient_code,
      reason: 'EarnFlow withdrawal',
      reference,
    });

    if (result.status) {
      await supabase
        .from('withdrawals')
        .update({ status: 'processing', paystack_transfer_ref: reference })
        .eq('id', w.id);
    } else {
      // Reverse the ledger debit so the user's balance is restored.
      await supabase.from('ledger_entries').insert({
        user_id: w.user_id,
        entry_type: 'withdrawal_reversal',
        amount_minor: w.amount_minor,
        currency: w.currency,
        related_withdrawal_id: w.id,
        memo: `Failed transfer: ${result.message}`,
      });
      await supabase
        .from('withdrawals')
        .update({ status: 'failed', failure_reason: result.message })
        .eq('id', w.id);
    }
  }
  // Final status (paid/failed) is confirmed via the Paystack transfer webhook,
  // not here — see a dedicated webhook route to add under routes/ if not
  // already present when Antigravity wires up Paystack event listening.
}

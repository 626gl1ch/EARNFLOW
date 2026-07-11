import { serviceClient } from '../lib/supabase.js';

/**
 * Server-to-server postback endpoints for CPA / survey / ad networks.
 * These are the ONLY trusted source of truth for provider-driven task
 * categories (cpa, ppc, download, survey, watch_ads, sponsored_video) —
 * never credit those categories from a client-side call.
 *
 * Each provider has a slightly different postback format; normalize them
 * here into a common shape, then always validate a shared secret before
 * doing anything else.
 */
export async function handlePostbacks(request, env, ctx, json, subpath) {
  const supabase = serviceClient(env);
  const url = new URL(request.url);

  if (subpath === '/cpalead') return handleGenericCpaPostback(request, url, env, supabase, json, 'cpalead');
  if (subpath === '/adgatemedia') return handleGenericCpaPostback(request, url, env, supabase, json, 'adgatemedia');
  if (subpath === '/offertoro') return handleGenericCpaPostback(request, url, env, supabase, json, 'offertoro');
  if (subpath === '/mylead') return handleGenericCpaPostback(request, url, env, supabase, json, 'mylead');
  if (subpath === '/bitlabs') return handleGenericCpaPostback(request, url, env, supabase, json, 'bitlabs');
  if (subpath === '/cpxresearch') return handleGenericCpaPostback(request, url, env, supabase, json, 'cpxresearch');

  return null;
}

async function handleGenericCpaPostback(request, url, env, supabase, json, provider) {
  // Each network's exact query param names differ (subid, s1, uid, etc.) —
  // Antigravity should map each provider's real postback spec here. The
  // shape below is the common pattern across most GPT-style networks.
  const secret = url.searchParams.get('secret');
  const expectedSecret = env[`POSTBACK_SECRET_${provider.toUpperCase()}`];
  if (!secret || secret !== expectedSecret) {
    return json({ error: 'invalid_secret' }, 403);
  }

  const userId = url.searchParams.get('subid') || url.searchParams.get('uid');
  const providerOfferId = url.searchParams.get('offer_id') || url.searchParams.get('oid');
  const payoutAmount = url.searchParams.get('payout'); // provider's stated gross payout, for reconciliation
  const status = url.searchParams.get('status') || 'confirmed'; // some networks send 'reversed' on chargeback

  if (!userId || !providerOfferId) {
    return json({ error: 'missing_required_params' }, 400);
  }

  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('provider', provider)
    .eq('provider_offer_id', providerOfferId)
    .single();

  if (!task) return json({ error: 'unknown_offer' }, 404);

  if (status === 'reversed' || status === 'chargeback') {
    // Provider is reversing a previously-credited completion (common with CPA networks).
    await supabase
      .from('task_completions')
      .update({ status: 'rejected', rejection_reason: 'provider_chargeback' })
      .eq('task_id', task.id)
      .eq('user_id', userId);

    await supabase.from('fraud_flags').insert({
      user_id: userId,
      flag_type: 'provider_chargeback',
      severity: 'medium',
      details: { provider, provider_offer_id: providerOfferId },
    });

    // Claw back the credited amount via a negative ledger entry.
    await supabase.from('ledger_entries').insert({
      user_id: userId,
      entry_type: 'withdrawal_reversal',
      amount_minor: -task.payout_minor,
      currency: task.currency,
      memo: `Chargeback: ${provider} offer ${providerOfferId}`,
    });

    return json({ ok: true, action: 'reversed' });
  }

  // Find or create the pending completion, mark verified, then pay.
  let { data: completion } = await supabase
    .from('task_completions')
    .select('*')
    .eq('task_id', task.id)
    .eq('user_id', userId)
    .single();

  if (!completion) {
    const { data: created } = await supabase
      .from('task_completions')
      .insert({ task_id: task.id, user_id: userId, status: 'pending' })
      .select()
      .single();
    completion = created;
  }

  if (completion.status === 'paid') {
    return json({ ok: true, action: 'already_paid' }); // idempotent — networks retry postbacks
  }

  await supabase
    .from('task_completions')
    .update({
      status: 'verified',
      completed_at: new Date().toISOString(),
      provider_postback_payload: { provider, providerOfferId, payoutAmount, raw: Object.fromEntries(url.searchParams) },
    })
    .eq('id', completion.id);

  const { error: payErr } = await supabase.rpc('complete_task', { p_task_completion_id: completion.id });
  if (payErr) return json({ error: 'payout_failed', message: payErr.message }, 500);

  return json({ ok: true, action: 'paid' });
}

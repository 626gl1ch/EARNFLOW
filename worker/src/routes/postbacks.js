import { serviceClient } from '../lib/supabase.js';
import { verifyWebhookSignature } from '../lib/paystack.js';
import { processReferralBonus } from '../lib/referral.js';

/**
 * Server-to-server postback endpoints for CPA / survey / ad networks.
 *
 * IMPORTANT — CPA CONFIRMATION STATE MACHINE:
 * External provider tasks (cpa, ppc, download, survey) go through
 * pending_confirmation → paid (or rejected) rather than instant credit.
 * This protects against network chargebacks / delayed reversals.
 *
 * Confirmation window per network (set on tasks.confirmation_window_hours):
 *   - CPALead, AdGateMedia, OfferToro, MyLead: 24–48 hrs
 *   - BitLabs, CPX Research, TheoremReach: 0–24 hrs (surveys confirm fast)
 *   - Adsterra, PropellerAds, Monetag: 0 hrs (ad views = instant)
 *   - Watch Ads / Captcha / Streak / Micro-task (inhouse): 0 hrs (instant)
 *
 * During pending_confirmation, the amount sits in wallets.pending_minor
 * (NOT in balance_minor). The cron/confirm-pending.js job sweeps hourly
 * and promotes completions whose window has elapsed.
 */
export async function handlePostbacks(request, env, ctx, json, subpath) {
  const supabase = serviceClient(env);
  const url = new URL(request.url);

  if (subpath === '/paystack') return handlePaystackPostback(request, env, supabase, json);

  if (subpath === '/cpalead')     return handleCpaPostback(request, url, env, supabase, json, 'cpalead',     ctx);
  if (subpath === '/adgatemedia') return handleCpaPostback(request, url, env, supabase, json, 'adgatemedia', ctx);
  if (subpath === '/offertoro')   return handleCpaPostback(request, url, env, supabase, json, 'offertoro',   ctx);
  if (subpath === '/mylead')      return handleCpaPostback(request, url, env, supabase, json, 'mylead',      ctx);
  if (subpath === '/bitlabs')     return handleSurveyPostback(request, url, env, supabase, json, 'bitlabs',      ctx);
  if (subpath === '/cpxresearch') return handleSurveyPostback(request, url, env, supabase, json, 'cpxresearch',  ctx);
  if (subpath === '/theoremreach')return handleTheoremReachPostback(request, url, env, supabase, json, ctx);

  return null;
}

// ============================================================================
// GENERIC CPA POSTBACK (CPALead, AdGateMedia, OfferToro, MyLead)
// Sets status = pending_confirmation, NOT immediately paid.
// Funds go into pending_minor until cron confirms.
// ============================================================================
async function handleCpaPostback(request, url, env, supabase, json, provider, ctx) {
  const secret = url.searchParams.get('secret');
  const expectedSecret = env[`POSTBACK_SECRET_${provider.toUpperCase()}`];
  if (!secret || !expectedSecret || !timingSafeEqual(secret, expectedSecret)) {
    return json({ error: 'invalid_secret' }, 403);
  }

  // Sub-ID is the unique click_id/completion_id we passed when user clicked the offer.
  // Always verify this against an existing pending completion — never create one blind.
  const subId       = url.searchParams.get('subid') || url.searchParams.get('uid') || url.searchParams.get('click_id');
  const providerOfferId = url.searchParams.get('offer_id') || url.searchParams.get('oid');
  const payoutParam = parseFloat(url.searchParams.get('payout') || '0');  // provider's gross, for reconciliation
  const status      = url.searchParams.get('status') || 'confirmed';

  if (!subId) {
    return json({ error: 'missing_subid', detail: 'subid/uid/click_id is required' }, 400);
  }

  // Fetch the task first so we know the confirmation window
  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('provider', provider)
    .eq('provider_offer_id', providerOfferId)
    .single();

  if (!task) return json({ error: 'unknown_offer', provider, offer_id: providerOfferId }, 404);

  // REVERSAL / CHARGEBACK path — provider is clawing back a previous credit
  if (status === 'reversed' || status === 'chargeback') {
    return handleChargeback(supabase, json, task, subId, provider, providerOfferId);
  }

  // Find existing pending completion that matches this subId
  // subId might be the completion ID (best) or user ID (fallback)
  let { data: completion } = await supabase
    .from('task_completions')
    .select('*')
    .eq('id', subId)
    .single();

  // If subId is not a completion UUID, try matching by user_id + task_id
  if (!completion) {
    const res = await supabase
      .from('task_completions')
      .select('*')
      .eq('task_id', task.id)
      .eq('user_id', subId)
      .in('status', ['pending', 'pending_confirmation'])
      .order('started_at', { ascending: false })
      .limit(1);
    completion = res.data?.[0] || null;
  }

  // Still nothing — this postback arrived without a matching record (duplicate or orphan)
  if (!completion) {
    // Some networks fire postbacks before the user even clicks (pre-ping). Log and ignore.
    return json({ ok: true, action: 'no_matching_completion' });
  }

  // Idempotent — already fully paid or already reversed
  if (completion.status === 'paid') return json({ ok: true, action: 'already_paid' });
  if (completion.status === 'rejected') return json({ ok: true, action: 'already_rejected' });

  const confirmWindowHours = task.confirmation_window_hours || 24; // default 24hr for CPA
  const confirmAt = new Date(Date.now() + confirmWindowHours * 3600 * 1000).toISOString();

  // Move to pending_confirmation — funds will be held until cron releases them
  await supabase
    .from('task_completions')
    .update({
      status: 'pending_confirmation',
      completed_at: new Date().toISOString(),
      confirmed_at: confirmAt,
      provider_postback_payload: {
        provider,
        providerOfferId,
        payoutParam,
        status,
        raw: Object.fromEntries(url.searchParams),
      },
    })
    .eq('id', completion.id);

  // Atomically increment pending_minor
  await supabase.rpc('adjust_pending_minor', {
    p_user_id: completion.user_id,
    p_amount_minor: task.payout_minor,
  });

  return json({ ok: true, action: 'pending_confirmation', confirm_at: confirmAt, window_hours: confirmWindowHours });
}

// ============================================================================
// SURVEY POSTBACK — BitLabs and CPX Research
// Surveys typically confirm within 24hrs; lower window than CPA
// ============================================================================
async function handleSurveyPostback(request, url, env, supabase, json, provider, ctx) {
  const secret = url.searchParams.get('secret') || url.searchParams.get('hash');
  const expectedSecret = env[`POSTBACK_SECRET_${provider.toUpperCase()}`];
  if (!secret || !expectedSecret || !timingSafeEqual(secret, expectedSecret)) {
    return json({ error: 'invalid_secret' }, 403);
  }

  const userId  = url.searchParams.get('subid') || url.searchParams.get('user_id') || url.searchParams.get('ext_user_id');
  const surveyId = url.searchParams.get('survey_id') || url.searchParams.get('sid');

  if (!userId) return json({ error: 'missing_user_id' }, 400);

  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('provider', provider)
    .eq('provider_offer_id', surveyId)
    .single();

  // If no discrete task row exists (widget-mode), skip — surveys handled via widget only
  if (!task) return json({ ok: true, action: 'widget_mode_no_task' });

  // Find pending completion
  let { data: completion } = await supabase
    .from('task_completions')
    .select('*')
    .eq('task_id', task.id)
    .eq('user_id', userId)
    .in('status', ['pending', 'pending_confirmation'])
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (!completion) {
    // Create it — survey networks may postback without a prior start event
    const ins = await supabase
      .from('task_completions')
      .insert({ task_id: task.id, user_id: userId, status: 'pending' })
      .select().single();
    completion = ins.data;
    if (!completion) return json({ error: 'could_not_create_completion' }, 500);
  }

  if (completion.status === 'paid') return json({ ok: true, action: 'already_paid' });

  const confirmWindowHours = task.confirmation_window_hours || 0; // surveys = 0 (instant) once postback arrives

  if (confirmWindowHours === 0) {
    // Instant credit for surveys
    await supabase
      .from('task_completions')
      .update({ status: 'verified', completed_at: new Date().toISOString(), provider_postback_payload: Object.fromEntries(url.searchParams) })
      .eq('id', completion.id);

    const { error: payErr } = await supabase.rpc('complete_task', { p_task_completion_id: completion.id });
    if (payErr) return json({ error: 'payout_failed', message: payErr.message }, 500);

    ctx.waitUntil(processReferralBonus(supabase, userId, task.payout_minor, task.currency, completion.id));
    return json({ ok: true, action: 'paid' });
  }

  // Survey with confirmation window
  const confirmAt = new Date(Date.now() + confirmWindowHours * 3600 * 1000).toISOString();
  await supabase.from('task_completions').update({
    status: 'pending_confirmation',
    completed_at: new Date().toISOString(),
    confirmed_at: confirmAt,
    provider_postback_payload: Object.fromEntries(url.searchParams),
  }).eq('id', completion.id);

  return json({ ok: true, action: 'pending_confirmation', confirm_at: confirmAt });
}

// ============================================================================
// THEOREMREACH — uses URL redirect + hash verification (more secure per their docs)
// ============================================================================
async function handleTheoremReachPostback(request, url, env, supabase, json, ctx) {
  // TheoremReach uses HMAC SHA-1 hash of (user_id + app_id) for verification
  const userId  = url.searchParams.get('uid') || url.searchParams.get('sub_id');
  const rewardAmt = url.searchParams.get('reward');
  const hash    = url.searchParams.get('hash');
  const apiKey  = env.POSTBACK_SECRET_THEOREMREACH;

  if (!userId || !hash || !apiKey) {
    return json({ error: 'missing_required_params' }, 400);
  }

  // TheoremReach hash: HMAC-SHA1(uid + ':' + apiKey)
  // We verify using Web Crypto since Node crypto isn't available in Workers
  const encoder = new TextEncoder();
  const keyData = encoder.encode(apiKey);
  const msgData = encoder.encode(`${userId}:${apiKey}`);
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sigBuf  = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const computed = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2,'0')).join('');

  if (computed !== hash) {
    return json({ error: 'invalid_hash' }, 403);
  }

  // Find any pending survey task by this user
  const { data: completion } = await supabase
    .from('task_completions')
    .select('*, tasks(*)')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (!completion) return json({ ok: true, action: 'no_pending_task' });
  if (completion.status === 'paid') return json({ ok: true, action: 'already_paid' });

  await supabase.from('task_completions').update({
    status: 'verified',
    completed_at: new Date().toISOString(),
    provider_postback_payload: { provider: 'theoremreach', userId, rewardAmt, raw: Object.fromEntries(url.searchParams) },
  }).eq('id', completion.id);

  const { error: payErr } = await supabase.rpc('complete_task', { p_task_completion_id: completion.id });
  if (payErr) return json({ error: 'payout_failed', message: payErr.message }, 500);

  ctx.waitUntil(processReferralBonus(supabase, userId, completion.tasks?.payout_minor || 0, completion.tasks?.currency || 'NGN', completion.id));

  return json({ ok: true, action: 'paid' });
}

// ============================================================================
// CHARGEBACK handler — reverses a previously pending/paid completion
// ============================================================================
async function handleChargeback(supabase, json, task, subId, provider, providerOfferId) {
  const { data: completion } = await supabase
    .from('task_completions')
    .select('*')
    .or(`id.eq.${subId},user_id.eq.${subId}`)
    .eq('task_id', task.id)
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (!completion) return json({ ok: true, action: 'no_completion_to_reverse' });

  await supabase.from('task_completions').update({
    status: 'rejected',
    rejection_reason: `provider_chargeback:${provider}`,
  }).eq('id', completion.id);

  await supabase.from('fraud_flags').insert({
    user_id: completion.user_id,
    flag_type: 'provider_chargeback',
    severity: 'medium',
    details: { provider, provider_offer_id: providerOfferId, completion_id: completion.id },
  });

  // If the completion was already paid, claw back the amount from user balance
  if (completion.status === 'paid') {
    await supabase.from('ledger_entries').insert({
      user_id: completion.user_id,
      entry_type: 'withdrawal_reversal',
      amount_minor: -task.payout_minor,
      currency: task.currency,
      memo: `Chargeback: ${provider} offer ${providerOfferId}`,
    });
  }

  // If it was pending_confirmation, just clear the pending_minor hold
  if (completion.status === 'pending_confirmation') {
    await supabase.rpc('adjust_pending_minor', {
      p_user_id: completion.user_id,
      p_amount_minor: -task.payout_minor,
    });
  }

  return json({ ok: true, action: 'reversed' });
}

// ============================================================================
// PAYSTACK WEBHOOK — transfer success/failure for user cashouts & owner payouts
// ============================================================================
async function handlePaystackPostback(request, env, supabase, json) {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const signatureHeader = request.headers.get('x-paystack-signature');
  if (!signatureHeader) {
    return json({ error: 'missing_signature' }, 401);
  }

  const rawBody = await request.text();
  const isValid = await verifyWebhookSignature(rawBody, signatureHeader, env);
  if (!isValid) {
    return json({ error: 'invalid_signature' }, 401);
  }

  const payload = JSON.parse(rawBody);
  const event = payload.event;
  const data = payload.data || {};
  const reference = data.reference || '';

  if (!reference.startsWith('earnflow_')) {
    return json({ ok: true, message: 'ignored_reference' });
  }

  // Handle OWNER revenue transfer postbacks
  if (reference.startsWith('earnflow_owner_')) {
    const withdrawalId = reference.replace('earnflow_owner_', '');
    const { data: ow, error: owErr } = await supabase
      .from('owner_withdrawals')
      .select('*')
      .eq('id', withdrawalId)
      .single();

    if (owErr || !ow) {
      return json({ error: 'owner_withdrawal_not_found' }, 404);
    }

    if (['paid', 'failed', 'reversed'].includes(ow.status)) {
      return json({ ok: true, message: 'already_processed' });
    }

    if (event === 'transfer.success') {
      await supabase
        .from('owner_withdrawals')
        .update({ status: 'paid', processed_at: new Date().toISOString() })
        .eq('id', ow.id);
      return json({ ok: true, action: 'owner_marked_paid' });
    }

    if (event === 'transfer.failed' || event === 'transfer.reversed') {
      const failureReason = data.gateway_response || 'Paystack owner transfer failed';
      await supabase.from('owner_ledger_entries').insert({
        entry_type: 'owner_withdrawal_reversal',
        amount_minor: ow.amount_minor,
        currency: ow.currency,
        related_withdrawal_id: ow.id,
        memo: `Failed owner transfer: ${failureReason}`,
      });

      await supabase
        .from('owner_withdrawals')
        .update({ status: 'failed', failure_reason: failureReason, processed_at: new Date().toISOString() })
        .eq('id', ow.id);

      return json({ ok: true, action: 'owner_marked_failed' });
    }
    return json({ ok: true, message: 'event_ignored' });
  }

  // Handle USER transfer postbacks
  const withdrawalId = reference.replace('earnflow_', '');
  const { data: w, error: wErr } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('id', withdrawalId)
    .single();

  if (wErr || !w) {
    return json({ error: 'withdrawal_not_found' }, 404);
  }

  if (['paid', 'failed', 'reversed'].includes(w.status)) {
    return json({ ok: true, message: 'already_processed' });
  }

  if (event === 'transfer.success') {
    await supabase
      .from('withdrawals')
      .update({ status: 'paid', processed_at: new Date().toISOString() })
      .eq('id', w.id);

    return json({ ok: true, action: 'marked_paid' });
  }

  if (event === 'transfer.failed' || event === 'transfer.reversed') {
    const failureReason = data.gateway_response || 'Paystack transfer failed';

    // Reverse the ledger debit so the user's balance is restored
    await supabase.from('ledger_entries').insert({
      user_id: w.user_id,
      entry_type: 'withdrawal_reversal',
      amount_minor: w.amount_minor,
      currency: w.currency,
      related_withdrawal_id: w.id,
      memo: `Failed transfer: ${failureReason}`,
    });

    await supabase
      .from('withdrawals')
      .update({ status: 'failed', failure_reason: failureReason, processed_at: new Date().toISOString() })
      .eq('id', w.id);

    return json({ ok: true, action: 'marked_failed' });
  }

  return json({ ok: true, message: 'event_ignored' });
}

/**
 * Timing-safe string comparison to mitigate timing attacks on postback secrets.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

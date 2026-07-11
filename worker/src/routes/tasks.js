import { serviceClient, getUserFromRequest } from '../lib/supabase.js';
import { getPersonalizedFeed } from '../lib/matching.js';
import { checkIpRisk } from '../lib/ipqs.js';
import { isRateLimited } from '../lib/ratelimit.js';
import { processReferralBonus } from '../lib/referral.js';

export async function handleTasks(request, env, ctx, json, subpath) {
  const supabase = serviceClient(env);
  const { user } = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  // GET /api/tasks/feed?page=1 — the personalized dashboard feed
  if (subpath.startsWith('/feed') && request.method === 'GET') {
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (!profile) return json({ error: 'profile_not_found' }, 404);

    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') || '1');
    const feed = await getPersonalizedFeed(supabase, profile, { page });
    return json(feed);
  }

  // POST /api/tasks/:id/start — begin an attempt (records started_at, IP, fingerprint)
  const startMatch = subpath.match(/^\/([0-9a-f-]{36})\/start$/);
  if (startMatch && request.method === 'POST') {
    // Rate limit user on task starting (e.g. max 10 requests, refills 0.2/sec)
    if (await isRateLimited(user.id, 'user_task', env, { maxTokens: 10, refillRate: 0.2 })) {
      return json({ error: 'rate_limited', message: 'Slow down. You are starting tasks too quickly.' }, 429);
    }

    const taskId = startMatch[1];
    const body = await request.json().catch(() => ({}));
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';

    const risk = await checkIpRisk(ip, env);
    if (risk.recommended_action === 'block') {
      return json({ error: 'blocked', reason: 'high_risk_ip' }, 403);
    }

    // Fetch the task and its category to check type
    const { data: task, error: taskErr } = await supabase
      .from('tasks')
      .select('*, task_categories(slug)')
      .eq('id', taskId)
      .single();

    if (taskErr || !task) {
      return json({ error: 'task_not_found' }, 404);
    }

    if (!task.is_active) {
      return json({ error: 'task_inactive' }, 400);
    }

    const { data, error } = await supabase
      .from('task_completions')
      .insert({
        task_id: taskId,
        user_id: user.id,
        ip_address: ip,
        device_fingerprint_hash: body.fingerprint || null,
        status: 'pending',
      })
      .select()
      .single();

    if (error) return json({ error: 'start_failed', message: error.message }, 400);

    // If it is a captcha task, generate challenge
    if (task.task_categories?.slug === 'captcha') {
      const captchaText = Math.random().toString(36).substring(2, 8).toUpperCase();
      // Store in KV with 5 minutes TTL
      if (env.FRAUD_KV) {
        await env.FRAUD_KV.put(`captcha:${data.id}`, captchaText, { expirationTtl: 300 });
      }
      return json({ completion_id: data.id, captcha: captchaText });
    }

    return json({ completion_id: data.id });
  }

  // POST /api/tasks/completions/:id/submit — used only by in-house categories
  // (captcha, micro-task, social, streak) where EarnFlow itself verifies the
  // submission. Provider-driven categories (CPA/survey/ad) are verified via
  // /api/postbacks instead — never trust a client "I'm done" for those.
  const submitMatch = subpath.match(/^\/completions\/([0-9a-f-]{36})\/submit$/);
  if (submitMatch && request.method === 'POST') {
    // Rate limit user on task completions (e.g. max 10 requests, refills 0.2/sec)
    if (await isRateLimited(user.id, 'user_submit', env, { maxTokens: 10, refillRate: 0.2 })) {
      return json({ error: 'rate_limited', message: 'Slow down. You are submitting completions too quickly.' }, 429);
    }

    const completionId = submitMatch[1];
    const body = await request.json().catch(() => ({}));

    const { data: completion } = await supabase
      .from('task_completions')
      .select('*, tasks(provider, category_id, payout_minor, currency, task_categories(slug))')
      .eq('id', completionId)
      .eq('user_id', user.id)
      .single();

    if (!completion) return json({ error: 'not_found' }, 404);
    if (completion.tasks.provider !== 'inhouse') {
      return json({ error: 'provider_verifies_this_category' }, 400);
    }

    const categorySlug = completion.tasks?.task_categories?.slug;

    // 1. Verify in-house captcha if it is a captcha task
    if (categorySlug === 'captcha') {
      if (!env.FRAUD_KV) {
        return json({ error: 'server_configuration_error', message: 'KV Store missing' }, 500);
      }
      const solution = await env.FRAUD_KV.get(`captcha:${completionId}`);
      if (!solution || solution !== String(body.solution || '').trim().toUpperCase()) {
        return json({ error: 'invalid_captcha', message: 'The captcha solution is incorrect.' }, 400);
      }
      // Solution is correct, remove from KV to prevent re-use
      await env.FRAUD_KV.delete(`captcha:${completionId}`);
    }

    // 2. Verify daily check-in (streak) task limit
    if (categorySlug === 'streak') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      // Check if user already completed any streak task today
      const { data: alreadyDone } = await supabase
        .from('task_completions')
        .select('id, tasks(category_id, task_categories(slug))')
        .eq('user_id', user.id)
        .eq('status', 'paid')
        .gte('completed_at', startOfDay.toISOString());

      const hasCheckedInToday = (alreadyDone || []).some(
        (c) => c.tasks?.task_categories?.slug === 'streak'
      );

      if (hasCheckedInToday) {
        return json({ error: 'streak_already_completed', message: 'You have already checked in today.' }, 400);
      }
    }

    const elapsed = Math.round((Date.now() - new Date(completion.started_at).getTime()) / 1000);
    if (elapsed < 3) {
      // Suspiciously fast — flag instead of auto-rejecting outright.
      await supabase.from('fraud_flags').insert({
        user_id: user.id,
        flag_type: 'velocity_abuse',
        severity: 'low',
        details: { completion_id: completionId, elapsed_seconds: elapsed },
      });
    }

    await supabase
      .from('task_completions')
      .update({
        status: 'verified',
        completed_at: new Date().toISOString(),
        time_to_complete_seconds: elapsed,
        provider_postback_payload: body,
      })
      .eq('id', completionId);

    const { error: payErr } = await supabase.rpc('complete_task', { p_task_completion_id: completionId });
    if (payErr) return json({ error: 'payout_failed', message: payErr.message }, 500);

    // 3. Process referral bonus asynchronously
    ctx.waitUntil(
      processReferralBonus(
        supabase,
        user.id,
        completion.tasks.payout_minor,
        completion.tasks.currency,
        completionId
      )
    );

    return json({ ok: true });
  }

  return null;
}

import { serviceClient, getUserFromRequest } from '../lib/supabase.js';
import { checkIpRisk, recordIpRiskCheck } from '../lib/ipqs.js';
import { isRateLimited } from '../lib/ratelimit.js';

export async function handleAuth(request, env, ctx, json, subpath) {
  const supabase = serviceClient(env);
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';

  // Apply IP-based rate limiting on auth endpoints
  if (await isRateLimited(ip, 'ip', env, { maxTokens: 10, refillRate: 0.2 })) {
    return json({ error: 'rate_limited', message: 'Too many auth requests. Please slow down.' }, 429);
  }

  // POST /api/auth/post-signup — called by the frontend right after Supabase Auth

  // sign-up succeeds, to run our own country/fraud pipeline against the new user.
  if (subpath === '/post-signup' && request.method === 'POST') {
    const { user } = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'unauthorized' }, 401);

    const body = await request.json().catch(() => ({}));
    const risk = await checkIpRisk(ip, env);
    await recordIpRiskCheck(supabase, user.id, risk);

    let country_status = 'unverified';
    if (risk.recommended_action === 'block') {
      return json({ error: 'signup_blocked', reason: 'high_risk_ip' }, 403);
    }
    if (!risk.is_vpn && !risk.is_proxy && !risk.is_datacenter && risk.country_code) {
      country_status = 'verified';
      await supabase.from('kyc_country_verifications').insert({
        user_id: user.id,
        signal_type: 'ip_geolocation',
        country_code: risk.country_code,
        raw_data: risk.raw,
      });
    }

    // Resolve referred_by if referral_code passed
    let referrerId = null;
    if (body.referral_code) {
      const { data: referrer } = await supabase
        .from('profiles')
        .select('id')
        .eq('referral_code', String(body.referral_code).trim())
        .single();
      if (referrer) {
        referrerId = referrer.id;
      }
    }

    const displayName = user.user_metadata?.display_name || body.display_name || user.email?.split('@')[0] || 'User';

    await supabase.from('profiles').upsert({
      id: user.id,
      display_name: displayName,
      country_code: risk.country_code,
      country_status,
      ...(referrerId ? { referred_by: referrerId } : {}),
    });

    if (referrerId) {
      await supabase.from('referrals').insert({
        referrer_id: referrerId,
        referee_id: user.id,
      }).catch(() => {}); // ignore duplicate if re-running
    }

    await supabase.from('wallets').upsert({ user_id: user.id, currency: 'NGN' }, { onConflict: 'user_id' });

    return json({ country_status, country_code: risk.country_code });
  }

  // POST /api/auth/login-check — called on every login to re-verify IP risk.
  if (subpath === '/login-check' && request.method === 'POST') {
    const { user } = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'unauthorized' }, 401);

    const risk = await checkIpRisk(ip, env);
    await recordIpRiskCheck(supabase, user.id, risk);

    if (risk.recommended_action === 'block') {
      return json({ error: 'login_blocked', reason: 'high_risk_ip' }, 403);
    }

    const { data: profile } = await supabase.from('profiles').select('country_code').eq('id', user.id).single();
    if (profile?.country_code && risk.country_code && profile.country_code !== risk.country_code) {
      await supabase.from('fraud_flags').insert({
        user_id: user.id,
        flag_type: 'country_mismatch',
        severity: 'medium',
        details: { known: profile.country_code, seen: risk.country_code },
      });
    }

    return json({ ok: true, recommended_action: risk.recommended_action });
  }

  return null;
}

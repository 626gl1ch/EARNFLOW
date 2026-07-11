import { serviceClient, getUserFromRequest } from '../lib/supabase.js';
import { checkIpRisk, recordIpRiskCheck } from '../lib/ipqs.js';

export async function handleFraud(request, env, ctx, json, subpath) {
  const supabase = serviceClient(env);

  // GET /api/fraud/check — called by the frontend before showing any paid
  // action (e.g. on task-feed load) so the UI can gate itself proactively
  // instead of only failing on submit.
  if (subpath === '/check' && request.method === 'GET') {
    const { user } = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'unauthorized' }, 401);

    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const risk = await checkIpRisk(ip, env);
    await recordIpRiskCheck(supabase, user.id, risk);

    return json({
      recommended_action: risk.recommended_action,
      is_vpn: risk.is_vpn,
      is_proxy: risk.is_proxy,
      is_datacenter: risk.is_datacenter,
    });
  }

  return null;
}

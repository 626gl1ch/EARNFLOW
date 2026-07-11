/**
 * IPQualityScore client — VPN/proxy/datacenter/Tor detection.
 * Docs: https://www.ipqualityscore.com/documentation/proxy-detection/overview
 *
 * Results are cached in Workers KV for a short TTL (default 6h) to control
 * API spend, keyed by IP address.
 */

const CACHE_TTL_SECONDS = 6 * 60 * 60;

export async function checkIpRisk(ip, env) {
  const cacheKey = `ipqs:${ip}`;
  const cached = await env.FRAUD_KV.get(cacheKey, 'json');
  if (cached) return cached;

  const url = `https://ipqualityscore.com/api/json/ip/${env.IPQS_API_KEY}/${ip}` +
    `?strictness=1&allow_public_access_points=true&fast=false&lighter_penalties=false`;

  const res = await fetch(url);
  const data = await res.json();

  const result = {
    ip,
    fraud_score: data.fraud_score ?? null,
    is_vpn: !!data.vpn,
    is_proxy: !!data.proxy,
    is_tor: !!data.tor,
    is_datacenter: !!data.is_crawler === false && data.connection_type === 'Data Center',
    country_code: data.country_code || null,
    recommended_action: classify(data),
    raw: data,
  };

  await env.FRAUD_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS });
  return result;
}

function classify(data) {
  const score = data.fraud_score ?? 0;
  if (data.tor || score >= 85) return 'block';
  if (data.vpn || data.proxy || data.connection_type === 'Data Center') return 'hold';
  if (score >= 60) return 'challenge';
  return 'allow';
}

/** Persist a risk check for audit + admin visibility. Call after checkIpRisk(). */
export async function recordIpRiskCheck(supabase, userId, result) {
  await supabase.from('ip_risk_checks').insert({
    user_id: userId,
    ip_address: result.ip,
    fraud_score: result.fraud_score,
    is_vpn: result.is_vpn,
    is_proxy: result.is_proxy,
    is_tor: result.is_tor,
    is_datacenter: result.is_datacenter,
    country_code: result.country_code,
    recommended_action: result.recommended_action,
    raw_response: result.raw,
  });
}

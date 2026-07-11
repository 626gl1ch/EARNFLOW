/**
 * Token Bucket Rate Limiter using Cloudflare KV.
 * Supports rate limiting by IP address and by User ID.
 */

export async function isRateLimited(id, type, env, options = {}) {
  const kv = env.FRAUD_KV;
  if (!kv) {
    // If KV is not bound (e.g., local dev without KV configured yet), skip rate limiting
    return false;
  }

  const limitKey = `ratelimit:${type}:${id}`;
  const now = Date.now();

  // Sensible defaults:
  // IP rate limiting: max 30 requests, refills 1 token/sec (bursty allowed, max 1 req/sec average)
  // Auth/Task rate limiting: max 5 requests, refills 0.1 tokens/sec (1 req every 10 sec average)
  const maxTokens = options.maxTokens ?? (type === 'ip' ? 30 : 5);
  const refillRate = options.refillRate ?? (type === 'ip' ? 1.0 : 0.1); // tokens per second
  const ttl = options.ttl ?? 3600; // 1 hour KV expiration

  try {
    const data = await kv.get(limitKey, 'json');
    let tokens = maxTokens;
    let lastUpdate = now;

    if (data) {
      const elapsed = (now - data.lastUpdate) / 1000;
      tokens = Math.min(maxTokens, data.tokens + elapsed * refillRate);
      lastUpdate = now;
    }

    if (tokens < 1) {
      // Out of tokens: save current state and block
      await kv.put(limitKey, JSON.stringify({ tokens, lastUpdate }), { expirationTtl: ttl });
      return true;
    }

    // Consume 1 token
    tokens -= 1;
    await kv.put(limitKey, JSON.stringify({ tokens, lastUpdate }), { expirationTtl: ttl });
    return false;
  } catch (err) {
    console.error('Rate limiting error:', err);
    return false; // Fail open to not block users on KV glitches
  }
}

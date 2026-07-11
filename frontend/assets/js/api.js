/**
 * Thin fetch wrapper around the EarnFlow Worker API.
 * Antigravity: wire `getSupabaseSession()` up to the actual Supabase JS
 * client once auth is initialized (mirrors the SnipeJob auth pattern).
 */
const EF_API_BASE = window.EF_API_BASE || 'https://api.earnflow.app'; // set per environment

async function efFetch(path, options = {}) {
  const session = await getSupabaseSession();
  const headers = {
    'Content-Type': 'application/json',
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`${EF_API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'unknown_error' }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function getSupabaseSession() {
  // Placeholder — replace with: const { data } = await supabase.auth.getSession(); return data.session;
  return window.__efSession || null;
}

const EF = {
  getFeed: (page = 1) => efFetch(`/api/tasks/feed?page=${page}`),
  getOffers: () => efFetch('/api/offers'),
  getSurveys: () => efFetch('/api/surveys'),
  getWallet: () => efFetch('/api/wallet'),
  getLedger: (limit = 25) => efFetch(`/api/wallet/ledger?limit=${limit}`),
  startTask: (taskId) => efFetch(`/api/tasks/${taskId}/start`, { method: 'POST', body: JSON.stringify({}) }),
  submitCompletion: (completionId, payload) =>
    efFetch(`/api/tasks/completions/${completionId}/submit`, { method: 'POST', body: JSON.stringify(payload) }),
  resolveAccount: (payload) => efFetch('/api/withdrawals/resolve-account', { method: 'POST', body: JSON.stringify(payload) }),
  requestWithdrawal: (payload) => efFetch('/api/withdrawals', { method: 'POST', body: JSON.stringify(payload) }),
  fraudCheck: () => efFetch('/api/fraud/check'),
};

/**
 * Thin fetch wrapper around the EarnFlow Worker API.
 * Antigravity: wire `getSupabaseSession()` up to the actual Supabase JS
 * client once auth is initialized (mirrors the SnipeJob auth pattern).
 */
const EF_API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8787'
  : 'https://earnflow-api.daniellancce1.workers.dev'; // production API url

const SUPABASE_URL = 'https://mdmpcxtjwnovbhidwwhj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6l7eSezczJta6rW2gomSqA_btj4X1h_';

let sb;
try {
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.error('Supabase client failed to initialize', e);
}

async function getSupabaseSession() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session;
}

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

/**
 * Raw fetch — returns the Response object (not parsed JSON).
 * Use when you need pagination meta, raw status, or to parse yourself.
 */
async function efRaw(path, method = 'GET', body = null) {
  const session = await getSupabaseSession();
  const headers = {
    'Content-Type': 'application/json',
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
  return fetch(`${EF_API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

const EF = {
  // Core feed + wallet
  getFeed:    (page = 1)       => efFetch(`/api/tasks/feed?page=${page}`),
  getOffers:  ()               => efFetch('/api/offers'),
  getSurveys: ()               => efFetch('/api/surveys'),
  getWallet:  ()               => efFetch('/api/wallet'),
  getLedger:  (limit = 25)     => efFetch(`/api/wallet/ledger?limit=${limit}`),

  // Task lifecycle
  startTask: (taskId) =>
    efFetch(`/api/tasks/${taskId}/start`, { method: 'POST', body: JSON.stringify({}) }),
  submitCompletion: (completionId, payload) =>
    efFetch(`/api/tasks/completions/${completionId}/submit`, { method: 'POST', body: JSON.stringify(payload) }),
  dismissCompletion: (completionId) =>
    efRaw(`/api/tasks/completions/${completionId}/dismiss`, 'DELETE'),

  // Earnings tracking (new v2 endpoints)
  getEarnings:    ()                        => efRaw('/api/tasks/earnings-by-category', 'GET'),
  getTaskHistory: (status = 'paid', page = 1) => efRaw(`/api/tasks/history?status=${status}&page=${page}`, 'GET'),

  // Withdrawals
  resolveAccount:    (payload) => efFetch('/api/withdrawals/resolve-account', { method: 'POST', body: JSON.stringify(payload) }),
  requestWithdrawal: (payload) => efFetch('/api/withdrawals', { method: 'POST', body: JSON.stringify(payload) }),

  // Misc
  fraudCheck: () => efFetch('/api/fraud/check'),

  /**
   * Generic raw API call — returns raw Response.
   * Used by dashboard.js for endpoints that need pagination meta.
   */
  api: (path, method = 'GET', body = null) => efRaw(path, method, body),
};

/**
 * Paystack client for payouts (Transfers API). Prefer the official
 * @paystack/mcp-server integration where the coding agent's environment
 * supports MCP tool calls directly; this fetch-based wrapper is the fallback
 * / reference implementation.
 */

const BASE = 'https://api.paystack.co';

function authHeaders(env) {
  return {
    Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

export async function resolveAccount(env, { account_number, bank_code }) {
  const res = await fetch(`${BASE}/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`, {
    headers: authHeaders(env),
  });
  return res.json();
}

export async function createTransferRecipient(env, { name, account_number, bank_code, currency = 'NGN' }) {
  const res = await fetch(`${BASE}/transferrecipient`, {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify({ type: 'nuban', name, account_number, bank_code, currency }),
  });
  return res.json();
}

export async function initiateTransfer(env, { amount_minor, recipient_code, reason, reference }) {
  const res = await fetch(`${BASE}/transfer`, {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify({
      source: 'balance',
      amount: amount_minor, // Paystack expects kobo for NGN — already minor units
      recipient: recipient_code,
      reason,
      reference,
    }),
  });
  return res.json();
}

/** Verify a Paystack webhook signature (x-paystack-signature header, HMAC SHA512). */
export async function verifyWebhookSignature(rawBody, signatureHeader, env) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.PAYSTACK_SECRET_KEY),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computed = [...new Uint8Array(sigBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return computed === signatureHeader;
}

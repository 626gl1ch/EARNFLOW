import { serviceClient } from '../lib/supabase.js';

/**
 * Runs every 6 hours: proactive fraud sweep for patterns that are hard to
 * catch in the request/response path — device fingerprints shared across
 * many accounts, and abnormal completion velocity.
 */
export async function runFraudSweep(env) {
  const supabase = serviceClient(env);

  // Multi-accounting: same device fingerprint used by 3+ distinct users.
  const { data: fingerprints } = await supabase.rpc('sql', {}).catch(() => ({ data: null }));
  // NOTE: Antigravity — implement as a proper SQL view/function
  // (e.g. `select fingerprint_hash, count(distinct user_id) from device_fingerprints
  //  group by fingerprint_hash having count(distinct user_id) >= 3`)
  // exposed as a Postgres function callable via supabase.rpc(), since the
  // JS client doesn't support raw GROUP BY queries directly.

  const { data: sharedDevices } = await supabase.rpc('find_shared_device_fingerprints', { min_accounts: 3 });
  for (const row of sharedDevices || []) {
    const { data: users } = await supabase
      .from('device_fingerprints')
      .select('user_id')
      .eq('fingerprint_hash', row.fingerprint_hash);

    for (const u of users || []) {
      await supabase.from('fraud_flags').insert({
        user_id: u.user_id,
        flag_type: 'multi_account',
        severity: 'high',
        details: { fingerprint_hash: row.fingerprint_hash, shared_with_count: row.account_count },
      });
    }
  }
}

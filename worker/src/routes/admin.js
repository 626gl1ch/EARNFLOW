import { serviceClient, getUserFromRequest } from '../lib/supabase.js';

async function requireAdmin(request, env, supabase) {
  const { user } = await getUserFromRequest(request, env);
  if (!user) return null;
  const { data: admin } = await supabase.from('admin_users').select('*').eq('id', user.id).single();
  return admin ? { user, admin } : null;
}

export async function handleAdmin(request, env, ctx, json, subpath) {
  const supabase = serviceClient(env);
  const auth = await requireAdmin(request, env, supabase);
  if (!auth) return json({ error: 'forbidden' }, 403);

  // GET /api/admin/fraud-queue — unresolved flags for manual review
  if (subpath === '/fraud-queue' && request.method === 'GET') {
    const { data } = await supabase
      .from('fraud_flags')
      .select('*, profiles(display_name, country_code)')
      .eq('resolved', false)
      .order('severity', { ascending: false })
      .order('created_at', { ascending: true });
    return json({ items: data || [] });
  }

  // POST /api/admin/fraud-queue/:id/resolve  { action: 'warn'|'hold_funds'|'suspend'|'ban' }
  const resolveMatch = subpath.match(/^\/fraud-queue\/([0-9a-f-]{36})\/resolve$/);
  if (resolveMatch && request.method === 'POST') {
    const flagId = resolveMatch[1];
    const { action } = await request.json();

    const { data: flag } = await supabase.from('fraud_flags').select('*').eq('id', flagId).single();
    await supabase
      .from('fraud_flags')
      .update({ resolved: true, resolved_by: auth.user.id, action_taken: action, resolved_at: new Date().toISOString() })
      .eq('id', flagId);

    if (action === 'suspend' || action === 'ban') {
      await supabase
        .from('profiles')
        .update({ is_suspended: true, suspension_reason: `${action}: ${flag.flag_type}` })
        .eq('id', flag.user_id);
    }

    await supabase.from('audit_log').insert({
      actor: auth.user.id,
      action: `fraud_flag_${action}`,
      target_table: 'fraud_flags',
      target_id: flagId,
    });

    return json({ ok: true });
  }

  // POST /api/admin/tasks — create a new task/offer
  if ((subpath === '/tasks') && request.method === 'POST') {
    const body = await request.json();
    const { data, error } = await supabase.from('tasks').insert(body).select().single();
    if (error) return json({ error: error.message }, 400);
    await supabase.from('audit_log').insert({ actor: auth.user.id, action: 'task_created', target_table: 'tasks', target_id: data.id });
    return json(data);
  }

  // GET /api/admin/withdrawals?status=requested
  if (subpath === '/withdrawals' && request.method === 'GET') {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || 'requested';
    const { data } = await supabase
      .from('withdrawals')
      .select('*, profiles(display_name, country_code)')
      .eq('status', status)
      .order('requested_at', { ascending: true });
    return json({ items: data || [] });
  }

  // GET /api/admin/owner-revenue — get platform profit stats and owner config
  if (subpath === '/owner-revenue' && request.method === 'GET') {
    const { data: wallet } = await supabase.from('owner_wallets').select('*').eq('id', 1).single();
    const { data: config } = await supabase.from('owner_payout_config').select('*').eq('id', 1).single();
    const { data: withdrawals } = await supabase.from('owner_withdrawals').select('*').order('requested_at', { ascending: false }).limit(20);
    const { data: recentCommission } = await supabase.from('owner_ledger_entries').select('*').order('created_at', { ascending: false }).limit(20);

    return json({
      wallet: wallet || { balance_minor: 0, lifetime_commission_minor: 0, currency: 'NGN' },
      config: config || null,
      withdrawals: withdrawals || [],
      recent_commission: recentCommission || [],
    });
  }

  // POST /api/admin/owner-bank — update owner payout bank details
  if (subpath === '/owner-bank' && request.method === 'POST') {
    const body = await request.json();
    const { bank_code, account_number, account_name, auto_payout_enabled, min_payout_minor } = body;

    const payload = {
      id: 1,
      bank_code,
      account_number,
      account_name,
      auto_payout_enabled: auto_payout_enabled ?? true,
      min_payout_minor: min_payout_minor || 500000,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from('owner_payout_config').upsert(payload).select().single();
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true, config: data });
  }

  // POST /api/admin/owner-payout — trigger immediate manual payout to owner bank
  if (subpath === '/owner-payout' && request.method === 'POST') {
    const { runOwnerPayout } = await import('../cron/owner-payout.js');
    await runOwnerPayout(env);
    return json({ ok: true, message: 'Owner payout batch execution triggered.' });
  }

  return null;
}


import { serviceClient, getUserFromRequest } from '../lib/supabase.js';

export async function handleWallet(request, env, ctx, json, subpath) {
  const supabase = serviceClient(env);
  const { user } = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  if ((subpath === '' || subpath === '/') && request.method === 'GET') {
    const { data: wallet } = await supabase.from('wallets').select('*').eq('user_id', user.id).single();
    return json(wallet || { balance_minor: 0, pending_minor: 0, lifetime_earned_minor: 0, currency: 'NGN' });
  }

  if (subpath === '/ledger' && request.method === 'GET') {
    const url = new URL(request.url);
    const limit = Math.min(100, Number(url.searchParams.get('limit') || '25'));
    const { data } = await supabase
      .from('ledger_entries')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    return json({ items: data || [] });
  }

  return null;
}

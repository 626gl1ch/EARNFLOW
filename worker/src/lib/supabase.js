import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client — full access, bypasses RLS. Only ever used inside the
 * Worker (never exposed to the frontend). Use for money-moving operations,
 * postback processing, and admin actions.
 */
export function serviceClient(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * User-scoped client — respects RLS, built from the JWT the frontend sends
 * in the Authorization header. Use for any read that should be scoped to
 * "the currently logged in user" so RLS does the enforcement for us.
 */
export function userClient(env, jwt) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
}

export async function getUserFromRequest(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const jwt = auth.replace('Bearer ', '');
  if (!jwt) return null;

  const supabase = serviceClient(env);
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user) return null;
  return { user: data.user, jwt };
}

/**
 * Builds a personalized, country-filtered, ranked task feed for a user.
 * See EARNFLOW_MASTER_DOCUMENTATION.md §4 for the full rules this implements.
 */

export async function getPersonalizedFeed(supabase, profile, { page = 1, pageSize = 20 } = {}) {
  const isVerified = profile.country_status === 'verified';
  const countryCode = profile.country_code;

  // Hard filter: GLOBAL tasks always included; country-scoped tasks only if
  // the user's country is verified and matches.
  let query = supabase
    .from('tasks')
    .select('*, task_categories(slug, name, icon)')
    .eq('is_active', true);

  if (isVerified && countryCode) {
    query = query.or(`country_scope.cs.{GLOBAL},country_scope.cs.{${countryCode}}`);
  } else {
    // Unverified / mismatched country: GLOBAL only, no exceptions.
    query = query.contains('country_scope', ['GLOBAL']);
  }

  const { data: tasks, error } = await query;
  if (error) throw error;

  // Exclude tasks already completed (once_per_user) and over-cap tasks.
  const { data: completed } = await supabase
    .from('task_completions')
    .select('task_id')
    .eq('user_id', profile.id)
    .neq('status', 'rejected');
  const completedIds = new Set((completed || []).map((c) => c.task_id));

  const eligible = tasks.filter((t) => {
    if (t.once_per_user && completedIds.has(t.id)) return false;
    if (t.total_cap && t.total_completions >= t.total_cap) return false;
    return true;
  });

  const ranked = rank(eligible, profile);

  const start = (page - 1) * pageSize;
  return {
    total: ranked.length,
    page,
    pageSize,
    items: ranked.slice(start, start + pageSize),
  };
}

function rank(tasks, profile) {
  // Simple weighted score for v1: payout amount, freshness, and a small
  // exploration bonus for categories the user hasn't tried. Antigravity
  // should evolve this into a real per-user conversion model once there's
  // completion-history data to train on.
  const now = Date.now();
  return tasks
    .map((t) => {
      const ageHours = (now - new Date(t.created_at).getTime()) / 3.6e6;
      const freshnessScore = Math.max(0, 1 - ageHours / (24 * 14)); // decays over 2 weeks
      const payoutScore = Math.min(1, t.payout_minor / 100000); // normalize, tune scale per currency
      const score = payoutScore * 0.6 + freshnessScore * 0.3 + Math.random() * 0.1;
      return { ...t, _score: score };
    })
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...t }) => t);
}

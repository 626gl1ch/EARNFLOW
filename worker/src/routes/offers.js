import { serviceClient, getUserFromRequest } from '../lib/supabase.js';
import { getPersonalizedFeed } from '../lib/matching.js';

const OFFER_CATEGORY_SLUGS = ['cpa', 'ppc', 'download'];

/**
 * Offers are just tasks in the cpa/ppc/download categories — this route exists
 * as a dedicated, cacheable endpoint for the "Offers" dashboard tab so the
 * frontend doesn't have to filter the generic /tasks/feed client-side.
 */
export async function handleOffers(request, env, ctx, json, subpath) {
  if (subpath === '' || subpath === '/') {
    const supabase = serviceClient(env);
    const { user } = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'unauthorized' }, 401);

    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    const feed = await getPersonalizedFeed(supabase, profile);
    const offersOnly = feed.items.filter((t) => OFFER_CATEGORY_SLUGS.includes(t.task_categories?.slug));
    return json({ ...feed, items: offersOnly });
  }
  return null;
}

import { serviceClient, getUserFromRequest } from '../lib/supabase.js';
import { getPersonalizedFeed } from '../lib/matching.js';

/**
 * Surveys are usually delivered via an embedded aggregator widget (BitLabs,
 * CPX Research, theoremreach) rather than discrete `tasks` rows. This route
 * returns both: any discrete survey tasks in our own catalog, plus the
 * signed widget URLs for embedded aggregators, scoped to the user's
 * verified country (aggregators also apply their own internal targeting).
 */
export async function handleSurveys(request, env, ctx, json, subpath) {
  if (subpath === '' || subpath === '/') {
    const supabase = serviceClient(env);
    const { user } = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'unauthorized' }, 401);

    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    const feed = await getPersonalizedFeed(supabase, profile);
    const surveyTasks = feed.items.filter((t) => t.task_categories?.slug === 'survey');

    const widgets = [];
    if (env.BITLABS_API_KEY) {
      widgets.push({
        provider: 'bitlabs',
        url: `https://web.bitlabs.ai/?token=${env.BITLABS_API_KEY}&uid=${user.id}`,
      });
    }
    if (env.CPX_RESEARCH_APP_ID) {
      widgets.push({
        provider: 'cpx_research',
        url: `https://offers.cpx-research.com/index.php?app_id=${env.CPX_RESEARCH_APP_ID}&ext_user_id=${user.id}`,
      });
    }

    return json({ tasks: surveyTasks, widgets });
  }
  return null;
}

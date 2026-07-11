import { serviceClient } from '../lib/supabase.js';

/** Runs every 15 minutes: deactivates tasks past ends_at or over total_cap. */
export async function runExpireTasks(env) {
  const supabase = serviceClient(env);
  const nowIso = new Date().toISOString();

  await supabase.from('tasks').update({ is_active: false }).lt('ends_at', nowIso).eq('is_active', true);

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, total_cap, total_completions')
    .eq('is_active', true)
    .not('total_cap', 'is', null);

  const overCap = (tasks || []).filter((t) => t.total_completions >= t.total_cap).map((t) => t.id);
  if (overCap.length) {
    await supabase.from('tasks').update({ is_active: false }).in('id', overCap);
  }
}

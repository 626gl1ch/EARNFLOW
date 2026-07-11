-- ============================================================================
-- EARNFLOW RLS POLICIES
-- Target: Supabase (Postgres 15+)
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.task_completions enable row level security;
alter table public.withdrawals enable row level security;
alter table public.device_fingerprints enable row level security;
alter table public.ip_risk_checks enable row level security;
alter table public.fraud_flags enable row level security;
alter table public.tasks enable row level security;
alter table public.task_categories enable row level security;

create policy "own profile" on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);
create policy "own wallet" on public.wallets for select using (auth.uid() = user_id);
create policy "own ledger" on public.ledger_entries for select using (auth.uid() = user_id);
create policy "own completions" on public.task_completions for select using (auth.uid() = user_id);
create policy "own completions insert" on public.task_completions for insert with check (auth.uid() = user_id);
create policy "own withdrawals" on public.withdrawals for select using (auth.uid() = user_id);
create policy "own withdrawals insert" on public.withdrawals for insert with check (auth.uid() = user_id);

-- tasks & task_categories are public-readable (filtering by country happens in application logic / a view)
create policy "public read active tasks" on public.tasks for select using (is_active = true);
create policy "public read categories" on public.task_categories for select using (is_active = true);

-- No client-side write policies exist for wallets, ledger_entries, or task_completions.status transitions
-- to 'verified'/'paid' — those only ever happen via the security-definer functions above, called by
-- the Worker using the service role key.

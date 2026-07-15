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
alter table public.referrals enable row level security;
create policy "own referrals" on public.referrals for select using (auth.uid() = referrer_id);

-- tasks & task_categories are public-readable (filtering by country happens in application logic / a view)
create policy "public read active tasks" on public.tasks for select using (is_active = true);
create policy "public read categories" on public.task_categories for select using (is_active = true);

-- Owner revenue tables RLS policies (accessible by service role / admin users only)
alter table public.owner_wallets enable row level security;
alter table public.owner_ledger_entries enable row level security;
alter table public.owner_payout_config enable row level security;
alter table public.owner_withdrawals enable row level security;

create policy "admin read owner_wallets" on public.owner_wallets for select using (
  exists (select 1 from public.admin_users where id = auth.uid() and role = 'owner')
);

create policy "admin read owner_ledger_entries" on public.owner_ledger_entries for select using (
  exists (select 1 from public.admin_users where id = auth.uid() and role = 'owner')
);

create policy "admin read owner_payout_config" on public.owner_payout_config for select using (
  exists (select 1 from public.admin_users where id = auth.uid() and role = 'owner')
);

create policy "admin read owner_withdrawals" on public.owner_withdrawals for select using (
  exists (select 1 from public.admin_users where id = auth.uid() and role = 'owner')
);

-- No client-side write policies exist for wallets, ledger_entries, owner_wallets, or task_completions.status transitions
-- to 'verified'/'paid' — those only ever happen via security-definer functions called by the Worker using service role key.

-- Grant read access on user_category_earnings view (secure because view itself filters by user_id)
alter table public.kyc_country_verifications enable row level security;
create policy "own kyc" on public.kyc_country_verifications for select using (auth.uid() = user_id);

-- Note: Views don't support direct RLS — the view uses SECURITY INVOKER by default,
-- so the underlying table RLS on task_completions and ledger_entries already scopes it.
-- The Worker endpoint /api/tasks/earnings-by-category uses the service role key and
-- filters by user_id in the query — safe.


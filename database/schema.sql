-- ============================================================================
-- EARNFLOW DATABASE SCHEMA
-- Target: Supabase (Postgres 15+)
-- Run via Supabase migrations. Do not run manually against production.
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ============================================================================
-- 1. PROFILES & IDENTITY
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  country_code char(2),                      -- verified country, see country_status
  country_status text not null default 'unverified'
    check (country_status in ('unverified','verified','mismatch','manual_review')),
  tier text not null default 'bronze' check (tier in ('bronze','silver','gold','platinum')),
  referred_by uuid references public.profiles(id),
  referral_code text unique not null default substr(md5(random()::text), 1, 8),
  is_suspended boolean not null default false,
  suspension_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.kyc_country_verifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  signal_type text not null check (signal_type in ('ip_geolocation','phone_otp','payout_account','manual_admin')),
  country_code char(2) not null,
  raw_data jsonb,
  created_at timestamptz not null default now()
);

create table public.device_fingerprints (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  fingerprint_hash text not null,
  user_agent text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, fingerprint_hash)
);
create index idx_device_fingerprints_hash on public.device_fingerprints(fingerprint_hash);

-- ============================================================================
-- 2. WALLET & LEDGER (money — treat as append-only + derived cache)
-- ============================================================================

create table public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance_minor bigint not null default 0,        -- available balance, smallest currency unit
  pending_minor bigint not null default 0,        -- held pending fraud review / provider confirmation
  lifetime_earned_minor bigint not null default 0,
  currency char(3) not null default 'NGN',
  updated_at timestamptz not null default now(),
  check (balance_minor >= 0),
  check (pending_minor >= 0)
);

create table public.ledger_entries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  entry_type text not null check (entry_type in
    ('task_credit','commission_debit','withdrawal_debit','withdrawal_reversal',
     'referral_bonus','admin_adjustment','streak_bonus')),
  amount_minor bigint not null,                   -- positive = credit to user, negative = debit
  currency char(3) not null default 'NGN',
  related_task_completion_id uuid,
  related_withdrawal_id uuid,
  memo text,
  created_by text not null default 'system',      -- 'system' | admin_user id | 'trigger'
  created_at timestamptz not null default now()
);
create index idx_ledger_user on public.ledger_entries(user_id, created_at desc);

-- Keep wallets.balance_minor in sync with ledger_entries (source of truth = ledger)
create or replace function public.fn_apply_ledger_entry() returns trigger as $$
begin
  insert into public.wallets (user_id, balance_minor, lifetime_earned_minor)
  values (new.user_id, new.amount_minor, greatest(new.amount_minor, 0))
  on conflict (user_id) do update
    set balance_minor = public.wallets.balance_minor + new.amount_minor,
        lifetime_earned_minor = public.wallets.lifetime_earned_minor
          + greatest(new.amount_minor, 0),
        updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_ledger_apply
  after insert on public.ledger_entries
  for each row execute function public.fn_apply_ledger_entry();

-- ============================================================================
-- 3. TASK CATALOG
-- ============================================================================

create table public.task_categories (
  id uuid primary key default uuid_generate_v4(),
  slug text unique not null,   -- e.g. 'watch_ads','captcha','ppc','cpa','survey','testing',
                                --      'download','referral','microtask','social','streak','sponsored_video'
  name text not null,
  description text,
  default_commission_rate numeric(4,3) not null default 0.300,
  icon text,
  is_active boolean not null default true,
  sort_order int not null default 0
);

create table public.tasks (
  id uuid primary key default uuid_generate_v4(),
  category_id uuid not null references public.task_categories(id),
  provider text not null,                 -- 'cpalead','adgatemedia','offertoro','mylead',
                                            -- 'bitlabs','cpxresearch','theoremreach',
                                            -- 'adsterra','propellerads','inhouse'
  provider_offer_id text,                 -- id in provider's system, null for inhouse tasks
  title text not null,
  description text,
  instructions text,
  image_url text,
  country_scope text[] not null default array['GLOBAL'],  -- ['GLOBAL'] or e.g. ['NG','GH','KE']
  requirements jsonb not null default '{}'::jsonb,          -- {os:['android'], min_age:18, ...}
  gross_minor bigint not null,             -- what provider pays EarnFlow
  payout_minor bigint not null,            -- what user receives (gross - commission)
  currency char(3) not null default 'NGN',
  once_per_user boolean not null default true,
  daily_cap int,
  total_cap int,
  total_completions int not null default 0,
  is_active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_tasks_active_category on public.tasks(category_id, is_active);
create index idx_tasks_country_scope on public.tasks using gin (country_scope);

create table public.task_completions (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references public.tasks(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','verified','paid','rejected','flagged')),
  provider_postback_payload jsonb,
  ip_address inet,
  device_fingerprint_hash text,
  time_to_complete_seconds int,
  rejection_reason text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  paid_at timestamptz,
  unique (task_id, user_id)               -- enforced app-side only when tasks.once_per_user = true
);
create index idx_completions_user on public.task_completions(user_id, status);
create index idx_completions_task on public.task_completions(task_id);

-- ============================================================================
-- 4. FRAUD / RISK
-- ============================================================================

create table public.ip_risk_checks (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade,
  ip_address inet not null,
  fraud_score int,
  is_vpn boolean,
  is_proxy boolean,
  is_tor boolean,
  is_datacenter boolean,
  country_code char(2),
  recommended_action text,               -- 'allow','challenge','hold','block'
  raw_response jsonb,
  checked_at timestamptz not null default now()
);
create index idx_ip_checks_user on public.ip_risk_checks(user_id, checked_at desc);

create table public.fraud_flags (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  flag_type text not null,               -- 'vpn_detected','country_mismatch','multi_account',
                                           -- 'velocity_abuse','provider_chargeback','manual'
  severity text not null default 'low' check (severity in ('low','medium','high','critical')),
  details jsonb,
  action_taken text check (action_taken in ('none','warn','hold_funds','suspend','ban')),
  resolved boolean not null default false,
  resolved_by text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index idx_fraud_flags_user on public.fraud_flags(user_id, resolved);

-- ============================================================================
-- 5. WITHDRAWALS / PAYOUTS
-- ============================================================================

create table public.payout_config (
  country_code char(2) primary key,
  min_withdrawal_minor bigint not null,
  currency char(3) not null,
  supported_methods text[] not null default array['paystack_bank','paystack_mobile_money','crypto_usdt']
);

create table public.withdrawals (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  method text not null,                  -- 'paystack_bank','paystack_mobile_money','crypto_usdt'
  destination jsonb not null,            -- bank details OR { network, wallet_address }
  status text not null default 'requested'
    check (status in ('requested','processing','paid','failed','reversed')),
  paystack_transfer_ref text,
  failure_reason text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz
);
create index idx_withdrawals_user on public.withdrawals(user_id, status);

-- ============================================================================
-- 6. REFERRALS
-- ============================================================================

create table public.referrals (
  id uuid primary key default uuid_generate_v4(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referee_id uuid not null unique references public.profiles(id) on delete cascade,
  bonus_rate numeric(4,3) not null default 0.100,
  total_bonus_paid_minor bigint not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 7. ADMIN & AUDIT
-- ============================================================================

create table public.admin_users (
  id uuid primary key references auth.users(id),
  role text not null check (role in ('owner','moderator','finance')),
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default uuid_generate_v4(),
  actor text not null,                   -- admin_users.id or 'system'
  action text not null,
  target_table text,
  target_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 8. OWNER REVENUE & PLATFORM COMMISSION (50% Split Automation)
-- ============================================================================

create table public.owner_wallets (
  id int primary key default 1 check (id = 1),   -- Singleton row for platform owner
  balance_minor bigint not null default 0 check (balance_minor >= 0),
  lifetime_commission_minor bigint not null default 0,
  currency char(3) not null default 'NGN',
  updated_at timestamptz not null default now()
);

create table public.owner_ledger_entries (
  id uuid primary key default uuid_generate_v4(),
  entry_type text not null check (entry_type in ('commission_credit', 'owner_withdrawal_debit', 'owner_withdrawal_reversal')),
  amount_minor bigint not null,                  -- positive = revenue credited, negative = payout to owner
  currency char(3) not null default 'NGN',
  related_task_completion_id uuid,
  related_withdrawal_id uuid,
  memo text,
  created_at timestamptz not null default now()
);

create table public.owner_payout_config (
  id int primary key default 1 check (id = 1),   -- Singleton row for owner payment account
  payout_method text not null default 'paystack' check (payout_method in ('paystack', 'crypto_usdt')),
  bank_code text,
  account_number text,
  account_name text,
  recipient_code text,                           -- Paystack recipient code
  crypto_network text,                           -- 'TRC20', 'BEP20', 'ERC20', 'Polygon'
  crypto_address text,                           -- Owner USDT Wallet Address
  currency char(3) not null default 'NGN',
  auto_payout_enabled boolean not null default true,
  min_payout_minor bigint not null default 500000, -- 5,000 NGN min threshold for owner auto-payout
  updated_at timestamptz not null default now()
);

create table public.owner_withdrawals (
  id uuid primary key default uuid_generate_v4(),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'NGN',
  destination jsonb not null,
  status text not null default 'requested' check (status in ('requested','processing','paid','failed','reversed')),
  paystack_transfer_ref text,
  failure_reason text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz
);

-- Trigger to sync owner_wallets balance with owner_ledger_entries
create or replace function public.fn_apply_owner_ledger_entry() returns trigger as $$
begin
  insert into public.owner_wallets (id, balance_minor, lifetime_commission_minor)
  values (1, new.amount_minor, greatest(new.amount_minor, 0))
  on conflict (id) do update
    set balance_minor = public.owner_wallets.balance_minor + new.amount_minor,
        lifetime_commission_minor = public.owner_wallets.lifetime_commission_minor + greatest(new.amount_minor, 0),
        updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_owner_ledger_apply
  after insert on public.owner_ledger_entries
  for each row execute function public.fn_apply_owner_ledger_entry();

-- Initialize singleton owner wallet row
insert into public.owner_wallets (id, balance_minor, lifetime_commission_minor)
values (1, 0, 0)
on conflict (id) do nothing;

-- ============================================================================
-- 9. SECURITY-DEFINER MONEY FUNCTIONS (only path that may credit/debit)
-- ============================================================================

create or replace function public.complete_task(
  p_task_completion_id uuid
) returns void as $$
declare
  v_completion public.task_completions%rowtype;
  v_task public.tasks%rowtype;
  v_user_payout bigint;
  v_owner_commission bigint;
begin
  select * into v_completion from public.task_completions where id = p_task_completion_id for update;
  if v_completion.status <> 'verified' then
    raise exception 'task_completion must be verified before payout';
  end if;

  select * into v_task from public.tasks where id = v_completion.task_id;

  -- 50/50 REVENUE SPLIT AUTOMATION:
  -- User gets 50% of task gross_minor, Platform Owner gets remaining 50%
  if v_task.gross_minor > 0 then
    v_user_payout := floor(v_task.gross_minor * 0.50);
    v_owner_commission := v_task.gross_minor - v_user_payout;
  else
    v_user_payout := v_task.payout_minor;
    v_owner_commission := 0;
  end if;

  -- 1. Credit 50% payout to user ledger
  insert into public.ledger_entries (user_id, entry_type, amount_minor, currency, related_task_completion_id, memo)
  values (v_completion.user_id, 'task_credit', v_user_payout, v_task.currency, v_completion.id,
          'Payout for task: ' || v_task.title);

  -- 2. Credit 50% platform commission to owner ledger
  if v_owner_commission > 0 then
    insert into public.owner_ledger_entries (entry_type, amount_minor, currency, related_task_completion_id, memo)
    values ('commission_credit', v_owner_commission, v_task.currency, v_completion.id,
            'Platform 50% commission for task: ' || v_task.title);
  end if;

  -- 3. Mark completion paid and bump counters
  update public.task_completions
    set status = 'paid', paid_at = now()
    where id = p_task_completion_id;

  update public.tasks set total_completions = total_completions + 1 where id = v_task.id;
end;
$$ language plpgsql security definer;

create or replace function public.request_withdrawal(
  p_user_id uuid, p_amount_minor bigint, p_currency char(3), p_method text, p_destination jsonb
) returns uuid as $$
declare
  v_withdrawal_id uuid;
  v_balance bigint;
begin
  select balance_minor into v_balance from public.wallets where user_id = p_user_id for update;
  if v_balance is null or v_balance < p_amount_minor then
    raise exception 'insufficient balance';
  end if;

  insert into public.withdrawals (user_id, amount_minor, currency, method, destination)
  values (p_user_id, p_amount_minor, p_currency, p_method, p_destination)
  returning id into v_withdrawal_id;

  insert into public.ledger_entries (user_id, entry_type, amount_minor, currency, related_withdrawal_id, memo)
  values (p_user_id, 'withdrawal_debit', -p_amount_minor, p_currency, v_withdrawal_id, 'Withdrawal request');

  return v_withdrawal_id;
end;
$$ language plpgsql security definer;

create or replace function public.request_owner_withdrawal(
  p_amount_minor bigint, p_currency char(3), p_destination jsonb
) returns uuid as $$
declare
  v_withdrawal_id uuid;
  v_balance bigint;
begin
  select balance_minor into v_balance from public.owner_wallets where id = 1 for update;
  if v_balance is null or v_balance < p_amount_minor then
    raise exception 'insufficient owner wallet balance';
  end if;

  insert into public.owner_withdrawals (amount_minor, currency, destination)
  values (p_amount_minor, p_currency, p_destination)
  returning id into v_withdrawal_id;

  insert into public.owner_ledger_entries (entry_type, amount_minor, currency, related_withdrawal_id, memo)
  values ('owner_withdrawal_debit', -p_amount_minor, p_currency, v_withdrawal_id, 'Owner revenue withdrawal to bank');

  return v_withdrawal_id;
end;
$$ language plpgsql security definer;



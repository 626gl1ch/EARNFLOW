-- Additional helper functions, kept separate from schema.sql for clarity.

create or replace function public.find_shared_device_fingerprints(min_accounts int default 3)
returns table(fingerprint_hash text, account_count bigint) as $$
  select fingerprint_hash, count(distinct user_id) as account_count
  from public.device_fingerprints
  group by fingerprint_hash
  having count(distinct user_id) >= min_accounts;
$$ language sql stable security definer;

-- Atomically increment or decrement pending_minor for a user, flooring at 0.
-- This prevents race conditions when concurrent postbacks or chargebacks arrive.
create or replace function public.adjust_pending_minor(
  p_user_id uuid,
  p_amount_minor bigint
) returns bigint as $$
declare
  v_new_pending bigint;
begin
  update public.wallets
  set pending_minor = greatest(0, pending_minor + p_amount_minor),
      updated_at = now()
  where user_id = p_user_id
  returning pending_minor into v_new_pending;

  return v_new_pending;
end;
$$ language plpgsql security definer;

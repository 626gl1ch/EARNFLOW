-- Additional helper functions, kept separate from schema.sql for clarity.

create or replace function public.find_shared_device_fingerprints(min_accounts int default 3)
returns table(fingerprint_hash text, account_count bigint) as $$
  select fingerprint_hash, count(distinct user_id) as account_count
  from public.device_fingerprints
  group by fingerprint_hash
  having count(distinct user_id) >= min_accounts;
$$ language sql stable security definer;

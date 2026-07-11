-- Dev/staging seed data only — never run against production.

insert into public.task_categories (slug, name, description, default_commission_rate, sort_order) values
  ('watch_ads', 'Watch & Earn', 'Short rewarded video ads', 0.400, 1),
  ('captcha', 'Captcha Tasks', 'In-house generated captchas', 0.200, 2),
  ('ppc', 'Pay-Per-Call', 'Call tracking CPA offers', 0.300, 3),
  ('cpa', 'Offers', 'CPA network offers', 0.300, 4),
  ('survey', 'Surveys', 'Survey aggregator completions', 0.250, 5),
  ('testing', 'Software Testing', 'Structured app/software test tasks', 0.200, 6),
  ('download', 'Download & Earn', 'Pay-per-install offers', 0.300, 7),
  ('referral', 'Referrals', 'Referral program bonuses', 0.000, 8),
  ('microtask', 'Micro-Tasks', 'Data labeling / small gigs', 0.200, 9),
  ('social', 'Social Tasks', 'Follow/like/subscribe actions', 0.200, 10),
  ('streak', 'Daily Streak', 'Daily login bonus', 0.000, 11),
  ('sponsored_video', 'Sponsored Video', 'Longer sponsored video content', 0.350, 12)
on conflict (slug) do nothing;

insert into public.payout_config (country_code, min_withdrawal_minor, currency, supported_methods) values
  ('NG', 100000, 'NGN', array['paystack_bank','paystack_mobile_money']),
  ('GH', 5000, 'GHS', array['paystack_mobile_money']),
  ('KE', 50000, 'KES', array['paystack_mobile_money'])
on conflict (country_code) do nothing;

-- Example tasks (GLOBAL + Nigeria-only) for local dev
insert into public.tasks (category_id, provider, title, description, country_scope, gross_minor, payout_minor, currency)
select id, 'inhouse', 'Complete 10 captchas', 'Solve 10 simple image captchas in a row.', array['GLOBAL'], 5000, 3500, 'NGN'
from public.task_categories where slug = 'captcha';

insert into public.tasks (category_id, provider, title, description, country_scope, gross_minor, payout_minor, currency)
select id, 'cpalead', 'Install & open Opay', 'Sign up and complete first transaction.', array['NG'], 150000, 105000, 'NGN'
from public.task_categories where slug = 'cpa';

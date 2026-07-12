# Changelog

All notable changes to EarnFlow should be logged here, most recent first.
Antigravity: append an entry every time you push.

## [Unreleased]
### Added
- Separated RLS policies into database/policies.sql for clean database folder structure.
- Implemented robust token bucket rate limiting on auth and task endpoints in Cloudflare Worker using KV.
- Added support for in-house Captcha verification (auto-generating challenge on task start, validating solution on task submit, caching in KV).
- Added Streak check-in task validation (limiting check-ins to once per user per calendar day).
- Implemented Referral program bonus credit loop (crediting referrers with 10% of referee task payouts during their first 30 days).
- Added Paystack Transfer success and failure webhook handling for cashouts with automatic transaction reversal and audit trails.
- Wired up full Supabase Auth JS SDK (v2) and active session checks on frontend landing page and dashboard.
- Built interactive frontend modals for SignUp, Login, Captcha verification, and Paystack withdrawal.
- Completed frontend tabs for Tasks, Offers, Surveys (with widget router links), Withdraw, Referrals, and Profile.
- Created premium operations admin panel at frontend/admin/index.html to resolve fraud queue warnings, view cashouts, and create tasks.
- Initialized local git repository, configured git settings, and committed files with conventional-commit history.


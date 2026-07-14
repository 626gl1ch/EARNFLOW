# Changelog

All notable changes to EarnFlow should be logged here, most recent first.
Antigravity: append an entry every time you push.

## [Unreleased]
### Added
- **Full-Stack Deep Audit & Hardening**:
  - Fixed Paystack webhook postback reference parser in `worker/src/routes/postbacks.js` to distinguish between `earnflow_owner_${id}` (owner profit transfers) and `earnflow_${id}` (user cashout transfers).
  - Enhanced post-signup handler in `worker/src/routes/auth.js` to process referral codes, resolve referrer IDs, and create initial `referrals` tracking records automatically.
  - Added RLS policy for `referrals` table in `database/policies.sql` allowing users to securely track their own referred network.
- Implemented **Dual Payout System (Crypto USDT & Paystack Bank)** across user dashboard and platform owner revenue system:
  - Users can now select between **Paystack Local Bank Transfer** or **Crypto (USDT TRC20, BEP20, ERC20, Polygon)** when requesting cashouts.
  - Platform Owner can select between receiving accumulated 50% profits via **Paystack Local Bank** or **Crypto USDT Wallet**.
- Implemented **50/50 Revenue Split Automation** in Postgres function `complete_task`: whenever any user completes a task, the platform automatically allocates 50% to the user and 50% net commission to the platform owner.
- Created `owner_wallets`, `owner_ledger_entries`, `owner_payout_config`, and `owner_withdrawals` database tables with row-level security.
- Added `worker/src/cron/owner-payout.js` daily cron job to automatically transfer accumulated 50% platform profits to the owner's personal bank account via Paystack.
- Added `/api/admin/owner-revenue`, `/api/admin/owner-bank`, and `/api/admin/owner-payout` API endpoints.
- Upgraded Admin Panel (`frontend/admin/index.html`) with a dedicated **Platform Profit & Owner Payouts** tab to track revenue and configure the owner bank account.
- Expanded landing page (`frontend/index.html`) with live global stats, 3-step illustrated workflow cards, FAQ accordions, and footer.
- Built responsive **Mobile Bottom Navigation Bar** (`.ef-mobile-nav`) for mobile and tablet devices.
- Added **Earnings History Log** tab (`#/history`) to user dashboard to view all past credits and withdrawals.
- Created `database/migrate.js` automated migration runner to apply `schema.sql`, `functions.sql`, `policies.sql`, and `seed.sql` with a single command once credentials are configured.
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


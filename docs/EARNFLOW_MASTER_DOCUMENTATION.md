# EARNFLOW — Master Build Documentation
### "Do tasks. Get paid. Watch it flow."

This document is the single source of truth for building **EarnFlow**, a global get‑paid‑to (GPT) earning platform. It is written to be handed directly to an AI coding agent (Google Antigravity) as its operating instructions. Everything the agent needs — architecture, schema, task logic, fraud/VPN detection, country‑matching rules, MCP automation, and git workflow — is in this file.

---

## 0. FIRST INSTRUCTIONS TO THE CODING AGENT (ANTIGRAVITY)

Read this entire document before writing any code. Then, in this exact order:

1. **Create a new GitHub repository** named `earnflow` under the owner's account. Initialize it with a `.gitignore` (Node + Cloudflare Workers + Supabase), an MIT or proprietary LICENSE (ask owner which), and this documentation file committed as `/docs/EARNFLOW_MASTER_DOCUMENTATION.md`.
2. Set up the repo structure exactly as described in **Section 2 (Repo Structure)**.
3. **Commit early, commit often.** After every meaningful unit of work (a migration, a worker route, a UI component, a bug fix) — `git add`, write a clear conventional-commit message (`feat:`, `fix:`, `chore:`, `docs:`), and commit. Do not batch unrelated changes into one commit.
4. **Push to the remote after every commit** (or at minimum after every working session) so nothing lives only on local disk. Never leave uncommitted work at the end of a session.
5. Use branches for risky/large features (`feature/vpn-detection`, `feature/offerwall-integration`) and merge to `main` only once a feature works end-to-end locally.
6. Keep a running `CHANGELOG.md` and update it with every push.
7. Never commit secrets (Supabase service key, Paystack secret key, CPA network API keys, IPQualityScore key). All secrets go in Cloudflare Worker environment variables / `wrangler secret put`, and in a local `.env` file that is git-ignored.
8. Whenever you finish a working slice of a feature, deploy it (`wrangler deploy` for the worker, push Supabase migrations, deploy frontend to Cloudflare Pages) so the owner can see progress live, then report what you shipped.

---

## 1. PRODUCT OVERVIEW

EarnFlow is a website where registered users earn real money (paid out via Paystack, and later other rails) by completing small digital tasks. The platform takes a **commission (default 30%, configurable per task-type)** on every completed, verified task before crediting the user's wallet.

**Core differentiators to build:**
- A genuinely personalized dashboard per user (not a static offer list — ranked and filtered by country, device, past behavior, and earnings potential).
- Strict **country-aware task routing**: country-restricted tasks are only ever shown to users whose verified country matches; tasks marked "Global" are shown to everyone.
- Aggressive, accurate **VPN / proxy / datacenter IP detection**, because GPT sites are a prime target for VPN-based geo-fraud (a user in Country A pretending to be in Country B to unlock better-paying offers, or one person farming multiple fake accounts from a VPN).
- Real-time earnings ledger with an animated, trustworthy "money is flowing" feel — this is a trust product; the UI needs to feel alive, transparent, and safe.

---

## 2. TECH STACK & REPO STRUCTURE

| Layer | Choice | Why |
|---|---|---|
| Database / Auth | **Supabase** (Postgres + Row Level Security + Auth) | Owner already runs Supabase for SnipeJob; reuse patterns. |
| Backend API | **Cloudflare Workers** (+ Cron Triggers, Queues, KV, Durable Objects for rate-limiting) | Owner's existing infra (`daniellancce1` account); free tier scales well for a task platform. |
| Payments (payout + subscription, if added later) | **Paystack** via `@paystack/mcp-server` | Nigeria-native, already integrated in SnipeJob. |
| Frontend | Single-file SPA (`index.html` + modular JS) hosted on **Cloudflare Pages**, same pattern as SnipeJob | Fast, no build step required, easy for the agent to iterate on. |
| Fraud/VPN detection | **IPQualityScore API** (primary) + **MaxMind GeoIP2** (secondary/offline fallback) + custom heuristics | Best-in-class proxy/VPN/datacenter detection; combine with device fingerprinting. |
| Email | **Resend** (owner already uses this for SnipeJob cron emails) | Consistency. |
| CPA / Offerwall networks | **CPALead** (owner already has an account/integration), **AdGateMedia**, **OfferToro**, **MyLead** | Multiple networks = more inventory, redundancy if one network suspends the site. |
| Survey networks | **BitLabs**, **CPX Research**, **theoremreach** | Standard survey aggregators with country-targeting built in. |
| Ad / PTC (paid-to-click / view ads) | **Adsterra**, **PropellerAds** (CPM/reward-ad units) | Reward-video and PTC units with global fill. |
| Captcha-solving-for-pay | Custom in-house captcha queue (see §5.2) — **do not** resell real reCAPTCHA solves (ToS-risk); use in-house generated captchas as a "skill task" instead. |
| Repo / CI | GitHub + GitHub Actions (lint, migration check, deploy) | Matches SnipeJob's existing workflow pattern. |

### Repo structure
```
earnflow/
├── docs/
│   └── EARNFLOW_MASTER_DOCUMENTATION.md
├── database/
│   ├── schema.sql
│   ├── policies.sql          (RLS policies, separate file for clarity)
│   ├── functions.sql         (Postgres functions: credit_wallet, complete_task, etc.)
│   └── seed.sql              (sample task/offer data for dev)
├── worker/
│   ├── src/
│   │   ├── index.js          (router entry point)
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── tasks.js
│   │   │   ├── offers.js
│   │   │   ├── surveys.js
│   │   │   ├── postbacks.js  (CPA network + survey network callback endpoints)
│   │   │   ├── wallet.js
│   │   │   ├── withdrawals.js
│   │   │   ├── fraud.js      (VPN/proxy check endpoint)
│   │   │   └── admin.js
│   │   ├── lib/
│   │   │   ├── supabase.js
│   │   │   ├── paystack.js
│   │   │   ├── ipqs.js       (IPQualityScore client)
│   │   │   ├── matching.js   (country/task matching engine)
│   │   │   └── ratelimit.js  (Durable Object)
│   │   └── cron/
│   │       ├── expire-tasks.js
│   │       ├── payout-batch.js
│   │       └── fraud-sweep.js
│   ├── wrangler.toml
│   └── package.json
├── frontend/
│   ├── index.html            (landing + SPA shell)
│   ├── assets/
│   │   ├── css/theme.css
│   │   └── js/ (app.js, dashboard.js, animations.js, api.js)
│   └── admin/index.html      (admin panel, separate route)
├── .github/workflows/deploy.yml
├── CHANGELOG.md
├── .gitignore
└── README.md
```

---

## 3. DATABASE SCHEMA (Supabase / Postgres)

See `/database/schema.sql` for the full executable schema (already generated — Antigravity should run it via Supabase migrations, not retype it). Summary of core tables:

- **profiles** — extends `auth.users`; stores `country_code` (verified, not self-reported), `display_name`, `avatar_url`, `tier` (bronze/silver/gold based on lifetime earnings), `referred_by`.
- **kyc_country_verifications** — how we *proved* a user's country (IP geolocation at signup + phone/SMS country code + card/payout account country at withdrawal time). Country shown on profile is the **intersection/agreement** of these signals, not just self-report.
- **wallets** — one row per user; `balance_minor` (kobo/cents, integer, never float), `pending_minor`, `lifetime_earned_minor`, `currency`.
- **ledger_entries** — immutable append-only ledger of every credit/debit (task payout, commission taken, withdrawal, referral bonus, admin adjustment). This is the source of truth; `wallets.balance_minor` is a derived cache kept in sync by a trigger.
- **task_categories** — the 11+ earning methods (see §5), each with its own commission rate, min payout, and config JSON.
- **tasks** — individual offers/surveys/ads/etc. Has `country_scope` (`'GLOBAL'` or array of ISO country codes), `category_id`, `payout_minor` (what the user receives after commission), `gross_minor` (what the network pays EarnFlow), `provider`, `provider_offer_id`, `requirements` JSON (device OS, min age, etc.), `is_active`, `daily_cap`, `total_cap`.
- **task_completions** — one row per user-task attempt; status `pending → verified → paid` or `rejected`. Stores the postback payload received from the provider network for audit.
- **device_fingerprints** — hashed device/browser fingerprints, tied to accounts, to detect multi-accounting.
- **ip_risk_checks** — every login/signup/task-completion IP check result from IPQualityScore (fraud score, is_vpn, is_proxy, is_tor, is_datacenter, recommended action), timestamped.
- **fraud_flags** — flags raised on a user (VPN detected, country mismatch, multi-account suspected, offer network flagged as fraud/chargeback) with `severity` and `action_taken` (warn / hold_funds / suspend / ban).
- **withdrawals** — payout requests, `method` (`paystack_bank`, `paystack_mobile_money`, etc. for NG; extendable), status, Paystack transfer reference.
- **referrals** — referral tree + bonus tracking.
- **admin_users** — separate from `profiles`, RBAC (`owner`, `moderator`, `finance`).
- **audit_log** — every admin action, immutable.

RLS: every user-facing table has RLS enabled; a user can only `SELECT`/`UPDATE` rows where `auth.uid() = user_id`. All writes that touch money (`ledger_entries`, `wallets`, `task_completions.status → paid`) happen **only** through `SECURITY DEFINER` Postgres functions called from the Worker with the service role — never directly from the client. This is critical: **the client should never be able to mark its own task as paid.**

---

## 4. COUNTRY MATCHING & ELIGIBILITY ENGINE

This is one of the most important pieces of business logic, so it gets its own section.

**Rule:** A task is visible to a user if and only if:
```
task.country_scope === 'GLOBAL'
   OR user.verified_country_code IN task.country_scope
```

**Determining `verified_country_code` (never trust a single signal):**
1. IP geolocation at signup and at every login (via IPQualityScore / MaxMind).
2. SIM/phone verification country code (if phone OTP is used for signup).
3. Payout destination country (bank/mobile money account country at withdrawal — Paystack tells us this).
4. If signals disagree, the account is put in `country_unverified` state: it only sees **GLOBAL** tasks until resolved, and is flagged for manual review if the mismatch persists across 3+ sessions.

**Matching/ranking engine (`lib/matching.js`)**, run server-side to build each user's personalized dashboard feed:
1. Hard filter: country eligibility (above) + device eligibility (`requirements.os` vs user agent) + not already completed (if `once_per_user`) + daily/total cap not exceeded + `is_active = true`.
2. Score remaining tasks by: category conversion history for this user, task payout amount, task freshness, provider fill-rate reliability, and a small exploration factor (occasionally surface a new category so users discover it).
3. Return a ranked, paginated feed — this is what makes the dashboard feel "personalized" rather than a static list.

---

## 5. THE EARNING METHODS (task categories to implement)

Each is its own `task_category` with its own commission rate and its own UI card style. Implement all of these:

1. **Watch & earn (rewarded video ads)** — via Adsterra/PropellerAds reward units; short cooldown between views; commission ~40% (ad payouts are tiny, so take a fixed spread instead of %, e.g. flat 2 NGN per view kept).
2. **Captcha completion** — in-house generated image/text captchas (never resold real reCAPTCHA solves), paid per correct batch; used mainly as a low-friction "warm-up" task for new users to build trust in the payout system fast.
3. **Pay-per-call (PPC) offers** — CPA network call-tracking offers (user calls a number / stays on line for X seconds); route through CPA network's PPC feed.
4. **CPA offers** — classic cost-per-action (install an app, sign up free trial, submit email) via CPALead/AdGateMedia/OfferToro/MyLead, matched by each network's own country targeting.
5. **Survey completion** — BitLabs/CPX Research/theoremreach aggregator widgets embedded in-dashboard; they handle their own internal country/quota targeting, EarnFlow applies its own country_scope filter on top.
6. **Software / app testing** — structured test tasks (install, follow a script, submit screenshots + short written feedback via a form); manually or semi-automatically reviewed before payout.
7. **Download games or software** — CPA "pay per install" offers, a specific sub-category of #4 with its own card/UI since it converts differently.
8. **Referral program** — user earns a % of referred users' first-month earnings (standard, high-retention growth loop).
9. **Micro-task / data-labeling gigs** — short structured tasks (image tagging, transcription snippets, simple data entry) — good fit for a dev-run platform since you can build simple task templates yourself with no external network needed.
10. **Social engagement tasks** — follow/like/subscribe actions on the owner's or partner brands' social accounts, self-hosted with screenshot-proof submission + spot review.
11. **Daily check-in / streak bonus** — small guaranteed reward for daily login, to drive retention (not a "way to make money" per se, but pairs naturally with the dashboard and should be built alongside these).
12. **Watch-to-earn video content / sponsored content** — longer sponsored video placements (distinct from #1's short ad units), higher payout, lower frequency cap.

That's 12 categories — comfortably covers "at least 5 more" beyond the 7 the owner named.

---

## 6. VPN / PROXY / FRAUD DETECTION

GPT sites live and die by fraud control — offer networks will cut off a site that sends them VPN/bot traffic, and users will abuse country-gated offers without it. Build defense in depth:

1. **IP reputation check on every signup, login, and task-completion attempt** via IPQualityScore's Proxy/VPN Detection API — checks `is_vpn`, `is_proxy`, `is_tor`, `is_datacenter_ip`, `fraud_score`, `recent_abuse`, `bot_status`. Cache results per-IP in KV for a short TTL to control API cost.
2. **Policy thresholds** (tune over time, store in `admin`-editable config, not hardcoded):
   - `fraud_score >= 85` OR `is_tor` → hard block, no signup/login allowed.
   - `is_vpn` OR `is_proxy` OR `is_datacenter_ip` → allow login (don't punish real users on legitimate VPNs for privacy) but **block all paid task completion** and hide country-restricted tasks (show GLOBAL-only, and even those go to `pending` review before payout) until the check clears.
   - Sudden country change vs account history → step-up verification (re-check IP, prompt for phone re-verification) before high-value tasks unlock again.
3. **Device fingerprinting** (canvas/audio/WebGL hash + coarse hardware signals, privacy-conscious — no cross-site tracking) to catch one person farming multiple accounts from the same device even across different IPs/VPNs.
4. **Behavioral heuristics**: task-completion time far below the realistic minimum (e.g., a 5-minute survey "completed" in 20 seconds), identical mouse-movement/timing patterns across "different" accounts, extremely high completion velocity → auto-flag to `fraud_flags`, hold the payout in `pending`, queue for review.
5. **Provider postback validation**: every CPA/survey network sends a server-to-server postback confirming a completion — **always verify the postback signature/secret** and match it against an existing `pending` `task_completions` row before crediting; never trust a client-side "I completed it" claim alone for paid categories (only for the in-house categories like captcha/micro-tasks where EarnFlow itself is the source of truth).
6. **Rate limiting** per IP and per account (Durable Object token bucket) on auth and task-completion endpoints to blunt scripted abuse.
7. **Manual admin review queue** for anything auto-flagged, with one-click approve/reject/ban from the admin panel — automation should assist a human, not fully replace review on money-movement decisions.

---

## 7. MCP AUTOMATIONS FOR THE CODING AGENT

Antigravity should use MCP servers wherever available instead of hand-rolling API glue. Concretely:

- **`@paystack/mcp-server`** (already used in SnipeJob) — use for: verifying bank/mobile-money account details before withdrawal, initiating transfers (payouts), listening for transfer webhook events (success/failure), and reconciling failed payouts automatically.
- **Supabase MCP** (if available in the Antigravity environment) — use for: running and versioning migrations, generating typed query helpers, inspecting RLS policies for correctness, and seeding dev data — instead of hand-writing raw SQL migration runners.
- **GitHub MCP** (or GitHub CLI) — use for: creating the repository, creating branches, opening PRs for large features even in a solo-dev workflow (keeps history clean), and tagging releases.
- **Cloudflare MCP** (if available) — use for: creating/managing the Worker, KV namespaces, Durable Object bindings, Cloudflare Pages project, and DNS records, rather than only using `wrangler` CLI blind.
- If an MCP server for **IPQualityScore** or the CPA networks doesn't exist, build a thin internal `lib/` wrapper (already scaffolded) and treat it like one — same interface discipline (typed request/response, retries, error surfacing) even without a formal MCP.

Whenever a new MCP-compatible tool becomes available for any of these providers, prefer swapping in the MCP integration over the hand-rolled fetch wrapper, and note the swap in `CHANGELOG.md`.

---

## 8. FRONTEND / DESIGN DIRECTION

**Concept: "The Passbook."** EarnFlow's visual identity is built around the idea of an old-fashioned bank passbook made digital and alive — every action the user takes writes a new line in a ledger that visibly, satisfyingly updates their balance. This is the signature element: an animated, odometer-style balance counter and a live-scrolling ledger feed on the dashboard, because the single most important feeling this product must produce is *"this is real money, and it's mine, and I can see it grow."*

- **Color tokens:** `--ink: #0B2B26` (deep teal-black, primary background), `--emerald: #12664F` (surfaces, cards), `--gold: #E8B84B` (earnings, primary accent — the color of "money moving"), `--mint: #BFE8D9` (primary text on dark surfaces), `--coral: #E2604A` (alerts, negative ledger entries, destructive actions), `--paper: #F6F3EC` (light-mode surface / marketing page background).
- **Type:** Display face **Fraunces** (a warm serif with real personality — used for the balance figure and section headers, ties to the "passbook/ledger" feel without going generic-fintech-sans everywhere), body/UI face **Inter**, numeric/ledger face **IBM Plex Mono** (all monetary figures and timestamps render in mono, reinforcing the "printed ledger line" feeling).
- **Layout:** Landing page opens with a live animated passbook ticker as the hero (lines writing themselves in: "Chidi completed a survey · +₦450", "Ada watched an ad · +₦20" — anonymized/sampled real activity, not fake numbers, once there's real traffic; synthetic-but-labeled-as-illustrative before that). Dashboard is a two-column layout: left sidebar nav (Tasks, Surveys, Offers, Withdraw, Referrals, Profile), main column split into a sticky balance/ledger header and a below-the-fold personalized task feed.
- **Motion:** the balance counter digit-flips (odometer style) on every credit; new ledger lines slide in from the top with a soft highlight-then-fade; task cards lift subtly on hover; page-load does one orchestrated reveal (ledger writes itself in, then balance settles) — deliberately restrained everywhere else so the ledger motion stays the star.
- **Dark by default** (matches the owner's existing SnipeJob dark steel-grey identity) with the light `--paper` mode used for print/receipt-style views (e.g. a downloadable earnings statement).

A working scaffold implementing this direction is included in `/frontend/index.html` and `/frontend/assets/css/theme.css` — Antigravity should extend it, not restart it.

---

## 9. COMMISSION & PAYOUT LOGIC

- Every `task_categories` row has a `commission_rate` (e.g. 0.30 = platform keeps 30%). `tasks.payout_minor` (user's cut) and `tasks.gross_minor` (network's payment to EarnFlow) are both stored so accounting is exact; commission is `gross_minor - payout_minor`, never recomputed from a percentage at payout time (percentages can drift if rates change; the stored split is the source of truth for that specific task instance).
- Minimum withdrawal threshold, configurable per country (e.g. ₦1,000 for Nigeria, $5 for global) — stored in an admin-editable `payout_config` table, not hardcoded.
- Withdrawals go `requested → processing → paid/failed`, processed via Paystack Transfers (bank/mobile money for NG; extend to other Paystack-supported rails as the platform expands beyond Nigeria).
- Nightly cron (`cron/payout-batch.js`) batches approved withdrawals, calls Paystack, and reconciles via webhook — mirrors the pg_cron + Resend pattern already proven in SnipeJob.

---

## 10. BUILD ORDER (recommended milestones for Antigravity)

1. Repo + schema + RLS policies + auth (email/password + Google OAuth via Supabase Auth).
2. Wallet + ledger core functions (`credit_wallet`, `debit_wallet`) — get money-safety right before anything else.
3. IP risk check + country verification pipeline (§4, §6) — build the gate before there's inventory to gate.
4. Admin panel v1 (manage task_categories, tasks, fraud queue, withdrawals) — you need this to seed and operate everything else.
5. Task feed + matching engine + dashboard UI (the passbook experience).
6. Integrate first CPA network + first survey network + first ad network (one of each, end-to-end, before adding more providers).
7. Withdrawals via Paystack.
8. Referral system + remaining task categories (captcha, micro-tasks, social, testing, downloads, streaks, sponsored video).
9. Fraud/VPN hardening pass + rate limiting + device fingerprinting.
10. Polish pass on animations/theme, then expand provider integrations.

At every milestone: commit, push, deploy, and report back to the owner with what's live and what's next.

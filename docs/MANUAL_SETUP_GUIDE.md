# EarnFlow — Complete Manual Setup Guide

> **This is the non-code work you must do yourself.** The codebase handles
> all integrations automatically once these steps are done. Work through
> each section in order. Budget 2–5 business days for network approvals.

---

## Part 1 — Supabase (Database)

### 1.1 Run migrations
You need to run the schema files against your Supabase project.

1. Go to [Supabase Dashboard](https://app.supabase.com) → your project
2. Click **SQL Editor** → **New query**
3. Paste and run these files in order:
   - `database/schema.sql` — all table definitions + views
   - `database/functions.sql` — `complete_task`, `hold_pending_payout`, etc.
   - `database/policies.sql` — Row-Level Security rules
   - `database/seed.sql` — optional starter data (task categories, etc.)

> **If you get an error on the view `user_category_earnings`:** Run
> `database/schema.sql` first, then separately run the `CREATE OR REPLACE VIEW`
> block at the bottom — it depends on `task_completions` and `tasks` existing first.

### 1.2 Enable Email Auth
1. Supabase Dashboard → **Authentication** → **Providers**
2. Enable **Email** provider
3. Set **Site URL** to your Cloudflare Pages URL (e.g. `https://earnflow.pages.dev`)
4. Add `https://earnflow.pages.dev/auth/callback` to **Redirect URLs**

### 1.3 Get your service role key
1. Supabase Dashboard → **Settings** → **API**
2. Copy the **service_role** key (starts with `eyJ...`)
3. You will set this as `SUPABASE_SERVICE_KEY` in the Worker secrets (Step 2.2)

> ⚠️ Never expose the service_role key in the frontend. It bypasses RLS.

---

## Part 2 — Cloudflare Worker (Backend API)

### 2.1 Install Wrangler and log in
```bash
npm install -g wrangler
wrangler login
```

### 2.2 Set Worker secrets
Run each command below in your terminal from the `worker/` directory.
You will be prompted to paste the value.

```bash
# Supabase
wrangler secret put SUPABASE_URL
# → paste: https://mdmpcxtjwnovbhidwwhj.supabase.co

wrangler secret put SUPABASE_SERVICE_KEY
# → paste: (your service_role key from Step 1.3)

# Paystack
wrangler secret put PAYSTACK_SECRET_KEY
# → paste: sk_live_XXXXXXXXXXXXXXXX  (your live secret key from Paystack dashboard)

wrangler secret put PAYSTACK_WEBHOOK_SECRET
# → paste: (from Paystack dashboard → Settings → Webhooks → copy secret)

# IPQualityScore (fraud detection)
wrangler secret put IPQS_API_KEY
# → paste: (from ipqualityscore.com → API Keys)

# CPA Network postback secrets — set one per network you join
# These are random strings YOU generate and set on the network's postback URL config
wrangler secret put POSTBACK_SECRET_CPALEAD
wrangler secret put POSTBACK_SECRET_ADGATEMEDIA
wrangler secret put POSTBACK_SECRET_OFFERTORO
wrangler secret put POSTBACK_SECRET_MYLEAD
wrangler secret put POSTBACK_SECRET_BITLABS
wrangler secret put POSTBACK_SECRET_CPXRESEARCH
wrangler secret put POSTBACK_SECRET_THEOREMREACH
```

**Generating a secure postback secret:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Use a different secret for each network.

### 2.3 Create KV namespace
The Worker uses Cloudflare KV for captcha challenges and rate limiting.

```bash
wrangler kv:namespace create FRAUD_KV
# Copy the id it prints, then add to wrangler.toml:
```

In `worker/wrangler.toml`, add:
```toml
[[kv_namespaces]]
binding = "FRAUD_KV"
id = "PASTE_YOUR_KV_ID_HERE"
```

### 2.4 Deploy the Worker
```bash
cd worker
npm install
wrangler deploy
```

Note the deployed URL (e.g. `https://earnflow-api.daniellancce1.workers.dev`).
Update `frontend/assets/js/api.js` line ~7 if the URL is different.

### 2.5 Set up Cron Trigger
This hourly cron promotes CPA completions from `pending_confirmation` → `paid`.

In `worker/wrangler.toml`, add:
```toml
[triggers]
crons = ["0 * * * *"]
```

Redeploy: `wrangler deploy`

---

## Part 3 — Cloudflare Pages (Frontend)

### 3.1 Connect your GitHub repo
1. [Cloudflare Pages](https://pages.cloudflare.com) → **Create application** → **Pages**
2. Connect your GitHub repo → select `EARNFLOW`
3. **Build settings:**
   - Build command: *(leave empty — it is static HTML)*
   - Build output directory: `frontend`
4. Deploy

### 3.2 Custom domain (optional)
1. Cloudflare Pages → your project → **Custom domains**
2. Add your domain (e.g. `earnflow.ng`)
3. Update Supabase → Authentication → **Site URL** to match

---

## Part 4 — Paystack (Nigeria Payments)

### 4.1 Create and verify your business account
1. [paystack.com](https://paystack.com) → Sign up as a business
2. Complete KYC: business name, CAC registration (or personal BVN for sole trader)
3. Wait for approval (usually 1–3 business days)

### 4.2 Enable Transfers
1. Paystack Dashboard → **Settings** → **Developer** → **Transfers**
2. Toggle **Enable Transfers** ON
3. **Important:** Transfers require a funded Paystack balance. You must manually
   fund your Paystack business balance before the platform can pay out users.

### 4.3 Set webhook URL
1. Paystack Dashboard → **Settings** → **Webhooks**
2. Add webhook URL: `https://earnflow-api.daniellancce1.workers.dev/api/postbacks/paystack`
3. Copy the **Webhook Secret** and set it as `PAYSTACK_WEBHOOK_SECRET` (Step 2.2)

### 4.4 Fund your Paystack business balance
When networks pay you (via wire/SWIFT/Paystack invoice), move the money into
your Paystack balance. EarnFlow's withdrawal system debits from this balance
when users cash out.

**Minimum operating float recommended:** ₦500,000 to handle concurrent payouts
while waiting for the next network payment cycle.

---

## Part 5 — Fraud Detection (IPQualityScore)

1. Sign up at [ipqualityscore.com](https://www.ipqualityscore.com)
2. Free tier: 5,000 lookups/month. Paid: $20/month for 100K lookups.
3. Dashboard → **API Keys** → copy your key
4. Set as `IPQS_API_KEY` (Step 2.2)

---

## Part 6 — CPA / Offer Networks

> ⚠️ **Read this carefully.** Networks vet publishers. Apply with a real
> looking platform, honest traffic description, and be transparent about
> your model. Thin or fake-looking sites get rejected.

### What to say in your application:
- **Platform type:** GPT (Get-Paid-To) / Reward platform
- **Traffic source:** Africa (primarily Nigeria) — organic, email, social
- **Monetisation model:** Revenue share with users (50% of offer payout)
- **Fraud controls:** IPQualityScore IP scoring, device fingerprinting, velocity limits
- **Monthly active users:** Start honestly (even 0 if launching). Networks prefer honesty.

### 6.1 CPALead
- Apply: [cpalead.com/publishers.php](https://cpalead.com/publishers.php)
- Postback URL to configure in their dashboard:
  `https://earnflow-api.daniellancce1.workers.dev/api/postbacks/cpalead?secret=YOUR_POSTBACK_SECRET&subid={subid}&offer_id={offer_id}&payout={payout}`
- **Confirmation window to set on tasks:** 24 hours
- Typical approval: 1–3 days

### 6.2 AdGate Media
- Apply: [adgatemedia.com/publishers](https://www.adgatemedia.com/publishers)
- Best for: offerwall embeds (they give you an iframe)
- Postback URL:
  `https://earnflow-api.daniellancce1.workers.dev/api/postbacks/adgatemedia?secret=YOUR_SECRET&subid={subid}&offer_id={oid}&payout={payout}`
- **Confirmation window:** 48 hours

### 6.3 OfferToro
- Apply: [offertoro.com](https://www.offertoro.com) → Publishers
- Postback URL:
  `https://earnflow-api.daniellancce1.workers.dev/api/postbacks/offertoro?secret=YOUR_SECRET&subid={subid}&offer_id={offer_id}&payout={payout}`
- **Confirmation window:** 24 hours

### 6.4 MyLead
- Apply: [mylead.global](https://mylead.global) → Publisher registration
- Strong in Europe + Africa
- Postback URL:
  `https://earnflow-api.daniellancce1.workers.dev/api/postbacks/mylead?secret=YOUR_SECRET&subid={subid}&offer_id={offer_id}&payout={payout}`
- **Confirmation window:** 48 hours

---

## Part 7 — Survey Networks

### 7.1 BitLabs
- Apply: [bitlabs.ai](https://bitlabs.ai) → Publisher
- Strong survey inventory for Africa
- Use their JavaScript widget (snippet they give you) embedded in your survey page
- Postback URL:
  `https://earnflow-api.daniellancce1.workers.dev/api/postbacks/bitlabs?secret=YOUR_SECRET&user_id={USER_ID}&survey_id={SURVEY_ID}`
- **Confirmation window:** 0 (instant on postback)

### 7.2 CPX Research
- Apply: [cpx-research.com](https://cpx-research.com) → Publishers
- High Africa payout rates
- Postback URL:
  `https://earnflow-api.daniellancce1.workers.dev/api/postbacks/cpxresearch?secret=YOUR_SECRET&user_id={SUBID}&survey_id={SID}`

### 7.3 TheoremReach
- Apply: [theoremreach.com](https://theoremreach.com)
- Set your API key as `POSTBACK_SECRET_THEOREMREACH`
- Their SDK/widget handles the survey display; postback URL:
  `https://earnflow-api.daniellancce1.workers.dev/api/postbacks/theoremreach?uid={USER_ID}&hash={HASH}&reward={REWARD}`

---

## Part 8 — Ad Networks (for "Watch Ads" category)

### 8.1 Adsterra
- Apply: [adsterra.com](https://adsterra.com) → Publisher
- Best for: direct link ads and pop-under (high Nigeria CPM)
- Once approved, get your **Direct Link** code
- Create an `inhouse` task with the direct link as `instructions`
- In-house tasks credit instantly (no confirmation window needed)

### 8.2 PropellerAds
- Apply: [propellerads.com](https://propellerads.com)
- Use their **In-Page Push** or **Onclick (Popunder)** format
- Payments via Payoneer, Webmoney, wire. **Note:** They don't support Paystack.
  You receive dollars → convert to NGN → fund Paystack

### 8.3 Monetag (formerly PropellerAds)
- Apply: [monetag.com](https://monetag.com)
- Best format: **Interstitial** for GPT platforms

---

## Part 9 — Crypto Payouts (USDT)

The platform supports USDT withdrawals. To process them:

1. **Get a business wallet:** Create a wallet on Binance, Coinbase, or OKX
2. **Manual process initially:** When users request USDT withdrawals, the Worker
   creates a `crypto_usdt` withdrawal record. You must manually review and send
   from your exchange wallet until you automate this via exchange API.
3. **To automate:** Integrate the Binance Pay API or a crypto payment processor
   like CoinsPaid or TripleA. Add the API key as a Worker secret.

---

## Part 10 — Revenue Flow (How You Actually Get Paid)

```
User completes task
       ↓
Network fires postback → Worker sets pending_confirmation
       ↓ (24–48hr window)
Cron promotes → user balance credited, pending_minor cleared
       ↓
User requests withdrawal → Paystack Transfer API sends to bank
       ↓
[Meanwhile] Network pays YOU (the publisher) on their NET30/NET15 cycle
       ↓
You fund your Paystack business balance with those receipts
       ↓
EarnFlow's Paystack balance processes the next batch of user payouts
```

**Your margin:** Gross CPA payout - 50% user share - Paystack fees (1.5% + ₦100)
Example: A ₦2,000 CPA install → User gets ₦1,000 → You net ~₦965 after fees.

---

## Part 11 — Going Live Checklist

- [ ] Supabase migrations run (schema, functions, policies)
- [ ] All Wrangler secrets set (`wrangler secret list` to verify)
- [ ] FRAUD_KV namespace created and bound in `wrangler.toml`
- [ ] Worker deployed successfully (`wrangler deploy`)
- [ ] Cron trigger configured in `wrangler.toml` and redeployed
- [ ] Cloudflare Pages connected to GitHub repo
- [ ] Frontend API URL updated in `api.js` to match deployed Worker
- [ ] Paystack business account verified and Transfers enabled
- [ ] Paystack webhook URL set and `PAYSTACK_WEBHOOK_SECRET` set
- [ ] Applied to at least 2 CPA networks (CPALead + OfferToro recommended first)
- [ ] Applied to at least 1 survey network (BitLabs recommended)
- [ ] IPQualityScore account created and API key set
- [ ] Postback secrets generated and set for each approved network
- [ ] Postback URLs configured in each network's publisher dashboard
- [ ] Test with a real user account: complete a task, verify postback arrives,
      cron fires, balance updates
- [ ] Initial Paystack float funded (minimum ₦500,000)

---

## Part 12 — Ongoing Operations

| Task | Frequency | Where |
|------|-----------|-------|
| Monitor fraud_flags table | Daily | Supabase → Table Editor |
| Review pending withdrawals | Daily | Supabase → withdrawals table |
| Fund Paystack balance | When low | Paystack dashboard |
| Check Cloudflare Worker errors | Weekly | Cloudflare → Workers → Logs |
| Monitor postback success rate | Weekly | Per-network publisher dashboard |
| Apply to more networks | Monthly | As traffic grows |
| Update confirmation_window_hours | As needed | When networks notify you of new policies |

---

## Useful Commands

```bash
# Check Worker logs in real time
wrangler tail

# Check deployed secrets list
wrangler secret list

# Redeploy after code changes
cd worker && wrangler deploy

# Check KV namespaces
wrangler kv:namespace list
```

---

*Last updated: July 2026 · EarnFlow v2*

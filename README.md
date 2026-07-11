# EarnFlow

**Do tasks. Get paid. Watch it flow.**

EarnFlow is a get-paid-to (GPT) platform where users earn money completing offers, surveys, ads, app installs, software testing, micro-tasks, and more. Full build instructions for the coding agent live in [`docs/EARNFLOW_MASTER_DOCUMENTATION.md`](./docs/EARNFLOW_MASTER_DOCUMENTATION.md) — read that first.

## Stack
- **Database/Auth:** Supabase (Postgres + RLS)
- **API:** Cloudflare Workers
- **Frontend:** Static SPA on Cloudflare Pages
- **Payments:** Paystack
- **Fraud/VPN detection:** IPQualityScore

## Quick start (local dev)

```bash
# Database
# 1. Create a Supabase project
# 2. Run database/schema.sql, then database/functions.sql, then database/seed.sql

# Worker
cd worker
npm install
cp .env.example .dev.vars   # fill in real values
npm run dev

# Frontend
cd ../frontend
python3 -m http.server 8080   # or any static server
```

## Deploy

```bash
cd worker && npm run deploy
# Frontend: connect the /frontend directory to a Cloudflare Pages project
```

See the master documentation for schema details, task category definitions, country-matching rules, fraud/VPN policy, and the recommended build order.

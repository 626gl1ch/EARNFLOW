/**
 * EarnFlow — Cloudflare Worker API entry point
 * Routes are split into modules under ./routes/. This file only handles
 * CORS, routing, and top-level error handling.
 */

import { handleAuth } from './routes/auth.js';
import { handleTasks } from './routes/tasks.js';
import { handleOffers } from './routes/offers.js';
import { handleSurveys } from './routes/surveys.js';
import { handlePostbacks } from './routes/postbacks.js';
import { handleWallet } from './routes/wallet.js';
import { handleWithdrawals } from './routes/withdrawals.js';
import { handleFraud } from './routes/fraud.js';
import { handleAdmin } from './routes/admin.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // tighten to the production origin before launch
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Every route module receives (request, env, ctx, json) and returns a Response or null.
      const routers = [
        ['/api/auth', handleAuth],
        ['/api/tasks', handleTasks],
        ['/api/offers', handleOffers],
        ['/api/surveys', handleSurveys],
        ['/api/postbacks', handlePostbacks],   // server-to-server, no user JWT — verify provider secret instead
        ['/api/wallet', handleWallet],
        ['/api/withdrawals', handleWithdrawals],
        ['/api/fraud', handleFraud],
        ['/api/admin', handleAdmin],
      ];

      for (const [prefix, handler] of routers) {
        if (path.startsWith(prefix)) {
          const res = await handler(request, env, ctx, json, path.slice(prefix.length));
          if (res) return res;
        }
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      console.error('Unhandled worker error:', err);
      return json({ error: 'internal_error', message: env.DEBUG === 'true' ? String(err) : undefined }, 500);
    }
  },

  // Cron Triggers configured in wrangler.toml (see [triggers] block)
  async scheduled(event, env, ctx) {
    const { runExpireTasks }           = await import('./cron/expire-tasks.js');
    const { runPayoutBatch }           = await import('./cron/payout-batch.js');
    const { runFraudSweep }            = await import('./cron/fraud-sweep.js');
    const { runOwnerPayout }           = await import('./cron/owner-payout.js');
    const { confirmPendingCompletions } = await import('./cron/confirm-pending.js');

    switch (event.cron) {
      case '*/15 * * * *':
        ctx.waitUntil(runExpireTasks(env));
        break;
      case '0 * * * *':
        // Every hour: promote CPA completions past their confirmation window
        ctx.waitUntil(confirmPendingCompletions(env));
        break;
      case '0 2 * * *':
        ctx.waitUntil(runPayoutBatch(env));
        ctx.waitUntil(runOwnerPayout(env));
        break;
      case '0 */6 * * *':
        ctx.waitUntil(runFraudSweep(env));
        break;
    }
  },
};


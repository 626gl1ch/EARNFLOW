-- ============================================================================
-- EarnFlow Migration: 002_cpa_confirmation_and_earnings_view.sql
-- Run this if you already have schema.sql applied and are upgrading to v2.
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE).
-- ============================================================================

-- 1. Add pending_confirmation status to task_completions CHECK constraint
-- PostgreSQL: must drop and re-add the constraint
ALTER TABLE public.task_completions
  DROP CONSTRAINT IF EXISTS task_completions_status_check;

ALTER TABLE public.task_completions
  ADD CONSTRAINT task_completions_status_check
  CHECK (status IN (
    'pending',
    'pending_confirmation',
    'verified',
    'paid',
    'rejected',
    'flagged'
  ));

-- 2. Add new columns to task_completions
ALTER TABLE public.task_completions
  ADD COLUMN IF NOT EXISTS confirmation_window_hours int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- 3. Add new column to tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS confirmation_window_hours int NOT NULL DEFAULT 0;

-- 4. Index for the cron sweeper (only scans pending_confirmation rows)
CREATE INDEX IF NOT EXISTS idx_completions_pending_confirm
  ON public.task_completions(status, confirmed_at)
  WHERE status = 'pending_confirmation';

-- 5. Earnings by category view (replaces old one if it exists)
CREATE OR REPLACE VIEW public.user_category_earnings AS
SELECT
  tc.user_id,
  cat.slug AS category_slug,
  cat.name AS category_name,
  cat.icon AS category_icon,
  COUNT(tc.id)::int AS completed_count,
  COALESCE(SUM(le.amount_minor), 0)::bigint AS total_earned_minor,
  MAX(tc.paid_at) AS last_earned_at
FROM public.task_completions tc
JOIN public.tasks t ON t.id = tc.task_id
JOIN public.task_categories cat ON cat.id = t.category_id
LEFT JOIN public.ledger_entries le
  ON le.related_task_completion_id = tc.id
  AND le.entry_type = 'task_credit'
WHERE tc.status = 'paid'
GROUP BY tc.user_id, cat.slug, cat.name, cat.icon;

-- 6. pending_minor column on wallets (for holding CPA funds during confirmation window)
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS pending_minor bigint NOT NULL DEFAULT 0;

-- Done! Re-check with:
-- SELECT column_name FROM information_schema.columns WHERE table_name='task_completions';
-- SELECT * FROM public.user_category_earnings LIMIT 5;

-- ============================================================
-- CADD Tech HRMS — Security Hardening
-- Run this in the Supabase SQL Editor (safe to re-run).
--
-- Fixes:
--  1. HR-only guard inside the column add/drop RPCs (were callable
--     by any logged-in user or even anonymously).
--  2. Monthly reset can only actually zero points once per month, so
--     a malicious user cannot wipe everyone's points mid-month.
--  3. Revoke RPC access from the anonymous role.
--  4. Tighten staff_performance RLS so a user can only INSERT/UPDATE
--     their own row (HR can touch any row). Everyone can still view.
-- ============================================================

-- ---- 1. add_performance_column: HR only ----
CREATE OR REPLACE FUNCTION public.add_performance_column(col_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_hr() THEN
    RETURN 'error: not authorized';
  END IF;
  IF col_name !~ '^[a-z][a-z0-9_]*$' THEN
    RETURN 'error: invalid column name';
  END IF;
  EXECUTE format(
    'ALTER TABLE public.staff_performance ADD COLUMN IF NOT EXISTS %I integer not null default 0',
    col_name
  );
  RETURN 'ok';
END;
$$;

-- ---- 2. drop_performance_column: HR only ----
CREATE OR REPLACE FUNCTION public.drop_performance_column(col_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_hr() THEN
    RETURN 'error: not authorized';
  END IF;
  IF col_name !~ '^[a-z][a-z0-9_]*$' THEN
    RETURN 'error: invalid column name';
  END IF;
  IF col_name IN ('id', 'staff_name', 'empid', 'created_at', 'updated_at') THEN
    RETURN 'error: protected column';
  END IF;
  EXECUTE format(
    'ALTER TABLE public.staff_performance DROP COLUMN IF EXISTS %I',
    col_name
  );
  RETURN 'ok';
END;
$$;

-- ---- 3. reset_staff_performance_monthly: only zero once per month ----
CREATE OR REPLACE FUNCTION public.reset_staff_performance_monthly()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  col text;
  cols text := '';
  last_reset text;
  this_month text := to_char(now(), 'YYYY-MM');
BEGIN
  -- If we've already reset this month, do nothing (prevents mid-month wipes)
  SELECT value INTO last_reset FROM public.app_meta WHERE key = 'last_perf_reset';
  IF last_reset = this_month THEN
    RETURN;
  END IF;

  FOR col IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'staff_performance'
      AND data_type IN ('integer', 'bigint', 'numeric')
      AND column_name NOT IN ('id')
  LOOP
    cols := cols || col || ' = 0, ';
  END LOOP;

  IF cols <> '' THEN
    cols := rtrim(cols, ', ');
    EXECUTE format('UPDATE public.staff_performance SET %s, updated_at = now()', cols);
  END IF;

  INSERT INTO public.app_meta (key, value)
  VALUES ('last_perf_reset', this_month)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END;
$$;

-- ---- 4. Revoke RPC access from anonymous callers ----
REVOKE EXECUTE ON FUNCTION public.add_performance_column(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.drop_performance_column(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reset_staff_performance_monthly() FROM anon;
GRANT  EXECUTE ON FUNCTION public.add_performance_column(text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.drop_performance_column(text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.reset_staff_performance_monthly() TO authenticated;

-- ---- 5. Tighten staff_performance RLS ----
ALTER TABLE public.staff_performance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view staff_performance"   ON public.staff_performance;
DROP POLICY IF EXISTS "Anyone can insert staff_performance" ON public.staff_performance;
DROP POLICY IF EXISTS "Anyone can update staff_performance" ON public.staff_performance;
DROP POLICY IF EXISTS "Update own or HR update"             ON public.staff_performance;
DROP POLICY IF EXISTS "Insert own or HR insert"             ON public.staff_performance;

-- Everyone authenticated can view the leaderboard
CREATE POLICY "View staff_performance"
  ON public.staff_performance FOR SELECT
  TO authenticated
  USING ( true );

-- Insert only your own row (by empid) — HR can insert any
CREATE POLICY "Insert own or HR insert"
  ON public.staff_performance FOR INSERT
  TO authenticated
  WITH CHECK (
    empid = (SELECT empid FROM public.profiles WHERE id = auth.uid())
    OR public.is_hr()
  );

-- Update only your own row (by empid) — HR can update any
CREATE POLICY "Update own or HR update"
  ON public.staff_performance FOR UPDATE
  TO authenticated
  USING (
    empid = (SELECT empid FROM public.profiles WHERE id = auth.uid())
    OR public.is_hr()
  )
  WITH CHECK (
    empid = (SELECT empid FROM public.profiles WHERE id = auth.uid())
    OR public.is_hr()
  );

-- ============================================================
-- CADD Tech HRMS — Monthly Performance Reset
-- Run this in the Supabase SQL Editor.
--
-- Points reset to 0 at the start of each month. A small app_meta
-- marker tracks the last reset month; the app calls the RPC on load
-- when the month has changed (so it resets exactly once per month).
-- ============================================================

-- Single-row key/value store
CREATE TABLE IF NOT EXISTS public.app_meta (
  key text primary key,
  value text
);

INSERT INTO public.app_meta (key, value)
VALUES ('last_perf_reset', to_char(now(), 'YYYY-MM'))
ON CONFLICT (key) DO NOTHING;

-- Reset RPC: zeroes every numeric column of staff_performance and
-- updates the month marker. SECURITY DEFINER so any logged-in user
-- (who triggers it from the app) can run it without RLS issues.
CREATE OR REPLACE FUNCTION public.reset_staff_performance_monthly()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  col text;
  cols text := '';
BEGIN
  FOR col IN
    SELECT column_name FROM information_schema.columns
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
  VALUES ('last_perf_reset', to_char(now(), 'YYYY-MM'))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_staff_performance_monthly() TO authenticated, anon;

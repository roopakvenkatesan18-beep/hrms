-- ============================================================
-- CADD Tech HRMS — Performance row for every employee
-- Run this in the Supabase SQL Editor (safe to re-run).
--
-- Every employee must appear in staff_performance (with zero points)
-- so they show consistently in the leaderboard and dashboard. New
-- hires and any existing employee without a row get one automatically.
--
-- ensure_staff_performance() creates the row ONLY if none already exists
-- for that empid, so it is safe to call on every sync (idempotent).
-- ============================================================

CREATE OR REPLACE FUNCTION public.ensure_staff_performance(p_empid text, p_staff_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_performance WHERE empid = p_empid
  ) THEN
    INSERT INTO public.staff_performance (empid, staff_name, created_at, updated_at)
    VALUES (p_empid, p_staff_name, now(), now());
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_staff_performance(text, text) TO authenticated;

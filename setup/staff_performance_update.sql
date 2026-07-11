-- ============================================================
-- CADD Tech HRMS — Staff Performance: add empid + RPC
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Add empid column for per-employee access control
ALTER TABLE IF EXISTS public.staff_performance
  ADD COLUMN IF NOT EXISTS empid text default '';

-- 2. Create an RPC function so HR can add new integer columns from the UI
--    (SECURITY DEFINER runs with table owner privileges)
CREATE OR REPLACE FUNCTION public.add_performance_column(col_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Validate: only allow lowercase letters and underscores
  IF col_name !~ '^[a-z][a-z0-9_]*$' THEN
    RETURN 'error: invalid column name';
  END IF;

  -- Add column if it doesn't exist (default 0)
  EXECUTE format(
    'ALTER TABLE public.staff_performance ADD COLUMN IF NOT EXISTS %I integer not null default 0',
    col_name
  );

  RETURN 'ok';
END;
$$;

-- 3. Backfill empid on existing rows by matching staff_name → profiles.name
--    (so employees can claim/update their own row even if empid was empty)
UPDATE public.staff_performance sp
SET empid = p.empid
FROM public.profiles p
WHERE (sp.empid IS NULL OR sp.empid = '')
  AND p.name = sp.staff_name;

-- 4. Update RLS — drop old policies and recreate with empid support
ALTER TABLE IF EXISTS public.staff_performance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view staff_performance" ON public.staff_performance;
DROP POLICY IF EXISTS "Anyone can insert staff_performance" ON public.staff_performance;
DROP POLICY IF EXISTS "Anyone can update staff_performance" ON public.staff_performance;

-- Everyone can view
CREATE POLICY "Anyone can view staff_performance"
  ON public.staff_performance FOR SELECT
  USING ( true );

-- Authenticated users can insert
CREATE POLICY "Anyone can insert staff_performance"
  ON public.staff_performance FOR INSERT
  WITH CHECK ( true );

-- Employees can update OWN row (by empid) or a row that hasn't been claimed
-- yet but matches their own name; HR can update any row.
CREATE POLICY "Update own or HR update"
  ON public.staff_performance FOR UPDATE
  TO authenticated
  USING (
    empid = (SELECT empid FROM public.profiles WHERE id = auth.uid())
    OR public.is_hr()
    OR staff_name = (SELECT name FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    empid = (SELECT empid FROM public.profiles WHERE id = auth.uid())
    OR public.is_hr()
  );

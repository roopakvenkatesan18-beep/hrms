-- ============================================================
-- CADD Tech HRMS — Staff Performance: drop-column RPC (HR only)
-- Run this in the Supabase SQL Editor.
--
-- Lets HR delete a performance column from the UI. SECURITY DEFINER
-- runs with table-owner privileges so it bypasses RLS. Protected
-- system columns can never be dropped.
-- ============================================================

CREATE OR REPLACE FUNCTION public.drop_performance_column(col_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Validate: only lowercase letters, numbers and underscores
  IF col_name !~ '^[a-z][a-z0-9_]*$' THEN
    RETURN 'error: invalid column name';
  END IF;

  -- Never drop the system columns
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

GRANT EXECUTE ON FUNCTION public.drop_performance_column(text) TO authenticated, anon;

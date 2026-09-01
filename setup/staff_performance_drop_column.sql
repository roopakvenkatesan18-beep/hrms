CREATE OR REPLACE FUNCTION public.drop_performance_column(col_name text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_hr() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF col_name IS NULL OR length(col_name) > 63 OR col_name !~ '^[a-z][a-z0-9_]*$'
    OR col_name IN ('id', 'staff_name', 'empid', 'created_at', 'updated_at') THEN
    RAISE EXCEPTION 'Invalid performance column' USING ERRCODE = '22023';
  END IF;
  EXECUTE format('ALTER TABLE public.staff_performance DROP COLUMN IF EXISTS %I', col_name);
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.drop_performance_column(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.drop_performance_column(text) TO authenticated;

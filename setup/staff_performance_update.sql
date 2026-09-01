ALTER TABLE public.staff_performance ADD COLUMN IF NOT EXISTS empid text DEFAULT '';

CREATE OR REPLACE FUNCTION public.add_performance_column(col_name text)
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
  EXECUTE format('ALTER TABLE public.staff_performance ADD COLUMN IF NOT EXISTS %I integer NOT NULL DEFAULT 0', col_name);
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.add_performance_column(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_performance_column(text) TO authenticated;

ALTER TABLE public.staff_performance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staff_performance FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.staff_performance TO authenticated;
DO $$
DECLARE policy_record record;
BEGIN
  FOR policy_record IN SELECT policyname FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'staff_performance'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.staff_performance', policy_record.policyname);
  END LOOP;
END;
$$;
CREATE POLICY staff_performance_read ON public.staff_performance FOR SELECT TO authenticated
  USING (public.app_current_empid() IS NOT NULL);
CREATE POLICY staff_performance_insert ON public.staff_performance FOR INSERT TO authenticated
  WITH CHECK (public.is_hr() OR empid = public.app_current_empid());
CREATE POLICY staff_performance_update ON public.staff_performance FOR UPDATE TO authenticated
  USING (public.is_hr() OR empid = public.app_current_empid())
  WITH CHECK (public.is_hr() OR empid = public.app_current_empid());

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

CREATE TABLE IF NOT EXISTS public.app_meta (
  key text PRIMARY KEY,
  value text
);
ALTER TABLE public.app_meta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_meta FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_meta TO authenticated;
DO $$
DECLARE policy_record record;
BEGIN
  FOR policy_record IN SELECT policyname FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'app_meta'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.app_meta', policy_record.policyname);
  END LOOP;
END;
$$;
CREATE POLICY app_meta_read ON public.app_meta FOR SELECT TO authenticated
  USING (public.app_current_empid() IS NOT NULL);
CREATE POLICY app_meta_insert ON public.app_meta FOR INSERT TO authenticated
  WITH CHECK (public.is_hr() AND key <> 'last_perf_reset');
CREATE POLICY app_meta_update ON public.app_meta FOR UPDATE TO authenticated
  USING (public.is_hr() AND key <> 'last_perf_reset')
  WITH CHECK (public.is_hr() AND key <> 'last_perf_reset');
CREATE POLICY app_meta_delete ON public.app_meta FOR DELETE TO authenticated
  USING (public.is_hr() AND key <> 'last_perf_reset');

INSERT INTO public.app_meta (key, value)
VALUES ('last_perf_reset', to_char(now(), 'YYYY-MM'))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reset_staff_performance_monthly()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  assignments text;
  last_reset text;
  this_month text := to_char(now(), 'YYYY-MM');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_hr() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(724091823);
  SELECT value INTO last_reset FROM public.app_meta WHERE key = 'last_perf_reset' FOR UPDATE;
  IF last_reset = this_month THEN RETURN; END IF;
  SELECT string_agg(format('%I = 0', column_name), ', ')
  INTO assignments FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'staff_performance'
    AND data_type IN ('integer', 'bigint', 'numeric')
    AND column_name NOT IN ('id', 'empid');
  IF assignments IS NOT NULL THEN
    EXECUTE format('UPDATE public.staff_performance SET %s, updated_at = now()', assignments);
  END IF;
  INSERT INTO public.app_meta (key, value) VALUES ('last_perf_reset', this_month)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END;
$$;
REVOKE ALL ON FUNCTION public.reset_staff_performance_monthly() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_staff_performance_monthly() TO authenticated;

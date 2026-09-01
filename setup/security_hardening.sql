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

CREATE OR REPLACE FUNCTION public.ensure_staff_performance(p_empid text, p_staff_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE profile_record record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_hr() AND p_empid IS DISTINCT FROM public.app_current_empid() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT empid, name INTO profile_record FROM public.profiles WHERE empid = p_empid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee profile missing' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.staff_performance (empid, staff_name, created_at, updated_at)
  SELECT profile_record.empid, profile_record.name, now(), now()
  WHERE NOT EXISTS (SELECT 1 FROM public.staff_performance WHERE empid = profile_record.empid);
END;
$$;

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

DO $$
DECLARE function_record record;
BEGIN
  FOR function_record IN
    SELECT procedure.oid::regprocedure AS signature
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public' AND procedure.proname IN (
      'add_performance_column', 'drop_performance_column',
      'ensure_staff_performance', 'reset_staff_performance_monthly'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', function_record.signature);
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.add_performance_column(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.drop_performance_column(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_staff_performance(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_staff_performance_monthly() TO authenticated;

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

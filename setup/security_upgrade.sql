BEGIN;

DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['profiles', 'emp_attendance', 'emp_monthly', 'emp_last6months', 'leave_requests', 'wfh_requests', 'travel_allowance_requests', 'permission_requests', 'announcements', 'employee_schedule_slots', 'employee_chat_conversations', 'employee_chat_messages', 'staff_performance', 'perf_targets', 'employee_details', 'hr_notifications', 'app_meta']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = target_table
        AND relation.relkind IN ('r', 'p')
    ) THEN
      RAISE EXCEPTION 'Required application table public.% is missing; complete schema setup before this upgrade', target_table;
    END IF;
  END LOOP;
END;
$$;

CREATE SCHEMA IF NOT EXISTS hrms_private;
REVOKE ALL ON SCHEMA hrms_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA hrms_private TO authenticated;

CREATE OR REPLACE FUNCTION hrms_private.is_hr()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'hr'
  );
$$;
REVOKE ALL ON FUNCTION hrms_private.is_hr() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hrms_private.is_hr() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_hr()
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$ SELECT hrms_private.is_hr(); $$;
REVOKE ALL ON FUNCTION public.is_hr() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_hr() TO authenticated;

CREATE OR REPLACE FUNCTION hrms_private.current_empid()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT empid FROM public.profiles
  WHERE auth.uid() IS NOT NULL AND id = auth.uid();
$$;
REVOKE ALL ON FUNCTION hrms_private.current_empid() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hrms_private.current_empid() TO authenticated;

CREATE OR REPLACE FUNCTION public.app_current_empid()
RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$ SELECT hrms_private.current_empid(); $$;
REVOKE ALL ON FUNCTION public.app_current_empid() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_current_empid() TO authenticated;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS shift_checkin time;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS shift_checkout time;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS saturday_plan text DEFAULT 'every_saturday_work';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sunday_plan text DEFAULT 'two_sundays_work';

CREATE OR REPLACE FUNCTION public.delete_auth_user_by_empid(target_empid text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_hr() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND empid = target_empid) THEN
    RAISE EXCEPTION 'Cannot delete your own account' USING ERRCODE = '22023';
  END IF;
  DELETE FROM auth.users WHERE email = target_empid || '@caddtech.com';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_user_id_by_empid(target_empid text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  target_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_hr() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO target_id FROM auth.users
  WHERE email = target_empid || '@caddtech.com' LIMIT 1;
  RETURN target_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_employee_profile(
  p_id uuid, p_empid text, p_name text, p_role text, p_department text,
  p_shift_checkin text DEFAULT NULL, p_shift_checkout text DEFAULT NULL,
  p_sat_plan text DEFAULT 'every_saturday_work', p_sun_plan text DEFAULT 'two_sundays_work'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_hr() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('hr', 'employee') OR p_empid IS NULL
     OR p_empid !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
     OR NULLIF(btrim(p_name), '') IS NULL OR NULLIF(btrim(p_department), '') IS NULL THEN
    RAISE EXCEPTION 'Invalid employee profile' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_id AND email = p_empid || '@caddtech.com') THEN
    RAISE EXCEPTION 'Account does not match employee ID' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.profiles (
    id, empid, name, role, department, shift_checkin, shift_checkout,
    saturday_plan, sunday_plan, created_at
  ) VALUES (
    p_id, p_empid, btrim(p_name), p_role, btrim(p_department),
    NULLIF(p_shift_checkin, '')::time, NULLIF(p_shift_checkout, '')::time,
    p_sat_plan, p_sun_plan, now()
  )
  ON CONFLICT (id) DO UPDATE SET
    empid = EXCLUDED.empid, name = EXCLUDED.name, role = EXCLUDED.role,
    department = EXCLUDED.department, shift_checkin = EXCLUDED.shift_checkin,
    shift_checkout = EXCLUDED.shift_checkout,
    saturday_plan = EXCLUDED.saturday_plan, sunday_plan = EXCLUDED.sunday_plan;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_employee_profile(
  p_empid text, p_department text DEFAULT NULL,
  p_shift_checkin text DEFAULT NULL, p_shift_checkout text DEFAULT NULL,
  p_sat_plan text DEFAULT NULL, p_sun_plan text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_hr() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles SET
    department = COALESCE(p_department, department),
    shift_checkin = NULLIF(p_shift_checkin, '')::time,
    shift_checkout = NULLIF(p_shift_checkout, '')::time,
    saturday_plan = COALESCE(p_sat_plan, saturday_plan),
    sunday_plan = COALESCE(p_sun_plan, sunday_plan)
  WHERE empid = p_empid;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  managed_role text := NEW.raw_app_meta_data->>'role';
  managed_empid text := split_part(NEW.email, '@', 1);
BEGIN
  IF NEW.raw_app_meta_data->>'hrms_managed' IS DISTINCT FROM 'true'
     OR managed_role IS NULL OR managed_role NOT IN ('employee', 'hr')
     OR NEW.email IS NULL OR NEW.email !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}@caddtech[.]com$' THEN
    RAISE EXCEPTION 'Accounts must be provisioned by HR' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.profiles (id, empid, name, role, department, created_at)
  VALUES (
    NEW.id, managed_empid,
    COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'name'), ''), 'Employee'),
    managed_role,
    COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'department'), ''), 'Training'),
    now()
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DO $$
DECLARE
  function_record record;
BEGIN
  FOR function_record IN
    SELECT procedure.oid::regprocedure AS signature
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public' AND procedure.proname IN (
      'delete_auth_user_by_empid', 'get_auth_user_id_by_empid',
      'create_employee_profile', 'update_employee_profile', 'handle_new_user'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', function_record.signature);
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_auth_user_by_empid(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_id_by_empid(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_employee_profile(uuid,text,text,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_employee_profile(text,text,text,text,text,text) TO authenticated;

DO $$
DECLARE
  target_table text;
  policy_record record;
  sequence_name text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['profiles', 'emp_attendance', 'emp_monthly', 'emp_last6months', 'leave_requests', 'wfh_requests', 'travel_allowance_requests', 'permission_requests', 'announcements', 'employee_schedule_slots', 'employee_chat_conversations', 'employee_chat_messages', 'staff_performance', 'perf_targets', 'employee_details', 'hr_notifications', 'app_meta']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', target_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', target_table);
    FOR policy_record IN SELECT policyname FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = target_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_record.policyname, target_table);
    END LOOP;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = target_table AND column_name = 'id') THEN
      sequence_name := pg_catalog.pg_get_serial_sequence(format('public.%I', target_table), 'id');
      IF sequence_name IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon', sequence_name);
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', sequence_name);
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE POLICY profiles_read ON public.profiles FOR SELECT TO authenticated
  USING (public.app_current_empid() IS NOT NULL);
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (public.is_hr());
CREATE POLICY profiles_delete ON public.profiles FOR DELETE TO authenticated
  USING (public.is_hr());
CREATE POLICY emp_attendance_read ON public.emp_attendance FOR SELECT TO authenticated
  USING (public.is_hr() OR empid = public.app_current_empid());
CREATE POLICY emp_monthly_read ON public.emp_monthly FOR SELECT TO authenticated
  USING (public.is_hr() OR empid = public.app_current_empid());
CREATE POLICY emp_last6months_read ON public.emp_last6months FOR SELECT TO authenticated
  USING (public.is_hr() OR empid = public.app_current_empid());
CREATE POLICY leave_requests_read ON public.leave_requests FOR SELECT TO authenticated
  USING (public.is_hr() OR employee_id = public.app_current_empid());
CREATE POLICY leave_requests_insert ON public.leave_requests FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.app_current_empid() AND status = 'Pending');
CREATE POLICY leave_requests_review ON public.leave_requests FOR UPDATE TO authenticated
  USING (public.is_hr()) WITH CHECK (public.is_hr());
CREATE POLICY wfh_requests_read ON public.wfh_requests FOR SELECT TO authenticated
  USING (public.is_hr() OR employee_id = public.app_current_empid());
CREATE POLICY wfh_requests_insert ON public.wfh_requests FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.app_current_empid() AND status = 'Pending');
CREATE POLICY wfh_requests_review ON public.wfh_requests FOR UPDATE TO authenticated
  USING (public.is_hr()) WITH CHECK (public.is_hr());
CREATE POLICY travel_allowance_requests_read ON public.travel_allowance_requests FOR SELECT TO authenticated
  USING (public.is_hr() OR employee_id = public.app_current_empid());
CREATE POLICY travel_allowance_requests_insert ON public.travel_allowance_requests FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.app_current_empid() AND status = 'Pending');
CREATE POLICY travel_allowance_requests_review ON public.travel_allowance_requests FOR UPDATE TO authenticated
  USING (public.is_hr()) WITH CHECK (public.is_hr());
CREATE POLICY travel_allowance_edit_pending ON public.travel_allowance_requests FOR UPDATE TO authenticated
  USING (employee_id = public.app_current_empid() AND status = 'Pending')
  WITH CHECK (employee_id = public.app_current_empid() AND status = 'Pending');
CREATE POLICY permissions_read ON public.permission_requests FOR SELECT TO authenticated
  USING (public.is_hr() OR employee_id = public.app_current_empid());
CREATE POLICY permissions_insert ON public.permission_requests FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.app_current_empid() AND status = 'Approved');
CREATE POLICY permissions_review ON public.permission_requests FOR UPDATE TO authenticated
  USING (public.is_hr()) WITH CHECK (public.is_hr());
CREATE POLICY announcements_read ON public.announcements FOR SELECT TO authenticated
  USING (public.app_current_empid() IS NOT NULL);
CREATE POLICY announcements_manage ON public.announcements FOR ALL TO authenticated
  USING (public.is_hr()) WITH CHECK (public.is_hr());
CREATE POLICY schedule_read ON public.employee_schedule_slots FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_hr());
CREATE POLICY schedule_insert ON public.employee_schedule_slots FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND empid = public.app_current_empid());
CREATE POLICY schedule_delete ON public.employee_schedule_slots FOR DELETE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY conversations_read ON public.employee_chat_conversations FOR SELECT TO authenticated
  USING (auth.uid() IN (user1_id, user2_id));
CREATE POLICY conversations_insert ON public.employee_chat_conversations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IN (user1_id, user2_id));
CREATE POLICY conversations_delete ON public.employee_chat_conversations FOR DELETE TO authenticated
  USING (auth.uid() IN (user1_id, user2_id));
CREATE POLICY messages_read ON public.employee_chat_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employee_chat_conversations conversation
    WHERE conversation.id = conversation_id AND auth.uid() IN (conversation.user1_id, conversation.user2_id)
  ));
CREATE POLICY messages_insert ON public.employee_chat_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.employee_chat_conversations conversation
    WHERE conversation.id = conversation_id AND auth.uid() IN (conversation.user1_id, conversation.user2_id)
  ));
CREATE POLICY messages_delete ON public.employee_chat_messages FOR DELETE TO authenticated
  USING (sender_id = auth.uid());
CREATE POLICY targets_read ON public.perf_targets FOR SELECT TO authenticated
  USING (public.app_current_empid() IS NOT NULL);
CREATE POLICY targets_manage ON public.perf_targets FOR ALL TO authenticated
  USING (public.is_hr()) WITH CHECK (public.is_hr());
CREATE POLICY details_read ON public.employee_details FOR SELECT TO authenticated
  USING (public.is_hr() OR empid = public.app_current_empid());
CREATE POLICY details_insert ON public.employee_details FOR INSERT TO authenticated
  WITH CHECK (public.is_hr() OR empid = public.app_current_empid());
CREATE POLICY details_update ON public.employee_details FOR UPDATE TO authenticated
  USING (public.is_hr() OR empid = public.app_current_empid())
  WITH CHECK (public.is_hr() OR empid = public.app_current_empid());
CREATE POLICY notifications_read ON public.hr_notifications FOR SELECT TO authenticated
  USING (public.is_hr());
CREATE POLICY notifications_insert ON public.hr_notifications FOR INSERT TO authenticated
  WITH CHECK (public.app_current_empid() IS NOT NULL AND audience = 'hr');
CREATE POLICY notifications_update ON public.hr_notifications FOR UPDATE TO authenticated
  USING (public.is_hr()) WITH CHECK (public.is_hr());

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

CREATE SCHEMA IF NOT EXISTS hrms_private;
REVOKE ALL ON SCHEMA hrms_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA hrms_private TO authenticated;

CREATE TABLE IF NOT EXISTS hrms_private.permission_quota_locks (
  employee_month text PRIMARY KEY,
  revision boolean NOT NULL DEFAULT false
);
ALTER TABLE hrms_private.permission_quota_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE hrms_private.permission_quota_locks FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.permission_requests'::regclass AND conname = 'permission_duration_valid') THEN
    ALTER TABLE public.permission_requests ADD CONSTRAINT permission_duration_valid CHECK (
      duration_minutes > 0 AND duration_minutes <= 180 AND to_time > from_time
      AND duration_minutes = extract(epoch FROM (to_time - from_time)) / 60
    ) NOT VALID;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION hrms_private.enforce_permission_quota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  new_month date := date_trunc('month', NEW.date)::date;
  new_lock text := NEW.employee_id || ':' || new_month::text;
  old_lock text;
  used_minutes bigint;
BEGIN
  IF auth.uid() IS NULL OR (NOT public.is_hr() AND NEW.employee_id IS DISTINCT FROM public.app_current_empid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE empid = NEW.employee_id) THEN
    RAISE EXCEPTION 'Employee profile missing' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    old_lock := OLD.employee_id || ':' || date_trunc('month', OLD.date)::date::text;
  END IF;
  IF old_lock IS NOT NULL AND old_lock <> new_lock THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(old_lock, new_lock), 0));
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(greatest(old_lock, new_lock), 0));
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new_lock, 0));
  END IF;
  IF old_lock IS NOT NULL AND old_lock <> new_lock THEN
    INSERT INTO hrms_private.permission_quota_locks (employee_month) VALUES (old_lock)
    ON CONFLICT (employee_month) DO UPDATE
      SET revision = NOT hrms_private.permission_quota_locks.revision;
  END IF;
  INSERT INTO hrms_private.permission_quota_locks (employee_month) VALUES (new_lock)
  ON CONFLICT (employee_month) DO UPDATE
    SET revision = NOT hrms_private.permission_quota_locks.revision;
  IF NEW.status <> 'Rejected' THEN
    SELECT COALESCE(sum(duration_minutes), 0) INTO used_minutes
    FROM public.permission_requests
    WHERE employee_id = NEW.employee_id AND date >= new_month
      AND date < (new_month + interval '1 month')::date
      AND status <> 'Rejected' AND id IS DISTINCT FROM NEW.id;
    IF used_minutes + NEW.duration_minutes > 180 THEN
      RAISE EXCEPTION 'Monthly permission limit is 180 minutes' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION hrms_private.enforce_permission_quota() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_permission_quota ON public.permission_requests;
CREATE TRIGGER enforce_permission_quota BEFORE INSERT OR UPDATE ON public.permission_requests
FOR EACH ROW EXECUTE FUNCTION hrms_private.enforce_permission_quota();

DO $$
DECLARE constraint_record record;
BEGIN
  FOR constraint_record IN SELECT * FROM (VALUES
    ('leave_requests', 'leave_dates_valid', 'to_date >= from_date AND days > 0 AND days <= (to_date - from_date + 1)'),
    ('wfh_requests', 'wfh_dates_valid', 'to_date >= from_date AND ((from_time IS NULL AND to_time IS NULL) OR (from_time IS NOT NULL AND to_time IS NOT NULL AND to_time > from_time))'),
    ('travel_allowance_requests', 'travel_values_valid', 'travel_distance_km >= 0 AND travel_cost >= 0')
  ) AS checks(table_name, constraint_name, expression)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = format('public.%I', constraint_record.table_name)::regclass
        AND conname = constraint_record.constraint_name) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s) NOT VALID',
        constraint_record.table_name, constraint_record.constraint_name, constraint_record.expression);
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;

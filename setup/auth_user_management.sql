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

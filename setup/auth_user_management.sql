-- ============================================================
-- CADD Tech HRMS — Auth User Management RPCs & Profile Guarantee
-- Run this in the Supabase SQL Editor (safe to re-run).
--
-- Fixes the "Add Employee" bug where a new employee appeared briefly
-- in auth.users and then disappeared with no profiles row:
--   * The profiles table was missing shift_checkin / shift_checkout,
--     and create_employee_profile() did not accept those params, so the
--     RPC errored and the profile was never written.
--   * A trigger now guarantees a profiles row is created for EVERY new
--     auth user (defense in depth), so a record never goes missing.
--   * create_employee_profile() is idempotent (ON CONFLICT) so re-adding
--     the same employee relinks cleanly without duplicates.
-- ============================================================

-- Drop any existing versions first (return types may differ)
DROP FUNCTION IF EXISTS public.delete_auth_user_by_empid(text);
DROP FUNCTION IF EXISTS public.get_auth_user_id_by_empid(text);

-- 0. Make sure profiles has the shift columns (idempotent)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS shift_checkin time;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS shift_checkout time;

CREATE OR REPLACE FUNCTION public.delete_auth_user_by_empid(target_empid text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM auth.users
  WHERE email = target_empid || '@caddtech.com';
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_auth_user_by_empid(text) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.get_auth_user_id_by_empid(target_empid text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM auth.users
  WHERE email = target_empid || '@caddtech.com'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_auth_user_id_by_empid(text) TO authenticated, anon;

-- Inserts (or updates) a profile row directly, bypassing RLS so that
-- "Add Employee" works for any HR without depending on INSERT policies.
-- Shift times are passed as TEXT (the JS sends "HH:MM:SS" strings) and
-- cast to time inside — this avoids overload ambiguity. Idempotent on the
-- primary key (id) so re-adding the same employee relinks cleanly.
--
-- Drop BOTH possible overloads first so we never end up with a
-- text/text and a time/time version that Postgres can't disambiguate.
DROP FUNCTION IF EXISTS public.create_employee_profile(uuid, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.create_employee_profile(uuid, text, text, text, text, time, time);

CREATE OR REPLACE FUNCTION public.create_employee_profile(
  p_id uuid,
  p_empid text,
  p_name text,
  p_role text,
  p_department text,
  p_shift_checkin text DEFAULT NULL,
  p_shift_checkout text DEFAULT NULL,
  p_sat_plan text DEFAULT 'every_saturday_work',
  p_sun_plan text DEFAULT 'two_sundays_work'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, empid, name, role, department, shift_checkin, shift_checkout, saturday_plan, sunday_plan, created_at)
  VALUES (
    p_id, p_empid, p_name, p_role, p_department,
    NULLIF(p_shift_checkin, '')::time,
    NULLIF(p_shift_checkout, '')::time,
    p_sat_plan,
    p_sun_plan,
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET empid = EXCLUDED.empid,
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        department = EXCLUDED.department,
        shift_checkin = EXCLUDED.shift_checkin,
        shift_checkout = EXCLUDED.shift_checkout,
        saturday_plan = EXCLUDED.saturday_plan,
        sunday_plan = EXCLUDED.sunday_plan;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_employee_profile(uuid, text, text, text, text, text, text, text, text) TO authenticated, anon;

-- Updates an employee's department and/or shift times. Called by the
-- "Edit Employee" dialog. Runs SECURITY DEFINER so HR can update profiles
-- despite RLS. Shift times are passed as TEXT and cast to time inside to
-- avoid overload ambiguity. Matches the named args from js/api.js.
DROP FUNCTION IF EXISTS public.update_employee_profile(text, text, text, text);
DROP FUNCTION IF EXISTS public.update_employee_profile(text, text, time, time);

CREATE OR REPLACE FUNCTION public.update_employee_profile(
  p_empid text,
  p_department text DEFAULT NULL,
  p_shift_checkin text DEFAULT NULL,
  p_shift_checkout text DEFAULT NULL,
  p_sat_plan text DEFAULT NULL,
  p_sun_plan text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET department      = COALESCE(p_department, department),
      shift_checkin   = NULLIF(p_shift_checkin, '')::time,
      shift_checkout  = NULLIF(p_shift_checkout, '')::time,
      saturday_plan   = COALESCE(p_sat_plan, saturday_plan),
      sunday_plan     = COALESCE(p_sun_plan, sunday_plan)
  WHERE empid = p_empid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_employee_profile(text, text, text, text, text, text) TO authenticated, anon;

-- ============================================================
-- Guarantee a profiles row for every newly created auth user.
-- This is the safety net: even if the client RPC is skipped or fails,
-- the employee still gets a profile (so they never "disappear").
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, empid, name, role, department, created_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'empid', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'name', 'Employee'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'employee'),
    COALESCE(NEW.raw_user_meta_data->>'department', 'Training'),
    now()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

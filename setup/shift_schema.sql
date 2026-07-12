-- ============================================================
-- CADD Tech HRMS — Shift / Late-Calculation Schema Update
-- Run this in the Supabase SQL Editor (after the base seed-users.sql).
-- It ONLY modifies existing tables (profiles) and updates/adds RPCs.
-- ============================================================

-- 1. Add shift columns to the profiles table (NULL for HR / no shift)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS shift_checkin time,
  ADD COLUMN IF NOT EXISTS shift_checkout time;

-- 2. Update create_employee_profile so HR can store the shift when creating
--    an employee account. (Drops the old 5-arg version first.)
DROP FUNCTION IF EXISTS public.create_employee_profile(uuid, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_employee_profile(
  p_id uuid,
  p_empid text,
  p_name text,
  p_role text,
  p_department text,
  p_shift_checkin text DEFAULT NULL,
  p_shift_checkout text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, empid, name, role, department, shift_checkin, shift_checkout, created_at)
  VALUES (p_id, p_empid, p_name, p_role, p_department, p_shift_checkin, p_shift_checkout, now())
  ON CONFLICT (id) DO UPDATE
    SET empid = EXCLUDED.empid,
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        department = EXCLUDED.department,
        shift_checkin = EXCLUDED.shift_checkin,
        shift_checkout = EXCLUDED.shift_checkout;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_employee_profile(uuid, text, text, text, text, text, text) TO authenticated, anon;

-- 3. New RPC so HR can update department + shift without hitting RLS.
DROP FUNCTION IF EXISTS public.update_employee_profile(text, text, text, text);

CREATE OR REPLACE FUNCTION public.update_employee_profile(
  p_empid text,
  p_department text DEFAULT NULL,
  p_shift_checkin text DEFAULT NULL,
  p_shift_checkout text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET department = COALESCE(p_department, department),
      shift_checkin = COALESCE(p_shift_checkin::time, shift_checkin),
      shift_checkout = COALESCE(p_shift_checkout::time, shift_checkout)
  WHERE empid = p_empid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_employee_profile(text, text, text, text) TO authenticated, anon;

-- 4. Allow HR to UPDATE profiles directly (fallback / convenience).
DROP POLICY IF EXISTS "HR can update profiles" ON public.profiles;

CREATE POLICY "HR can update profiles"
  ON public.profiles
  FOR UPDATE
  USING (public.is_hr())
  WITH CHECK (public.is_hr());

-- 5. (Optional, reference) Pure-SQL helper that mirrors the app's late rule:
--    Absent if no check-in; Late if check-in is > 30 min after the shift
--    check-in; otherwise Present. Falls back to the legacy 11:00 rule when
--    no shift is assigned. The app performs this client-side; this is here
--    so the same logic is available in SQL if you ever need it.
CREATE OR REPLACE FUNCTION public.attendance_status(checkin time, shift_checkin time)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  IF checkin IS NULL THEN
    RETURN 'Absent';
  END IF;

  IF shift_checkin IS NULL THEN
    IF (EXTRACT(hour FROM checkin) > 11)
       OR (EXTRACT(hour FROM checkin) = 11 AND EXTRACT(minute FROM checkin) > 0) THEN
      RETURN 'Late';
    ELSE
      RETURN 'Present';
    END IF;
  END IF;

  IF (EXTRACT(epoch FROM (checkin - shift_checkin)) / 60.0) > 30 THEN
    RETURN 'Late';
  ELSE
    RETURN 'Present';
  END IF;
END;
$$;

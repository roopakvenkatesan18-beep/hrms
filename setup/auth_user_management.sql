-- ============================================================
-- CADD Tech HRMS — Auth User Management RPCs
-- Run this in the Supabase SQL Editor.
--
-- These let HR fully manage employee auth accounts:
--   * delete_auth_user_by_empid : removes the auth user (cascades
--     to the profiles row), so a deleted employee can be re-added
--     cleanly with a fresh password.
--   * get_auth_user_id_by_empid : resolves the UUID of an existing
--     auth user without knowing their password (safety net for the
--     "user already registered" case when re-linking a profile).
-- ============================================================

-- Drop any existing versions first (return types may differ)
DROP FUNCTION IF EXISTS public.delete_auth_user_by_empid(text);
DROP FUNCTION IF EXISTS public.get_auth_user_id_by_empid(text);

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
CREATE OR REPLACE FUNCTION public.create_employee_profile(
  p_id uuid,
  p_empid text,
  p_name text,
  p_role text,
  p_department text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, empid, name, role, department, created_at)
  VALUES (p_id, p_empid, p_name, p_role, p_department, now())
  ON CONFLICT (id) DO UPDATE
    SET empid = EXCLUDED.empid,
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        department = EXCLUDED.department;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_employee_profile(uuid, text, text, text, text) TO authenticated, anon;

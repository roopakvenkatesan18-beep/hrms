-- ============================================================
-- SQL to run in Supabase SQL Editor
-- This enables all logged-in (authenticated) employees and HR
-- to read profile rows. This allows the Employee Directory and 
-- Team Chat to load and show everyone automatically!
-- ============================================================

-- 1. Drop the old restrictive SELECT policies
DROP POLICY IF EXISTS "Employees can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "HR can view all profiles" ON public.profiles;

-- 2. Create the new permissive SELECT policy
CREATE POLICY "Anyone authenticated can view all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING ( true );

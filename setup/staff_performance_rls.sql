-- ============================================================
-- CADD Tech HRMS — Staff Performance RLS Policies
-- Run this AFTER table creation in Supabase SQL Editor
-- ============================================================

ALTER TABLE public.staff_performance ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can view all staff performance
DROP POLICY IF EXISTS "Anyone can view staff_performance" ON public.staff_performance;
CREATE POLICY "Anyone can view staff_performance"
  ON public.staff_performance FOR SELECT
  USING ( true );

-- Authenticated users can insert (new staff signup)
DROP POLICY IF EXISTS "Anyone can insert staff_performance" ON public.staff_performance;
CREATE POLICY "Anyone can insert staff_performance"
  ON public.staff_performance FOR INSERT
  WITH CHECK ( true );

-- Authenticated users can update any row (self-service points tracking)
DROP POLICY IF EXISTS "Anyone can update staff_performance" ON public.staff_performance;
CREATE POLICY "Anyone can update staff_performance"
  ON public.staff_performance FOR UPDATE
  USING ( true );

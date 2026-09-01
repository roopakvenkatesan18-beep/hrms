-- RLS policies for emp_last6months table
ALTER TABLE public.emp_last6months ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "HR can view all last6months" ON public.emp_last;
CREATE POLICY "HR can view all last6months"
  ON public.emp_last6months FOR SELECT
  TO authenticated
  USING ( public.is_hr() );

DROP POLICY IF EXISTS "Employee can view own last6months" ON public.emp_last;
CREATE POLICY "Employee can view own last6months"
  ON public.emp_last6months FOR SELECT
  TO authenticated
  USING (
    empid = (SELECT empid FROM public.profiles WHERE id = auth.uid())
  );

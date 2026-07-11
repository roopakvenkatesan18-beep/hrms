-- RLS policies for emp_last6months table
ALTER TABLE public.emp_last6months ENABLE ROW LEVEL SECURITY;

CREATE POLICY "HR can view all last6months"
  ON public.emp_last6months FOR SELECT
  USING ( public.is_hr() );

CREATE POLICY "Employee can view own last6months"
  ON public.emp_last6months FOR SELECT
  USING (
    empid = (SELECT empid FROM public.profiles WHERE id = auth.uid())
  );
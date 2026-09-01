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
REVOKE ALL ON FUNCTION public.ensure_staff_performance(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_staff_performance(text,text) TO authenticated;

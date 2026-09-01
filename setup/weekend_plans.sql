ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS saturday_plan text DEFAULT 'every_saturday_work';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sunday_plan text DEFAULT 'two_sundays_work';

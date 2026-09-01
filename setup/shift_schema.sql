ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS shift_checkin time;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS shift_checkout time;

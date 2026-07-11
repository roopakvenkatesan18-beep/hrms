-- =========================================================
-- Supabase schema for Employee Schedule (per-user slots)
-- Each employee can add/remove their own class schedule.
-- Run this in the Supabase SQL Editor.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.employee_schedule_slots (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    empid       text NOT NULL,
    class_name  text NOT NULL,
    start_h     smallint NOT NULL CHECK (start_h >= 0 AND start_h <= 23),
    start_m     smallint NOT NULL CHECK (start_m >= 0 AND start_m <= 59),
    end_h       smallint NOT NULL CHECK (end_h >= 0 AND end_h <= 23),
    end_m       smallint NOT NULL CHECK (end_m >= 0 AND end_m <= 59),
    color       text NOT NULL DEFAULT '#3b82f6',
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT schedule_end_after_start CHECK (
        (end_h * 60 + end_m) > (start_h * 60 + start_m)
    )
);

CREATE INDEX IF NOT EXISTS idx_schedule_user_id
    ON public.employee_schedule_slots (user_id);

CREATE INDEX IF NOT EXISTS idx_schedule_empid
    ON public.employee_schedule_slots (empid);

-- =========================================================
-- Row-Level Security
-- =========================================================

ALTER TABLE public.employee_schedule_slots ENABLE ROW LEVEL SECURITY;

-- Employees read their own schedule
CREATE POLICY "employees_select_own_schedule"
    ON public.employee_schedule_slots
    FOR SELECT
    USING (user_id = auth.uid());

-- Employees insert their own schedule
CREATE POLICY "employees_insert_own_schedule"
    ON public.employee_schedule_slots
    FOR INSERT
    WITH CHECK (
        user_id = auth.uid()
        AND empid = (SELECT empid FROM public.profiles WHERE id = auth.uid())
    );

-- Employees delete their own schedule
CREATE POLICY "employees_delete_own_schedule"
    ON public.employee_schedule_slots
    FOR DELETE
    USING (user_id = auth.uid());

-- HR can view all schedules (optional — for future HR views)
CREATE POLICY "hr_select_all_schedules"
    ON public.employee_schedule_slots
    FOR SELECT
    USING (public.is_hr());

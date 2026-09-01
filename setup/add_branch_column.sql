-- Adds the 'branch' column to the existing employee_details table.
-- The table was created before branch was added to the schema, so
-- CREATE TABLE IF NOT EXISTS skipped it. This is safe to re-run.
ALTER TABLE public.employee_details
  ADD COLUMN IF NOT EXISTS branch text DEFAULT '';

-- Refresh PostgREST schema cache so the Supabase client picks up the new column.
NOTIFY pgrst, 'reload schema';

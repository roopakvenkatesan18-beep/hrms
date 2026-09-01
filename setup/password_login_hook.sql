BEGIN;

CREATE SCHEMA IF NOT EXISTS hrms_private;
REVOKE ALL ON SCHEMA hrms_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA hrms_private TO supabase_auth_admin;

CREATE TABLE IF NOT EXISTS hrms_private.password_login_attempts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  attempts timestamptz[] NOT NULL DEFAULT '{}'
);
ALTER TABLE hrms_private.password_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hrms_private.password_login_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON hrms_private.password_login_attempts TO supabase_auth_admin;
DROP POLICY IF EXISTS auth_login_counter ON hrms_private.password_login_attempts;
CREATE POLICY auth_login_counter ON hrms_private.password_login_attempts
  FOR ALL TO supabase_auth_admin USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.password_login_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  target_user uuid := (event->>'user_id')::uuid;
  attempt_time timestamptz := clock_timestamp();
  recent_attempts timestamptz[];
BEGIN
  IF target_user IS NULL THEN
    RETURN jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Authentication unavailable.'));
  END IF;
  INSERT INTO hrms_private.password_login_attempts(user_id) VALUES (target_user)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT attempts INTO recent_attempts
    FROM hrms_private.password_login_attempts
    WHERE user_id = target_user FOR UPDATE;
  SELECT coalesce(array_agg(attempt), '{}'::timestamptz[]) INTO recent_attempts
    FROM unnest(recent_attempts) AS attempt
    WHERE attempt > attempt_time - interval '15 minutes';
  IF cardinality(recent_attempts) >= 15 THEN
    RETURN jsonb_build_object('error', jsonb_build_object('http_code', 428, 'message', 'Too many login attempts. Please wait 15 minutes.'));
  END IF;
  UPDATE hrms_private.password_login_attempts
    SET attempts = array_append(recent_attempts, attempt_time)
    WHERE user_id = target_user;
  RETURN jsonb_build_object('decision', 'continue');
END;
$$;

REVOKE ALL ON FUNCTION public.password_login_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.password_login_hook(jsonb) TO supabase_auth_admin;

COMMIT;

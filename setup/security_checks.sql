BEGIN READ ONLY;

DO $$
DECLARE
  target_table text;
  function_record record;
  selected_employee record;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'profiles', 'emp_attendance', 'emp_monthly', 'emp_last6months',
    'leave_requests', 'wfh_requests', 'travel_allowance_requests',
    'permission_requests', 'announcements', 'employee_schedule_slots',
    'employee_chat_conversations', 'employee_chat_messages',
    'staff_performance', 'perf_targets', 'employee_details',
    'hr_notifications', 'app_meta'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
      WHERE oid = format('public.%I', target_table)::regclass AND relrowsecurity) THEN
      RAISE EXCEPTION 'RLS missing on public.%', target_table;
    END IF;
    IF has_table_privilege('anon', format('public.%I', target_table), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') THEN
      RAISE EXCEPTION 'Anonymous privilege on public.%', target_table;
    END IF;
    IF has_table_privilege('authenticated', format('public.%I', target_table), 'TRUNCATE') THEN
      RAISE EXCEPTION 'Authenticated TRUNCATE privilege on public.%', target_table;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = target_table
        AND (roles @> ARRAY['public'::name] OR roles @> ARRAY['anon'::name])) THEN
      RAISE EXCEPTION 'Public/anonymous policy on public.%', target_table;
    END IF;
  END LOOP;

  FOR function_record IN
    SELECT procedure.oid, procedure.proname, procedure.proconfig
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public' AND procedure.proname IN (
      'delete_auth_user_by_empid', 'get_auth_user_id_by_empid',
      'create_employee_profile', 'update_employee_profile',
      'add_performance_column', 'drop_performance_column',
      'reset_staff_performance_monthly', 'ensure_staff_performance', 'handle_new_user'
    )
  LOOP
    IF has_function_privilege('anon', function_record.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Anonymous execution allowed: %', function_record.proname;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.permission_requests'::regclass
      AND tgname = 'enforce_permission_quota' AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'Permission quota trigger missing or disabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.permission_requests'::regclass
      AND conname = 'permission_duration_valid') THEN
    RAISE EXCEPTION 'Permission duration constraint missing';
  END IF;
  SELECT id, empid INTO selected_employee FROM public.profiles
    WHERE role = 'employee' ORDER BY id LIMIT 1;
  PERFORM set_config('hrms.test_employee_uuid', COALESCE(selected_employee.id::text, ''), true);
  PERFORM set_config('hrms.test_employee_empid', COALESCE(selected_employee.empid, ''), true);
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{}', true);

DO $$
BEGIN
  IF public.is_hr() OR public.app_current_empid() IS NOT NULL THEN
    RAISE EXCEPTION 'Missing identity must not resolve an employee or HR';
  END IF;
  BEGIN
    PERFORM public.get_auth_user_id_by_empid('security-check');
    RAISE EXCEPTION 'Missing identity was allowed to resolve accounts';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.reset_staff_performance_monthly();
    RAISE EXCEPTION 'Missing identity was allowed to reset performance';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  employee_uuid text := current_setting('hrms.test_employee_uuid');
  employee_empid text := current_setting('hrms.test_employee_empid');
  target_table text;
  other_rows bigint;
BEGIN
  IF employee_uuid = '' THEN
    RAISE NOTICE 'Employee-role checks skipped: no existing employee profile';
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', employee_uuid, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', employee_uuid, 'role', 'authenticated')::text, true);
  IF public.is_hr() OR public.app_current_empid() IS DISTINCT FROM employee_empid THEN
    RAISE EXCEPTION 'Employee identity/role resolution failed';
  END IF;
  BEGIN
    PERFORM public.create_employee_profile(employee_uuid::uuid, employee_empid, 'Security Check', 'hr', 'Training');
    RAISE EXCEPTION 'Employee was allowed to change HR role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.delete_auth_user_by_empid(employee_empid);
    RAISE EXCEPTION 'Employee was allowed to delete accounts';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.update_employee_profile(employee_empid);
    RAISE EXCEPTION 'Employee was allowed to manage profiles';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.add_performance_column('security_check');
    RAISE EXCEPTION 'Employee was allowed to add performance columns';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.drop_performance_column('security_check');
    RAISE EXCEPTION 'Employee was allowed to drop performance columns';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  FOREACH target_table IN ARRAY ARRAY['leave_requests','wfh_requests','travel_allowance_requests','permission_requests']
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE employee_id IS DISTINCT FROM $1', target_table)
      INTO other_rows USING employee_empid;
    IF other_rows <> 0 THEN RAISE EXCEPTION 'Other employees visible in %', target_table; END IF;
  END LOOP;
END;
$$;

RESET ROLE;
ROLLBACK;

/* ============================================================
   CADD Tech HRMS — API Data Layer
   Handles fetching and formatting data from Supabase
   ============================================================ */

const API = (() => {

  /**
   * Convert SQL time "09:30:00" to UI format "09:30 AM"
   */
  function formatTime(timeStr) {
    if (!timeStr || timeStr === "00:00:00") return "--:--";
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;

    let h = parseInt(parts[0], 10);
    const m = parts[1];
    const ampm = h >= 12 ? 'PM' : 'AM';

    h = h % 12;
    h = h ? h : 12; // 0 becomes 12

    return `${h.toString().padStart(2, '0')}:${m} ${ampm}`;
  }

  /**
   * Safely parse punches which could be an array (jsonb), a JSON string, or null
   */
  function parsePunches(punches) {
    if (!punches) return [];
    if (Array.isArray(punches)) return punches;
    if (typeof punches === 'string') {
      try {
        const parsed = JSON.parse(punches);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  /**
   * Calculate Attendance Status based on check-in time
   * Assumption: Before 09:15 AM is Present, after is Late
   */
  function calculateStatus(checkinTime) {
    if (!checkinTime || checkinTime === "00:00:00") return "Absent";
    const parts = checkinTime.split(':');
    if (parts.length < 2) return "Present";

    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);

    // Only comes under late if after 11:00
    if (h > 11 || (h === 11 && m > 0)) return "Late";
    return "Present";
  }

  /**
   * Fetch attendance records from Supabase and map them to the UI state format.
   * If empid is provided, filters for that employee. Otherwise fetches all (for HR).
   */
  async function fetchAttendance(empid = null) {
    try {
      let query = supabaseClient.from('emp_attendance').select('*');

      if (empid) {
        query = query.eq('empid', empid);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Supabase Query Error:", error);
        throw error;
      }

      // Map database rows to the exact structure the UI expects
      return data.map(row => ({
        id: row.id.toString(),
        employeeId: row.empid,
        date: row.date,
        checkIn: formatTime(row.checkin),
        checkOut: formatTime(row.checkout),
        status: calculateStatus(row.checkin),
        punches: parsePunches(row.punches)
      }));

    } catch (err) {
      console.error("[API] fetchAttendance Error:", err);
      return []; // Return empty array so UI doesn't crash
    }
  }

  /**
   * Fetch monthly attendance summary from Supabase
   */
  async function fetchMonthlyAttendance(empid = null) {
    try {
      let query = supabaseClient.from('emp_monthly').select('*');

      if (empid) {
        query = query.eq('empid', empid);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Supabase Query Error (emp_monthly):", error);
        throw error;
      }

      return data.map(row => ({
        id: row.id.toString(),
        employeeId: row.empid,
        name: row.name,
        date: row.date,
        checkIn: formatTime(row.checkin),
        checkOut: formatTime(row.checkout),
        overtime: row.work_ot,
        status: calculateStatus(row.checkin),
        punches: parsePunches(row.punches)
      }));

    } catch (err) {
      console.error("[API] fetchMonthlyAttendance Error:", err);
      return [];
    }
  }

  /**
   * Add a new employee (HR Admin only)
   * Uses a secondary Supabase client with persistSession: false so the HR admin is not logged out!
   *
   * The flow is atomic: if the profile row cannot be written, any freshly
   * created auth user is rolled back so we never leave an orphaned account
   * that later gets cleaned up and "disappears". Re-adding an existing empid
   * relinks the profile (idempotent) instead of creating a duplicate.
   */
  async function addEmployee(empid, name, role, dept, password, shiftCheckin = null, shiftCheckout = null, satPlan = 'every_saturday_work', sunPlan = 'two_sundays_work') {
    const cleanEmpid = (empid || "").trim();
    const cleanName = (name || "").trim();
    const email = `${cleanEmpid}@caddtech.com`;

    // Create a clean background client (so the HR admin isn't logged out)
    const bgClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    let authUserId = null;
    let createdNewAuthUser = false;

    try {
      // 1. Ensure the auth user exists (create or resolve).
      const { data: signUpData, error: signUpError } = await bgClient.auth.signUp({
        email: email,
        password: password,
        options: {
          data: {
            empid: cleanEmpid,
            name: cleanName,
            role: role,
            department: dept
          }
        }
      });

      if (signUpError) {
        if (signUpError.message.includes("User already registered")) {
          // Auth account already exists — resolve its UUID without the password.
          try {
            const { data: rpcUid, error: rpcErr } = await supabaseClient.rpc('get_auth_user_id_by_empid', {
              target_empid: cleanEmpid
            });
            if (!rpcErr && rpcUid) authUserId = rpcUid;
          } catch (e) {
            console.warn('[API] get_auth_user_id_by_empid failed, trying password sign-in:', e);
          }

          if (!authUserId) {
            const { data: signInData, error: signInError } = await bgClient.auth.signInWithPassword({
              email: email,
              password: password,
            });
            if (signInError || !signInData?.user) {
              throw new Error(`Employee ID ${cleanEmpid} already has an account, but the password didn't match. Use the original password or reset it.`);
            }
            authUserId = signInData.user.id;
          }
        } else {
          throw signUpError;
        }
      } else {
        authUserId = signUpData.user.id;
        createdNewAuthUser = true;
      }

      if (!authUserId) {
        throw new Error("Could not resolve the employee's auth account. Please try again.");
      }

      // 2. Create/update the profile row via a SECURITY DEFINER RPC (bypasses RLS).
      //    Idempotent on the primary key, so re-adding relinks cleanly.
      const { error: rpcError } = await supabaseClient.rpc('create_employee_profile', {
        p_id: authUserId,
        p_empid: cleanEmpid,
        p_name: cleanName,
        p_role: role,
        p_department: dept,
        p_shift_checkin: shiftCheckin || null,
        p_shift_checkout: shiftCheckout || null,
        p_sat_plan: satPlan || 'every_saturday_work',
        p_sun_plan: sunPlan || 'two_sundays_work'
      });

      if (rpcError) {
        // Roll back a freshly-created auth user so we don't leave an orphan
        // that later gets cleaned up and "disappears".
        if (createdNewAuthUser) {
          await supabaseClient.rpc('delete_auth_user_by_empid', { target_empid: cleanEmpid }).catch(() => {});
        }
        throw rpcError;
      }

      // 3. Guarantee a staff_performance row (zero points) so the new hire
      //    appears in the leaderboard / dashboard consistently.
      try {
        await ensureStaffPerformance(cleanEmpid, cleanName);
      } catch (e) {
        console.warn('[API] ensureStaffPerformance (onboard) failed:', e);
      }

      return { user: { id: authUserId } };
    } catch (err) {
      console.error("[API] addEmployee Error:", err);
      throw err;
    }
  }

  /**
   * Update an employee's department and/or shift (HR only).
   * Uses a SECURITY DEFINER RPC so HR can update profiles despite RLS.
   */
  async function updateEmployee(empid, updates) {
    try {
      const { error } = await supabaseClient.rpc('update_employee_profile', {
        p_empid: empid,
        p_department: updates.department ?? null,
        p_shift_checkin: updates.shiftCheckin ?? null,
        p_shift_checkout: updates.shiftCheckout ?? null,
        p_sat_plan: updates.satPlan ?? null,
        p_sun_plan: updates.sunPlan ?? null
      });
      if (error) throw error;
      return true;
    } catch (err) {
      console.error("[API] updateEmployee Error:", err);
      throw err;
    }
  }

  /**
   * Fetch all employees from the profiles table (HR Admin view)
   */
  async function fetchAllProfiles() {
    try {
      const { data, error } = await supabaseClient.from('profiles').select('*').order('empid');
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error("[API] fetchAllProfiles Error:", err);
      return [];
    }
  }

  /**
   * Remove employee — deletes the auth user via the
   * delete_auth_user_by_empid RPC (runs with SECURITY DEFINER so it can
   * reach auth.users). Deleting the auth user cascades to the profiles row.
   * Falls back to deleting just the profile row if the RPC is unavailable.
   */
  async function removeEmployee(empid) {
    try {
      // First try to delete the authentication user via RPC
      const { data, error: rpcError } = await supabaseClient.rpc('delete_auth_user_by_empid', {
        target_empid: empid
      });
      
      if (rpcError) {
        console.warn('[API] RPC user deletion failed, falling back to profile row deletion:', rpcError);
        // Fallback: delete just profile row
        const { error } = await supabaseClient
          .from('profiles')
          .delete()
          .eq('empid', empid);
        if (error) throw error;
      }
      return true;
    } catch (err) {
      console.error("[API] removeEmployee Error:", err);
      throw err;
    }
  }

  /**
   * Fetch all conversations the current user is part of (either side).
   * New schema: user1_id + user2_id both stored.
   */
  async function fetchMyConversations() {
    try {
      const { data, error } = await supabaseClient
        .from('employee_chat_conversations')
        .select('id, user1_id, user2_id, created_at')
        .order('created_at');
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('[API] fetchMyConversations Error:', err);
      return [];
    }
  }

  /**
   * Find an existing conversation between myUid and otherUid,
   * or create one if it doesn't exist.
   * We enforce canonical order (lower UUID first) to match the UNIQUE index.
   */
  async function findOrCreateConversation(myUid, otherUid) {
    try {
      // Canonical order: smaller UUID is always user1
      const u1 = myUid < otherUid ? myUid : otherUid;
      const u2 = myUid < otherUid ? otherUid : myUid;

      // Try to find existing
      const { data: existing, error: findErr } = await supabaseClient
        .from('employee_chat_conversations')
        .select('id, user1_id, user2_id')
        .eq('user1_id', u1)
        .eq('user2_id', u2)
        .maybeSingle();

      if (existing) return existing;

      // Create new
      const { data: created, error: createErr } = await supabaseClient
        .from('employee_chat_conversations')
        .insert([{ user1_id: u1, user2_id: u2 }])
        .select()
        .single();
      if (createErr) throw createErr;
      return created;
    } catch (err) {
      console.error('[API] findOrCreateConversation Error:', err);
      throw err;
    }
  }

  /**
   * Fetch messages for a given conversation, ordered by time ascending.
   */
  async function fetchChatMessages(conversationId) {
    try {
      const { data, error } = await supabaseClient
        .from('employee_chat_messages')
        .select('id, conversation_id, sender_id, text, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('[API] fetchChatMessages Error:', err);
      return [];
    }
  }

  /**
   * Insert a new message into a conversation.
   */
  async function sendChatMessage(conversationId, senderUid, text) {
    try {
      const { data, error } = await supabaseClient
        .from('employee_chat_messages')
        .insert([{ conversation_id: conversationId, sender_id: senderUid, text }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('[API] sendChatMessage Error:', err);
      throw err;
    }
  }

  /**
   * Map a DB schedule row to the UI slot format used in app.js
   */
  function mapScheduleRow(row) {
    return {
      id: row.id,
      startH: row.start_h,
      startM: row.start_m,
      endH: row.end_h,
      endM: row.end_m,
      className: row.class_name,
      color: row.color || '#3b82f6',
    };
  }

  /**
   * Fetch schedule slots for the currently logged-in employee.
   */
  async function fetchScheduleSlots() {
    try {
      const { data, error } = await supabaseClient
        .from('employee_schedule_slots')
        .select('id, user_id, empid, class_name, start_h, start_m, end_h, end_m, color, created_at')
        .order('start_h', { ascending: true })
        .order('start_m', { ascending: true });

      if (error) throw error;
      return (data || []).map(mapScheduleRow);
    } catch (err) {
      console.error('[API] fetchScheduleSlots Error:', err);
      return [];
    }
  }

  /**
   * Add a schedule slot for the current employee.
   */
  async function addScheduleSlot(userId, empid, slot) {
    try {
      const { data, error } = await supabaseClient
        .from('employee_schedule_slots')
        .insert([{
          user_id: userId,
          empid: empid,
          class_name: slot.className,
          start_h: slot.startH,
          start_m: slot.startM,
          end_h: slot.endH,
          end_m: slot.endM,
          color: slot.color,
        }])
        .select('id, user_id, empid, class_name, start_h, start_m, end_h, end_m, color, created_at')
        .single();

      if (error) throw error;
      return mapScheduleRow(data);
    } catch (err) {
      console.error('[API] addScheduleSlot Error:', err);
      throw err;
    }
  }

  /**
   * Remove a schedule slot (RLS ensures only own rows can be deleted).
   */
  async function removeScheduleSlot(slotId) {
    try {
      const { error } = await supabaseClient
        .from('employee_schedule_slots')
        .delete()
        .eq('id', slotId);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[API] removeScheduleSlot Error:', err);
      throw err;
    }
  }

  /**
   * Fetch all announcements from Supabase, newest first
   */
  async function fetchAnnouncements() {
    try {
      const { data, error } = await supabaseClient
        .from('announcements')
        .select('*')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('[API] fetchAnnouncements Error:', err);
      return [];
    }
  }

  /**
   * Create a new announcement (HR only)
   */
  async function createAnnouncement(title, body, category, author, authorEmpid) {
    try {
      const { data, error } = await supabaseClient
        .from('announcements')
        .insert([{
          title,
          body,
          category,
          author,
          author_empid: authorEmpid,
          date: new Date().toISOString().slice(0, 10)
        }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('[API] createAnnouncement Error:', err);
      throw err;
    }
  }

  /**
   * Fetch leave requests. If empid provided, fetch only that employee's.
   */
  async function fetchLeaveRequests(empid = null) {
    try {
      let query = supabaseClient.from('leave_requests').select('*').order('created_at', { ascending: false });
      if (empid) {
        query = query.eq('employee_id', empid);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('[API] fetchLeaveRequests Error:', err);
      return [];
    }
  }

  /**
   * Create a new leave request (employee only)
   */
  async function createLeaveRequest(employeeId, type, fromDate, toDate, days, reason) {
    try {
      const { data, error } = await supabaseClient
        .from('leave_requests')
        .insert([{
          employee_id: employeeId,
          type,
          from_date: fromDate,
          to_date: toDate,
          days,
          reason,
          status: 'Pending'
        }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('[API] createLeaveRequest Error:', err);
      throw err;
    }
  }

  /**
   * Update leave request status (HR only — approve/reject)
   */
  async function updateLeaveStatus(id, status, reviewerNote, reviewedBy) {
    try {
      const { data, error } = await supabaseClient
        .from('leave_requests')
        .update({ status, reviewer_note: reviewerNote, reviewed_by: reviewedBy })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('[API] updateLeaveStatus Error:', err);
      throw err;
    }
  }

  /**
   * Fetch Work-From-Home requests. If empid provided, fetch only that employee's.
   */
  async function fetchWfhRequests(empid = null) {
    try {
      let query = supabaseClient.from('wfh_requests').select('*').order('created_at', { ascending: false });
      if (empid) {
        query = query.eq('employee_id', empid);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('[API] fetchWfhRequests Error:', err);
      return [];
    }
  }

  /**
   * Create a new WFH request (employee only)
   */
  async function createWfhRequest(employeeId, fromDate, toDate, fromTime, toTime, reason) {
    try {
      const { data, error } = await supabaseClient
        .from('wfh_requests')
        .insert([{
          employee_id: employeeId,
          from_date: fromDate,
          to_date: toDate,
          from_time: fromTime || null,
          to_time: toTime || null,
          reason,
          status: 'Pending'
        }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('[API] createWfhRequest Error:', err);
      throw err;
    }
  }

  /**
   * Update WFH request status (HR only — approve/reject)
   */
  async function updateWfhStatus(id, status, reviewerNote, reviewedBy) {
    try {
      const { data, error } = await supabaseClient
        .from('wfh_requests')
        .update({ status, reviewer_note: reviewerNote, reviewed_by: reviewedBy })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('[API] updateWfhStatus Error:', err);
      throw err;
    }
  }

  /**
   * Fetch permission requests. If empid provided, fetch only that employee's.
   */
  async function fetchPermissionRequests(empid = null) {
    try {
      let query = supabaseClient.from('permission_requests').select('*').order('created_at', { ascending: false });
      if (empid) {
        query = query.eq('employee_id', empid);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('[API] fetchPermissionRequests Error:', err);
      return [];
    }
  }

  /**
   * Create a new permission request (employee only, status fixed to 'Approved')
   */
  async function createPermissionRequest(employeeId, date, fromTime, toTime, durationMinutes, reason) {
    try {
      const { data, error } = await supabaseClient
        .from('permission_requests')
        .insert([{
          employee_id: employeeId,
          date,
          from_time: fromTime,
          to_time: toTime,
          duration_minutes: durationMinutes,
          reason,
          status: 'Approved'
        }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('[API] createPermissionRequest Error:', err);
      throw err;
    }
  }

  async function fetchStaffPerformance() {
    try {
      const { data, error } = await supabaseClient
        .from('staff_performance')
        .select('*')
        .order('id');
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('[API] fetchStaffPerformance Error:', err);
      return [];
    }
  }

  /**
    * Update a staff performance record (self-service points)
    */
  async function updateStaffPerformance(id, updates) {
    try {
      const { data, error } = await supabaseClient
        .from('staff_performance')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select();
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("No performance record updated — run setup/staff_performance_update.sql in Supabase (RLS blocks the update).");
      }
      return data[0];
    } catch (err) {
      console.error('[API] updateStaffPerformance Error:', err);
      throw err;
    }
  }

  /**
    * Create a new staff performance record (used when an employee has no row yet)
    */
  async function createStaffPerformance(empid, staffName, updates) {
    try {
      const row = {
        empid: empid,
        staff_name: staffName,
        ...updates,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const { data, error } = await supabaseClient
        .from('staff_performance')
        .insert([row])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('[API] createStaffPerformance Error:', err);
      throw err;
    }
  }

  /**
   * Ensure a staff_performance row exists for an employee (with zero points).
   * Idempotent: does nothing if a row for that empid already exists.
   * Used during onboarding and sync so every employee shows in the
   * leaderboard / dashboard consistently.
   */
  async function ensureStaffPerformance(empid, staffName) {
    try {
      const { error } = await supabaseClient.rpc('ensure_staff_performance', {
        p_empid: empid,
        p_staff_name: staffName
      });
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[API] ensureStaffPerformance Error:', err);
      throw err;
    }
  }

  /**
   * Call the RPC to add a new integer column to staff_performance (HR only)
   */
  async function addStaffPerformanceColumn(colName) {
    try {
      const { data, error } = await supabaseClient.rpc('add_performance_column', {
        col_name: colName
      });
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('[API] addStaffPerformanceColumn Error:', err);
      throw err;
    }
  }

  /**
   * Call the RPC to drop a column from staff_performance (HR only)
   */
  async function dropStaffPerformanceColumn(colName) {
    try {
      const { data, error } = await supabaseClient.rpc('drop_performance_column', {
        col_name: colName
      });
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('[API] dropStaffPerformanceColumn Error:', err);
      throw err;
    }
  }

  async function deleteChatMessage(messageId) {
    try {
      const { error } = await supabaseClient
        .from('employee_chat_messages')
        .delete()
        .eq('id', messageId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[API] deleteChatMessage Error:', err);
      throw err;
    }
  }

  async function fetchLast6Months(empid = null) {
    try {
      let query = supabaseClient.from('emp_last6months').select('*');

      if (empid) {
        query = query.eq('empid', empid);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Supabase Query Error (emp_last6months):", error);
        throw error;
      }

      return data.map(row => ({
        id: row.id.toString(),
        employeeId: row.empid,
        name: row.name,
        date: row.date,
        checkIn: formatTime(row.checkin),
        checkOut: formatTime(row.checkout),
        overtime: row.work_ot,
        punches: parsePunches(row.punches)
      }));

    } catch (err) {
      console.error("[API] fetchLast6Months Error:", err);
      return [];
    }
  }

  async function fetchAttendanceByMonth(empid, startDate, endDate) {
    try {
      let query = supabaseClient
        .from('emp_attendance')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate);

      if (empid) {
        query = query.eq('empid', empid);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Supabase Query Error (fetchAttendanceByMonth):", error);
        throw error;
      }

      return data.map(row => ({
        id: row.id.toString(),
        employeeId: row.empid,
        date: row.date,
        checkIn: formatTime(row.checkin),
        checkOut: formatTime(row.checkout),
        status: calculateStatus(row.checkin),
        punches: parsePunches(row.punches)
      }));

    } catch (err) {
      console.error("[API] fetchAttendanceByMonth Error:", err);
      return [];
    }
  }

  /**
   * Fetch attendance from emp_last6months table for a specific date range.
   * Used by calendar navigation to load previous month data.
   */
  async function fetchLast6MonthsByMonth(empid, startDate, endDate) {
    try {
      let query = supabaseClient
        .from('emp_last6months')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate);

      if (empid) {
        query = query.eq('empid', empid);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Supabase Query Error (fetchLast6MonthsByMonth):", error);
        throw error;
      }

      return data.map(row => ({
        id: row.id.toString(),
        employeeId: row.empid,
        name: row.name,
        date: row.date,
        checkIn: formatTime(row.checkin),
        checkOut: formatTime(row.checkout),
        overtime: row.work_ot,
        status: calculateStatus(row.checkin),
        punches: parsePunches(row.punches)
      }));

    } catch (err) {
      console.error("[API] fetchLast6MonthsByMonth Error:", err);
      return [];
    }
  }

  /**
   * Fetch travel allowance requests. If empid provided, fetch only that employee's.
   */
  async function fetchTravelAllowanceRequests(empid = null) {
    try {
      let query = supabaseClient.from('travel_allowance_requests').select('*').order('created_at', { ascending: false });
      if (empid) {
        query = query.eq('employee_id', empid);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('[API] fetchTravelAllowanceRequests Error:', err);
      return [];
    }
  }

  /**
   * Create a new travel allowance request (employee only)
   */
  async function createTravelAllowanceRequest(req) {
    try {
      const { data, error } = await supabaseClient
        .from('travel_allowance_requests')
        .insert([{
          employee_id: req.employeeId,
          request_date: req.requestDate,
          from_location: req.fromLocation,
          destination: req.destination,
          travel_distance_km: req.distanceKm != null ? req.distanceKm : 0,
          purpose: req.purpose,
          additional_details: req.additionalDetails,
          status: 'Pending'
        }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('[API] createTravelAllowanceRequest Error:', err);
      throw err;
    }
  }

  /**
   * Update travel allowance request status (HR only — approve/reject)
   */
  async function updateTravelAllowanceStatus(id, status, reviewerNote, reviewedBy) {
    try {
      const { data, error } = await supabaseClient
        .from('travel_allowance_requests')
        .update({
          status,
          reviewer_note: reviewerNote,
          reviewed_by: reviewedBy,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('[API] updateTravelAllowanceStatus Error:', err);
      throw err;
    }
  }

  return {
    fetchAttendance,
    fetchMonthlyAttendance,
    fetchLast6Months,
    fetchAttendanceByMonth,
    fetchLast6MonthsByMonth,
    addEmployee,
    fetchAllProfiles,
    updateEmployee,
    removeEmployee,
    fetchMyConversations,
    findOrCreateConversation,
    fetchChatMessages,
    sendChatMessage,
    fetchScheduleSlots,
    addScheduleSlot,
    removeScheduleSlot,
    fetchAnnouncements,
    createAnnouncement,
    fetchLeaveRequests,
    createLeaveRequest,
    updateLeaveStatus,
    fetchTravelAllowanceRequests,
    createTravelAllowanceRequest,
    updateTravelAllowanceStatus,
    fetchWfhRequests,
    createWfhRequest,
    updateWfhStatus,
    fetchPermissionRequests,
    createPermissionRequest,
    fetchStaffPerformance,
    updateStaffPerformance,
    createStaffPerformance,
    ensureStaffPerformance,
    addStaffPerformanceColumn,
    dropStaffPerformanceColumn,
    deleteChatMessage,
    formatTime,
  };

})();

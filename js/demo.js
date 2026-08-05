/* ============================================================
   CADD Tech HRMS — Demo Mode (TEMPORARY)
   Generates random data and bypasses Supabase auth.
   Will be reverted after the GitHub update.
   ============================================================ */

const Demo = (() => {

  /* ---------- Random Data Pools ---------- */
  const FIRST_NAMES = [
    'Aarav','Vivaan','Aditya','Arjun','Sai','Rohan','Vikram','Rahul','Amit','Sanjay',
    'Priya','Ananya','Neha','Pooja','Riya','Kavya','Divya','Shruti','Meera','Isha',
    'Kiran','Deepak','Manoj','Prakash','Suresh','Rajesh','Vijay','Ganesh','Mohan','Sathish',
    'Lakshmi','Saranya','Revathi','Kavitha','Sumathi','Geetha','Nithya','Tamilselvan','Saravanan','Balamurugan',
    'Harish','Prabhu','Murugan','Velmurugan','Dinesh','Senthil','Karthik','Saravana','Muthu','Rajkumar'
  ];
  const LAST_NAMES = [
    'Kumar','Singh','Sharma','Patel','Nair','Reddy','Gupta','Mishra','Iyer','Desai',
    'Rao','Menon','Pillai','Das','Banerjee','Mukherjee','Chatterjee','Joshi','Verma','Chauhan',
    'Tiwari','Pandey','Saxena','Malhotra','Kapoor','Chopra','Sinha','Thakur','Kaur','Bhat'
  ];
  const DEPARTMENTS = ['Training','Placement','Projects','Marketing','IT','Civil','Mechanical','EEE','HR','Admin'];
  const BRANCHES = ['Avadi','Poonamallee','Arumbakkam'];
  const LOCATIONS = ['Chennai','Bengaluru','Hyderabad','Mumbai','Pune'];
  const LEAVE_TYPES = ['Casual','Sick','Earned','Personal','Medical'];
  const LEAVE_REASONS = [
    'Family function','Medical appointment','Personal work','Festival celebration',
    'Family vacation','Wedding ceremony','Health check-up','Urgent travel','Religious event','Home renovation'
  ];
  const WFH_REASONS = [
    'Internet connectivity at office is poor','Doctor appointment in the afternoon',
    'Home repair work in progress','Family emergency','Child school event',
    'Remote collaboration with offshore team','Need quiet workspace for report preparation'
  ];
  const TRAVEL_PURPOSES = [
    'Client visit','Training session','Branch transfer','Conference attendance',
    'Vendor meeting','Campus recruitment drive','Project installation','Site inspection'
  ];
  const TRAVEL_FROM = ['Chennai Office','Avadi Branch','Poonamallee Branch','Arumbakkam Branch','Home'];
  const TRAVEL_DEST = ['Mumbai Client Site','Bengaluru Office','Hyderabad Branch','Pune Training Center','Coimbatore Factory'];
  const PERM_REASONS = [
    'Bank work','Post office visit','Medical test','Government office work',
    'Personal errand','Interview preparation','Child school visit'
  ];
  const ANNOUNCEMENT_TITLES = [
    'Office Holiday Notice','Monthly Town Hall','New Policy Update','Team Outing Planned',
    'Training Session — Soft Skills','Fire Safety Drill','Birthday Celebration','Work Anniversary',
    'Annual Day Rehearsals','Parking Rules Reminder','New Timings Effective Monday',
    'Employee of the Month','Health Insurance Renewal','Performance Review Schedule'
  ];
  const ANNOUNCEMENT_BODIES = [
    'Please note that the office will remain closed on account of the upcoming public holiday.',
    'Monthly town hall meeting scheduled for the last working day of this month. Attendance is mandatory.',
    'Kindly go through the updated leave policy document shared on the internal portal.',
    'A team outing is being organized for all departments next Saturday. RSVP by Thursday.',
    'Mandatory soft-skills training session for all staff this Wednesday, 3:00 PM – 5:00 PM.',
    'Fire safety drill will be conducted on Friday morning. Please follow evacuation procedures.',
    'Wishing all employees with birthdays this month a wonderful year ahead!',
    'Congratulations to our work anniversaries this month — thank you for your dedication.',
    'Annual day rehearsals start next week. Please ensure your participation as per the schedule.',
    'Please note the updated parking rules effective immediately. Two-wheelers must park in the designated area.',
    'Work timings will be adjusted to 9:30 AM – 6:30 PM starting next Monday.',
    'Congratulations to this month\'s top performers! Check the leaderboard for details.',
    'Health insurance renewal window opens next month. Please review your dependents.',
    'Q2 performance review discussions will be held in the first week of next month.'
  ];
  const CLASS_NAMES = [
    'AutoCAD','Revit MEP','SolidWorks','CATIA','ANSYS','STAAD Pro','Primavera',
    '3ds Max','SketchUp','ETABS','Tekla','MATLAB','Python','Advanced Excel',
    'Tally ERP','Web Development'
  ];
  const CATEGORIES = ['General','Important','Urgent','Reminder','Policy','Event'];

  /* ---------- Helpers ---------- */
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pad2(n) { return String(n).padStart(2, '0'); }

  function randomDate(daysBackMin, daysBackMax) {
    const d = new Date();
    d.setDate(d.getDate() - randInt(daysBackMin, daysBackMax));
    return d.toISOString().slice(0, 10);
  }

  function randomTime(minHour, maxHour) {
    const h = randInt(minHour, maxHour);
    const m = pick([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    return `${pad2(h)}:${pad2(m)}:00`;
  }

  function formatTimeDisplay(time24) {
    if (!time24 || time24 === '00:00:00') return '--:--';
    const parts = time24.split(':');
    let h = parseInt(parts[0], 10);
    const m = parts[1];
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${pad2(h)}:${m} ${ampm}`;
  }

  function fakeUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function randomPhone() {
    return `+91 ${randInt(6000,9999)} ${randInt(10000,99999)}`;
  }

  function randomEmail(empid) {
    return `${empid}@caddtech.com`;
  }

  /* ---------- Demo Account Definitions ---------- */
  function buildHrAccounts() {
    const names = [
      { name: 'Harikrishnan P', empid: 'demo-hr-1' },
      { name: 'Chandru V',      empid: 'demo-hr-2' },
      { name: 'Raji S',         empid: 'demo-hr-3' }
    ];
    return names.map(n => ({
      ...n,
      role: 'hr',
      department: 'HR',
      branch: pick(BRANCHES),
      phone: randomPhone(),
      email: randomEmail(n.empid),
      joinDate: randomDate(400, 900),
      shiftCheckin: '09:30:00',
      shiftCheckout: '18:30:00',
      designation: 'HR Manager'
    }));
  }

  function buildEmployeeAccounts() {
    const usedNames = new Set();
    const emps = [];
    for (let i = 1; i <= 15; i++) {
      let firstName, lastName, fullName;
      do {
        firstName = pick(FIRST_NAMES);
        lastName = pick(LAST_NAMES);
        fullName = `${firstName} ${lastName.charAt(0)}.`;
      } while (usedNames.has(fullName));
      usedNames.add(fullName);

      emps.push({
        empid: `demo-emp-${pad2(i)}`,
        name: fullName,
        role: 'employee',
        department: pick(DEPARTMENTS),
        branch: pick(BRANCHES),
        phone: randomPhone(),
        email: randomEmail(`demo-emp-${pad2(i)}`),
        joinDate: randomDate(30, 800),
        shiftCheckin: pick(['09:00:00','09:30:00','10:00:00']),
        shiftCheckout: pick(['18:00:00','18:30:00','19:00:00']),
        designation: pick(['CAD Trainer','Junior Trainer','Senior Trainer','Placement Coordinator','Project Lead','IT Executive'])
      });
    }
    return emps;
  }

  /* ---------- Generate Random Data ---------- */
  function generateEmployees() {
    return [...buildHrAccounts(), ...buildEmployeeAccounts()];
  }

  function generateAttendance(employees, daysBackMin, daysBackMax) {
    const records = [];
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun, 6=Sat

    employees.forEach(emp => {
      for (let n = daysBackMin; n <= daysBackMax; n++) {
        const d = new Date();
        d.setDate(d.getDate() - n);
        const dow = d.getDay();
        if (dow === 0) continue; // skip Sundays
        if (dow === 6 && Math.random() > 0.4) continue; // skip ~60% of Saturdays

        const dateStr = d.toISOString().slice(0, 10);
        const shiftCI = emp.shiftCheckin || '09:30:00';
        const shiftH = parseInt(shiftCI.split(':')[0], 10);
        const shiftM = parseInt(shiftCI.split(':')[1], 10);

        const roll = Math.random();
        let status, checkin24, checkout24;

        if (roll < 0.75) {
          // Present — on time or slightly late
          const lateMin = randInt(-5, 30);
          const ciH = Math.max(8, Math.min(12, shiftH + Math.floor((shiftM + lateMin) / 60)));
          const ciM = (shiftM + lateMin + 60) % 60;
          checkin24 = `${pad2(ciH)}:${pad2(ciM)}:00`;
          checkout24 = randomTime(17, 19);
          status = lateMin > 30 ? 'Late' : 'Present';
        } else if (roll < 0.9) {
          // Late
          checkin24 = randomTime(11, 12);
          checkout24 = randomTime(17, 19);
          status = 'Late';
        } else {
          // Absent
          checkin24 = '00:00:00';
          checkout24 = '00:00:00';
          status = 'Absent';
        }

        const punches = status !== 'Absent' ? [
          { time: checkin24, type: 'in' },
          { time: checkout24, type: 'out' }
        ] : [];

        records.push({
          id: `${emp.empid}-${dateStr}`,
          employeeId: emp.empid,
          date: dateStr,
          checkIn: formatTimeDisplay(checkin24),
          checkOut: formatTimeDisplay(checkout24),
          status,
          punches
        });
      }
    });
    return records;
  }

  function generateMonthlyAttendance(employees, daysBackMin, daysBackMax) {
    const records = [];
    employees.forEach(emp => {
      for (let n = daysBackMin; n <= daysBackMax; n++) {
        const d = new Date();
        d.setDate(d.getDate() - n);
        const dow = d.getDay();
        if (dow === 0) continue;
        if (dow === 6 && Math.random() > 0.4) continue;

        const dateStr = d.toISOString().slice(0, 10);
        const shiftCI = emp.shiftCheckin || '09:30:00';
        const shiftH = parseInt(shiftCI.split(':')[0], 10);
        const shiftM = parseInt(shiftCI.split(':')[1], 10);

        const roll = Math.random();
        let checkin24, checkout24, status;

        if (roll < 0.75) {
          const lateMin = randInt(-5, 30);
          const ciH = Math.max(8, Math.min(12, shiftH + Math.floor((shiftM + lateMin) / 60)));
          const ciM = (shiftM + lateMin + 60) % 60;
          checkin24 = `${pad2(ciH)}:${pad2(ciM)}:00`;
          checkout24 = randomTime(17, 19);
          status = lateMin > 30 ? 'Late' : 'Present';
        } else if (roll < 0.9) {
          checkin24 = randomTime(11, 12);
          checkout24 = randomTime(17, 19);
          status = 'Late';
        } else {
          checkin24 = '00:00:00';
          checkout24 = '00:00:00';
          status = 'Absent';
        }

        const ot = status !== 'Absent' && Math.random() > 0.85;
        const punches = status !== 'Absent' ? [
          { time: checkin24, type: 'in' },
          { time: checkout24, type: 'out' }
        ] : [];

        records.push({
          id: `${emp.empid}-m-${dateStr}`,
          employeeId: emp.empid,
          name: emp.name,
          date: dateStr,
          checkIn: formatTimeDisplay(checkin24),
          checkOut: formatTimeDisplay(checkout24),
          overtime: ot,
          status,
          punches
        });
      }
    });
    return records;
  }

  function generateLast6Months(employees) {
    return generateMonthlyAttendance(employees, 90, 180);
  }

  function generateLeaveRequests(employees) {
    const requests = [];
    let id = 1000;
    employees.forEach(emp => {
      const count = randInt(1, 3);
      for (let i = 0; i < count; i++) {
        const from = randomDate(5, 60);
        const fromDate = new Date(from);
        fromDate.setDate(fromDate.getDate() + randInt(0, 3));
        const to = fromDate.toISOString().slice(0, 10);
        const days = Math.max(1, Math.round((fromDate - new Date(from)) / 86400000) + 1);
        const statusRoll = Math.random();
        const status = statusRoll < 0.3 ? 'Pending' : statusRoll < 0.7 ? 'Approved' : 'Rejected';

        requests.push({
          id: id++,
          employee_id: emp.empid,
          type: pick(LEAVE_TYPES),
          from_date: from,
          to_date: to,
          days,
          reason: pick(LEAVE_REASONS),
          status,
          reviewer_note: status !== 'Pending' ? pick(['Approved','Rejected due to project deadline','Need more details','Approved with conditions']) : '',
          reviewed_by: status !== 'Pending' ? pick(['Harikrishnan P','Chandru V','Raji S']) : '',
          applied_on: from,
          created_at: new Date(from).toISOString()
        });
      }
    });
    return requests;
  }

  function generateWfhRequests(employees) {
    const requests = [];
    let id = 2000;
    employees.forEach(emp => {
      if (Math.random() > 0.6) return; // ~40% have WFH requests
      const from = randomDate(3, 45);
      const fromDate = new Date(from);
      fromDate.setDate(fromDate.getDate() + randInt(0, 2));
      const to = fromDate.toISOString().slice(0, 10);
      const statusRoll = Math.random();
      const status = statusRoll < 0.3 ? 'Pending' : statusRoll < 0.75 ? 'Approved' : 'Rejected';

      requests.push({
        id: id++,
        employee_id: emp.empid,
        from_date: from,
        to_date: to,
        from_time: pick(['09:00','09:30','10:00']),
        to_time: pick(['17:00','17:30','18:00']),
        reason: pick(WFH_REASONS),
        status,
        reviewer_note: status !== 'Pending' ? pick(['Approved','Rejected — need in-office presence','Approved for this week only']) : '',
        reviewed_by: status !== 'Pending' ? pick(['Harikrishnan P','Chandru V','Raji S']) : '',
        applied_on: from,
        created_at: new Date(from).toISOString()
      });
    });
    return requests;
  }

  function generateTravelRequests(employees) {
    const requests = [];
    let id = 3000;
    employees.forEach(emp => {
      if (Math.random() > 0.5) return; // ~50% have travel requests
      const distance = randInt(5, 80);
      const statusRoll = Math.random();
      const status = statusRoll < 0.35 ? 'Pending' : statusRoll < 0.75 ? 'Approved' : 'Rejected';
      const reqDate = randomDate(3, 60);

      requests.push({
        id: id++,
        employee_id: emp.empid,
        request_date: reqDate,
        from_location: pick(TRAVEL_FROM),
        destination: pick(TRAVEL_DEST),
        travel_distance_km: distance,
        purpose: pick(TRAVEL_PURPOSES),
        additional_details: distance > 40 ? 'Long-distance travel, hotel accommodation needed' : '',
        status,
        reviewer_note: status !== 'Pending' ? pick(['Approved','Rejected — use company transport','Approved with standard rates']) : '',
        reviewed_by: status !== 'Pending' ? pick(['Harikrishnan P','Chandru V','Raji S']) : '',
        reviewed_at: status !== 'Pending' ? new Date().toISOString() : null,
        created_at: new Date(reqDate).toISOString()
      });
    });
    return requests;
  }

  function generatePermissionRequests(employees) {
    const requests = [];
    let id = 4000;
    employees.forEach(emp => {
      if (Math.random() > 0.5) return;
      const reqDate = randomDate(2, 50);
      const fromH = randInt(10, 15);
      const fromM = pick([0, 15, 30, 45]);
      const toH = fromH + randInt(1, 3);
      const toM = pick([0, 15, 30, 45]);
      const durMin = Math.max(15, (toH * 60 + toM) - (fromH * 60 + fromM));

      requests.push({
        id: id++,
        employee_id: emp.empid,
        date: reqDate,
        from_time: `${pad2(fromH)}:${pad2(fromM)}`,
        to_time: `${pad2(Math.min(toH, 18))}:${pad2(toM)}`,
        duration_minutes: durMin,
        reason: pick(PERM_REASONS),
        status: 'Approved',
        created_at: new Date(reqDate).toISOString()
      });
    });
    return requests;
  }

  function generateStaffPerformance(employees) {
    const PERF_KEYS = [
      'google_reviews_avadi','google_reviews_poonamallee','google_reviews_arumbakkam',
      'insta_follow','youtube_sub','batch_completion','course_completion',
      'projects','reference_upgrade','registration','demo','student_placement','video_poster_edit'
    ];
    return employees.filter(e => e.role === 'employee').map((emp, idx) => {
      const row = {
        id: idx + 1,
        empid: emp.empid,
        staff_name: emp.name,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      PERF_KEYS.forEach(k => { row[k] = randInt(0, 25); });
      return row;
    });
  }

  function generateAnnouncements() {
    return ANNOUNCEMENT_TITLES.map((title, i) => ({
      id: (5000 + i).toString(),
      title,
      body: ANNOUNCEMENT_BODIES[i] || 'Please check the notice board for details.',
      category: pick(CATEGORIES),
      author: pick(['Harikrishnan P','Chandru V','Raji S']),
      date: randomDate(1, 30),
      pinned: i < 2
    }));
  }

  function generateScheduleSlots() {
    const slots = [];
    const hours = [9, 10, 11, 12, 13, 14, 15, 16];
    const numSlots = randInt(5, 8);
    for (let i = 0; i < numSlots; i++) {
      const startH = pick(hours);
      const startM = pick([0, 30]);
      const dur = pick([1, 1, 1.5, 2]);
      const endMTotal = startM + dur * 60;
      const endH = startH + Math.floor(endMTotal / 60);
      const endM = endMTotal % 60;

      slots.push({
        id: `slot-${i + 1}`,
        startH,
        startM,
        endH,
        endM,
        className: pick(CLASS_NAMES),
        color: pick(['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#f97316'])
      });
    }
    return slots;
  }

  /* ---------- Build Profile Object ---------- */
  function buildProfile(emp) {
    return {
      id: fakeUuid(),
      empid: emp.empid,
      name: emp.name,
      role: emp.role,
      department: emp.department,
      branch: emp.branch,
      phone: emp.phone,
      email: emp.email,
      join_date: emp.joinDate,
      shift_checkin: emp.shiftCheckin,
      shift_checkout: emp.shiftCheckout,
      saturday_plan: 'every_saturday_work',
      sunday_plan: 'two_sundays_work'
    };
  }

  /* ---------- Build employees array entry (from data.js syncEmployeesFromSupabase shape) ---------- */
  function buildEmployeeEntry(emp) {
    return {
      id: emp.empid,
      name: emp.name,
      title: emp.designation || (emp.role === 'hr' ? 'HR Manager' : 'CAD Trainer'),
      description: 'Employee profile stored in system.',
      department: emp.department,
      email: emp.email,
      phone: emp.phone,
      branch: emp.branch,
      location: pick(LOCATIONS),
      manager: pick(['Harikrishnan P','Chandru V','Raji S']),
      joinDate: emp.joinDate,
      employmentType: 'Full-time',
      status: 'Active',
      about: 'Employee profile stored in system.',
      shiftCheckin: emp.shiftCheckin,
      shiftCheckout: emp.shiftCheckout,
      saturdayPlan: 'every_saturday_work',
      sundayPlan: 'two_sundays_work'
    };
  }

  /* ---------- Build raw profiles (for API.fetchAllProfiles shape) ---------- */
  function buildRawProfile(emp) {
    return {
      id: fakeUuid(),
      empid: emp.empid,
      name: emp.name,
      role: emp.role,
      department: emp.department,
      email: emp.email,
      phone: emp.phone,
      branch: emp.branch,
      location: pick(LOCATIONS),
      shift_checkin: emp.shiftCheckin,
      shift_checkout: emp.shiftCheckout,
      saturday_plan: 'every_saturday_work',
      sunday_plan: 'two_sundays_work',
      join_date: emp.joinDate,
      employment_type: 'Full-time'
    };
  }

  /* ===========================================================
     PUBLIC API
     =========================================================== */
  let _allEmployees = [];
  let _demoProfile = null;
  let _attendance = [];
  let _monthlyAttendance = [];
  let _last6Months = [];
  let _leaveRequests = [];
  let _wfhRequests = [];
  let _travelRequests = [];
  let _permissionRequests = [];
  let _staffPerformance = [];
  let _announcements = [];
  let _scheduleSlots = [];
  let _rawProfiles = [];

  /**
   * Initialize demo mode and generate all random data.
   * @param {string} role - 'hr' or 'employee'
   */
  function init(role) {
    window.IS_DEMO_MODE = true;
    sessionStorage.setItem('demo_mode', '1');
    sessionStorage.setItem('demo_role', role);

    // Generate employees
    _allEmployees = generateEmployees();
    const allEmpEntries = _allEmployees.map(buildEmployeeEntry);

    // Populate global employees array (clear + push)
    if (typeof employees !== 'undefined') {
      employees.length = 0;
      employees.push(...allEmpEntries);
    }

    // Generate random data
    _attendance = generateAttendance(_allEmployees, 1, 28);
    _monthlyAttendance = generateMonthlyAttendance(_allEmployees, 1, 28);
    _last6Months = generateLast6Months(_allEmployees);
    _leaveRequests = generateLeaveRequests(_allEmployees);
    _wfhRequests = generateWfhRequests(_allEmployees);
    _travelRequests = generateTravelRequests(_allEmployees);
    _permissionRequests = generatePermissionRequests(_allEmployees);
    _staffPerformance = generateStaffPerformance(_allEmployees);
    _announcements = generateAnnouncements();
    _scheduleSlots = generateScheduleSlots();
    _rawProfiles = _allEmployees.map(buildRawProfile);

    // Store reimbursement rate in state if available
    if (typeof state !== 'undefined') {
      state.reimbursementRate = 5.5; // ₹5.50/km
    }
  }

  /**
   * Get a demo profile for a given role.
   * Picks the first HR or first employee account.
   */
  function getDemoProfile(role) {
    if (role === 'hr') {
      return buildProfile(_allEmployees.find(e => e.role === 'hr'));
    }
    return buildProfile(_allEmployees.find(e => e.role === 'employee'));
  }

  /**
   * Get a specific demo employee by empid.
   */
  function getDemoEmployee(empid) {
    const emp = _allEmployees.find(e => e.empid === empid);
    return emp ? buildProfile(emp) : null;
  }

  /**
   * Login as HR Admin and redirect to hr-dashboard.html.
   */
  function loginAsAdmin() {
    init('hr');
    _demoProfile = getDemoProfile('hr');
    window.location.href = 'hr-dashboard.html';
  }

  /**
   * Login as Employee and redirect to employee-dashboard.html.
   */
  function loginAsEmployee() {
    init('employee');
    _demoProfile = getDemoProfile('employee');
    window.location.href = 'employee-dashboard.html';
  }

  /* ===========================================================
     OVERRIDES — call these AFTER demo.js is loaded but BEFORE
     the dashboard scripts run (i.e. before RoleGuard.requireAuth).
     =========================================================== */

  /**
   * Apply all demo overrides to Session, RoleGuard, and API.
   * Must be called once on pages loaded in demo mode.
   */
  function applyOverrides() {
    if (!window.IS_DEMO_MODE) return;

    const profile = _demoProfile || getDemoProfile(sessionStorage.getItem('demo_role') || 'hr');

    // --- Session overrides ---
    Session.getSession = async () => ({ user: { id: profile.id, email: profile.email } });
    Session.getUser = async () => ({ id: profile.id, email: profile.email });
    Session.getProfile = async () => profile;
    Session.isAuthenticated = async () => true;

    // --- RoleGuard override ---
    RoleGuard.requireAuth = async (allowedRoles) => {
      // Hide loading skeleton if present
      const skel = document.getElementById('auth-loading-skeleton');
      if (skel) skel.remove();
      const shell = document.querySelector('.app-shell');
      if (shell) shell.style.display = 'flex';

      // Check role
      if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(profile.role)) {
        window.location.href = 'login.html';
        return new Promise(() => {});
      }
      return profile;
    };

    // --- API overrides ---
    API.fetchAttendance = async (empid) => {
      if (empid) return _attendance.filter(r => r.employeeId === empid);
      return _attendance;
    };

    API.fetchMonthlyAttendance = async (empid) => {
      if (empid) return _monthlyAttendance.filter(r => r.employeeId === empid);
      return _monthlyAttendance;
    };

    API.fetchLast6Months = async (empid) => {
      if (empid) return _last6Months.filter(r => r.employeeId === empid);
      return _last6Months;
    };

    API.fetchAttendanceByMonth = async (empid, startDate, endDate) => {
      let data = empid ? _attendance.filter(r => r.employeeId === empid) : _attendance;
      return data.filter(r => r.date >= startDate && r.date <= endDate);
    };

    API.fetchLast6MonthsByMonth = async (empid, startDate, endDate) => {
      let data = empid ? _last6Months.filter(r => r.employeeId === empid) : _last6Months;
      return data.filter(r => r.date >= startDate && r.date <= endDate);
    };

    API.fetchLeaveRequests = async (empid) => {
      if (empid) return _leaveRequests.filter(r => r.employee_id === empid);
      return _leaveRequests;
    };

    API.fetchWfhRequests = async (empid) => {
      if (empid) return _wfhRequests.filter(r => r.employee_id === empid);
      return _wfhRequests;
    };

    API.fetchTravelAllowanceRequests = async (empid) => {
      if (empid) return _travelRequests.filter(r => r.employee_id === empid);
      return _travelRequests;
    };

    API.fetchPermissionRequests = async (empid) => {
      if (empid) return _permissionRequests.filter(r => r.employee_id === empid);
      return _permissionRequests;
    };

    API.fetchStaffPerformance = async () => _staffPerformance;

    API.fetchAnnouncements = async () => _announcements;

    API.fetchScheduleSlots = async () => _scheduleSlots;

    API.fetchAllProfiles = async () => _rawProfiles;

    // Stub out write operations so they don't crash
    API.createAnnouncement = async () => ({ id: Date.now().toString() });
    API.createLeaveRequest = async () => ({ id: Date.now() });
    API.createWfhRequest = async () => ({ id: Date.now() });
    API.createTravelAllowanceRequest = async () => ({ id: Date.now() });
    API.createPermissionRequest = async () => ({ id: Date.now() });
    API.updateLeaveStatus = async () => ({});
    API.updateWfhStatus = async () => ({});
    API.updateTravelAllowanceStatus = async () => ({});
    API.updateStaffPerformance = async () => ({});
    API.addScheduleSlot = async (userId, empid, slot) => ({
      id: `slot-${Date.now()}`,
      startH: slot.startH,
      startM: slot.startM,
      endH: slot.endH,
      endM: slot.endM,
      className: slot.className,
      color: slot.color
    });
    API.removeScheduleSlot = async () => true;
    API.addEmployee = async () => ({ user: { id: fakeUuid() } });
    API.updateEmployee = async () => true;
    API.removeEmployee = async () => true;
    API.ensureStaffPerformance = async () => true;
    API.addStaffPerformanceColumn = async () => true;
    API.dropStaffPerformanceColumn = async () => true;
    API.deleteChatMessage = async () => true;
    API.findOrCreateConversation = async () => ({ id: `conv-${Date.now()}` });
    API.fetchChatMessages = async () => [];
    API.sendChatMessage = async () => ({ id: Date.now() });

    // Override syncEmployeesFromSupabase to no-op (already populated)
    if (typeof syncEmployeesFromSupabase === 'function') {
      window._origSyncEmployees = syncEmployeesFromSupabase;
      window.syncEmployeesFromSupabase = async () => {};
    }

    // Override ensureMonthlyPerfReset to no-op
    if (typeof ensureMonthlyPerfReset === 'function') {
      window._origEnsureMonthlyPerfReset = ensureMonthlyPerfReset;
      window.ensureMonthlyPerfReset = async () => {};
    }

    // Override loadReimbursementRate to set known rate
    if (typeof loadReimbursementRate === 'function') {
      window._origLoadReimbursementRate = loadReimbursementRate;
      window.loadReimbursementRate = async () => { state.reimbursementRate = 5.5; };
    }

    // Suppress Supabase auth state listener errors
    Session.onAuthStateChange = () => ({ unsubscribe: () => {} });

    // Override Auth.logout to clear demo mode
    Auth.logout = async () => {
      window.IS_DEMO_MODE = false;
      sessionStorage.removeItem('demo_mode');
      sessionStorage.removeItem('demo_role');
      window.location.href = 'login.html';
    };

    console.log('[Demo] All overrides applied.');
  }

  /**
   * Check if current page was loaded in demo mode.
   */
  function isDemoMode() {
    return window.IS_DEMO_MODE === true || sessionStorage.getItem('demo_mode') === '1';
  }

  /**
   * Auto-apply overrides if we're in demo mode (called at script load time).
   */
  function autoApply() {
    if (isDemoMode()) {
      window.IS_DEMO_MODE = true;
      // Re-generate data if not already generated
      if (_allEmployees.length === 0) {
        const role = sessionStorage.getItem('demo_role') || 'hr';
        init(role);
      }
      _demoProfile = getDemoProfile(sessionStorage.getItem('demo_role') || 'hr');
      // Apply overrides immediately so subsequent script calls use demo data
      applyOverrides();
    }
  }

  return {
    init,
    loginAsAdmin,
    loginAsEmployee,
    applyOverrides,
    isDemoMode,
    autoApply,
    getDemoProfile,
    getDemoEmployee,
    get allEmployees() { return _allEmployees; }
  };

})();

// Auto-apply overrides on pages loaded in demo mode
Demo.autoApply();

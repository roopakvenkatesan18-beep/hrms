/* ============================================================
   CADD Tech HRMS — Vanilla JS Application Logic
   All rendering via DOM manipulation, no React.
   ============================================================ */

/* ---------- State ---------- */
const state = {
  page: "dashboard",
  role: "admin",
  sidebarOpen: false,
  attendance: seedInitialAttendance(),
  leaveRequests: [],
  travelRequests: [],
  travelFilterEmp: "all",
  reimbursementRate: 0,
  staffPerformance: [],
  perfTargets: {},
  announcements: [],

  scheduleSlots: [],
  activeConversationId: "",
  pieMode: "Month",
  chartType: "Bar",
  pieChart: null,
  hoursChart: null,

  last6Months: [],
  calMonthOffset: 0,

  analytics: {
    selectedEmpId: null,
    monthIndex: 0,     // index into the last-4-months array (0 = current month)
    view: "statistics",
    dayRecords: [],    // computed day-by-day records for the selected month
    monthMeta: null,   // { year, month, isCurrent, eligible, label }
  },
};

const SLOT_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

/* ---------- Helpers ---------- */
function badgeClass(status) {
  return (status || "").toLowerCase().replace(/\s+/g, "-");
}

function statCardHTML(label, value, hint, accent = "primary") {
  const trendIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`;
  return `<div class="card stat-card">
    <div class="stat-card-top">
      <div><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>
      <div class="stat-icon ${accent}">${trendIcon}</div>
    </div>
    ${hint ? `<div class="stat-hint">${hint}</div>` : ""}
  </div>`;
}

function avatarHTML(name, size = "md", variant = "primary") {
  return `<div class="avatar ${size} ${variant}">${getInitials(name)}</div>`;
}

function badgeHTML(status) {
  return `<span class="badge ${badgeClass(status)}">${status}</span>`;
}

function parseTimeInput(raw, ampm) {
  if (!raw) return null;
  const s = raw.toString().trim().replace(/\s/g, "");
  let h, m;
  if (/^\d{1,2}$/.test(s)) {
    h = parseInt(s, 10);
    m = 0;
  } else {
    const match = s.match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
      h = parseInt(match[1], 10);
      m = parseInt(match[2], 10);
    } else {
      return null;
    }
  }
  if (ampm) {
    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    if (ampm === "AM") { if (h === 12) h = 0; }
    else if (ampm === "PM") { if (h < 12) h += 12; }
  } else {
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  }
  return { h, m };
}

function fmtTime(h, m) {
  const suffix = h >= 12 ? "PM" : "AM";
  const hr = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hr}:${m.toString().padStart(2, "0")} ${suffix}`;
}

function formatPunchTime(timeStr) {
  return API.formatTime(timeStr);
}

function timeToMinutes(h, m) { return h * 60 + m; }

function parseAMPMTime(t) {
  const match = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return null;
  let hh = parseInt(match[1], 10);
  const mm = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && hh !== 12) hh += 12;
  if (ampm === "AM" && hh === 12) hh = 0;
  return { h: hh, m: mm };
}

function timeStrToHours(t) {
  const p = parseAMPMTime(t);
  return p ? p.h + p.m / 60 : 0;
}

/* Parse a 24h time string ("09:00:00" or "09:00") to {h, m} */
function parse24hTime(t) {
  if (!t) return null;
  const parts = String(t).split(":");
  if (parts.length < 2) return null;
  return { h: parseInt(parts[0], 10), m: parseInt(parts[1], 10) };
}

/* Minutes between a displayed check-in ("09:42 AM") and a 24h shift time */
function minutesLateVsShift(checkInDisplay, shiftCheckin24h) {
  const ci = parseAMPMTime(checkInDisplay);
  const shift = parse24hTime(shiftCheckin24h);
  if (!ci || !shift) return null;
  return (ci.h * 60 + ci.m) - (shift.h * 60 + shift.m);
}

/* Recompute Present/Late using the employee's assigned shift.
   Absent records are left untouched. Records with no shift keep their
   prior status (legacy fixed 11:00 rule). */
function recomputeStatusWithShift(records) {
  if (!records || !Array.isArray(records)) return;
  records.forEach(r => {
    if (!r || r.status === "Absent") return;
    const emp = employees.find(e => e.id === r.employeeId);
    const shiftCI = emp && (emp.shiftCheckin || emp.shift_checkin);
    if (!shiftCI) return;
    const diff = minutesLateVsShift(r.checkIn, shiftCI);
    if (diff === null) return;
    r.status = diff > 30 ? "Late" : "Present";
  });
}

/* Apply shift-based late calculation to all loaded attendance arrays */
function applyShiftLate() {
  ["attendance", "monthlyAttendance", "last6Months"].forEach(key => {
    if (state[key] && Array.isArray(state[key])) recomputeStatusWithShift(state[key]);
  });
}

/* ---- Shift time helpers: plain time input + AM/PM dropdown ---- */
/* Read a time input (12h value, e.g. "09:00") plus an AM/PM select and
   return "HH:MM:SS" (24h). Returns null if the input is empty. */
function readShiftInput(inputId, apId) {
  const el = document.getElementById(inputId);
  const apEl = document.getElementById(apId);
  if (!el || !el.value) return null;
  let [h, m] = el.value.split(':');
  h = parseInt(h, 10); m = parseInt(m, 10);
  if (isNaN(h) || isNaN(m)) return null;
  const ap = apEl ? apEl.value : 'AM';
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':00';
}

/* Fill a time input + AM/PM select from a stored "HH:MM:SS" (24h) value */
function fillShiftInput(value24, inputId, apId) {
  const el = document.getElementById(inputId);
  const apEl = document.getElementById(apId);
  if (!el || !value24) return;
  let [h, m] = value24.split(':');
  h = parseInt(h, 10); m = parseInt(m, 10);
  let ap = 'AM';
  if (h >= 12) { ap = 'PM'; if (h > 12) h -= 12; }
  if (h === 0) h = 12;
  el.value = String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
  if (apEl) apEl.value = ap;
}

/* ---------- Toast ---------- */
let toastTimeout = null;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { t.style.display = "none"; }, 2500);
}

/* ---------- Navigation ---------- */
const ALL_PAGES = [
  "dashboard-admin", "dashboard-employee",
  "directory", "profile",
   "attendance-employee",
   "leave-admin", "leave-employee",
   "travel-admin", "travel-employee",
   "performance-admin", "performance-employee",
   "announcements", "chat", "timetable", "emp-management", "analytics"
];

function navigate(pageId) {
  state.page = pageId;
  state.sidebarOpen = false;
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.remove("open");

  // Hide all pages
  ALL_PAGES.forEach(p => {
    const el = document.getElementById("page-" + p);
    if (el) el.style.display = "none";
  });

  // Update nav active state
  document.querySelectorAll("#sidebar-nav .nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.page === pageId);
  });

  // Determine which section to show
  const role = state.role;
  let sectionId;

  if (pageId === "dashboard") {
    sectionId = role === "admin" ? "page-dashboard-admin" : "page-dashboard-employee";
  } else if (pageId === "attendance") {
    sectionId = role === "admin" ? "page-attendance-admin" : "page-attendance-employee";
  } else if (pageId === "leave") {
    sectionId = role === "admin" ? "page-leave-admin" : "page-leave-employee";
  } else if (pageId === "travel") {
    sectionId = role === "admin" ? "page-travel-admin" : "page-travel-employee";
  } else if (pageId === "performance") {
    sectionId = role === "admin" ? "page-performance-admin" : "page-performance-employee";
  } else {
    sectionId = "page-" + pageId;
  }

  const section = document.getElementById(sectionId);
  if (section) section.style.display = "block";

  // Render page content
  renderCurrentPage(pageId);
}

function renderCurrentPage(pageId) {
  switch (pageId) {
    case "dashboard":
      state.role === "admin" ? renderAdminDashboard() : renderEmployeeDashboard();
      break;
    case "directory": renderDirectory(); break;
    case "profile": renderProfile(); break;
    case "attendance":
      state.role === "admin" ? renderAttendanceAdmin() : renderAttendanceEmployee();
      break;
    case "leave":
      state.role === "admin" ? renderLeaveAdmin() : renderLeaveEmployee();
      break;
    case "travel":
      state.role === "admin" ? renderTravelAllowanceAdmin() : renderTravelAllowanceEmployee();
      break;
    case "performance":
      state.role === "admin" ? renderPerformanceAdmin() : renderPerformanceEmployee();
      break;
    case "announcements": renderAnnouncements(); break;
    case "chat": loadChatData(); break;
    case "timetable": renderTimetable(); break;
    case "emp-management": renderEmpManagement(); break;
    case "analytics": renderEmployeeAnalytics(); break;
  }
}

/* ---------- Add / Remove Employee ---------- */
let _allProfiles = [];   // cached profiles for remove search

async function renderEmpManagement() {
  // ---- ADD EMPLOYEE FORM ----
  const addForm = document.getElementById('add-emp-inline-form');
  const empidInput = document.getElementById('ae-empid');
  const emailPreview = document.getElementById('ae-email-preview');

  // Live email preview
  if (empidInput && !empidInput._empMgmtBound) {
    empidInput._empMgmtBound = true;
    empidInput.addEventListener('input', () => {
      const v = empidInput.value.trim();
      emailPreview.textContent = v ? `${v}@caddtech.com` : '—';
    });
  }

  // Show/hide shift fields based on role (employees only)
  const roleSel = document.getElementById('ae-role');
  const shiftFields = document.getElementById('ae-shift-fields');
  const syncShiftVisibility = () => {
    if (roleSel && shiftFields) shiftFields.style.display = roleSel.value === 'employee' ? 'grid' : 'none';
  };
  if (roleSel && !roleSel._empMgmtBound) {
    roleSel._empMgmtBound = true;
    roleSel.addEventListener('change', syncShiftVisibility);
  }
  syncShiftVisibility();

  if (addForm && !addForm._empMgmtBound) {
    addForm._empMgmtBound = true;
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const empid = document.getElementById('ae-empid').value.trim();
      const name  = document.getElementById('ae-name').value.trim();
      const role  = document.getElementById('ae-role').value;
      const dept  = document.getElementById('ae-dept').value.trim();
      const pass  = document.getElementById('ae-password').value;
      const errEl = document.getElementById('ae-error');
      const okEl  = document.getElementById('ae-success');
      const btn   = document.getElementById('ae-submit-btn');

      errEl.textContent = ''; okEl.textContent = '';

      if (!empid || !name || !dept || !pass) { errEl.textContent = 'Please fill all fields.'; return; }
      if (pass.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }

      // Shift is required for employees; ignored for HR
      let shiftCheckin = null, shiftCheckout = null;
      if (role === 'employee') {
        shiftCheckin = readShiftInput('ae-shift-ci-t', 'ae-shift-ci-ap');
        shiftCheckout = readShiftInput('ae-shift-co-t', 'ae-shift-co-ap');
        if (!shiftCheckin || !shiftCheckout) { errEl.textContent = 'Please enter shift check-in and check-out times for employees.'; return; }
      }

      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        await API.addEmployee(empid, name, role, dept, pass, shiftCheckin, shiftCheckout);
        okEl.textContent = `✓ ${name} (ID: ${empid}) created! They can now log in.`;
        addForm.reset(); emailPreview.textContent = '—';
        // Push into local employees array so directory updates
        employees.push({ id: empid, name, role, department: dept, email: `${empid}@caddtech.com`, status: 'Active', shiftCheckin, shiftCheckout });
        // Refresh the profiles cache for the remove list
        _allProfiles = await API.fetchAllProfiles();
        renderRemoveList(document.getElementById('re-search')?.value || '');
      } catch (err) {
        errEl.textContent = err.message || 'Error creating employee.';
      }
      btn.disabled = false; btn.textContent = 'Create Employee Account';
    });
  }

  // ---- REMOVE EMPLOYEE SEARCH ----
  _allProfiles = await API.fetchAllProfiles();
  renderRemoveList('');

  const reSearch = document.getElementById('re-search');
  if (reSearch && !reSearch._empMgmtBound) {
    reSearch._empMgmtBound = true;
    reSearch.addEventListener('input', () => renderRemoveList(reSearch.value));
  }

  // ---- EDIT EMPLOYEE MODAL WIRING ----
  if (!renderEmpManagement._editBound) {
    renderEmpManagement._editBound = true;
    document.getElementById('edit-emp-save')?.addEventListener('click', saveEditEmployee);
    document.getElementById('edit-emp-cancel')?.addEventListener('click', closeEditEmployee);
    document.getElementById('edit-emp-modal')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('edit-emp-modal')) closeEditEmployee();
    });
  }
}

function renderRemoveList(query) {
  const listEl = document.getElementById('re-employee-list');
  if (!listEl) return;

  const q = (query || '').toLowerCase().trim();
  const filtered = _allProfiles.filter(p =>
    !q ||
    p.empid?.toLowerCase().includes(q) ||
    p.name?.toLowerCase().includes(q) ||
    p.department?.toLowerCase().includes(q)
  );

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state" style="padding:1.5rem">${q ? 'No employees match your search.' : 'No employees found.'}</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(p => `
    <div class="remove-emp-item">
      <div class="remove-emp-info">
        <div class="remove-emp-avatar">${(p.name || 'E').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}</div>
        <div class="remove-emp-details">
          <div class="remove-emp-name">${escapeHtml(p.name || 'Unknown')}</div>
          <div class="remove-emp-meta">ID: ${escapeHtml(p.empid)} · ${escapeHtml(p.role)} · ${escapeHtml(p.department || '—')}</div>
        </div>
      </div>
      <div class="remove-emp-actions">
        <button onclick="openEditEmployee('${p.empid}','${(p.name||'').replace(/'/g,'\\\'')}')" class="edit-emp-btn" title="Edit department & shift">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit
        </button>
        <button onclick="confirmRemoveEmployee('${p.empid}','${(p.name||'').replace(/'/g,'\\\'')}')" class="remove-emp-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          Remove
        </button>
      </div>
    </div>
  `).join('');
}

async function confirmRemoveEmployee(empid, name) {
  const msgEl = document.getElementById('re-message');
  const confirmed = window.confirm(`Remove ${name} (ID: ${empid})?\n\nThis will revoke their dashboard login. Attendance data is kept.`);
  if (!confirmed) return;

  msgEl.style.color = '#6b7280';
  msgEl.textContent = `Removing ${name}…`;

  try {
    await API.removeEmployee(empid);
    msgEl.style.color = '#059669';
    msgEl.textContent = `✓ ${name} (ID: ${empid}) has been removed.`;
    // Remove from cached profiles and re-render the list
    _allProfiles = _allProfiles.filter(p => p.empid !== empid);
    // Also remove from local employees array
    const idx = employees.findIndex(e => e.id === empid);
    if (idx > -1) employees.splice(idx, 1);
    renderRemoveList(document.getElementById('re-search')?.value || '');
  } catch (err) {
    msgEl.style.color = '#dc2626';
    msgEl.textContent = err.message || 'Failed to remove employee.';
  }
}

/* ---------- Edit Employee (department + shift) ---------- */
let _editEmpId = null;

function openEditEmployee(empid, name) {
  const p = _allProfiles.find(x => x.empid === empid) || employees.find(x => x.id === empid);
  if (!p) return;
  _editEmpId = empid;

  const modal = document.getElementById('edit-emp-modal');
  const nameEl = document.getElementById('edit-emp-name');
  const deptEl = document.getElementById('edit-emp-dept');
  const errEl = document.getElementById('edit-emp-error');
  const shiftRow = document.getElementById('edit-emp-shift-row');

  if (nameEl) nameEl.textContent = `${name} (ID: ${empid})`;
  if (deptEl) deptEl.value = p.department || '';
  if (shiftRow) shiftRow.style.display = (p.role === 'employee') ? 'flex' : 'none';
  if (shiftRow && shiftRow.style.display !== 'none') {
    fillShiftInput(p.shift_checkin, 'edit-emp-shift-ci-t', 'edit-emp-shift-ci-ap');
    fillShiftInput(p.shift_checkout, 'edit-emp-shift-co-t', 'edit-emp-shift-co-ap');
  }
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  if (modal) modal.style.display = 'flex';
}

async function saveEditEmployee() {
  if (!_editEmpId) return;
  const deptEl = document.getElementById('edit-emp-dept');
  const errEl = document.getElementById('edit-emp-error');
  const btn = document.getElementById('edit-emp-save');
  const shiftRow = document.getElementById('edit-emp-shift-row');

  const department = deptEl ? deptEl.value.trim() : '';
  let shiftCheckin = null, shiftCheckout = null;
  if (shiftRow && shiftRow.style.display !== 'none') {
    shiftCheckin = readShiftInput('edit-emp-shift-ci-t', 'edit-emp-shift-ci-ap');
    shiftCheckout = readShiftInput('edit-emp-shift-co-t', 'edit-emp-shift-co-ap');
  }

  if (!department) { errEl.style.display = 'block'; errEl.textContent = 'Department is required.'; return; }

  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await API.updateEmployee(_editEmpId, { department, shiftCheckin, shiftCheckout });
    // Update local caches
    const prof = _allProfiles.find(x => x.empid === _editEmpId);
    if (prof) { prof.department = department; prof.shift_checkin = shiftCheckin; prof.shift_checkout = shiftCheckout; }
    const emp = employees.find(x => x.id === _editEmpId);
    if (emp) { emp.department = department; emp.shiftCheckin = shiftCheckin; emp.shiftCheckout = shiftCheckout; }
    const modal = document.getElementById('edit-emp-modal');
    if (modal) modal.style.display = 'none';
    renderRemoveList(document.getElementById('re-search')?.value || '');
  } catch (err) {
    errEl.style.display = 'block';
    errEl.textContent = err.message || 'Failed to update employee.';
  }
  btn.disabled = false; btn.textContent = 'Save Changes';
}

function closeEditEmployee() {
  const modal = document.getElementById('edit-emp-modal');
  if (modal) modal.style.display = 'none';
  _editEmpId = null;
}

/* ---------- Admin Dashboard ---------- */
function renderAdminDashboard() {
  const pendingLeaves = state.leaveRequests.filter(l => l.status === "Pending");
  const todayStr = iso(new Date());
  const presentToday = state.attendance.filter(a => a.date === todayStr).length;
  statCardHTML("Pending Leaves", pendingLeaves.length, "Awaiting approval", "chart3");

  // Pending leaves
  const plEl = document.getElementById("admin-pending-leaves");
  if (pendingLeaves.length === 0) {
    plEl.innerHTML = `<p class="empty-state">No pending requests.</p>`;
  } else {
    plEl.innerHTML = pendingLeaves.map(l => {
      const emp = getEmployee(l.employeeId);
      return `<div class="list-row">
        ${avatarHTML(emp.name, "md", "accent")}
        <div class="list-row-info">
          <div class="title">${escapeHtml(emp.name)}</div>
          <div class="sub">${escapeHtml(l.type)} leave · ${l.days} day${l.days > 1 ? "s" : ""} · ${formatDate(l.from)}</div>
        </div>
        <button class="btn outline sm" data-page="leave">Review</button>
      </div>`;
    }).join("");
  }

  // Announcements
  document.getElementById("admin-dash-announcements").innerHTML = state.announcements.slice(0, 3).map(a => `
    <div class="announce-item">
      <div class="title" style="font-weight:500;font-size:0.875rem">${escapeHtml(a.title)}</div>
      <div class="sub" style="margin-top:0.25rem;font-size:0.75rem;color:var(--muted-foreground)">${escapeHtml(a.body)}</div>
      <div style="margin-top:0.25rem;font-size:0.75rem;color:var(--muted-foreground)">${formatDate(a.date)}</div>
    </div>
  `).join("");

  // Leaderboard (top 5)
  const sorted = [...state.staffPerformance].sort((a, b) => totalPoints(b) - totalPoints(a)).slice(0, 5);
  document.getElementById("admin-dash-reviews").innerHTML = sorted.map((r, i) => `
    <div class="list-row" style="border:none;padding:0.5rem 0">
      <div style="width:24px;font-weight:700;color:${i === 0 ? '#f59e0b' : i < 3 ? '#94a3b8' : 'var(--muted-foreground)'}">#${i + 1}</div>
      <div class="list-row-info">
        <div class="title">${escapeHtml(r.staff_name)}</div>
        <div class="sub">${totalPoints(r)} pts</div>
      </div>
      <div class="perf-rank-badge">${i === 0 ? '🏆' : i < 3 ? '⭐' : ''}</div>
    </div>
  `).join("");

  // Render attendance (now shown on the dashboard)
  renderAttendanceAdmin();

}

/* ---------- Employee Dashboard ---------- */
function renderEmployeeDashboard() {
  const currentUser = getEmployee(CURRENT_USER_ID);
  const h = new Date().getHours();
  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  document.getElementById("emp-greeting").textContent = `${greeting}, ${currentUser.name.split(" ")[0]}`;

  // Charts
  renderPieChart();
  renderHoursChart();

  // Schedule
  renderScheduleSlots();

  // Today's check-in status
  renderTodayCheckinStatus();

  // Last 7 days attendance table (spans into previous months via last6Months)
  renderLast7DaysTable();

  // My leaves
  const myLeaves = state.leaveRequests.filter(l => l.employeeId === CURRENT_USER_ID);
  document.getElementById("emp-leaves-list").innerHTML = myLeaves.map(l => `
    <div class="list-row">
      <div class="list-row-info">
        <div class="title">${l.type} Leave</div>
        <div class="sub">${formatDate(l.from)} – ${formatDate(l.to)} · ${l.days}d</div>
      </div>
      ${badgeHTML(l.status)}
    </div>
  `).join("");

  // Announcements
  document.getElementById("emp-announcements-items").innerHTML = state.announcements.slice(0, 4).map(a => `
    <div class="list-row" style="border:none;padding:0.5rem 0">
      <div class="list-row-info">
        <div class="title">${escapeHtml(a.title)}</div>
        <div class="sub">${escapeHtml(a.body)}</div>
      </div>
    </div>
  `).join("");
}

/* ---------- Charts (Chart.js) ---------- */
function getPieData() {
  const source = (state.monthlyAttendance && state.monthlyAttendance.length > 0)
    ? state.monthlyAttendance
    : state.attendance;

  const myRecords = source.filter(a => a.employeeId === CURRENT_USER_ID);

  let present = 0, late = 0, absent = 0;
  
  if (state.pieMode === "Month") {
    // Only use days that exist in the database
    myRecords.forEach(r => {
      if (r.status === "Absent") {
        absent++;
        return;
      }
      if (!r.checkIn || r.checkIn === "--:--" || r.checkIn === "12:00 AM") {
        absent++;
        return;
      }
      
      // Parse checkIn time to determine Late vs Present
      let isLate = false;
      const parsed = parseAMPMTime(r.checkIn);
      if (parsed) {
        if (parsed.h > 11 || (parsed.h === 11 && parsed.m > 0)) {
          isLate = true;
        }
      } else if (r.status === "Late") {
        isLate = true;
      }

      if (isLate) {
        late++;
      } else {
        // If check in is there then present even if check out is not there
        present++;
      }
    });
  } else {
    // Week mode: last 7 days, but only count records that fall in the last 7 days
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 6);
    
    myRecords.forEach(r => {
      const recordDate = new Date(r.date);
      if (recordDate >= sevenDaysAgo && recordDate <= today) {
        if (r.status === "Absent" || !r.checkIn || r.checkIn === "--:--" || r.checkIn === "12:00 AM") {
          absent++;
        } else {
          let isLate = false;
          const parsed = parseAMPMTime(r.checkIn);
          if (parsed && (parsed.h > 11 || (parsed.h === 11 && parsed.m > 0))) {
            isLate = true;
          }
          if (isLate) late++;
          else present++;
        }
      }
    });
  }

  return { labels: ["Present", "Late", "Absent"], data: [present, late, absent], colors: ["#10b981", "#f59e0b", "#ef4444"] };
}

function renderPieChart() {
  const pd = getPieData();
  const canvas = document.getElementById("pie-chart-canvas");
  if (!canvas) return;

  if (state.pieChart) { state.pieChart.destroy(); state.pieChart = null; }

  document.getElementById("pie-center-value").textContent = pd.data[0];

  state.pieChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: pd.labels,
      datasets: [{ data: pd.data, backgroundColor: pd.colors, borderWidth: 0 }]
    },
    options: {
      cutout: "70%",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#fff",
          titleColor: "#1f2937",
          bodyColor: "#4b5563",
          borderColor: "#e5e7eb",
          borderWidth: 1,
          cornerRadius: 12,
          padding: 12,
          boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
          titleFont: { weight: 600 },
          bodyFont: { weight: 600 }
        }
      },
      animation: { animateRotate: true, duration: 800 }
    }
  });

  // Legend
  document.getElementById("pie-legend").innerHTML = pd.labels.map((name, i) =>
    `<div style="display:flex;align-items:center;gap:0.5rem"><span style="width:12px;height:12px;border-radius:50%;background:${pd.colors[i]}"></span>${escapeHtml(name)} <span style="color:#9ca3af">(${pd.data[i]})</span></div>`
  ).join("");
}

function getHoursData() {
  const source = (state.monthlyAttendance && state.monthlyAttendance.length > 0)
    ? state.monthlyAttendance.filter(a => a.employeeId === CURRENT_USER_ID)
    : state.attendance.filter(a => a.employeeId === CURRENT_USER_ID);
  
  const data = [];
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  
  // Last 7 days, but capped at the start of the month
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 6);
  const startDate = sevenDaysAgo > startOfMonth ? sevenDaysAgo : startOfMonth;

  for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
    const dateStr = iso(d);
    const record = source.find(a => a.date === dateStr);
    
    // Only push to data if the record exists (user requested "how day of data aviable")
    if (record) {
      let hours = 0;
      if (record.overtime !== undefined && record.overtime > 0) {
        hours = record.overtime;
      } else if (record.checkIn && record.checkOut && record.checkIn !== "--:--" && record.checkOut !== "--:--" && record.checkIn !== "12:00 AM") {
        const inH = timeStrToHours(record.checkIn);
        const outH = timeStrToHours(record.checkOut);
        if (outH > inH) hours = outH - inH;
      }
      data.push({ date: dateStr.slice(5), hours: Number(hours.toFixed(1)) });
    }
  }
  
  // If no data exists at all, just provide a dummy empty state so the chart doesn't crash
  if (data.length === 0) {
    data.push({ date: iso(today).slice(5), hours: 0 });
  }
  
  return data;
}

function renderHoursChart() {
  const hd = getHoursData();
  const canvas = document.getElementById("hours-chart-canvas");
  if (!canvas) return;

  if (state.hoursChart) { state.hoursChart.destroy(); state.hoursChart = null; }

  const isBar = state.chartType !== "Line";

  const config = {
    type: isBar ? "bar" : "line",
    data: {
      labels: hd.map(d => d.date),
      datasets: [{
        label: "hours",
        data: hd.map(d => d.hours),
        backgroundColor: "#3b82f6",
        borderColor: "#3b82f6",
        borderWidth: isBar ? 0 : 2,
        fill: isBar ? false : true,
        pointBackgroundColor: "#fff",
        pointBorderColor: "#3b82f6",
        pointBorderWidth: 2,
        borderRadius: 6,
        barPercentage: 0.9,
        categoryPercentage: 0.9,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: isBar ? "y" : "x",
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#fff",
          titleColor: "#1f2937",
          bodyColor: "#3b82f6",
          borderColor: "#e5e7eb",
          borderWidth: 1,
          cornerRadius: 12,
          padding: 12,
          titleFont: { weight: 600 },
          bodyFont: { weight: 600 }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#9ca3af", font: { size: 12, weight: 500 } } },
        y: { grid: { color: "#e5e7eb40" }, ticks: { color: "#9ca3af", font: { size: 12, weight: 500 } }, border: { display: false } }
      },
      animation: { duration: 1000 }
    }
  };

  state.hoursChart = new Chart(canvas, config);
}

function renderTodayCheckinStatus() {
  const el = document.getElementById("emp-checkin-status");
  if (!el) return;

  const todayStr = iso(new Date());
  const source = (state.monthlyAttendance && state.monthlyAttendance.length > 0)
    ? state.monthlyAttendance
    : state.attendance;

  const todayRecord = source.find(
    a => a.employeeId === CURRENT_USER_ID && a.date === todayStr
  );

  console.log('[DEBUG] renderTodayCheckinStatus:', { todayStr, CURRENT_USER_ID, found: !!todayRecord, punches: todayRecord?.punches, sourceLen: source.length });

  const hasCheckedIn = todayRecord &&
    todayRecord.checkIn &&
    todayRecord.checkIn !== "--:--" &&
    todayRecord.checkIn !== "12:00 AM" &&
    todayRecord.status !== "Absent";

  if (hasCheckedIn) {
    let sessionsHTML = "";
    if (todayRecord.punches && todayRecord.punches.length > 0) {
      sessionsHTML = todayRecord.punches.map((p, i) => `
        <div style="display:flex;align-items:center;gap:0.5rem;padding:0.375rem 0;border-bottom:${i < todayRecord.punches.length - 1 ? '1px solid #f3f4f6' : 'none'}">
          <span style="font-weight:500;min-width:4.5rem;font-size:0.8125rem;color:#374151">Session ${i + 1}:</span>
          <span style="color:var(--muted-foreground);font-size:0.8125rem">${formatPunchTime(p.in)} → ${formatPunchTime(p.out)}</span>
        </div>
      `).join("");
    }

    el.innerHTML = `
      <div style="font-size:1rem;font-weight:600;color:#059669;margin-bottom:0.75rem">Checked In Today ✓</div>
      <div class="punch-details" style="background:#f9fafb;border-radius:0.5rem;padding:0.75rem">
        <div style="display:flex;align-items:center;gap:0.5rem;padding:0.375rem 0;border-bottom:1px solid #e5e7eb">
          <span style="font-weight:600;font-size:0.8125rem;color:#374151">Check-in:</span>
          <span style="font-size:0.875rem;color:#059669;font-weight:700">${todayRecord.checkIn}</span>
        </div>
        ${sessionsHTML}
        <div style="display:flex;align-items:center;gap:0.5rem;padding:0.375rem 0;border-top:1px solid #e5e7eb">
          <span style="font-weight:600;font-size:0.8125rem;color:#374151">Check-out:</span>
          <span style="font-size:0.875rem;color:#dc2626;font-weight:700">${todayRecord.checkOut}</span>
        </div>
      </div>
    `;
  } else {
    el.innerHTML = `
      <div style="font-size:1.125rem;font-weight:600;color:#64748b">Not Checked In Yet 😞</div>
      <p class="sub" style="margin-top:0.75rem;font-size:0.8125rem;line-height:1.5;color:var(--muted-foreground)">
        Already checked in? Please ignore this message. Your status will update within 30 minutes.
      </p>`;
  }
}

/* ---------- Schedule ---------- */
async function loadScheduleSlots() {
  try {
    state.scheduleSlots = await API.fetchScheduleSlots();
  } catch (err) {
    console.error('[Schedule] loadScheduleSlots error:', err);
    state.scheduleSlots = [];
  }
}

function renderScheduleSlots() {
  const sorted = [...state.scheduleSlots].sort((a, b) => timeToMinutes(a.startH, a.startM) - timeToMinutes(b.startH, b.startM));
  const container = document.getElementById("schedule-slots");
  const ttBtn = document.getElementById("schedule-timetable-btn");

  if (sorted.length === 0) {
    container.innerHTML = `<p class="empty-state">No classes scheduled. Click "+ Add" to create one.</p>`;
    if (ttBtn) ttBtn.style.display = "none";
  } else {
    container.innerHTML = sorted.map(slot => `
      <div class="schedule-slot-item">
        <div class="schedule-slot-bar" style="background:${slot.color}"></div>
        <div class="schedule-slot-info">
          <div class="schedule-slot-row">
            <span class="schedule-slot-label">Time:</span>
            <span class="schedule-slot-value">${fmtTime(slot.startH, slot.startM)} - ${fmtTime(slot.endH, slot.endM)}</span>
          </div>
          <div class="schedule-slot-row">
            <span class="schedule-slot-label">Class:</span>
            <span class="schedule-slot-value schedule-slot-class">${escapeHtml(slot.className)}</span>
          </div>
        </div>
        <button onclick="removeScheduleSlot('${slot.id}')" class="schedule-slot-remove" title="Remove slot">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `).join("");
    if (ttBtn) ttBtn.style.display = "flex";
  }
}

async function removeScheduleSlot(id) {
  try {
    await API.removeScheduleSlot(id);
    state.scheduleSlots = state.scheduleSlots.filter(s => s.id !== id);
    renderScheduleSlots();
    if (state.page === "timetable") renderTimetable();
    showToast("Schedule slot removed.");
  } catch (err) {
    console.error('[Schedule] removeScheduleSlot error:', err);
    showToast("Failed to remove slot. Try again.");
  }
}

async function addScheduleSlot() {
  const startTime = document.getElementById("schedule-start-time").value;
  const startAmPm = document.getElementById("schedule-start-ampm").value;
  const endTime = document.getElementById("schedule-end-time").value;
  const endAmPm = document.getElementById("schedule-end-ampm").value;
  const className = document.getElementById("schedule-class-name").value;
  const errorEl = document.getElementById("schedule-error");
  const btn = document.getElementById("schedule-add-slot-btn");

  errorEl.style.display = "none";
  const st = parseTimeInput(startTime, startAmPm);
  const et = parseTimeInput(endTime, endAmPm);
  if (!st) { errorEl.textContent = "Invalid start time. Enter like 9 or 9:30 (1-12 range)"; errorEl.style.display = "block"; return; }
  if (!et) { errorEl.textContent = "Invalid end time. Enter like 10 or 10:30 (1-12 range)"; errorEl.style.display = "block"; return; }
  if (!className.trim()) { errorEl.textContent = "Please enter a class name."; errorEl.style.display = "block"; return; }
  if (timeToMinutes(et.h, et.m) <= timeToMinutes(st.h, st.m)) { errorEl.textContent = "End time must be after start time."; errorEl.style.display = "block"; return; }

  const userId = window.CURRENT_USER_UUID;
  const empid = window.CURRENT_USER_ID;
  if (!userId || !empid) {
    errorEl.textContent = "Session error. Please sign in again.";
    errorEl.style.display = "block";
    return;
  }

  const slotPayload = {
    startH: st.h, startM: st.m,
    endH: et.h, endM: et.m,
    className: className.trim(),
    color: SLOT_COLORS[state.scheduleSlots.length % SLOT_COLORS.length],
  };

  if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }

  try {
    const saved = await API.addScheduleSlot(userId, empid, slotPayload);
    state.scheduleSlots.push(saved);

    document.getElementById("schedule-start-time").value = "";
    document.getElementById("schedule-start-ampm").value = "AM";
    document.getElementById("schedule-end-time").value = "";
    document.getElementById("schedule-end-ampm").value = "PM";
    document.getElementById("schedule-class-name").value = "";
    document.getElementById("schedule-form").style.display = "none";
    renderScheduleSlots();
    showToast("Schedule slot added!");
  } catch (err) {
    errorEl.textContent = err.message || "Failed to save schedule. Run schedule_schema.sql in Supabase first.";
    errorEl.style.display = "block";
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Add Slot"; }
  }
}

/* ---------- Directory ---------- */
function renderDirectory() {
  // Populate department filter
  const deptFilter = document.getElementById("dir-dept-filter");
  const departments = [...new Set(employees.map(e => e.department))].sort();
  if (deptFilter.options.length <= 1) {
    departments.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      deptFilter.appendChild(opt);
    });
  }

  document.getElementById("dir-count").textContent = `${employees.length} team members at CADD Tech Solutions`;

  const query = (document.getElementById("dir-search").value || "").toLowerCase();
  const dept = document.getElementById("dir-dept-filter").value;

  const filtered = employees.filter(e => {
    const matchQ = e.name.toLowerCase().includes(query) || e.title.toLowerCase().includes(query) || e.email.toLowerCase().includes(query);
    return matchQ && (dept === "all" || e.department === dept);
  });

  document.getElementById("employee-grid").innerHTML = filtered.map(emp => `
    <div class="card employee-card" data-emp-id="${emp.id}">
      <div class="employee-card-head">
        ${avatarHTML(emp.name, "lg")}
        <div>
          <div class="name">${escapeHtml(emp.name)}</div>
          <div class="title">${escapeHtml(emp.title)}</div>
        </div>
      </div>
      <div class="divider"></div>
      <div class="meta-line"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:1rem;height:1rem"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg><span>${escapeHtml(emp.department)}</span></div>
      <div class="meta-line"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:1rem;height:1rem"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg><span>${escapeHtml(emp.location)}</span></div>
      <div class="meta-line"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:1rem;height:1rem"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span>${escapeHtml(emp.phone)}</span></div>
      <div style="margin-top:1rem">${badgeHTML(emp.status)}</div>
    </div>
  `).join("");

  // Click handlers for employee cards
  document.querySelectorAll(".employee-card[data-emp-id]").forEach(card => {
    card.addEventListener("click", () => openEmployeeModal(card.dataset.empId));
  });
}

function openEmployeeModal(empId) {
  const emp = getEmployee(empId);
  if (!emp) return;
  document.getElementById("modal-avatar").textContent = getInitials(emp.name);
  document.getElementById("modal-name").textContent = emp.name;
  document.getElementById("modal-title").textContent = emp.title;
  document.getElementById("modal-badge").innerHTML = badgeHTML(emp.status);
  document.getElementById("modal-about").textContent = emp.about;
  document.getElementById("modal-email").textContent = emp.email;
  document.getElementById("modal-phone").textContent = emp.phone;
  document.getElementById("modal-dept").textContent = emp.department;
  document.getElementById("modal-location").textContent = emp.location;
  document.getElementById("modal-joined").textContent = formatDate(emp.joinDate);
  document.getElementById("modal-employment").textContent = emp.employmentType;
  document.getElementById("modal-manager").textContent = emp.manager;
  document.getElementById("employee-modal").style.display = "flex";
}

/* ---------- Attendance ---------- */
function renderAttendanceAdmin() {
  const todayStr = iso(new Date());
  const todayAll = state.attendance.filter(a => a.date === todayStr);
  const present = todayAll.filter(a => a.status && a.status !== "Absent").length;
  const onTime = todayAll.filter(a => a.status === "Present").length;
  const late = todayAll.filter(a => a.status === "Late").length;
  const withData = new Set(state.attendance.map(a => a.employeeId)).size;
  const totalStaff = withData || employees.length;

  document.getElementById("att-admin-stats").innerHTML =
    statCardHTML("Present Today", `${present}/${totalStaff}`, "Present / With data", "chart5") +
    statCardHTML("On Time", onTime, null, "primary") +
    statCardHTML("Late Arrivals", late, null, "chart3");

  const tbody = document.getElementById("att-admin-table-body");
  if (todayAll.length) {
    tbody.innerHTML = todayAll.map(a => {
      const emp = getEmployee(a.employeeId);
      let sessionsHTML = "";
      if (a.punches && a.punches.length > 0) {
        sessionsHTML = a.punches.map((p, i) =>
          `<div style="font-size:0.75rem;padding:2px 0${i > 0 ? ';border-top:1px dashed #e5e7eb' : ''}">
            <span style="color:#374151;font-weight:500">${formatPunchTime(p.in)}</span>
            <span style="color:#9ca3af;margin:0 2px">→</span>
            <span style="color:#374151;font-weight:500">${formatPunchTime(p.out)}</span>
          </div>`
        ).join("");
      } else {
        sessionsHTML = `<span style="color:#9ca3af;font-size:0.75rem">—</span>`;
      }
      return `<tr>
        <td>
          <div style="font-weight:500">${escapeHtml(emp?.name ?? "—")}</div>
          <div style="font-size:0.75rem;color:#6b7280">${escapeHtml(a.employeeId)}</div>
        </td>
        <td><span style="font-weight:500">${a.checkIn ?? "—"}</span></td>
        <td>${sessionsHTML}</td>
        <td><span style="font-weight:500">${a.checkOut ?? "—"}</span></td>
        <td>${badgeHTML(a.status)}</td>
      </tr>`;
    }).join("");
  } else {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No check-ins recorded yet today.</td></tr>`;
  }

  // Render Monthly Summary Table for HR
  const hrMonthlyTbody = document.getElementById("hr-monthly-summary-tbody");
  if (hrMonthlyTbody && state.monthlyAttendance) {
    if (state.monthlyAttendance.length === 0) {
      hrMonthlyTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#6b7280;padding:2rem">No monthly records yet</td></tr>';
    } else {
      let mHtml = "";
      state.monthlyAttendance.forEach(row => {
        mHtml += `
          <tr>
            <td>
              <div style="font-weight:600;color:#111827">${row.name || 'Unknown'}</div>
              <div style="font-size:0.75rem;color:#6b7280">ID: ${row.employeeId}</div>
            </td>
            <td>
              <div style="font-weight:500;color:#111827">${row.date}</div>
            </td>
            <td>${row.checkIn}</td>
            <td>${row.checkOut}</td>
            <td>
              <span class="badge ${row.overtime > 0 ? 'warning' : 'success'}">${row.overtime} hrs</span>
            </td>
          </tr>
        `;
      });
      hrMonthlyTbody.innerHTML = mHtml;
    }
  }
}

function renderAttendanceEmployee() {
  const todayStr = iso(new Date());

  // Draw weekly timeline
  const todayDateObj = new Date();
  const currentDayOfWeek = todayDateObj.getDay();

  const startOfWeek = new Date(todayDateObj);
  startOfWeek.setDate(todayDateObj.getDate() - currentDayOfWeek);

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let timelineHTML = "";

  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    const dateStr = iso(d);

    const dayName = days[i];
    const dateNum = d.getDate();

    let record = state.last6Months.find(a => a.employeeId === CURRENT_USER_ID && a.date === dateStr);
    if (!record) {
      record = state.attendance.find(a => a.employeeId === CURRENT_USER_ID && a.date === dateStr);
    }
    if (!record && state.monthlyAttendance) {
      record = state.monthlyAttendance.find(a => a.employeeId === CURRENT_USER_ID && a.date === dateStr);
    }

    let status = "gray", statusLabel = "No data", endDotClass = "gray", checkInStr = "", checkOutStr = "";

    if (record) {
      const ci = record.checkIn;
      const co = record.checkOut;
      const hasCI = ci && ci !== "--:--" && ci !== "12:00 AM" && ci !== "Invalid Date";
      const hasCO = co && co !== "--:--" && co !== "12:00 AM" && co !== "Invalid Date";
      const isLate = record.status === "Late";

      if (hasCI && hasCO) {
        status = "green";
        statusLabel = isLate ? "Completed · Late" : "Completed";
        checkInStr = ci;
        checkOutStr = co;
        endDotClass = "green";
      } else if (hasCI) {
        status = "orange";
        statusLabel = "Working";
        checkInStr = ci;
        checkOutStr = "—";
        endDotClass = "open";
      } else {
        status = "red";
        statusLabel = "Absent";
        checkInStr = "";
        checkOutStr = "";
        endDotClass = "red";
      }
    }

    const isToday = dateStr === todayStr;

    timelineHTML += `
      <div class="att-timeline-row${isToday ? " today" : ""}">
        <div class="att-day-info">
          <div class="att-day-name">${dayName}</div>
          <div class="att-day-date">${dateNum}</div>
        </div>
        <div class="att-timeline-center">
          <div class="att-timeline-track ${status}">
            <span class="att-tl-time start">${checkInStr}</span>
            <span class="att-timeline-dot ${status}"></span>
            <span class="att-timeline-dot ${endDotClass}"></span>
            <span class="att-tl-time end">${checkOutStr}</span>
          </div>
        </div>
        <div class="att-hours-info">
          <div class="att-status-pill ${status}">${statusLabel}</div>
        </div>
      </div>
    `;
  }

  document.getElementById("att-timeline-container").innerHTML = timelineHTML;

  // Render Monthly Summary Table
  const monthlyTbody = document.getElementById("emp-monthly-summary-tbody");
  if (monthlyTbody && state.monthlyAttendance) {
    if (state.monthlyAttendance.length === 0) {
      monthlyTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#6b7280;padding:2rem">No monthly records yet</td></tr>';
    } else {
      let mHtml = "";
      state.monthlyAttendance.forEach(row => {
        mHtml += `
          <tr>
            <td>
              <div style="font-weight:500;color:#111827">${row.date}</div>
            </td>
            <td>${row.checkIn}</td>
            <td>${row.checkOut}</td>
            <td>
              <span class="badge ${row.overtime > 0 ? 'warning' : 'success'}">${row.overtime} hrs</span>
            </td>
          </tr>
        `;
      });
      monthlyTbody.innerHTML = mHtml;
    }
  }

  renderSundayLeaveInfo();
}

/* Render the per-month Table view in the employee attendance section.
   Uses the same month offset (calMonthOffset) as the calendar view so it
   always reflects "all month detail" for the currently selected month. */
function renderAttendanceTable() {
  const tbody = document.getElementById("att-table-body");
  if (!tbody) return;

  const now = new Date();
  const offset = state.calMonthOffset || 0;
  const year = now.getFullYear();
  const month = now.getMonth() + offset;

  const stats = computeMonthStats(window.CURRENT_USER_ID, year, month);
  tbody.innerHTML = dayRecordsTableHTML(stats.records);

  const headerEl = document.getElementById("att-table-header");
  if (headerEl) {
    headerEl.textContent = `Attendance — ${MONTH_NAMES[month]} ${year}`;
  }
  const summaryEl = document.getElementById("att-table-summary");
  if (summaryEl) {
    summaryEl.innerHTML = `
      <span class="dot" style="background:#10b981"></span>Present <b>${stats.present}</b>
      <span class="dot" style="background:#f59e0b"></span>Late <b>${stats.late}</b>
      <span class="dot" style="background:#ef4444"></span>Absent <b>${stats.absent}</b>
      · ${stats.totalHours}h total`;
  }
}

function renderSundayLeaveInfo() {
  const el = document.getElementById("sunday-leave-info");
  if (!el) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Collect Sunday date strings in the current month
  const sundayDates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d);
    if (dt.getDay() === 0) sundayDates.push(iso(dt));
  }
  const totalSundays = sundayDates.length;
  if (totalSundays === 0) { el.style.display = "none"; return; }

  const sources = [...(state.attendance || []), ...(state.monthlyAttendance || []), ...(state.last6Months || [])]
    .filter(a => a.employeeId === CURRENT_USER_ID);

  const used = new Set();
  sundayDates.forEach(sd => {
    if (sources.some(a => a.date === sd)) used.add(sd);
  });

  // Also count approved leave requests that fall on a Sunday this month
  (state.leaveRequests || []).forEach(l => {
    if (l.employeeId !== CURRENT_USER_ID || l.status !== "Approved") return;
    const from = new Date(l.from), to = new Date(l.to);
    sundayDates.forEach(sd => {
      const dt = new Date(sd);
      if (dt >= from && dt <= to) used.add(sd);
    });
  });

  const MAX_SUNDAY_LEAVE = 2;
  const usedCount = Math.min(used.size, MAX_SUNDAY_LEAVE);
  const remaining = Math.max(MAX_SUNDAY_LEAVE - usedCount, 0);

  el.style.display = "flex";
  el.innerHTML = `
    <span class="sunday-leave-icon">📅</span>
    <div class="sunday-leave-text">
      <strong>You have ${remaining} Sunday${remaining === 1 ? "" : "s"} to take leave</strong>
      <span class="sunday-leave-sub">${usedCount}/${MAX_SUNDAY_LEAVE} Sunday leaves used this month</span>
    </div>
    <button class="sunday-leave-close" onclick="this.parentNode.style.display='none'">&times;</button>
  `;
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function renderAttendanceCalendar() {
  const now = new Date();
  const offset = state.calMonthOffset || 0;
  const year = now.getFullYear();
  const month = now.getMonth() + offset;
  const todayDateStr = iso(new Date());

  // Show/hide nav buttons
  const prevBtn = document.getElementById("cal-prev-btn");
  const nextBtn = document.getElementById("cal-next-btn");
  if (prevBtn) prevBtn.style.visibility = offset <= -3 ? "hidden" : "visible";
  if (nextBtn) nextBtn.style.visibility = offset >= 0 ? "hidden" : "visible";

  document.getElementById("att-cal-header").textContent = `${MONTH_NAMES[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let presentCount = 0, lateCount = 0, absentCount = 0;

  let calHTML = `
    <div class="att-cal-day-header">Sun</div>
    <div class="att-cal-day-header">Mon</div>
    <div class="att-cal-day-header">Tue</div>
    <div class="att-cal-day-header">Wed</div>
    <div class="att-cal-day-header">Thu</div>
    <div class="att-cal-day-header">Fri</div>
    <div class="att-cal-day-header">Sat</div>
  `;

  for (let i = 0; i < firstDay; i++) {
    calHTML += `<div class="att-cal-cell empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const dateStr = iso(d);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const isToday = dateStr === todayDateStr;

    let statusClass = "", statusText = "", checkInStr = "", checkOutStr = "";

    let record = state.last6Months.find(a => a.employeeId === CURRENT_USER_ID && a.date === dateStr);
    if (!record) record = state.attendance.find(a => a.employeeId === CURRENT_USER_ID && a.date === dateStr);
    if (!record && state.monthlyAttendance) record = state.monthlyAttendance.find(a => a.employeeId === CURRENT_USER_ID && a.date === dateStr);

    if (record) {
      const hasCI = record.checkIn && record.checkIn !== "--:--" && record.checkIn !== "12:00 AM" && record.checkIn !== "Invalid Date";
      const hasCO = record.checkOut && record.checkOut !== "--:--" && record.checkOut !== "12:00 AM" && record.checkOut !== "Invalid Date";
      if (hasCI || hasCO) {
        checkInStr = hasCI ? record.checkIn : "—";
        checkOutStr = hasCO ? record.checkOut : "—";
        statusClass = record.status === "Late" ? "late" : "present";
        statusText = record.status === "Late" ? "Late" : "Present";
        if (statusClass === "late") lateCount++; else presentCount++;
      } else {
        statusClass = "absent";
        statusText = "Absent";
        absentCount++;
      }
    }

    const cellClass = ["att-cal-cell", statusClass, isWeekend ? "weekend" : "", isToday ? "today" : ""].filter(Boolean).join(" ");

    calHTML += `
      <div class="${cellClass}">
        <div class="att-cal-cell-top">
          <span class="att-cal-date">${day}</span>
          ${statusText ? `<span class="att-cal-badge ${statusClass}">${statusText}</span>` : ""}
        </div>
        ${checkInStr ? `<div class="att-cal-time"><span class="att-cal-checkin">${checkInStr}</span><span class="att-cal-sep">→</span><span class="att-cal-checkout">${checkOutStr}</span></div>` : ""}
      </div>
    `;
  }

  const totalCells = firstDay + daysInMonth;
  const rem = totalCells % 7;
  if (rem > 0) {
    for (let i = 0; i < (7 - rem); i++) {
      calHTML += `<div class="att-cal-cell empty"></div>`;
    }
  }

  document.getElementById("att-cal-grid").innerHTML = calHTML;

  // Monthly summary
  const summaryEl = document.getElementById("att-cal-summary");
  if (summaryEl) {
    const totalMarked = presentCount + lateCount + absentCount;
    const rate = totalMarked ? Math.round(((presentCount + lateCount) / totalMarked) * 100) : 0;
    summaryEl.innerHTML = `
      <span class="att-cal-stat"><span class="dot" style="background:#10b981"></span>Present <b>${presentCount}</b></span>
      <span class="att-cal-stat"><span class="dot" style="background:#f59e0b"></span>Late <b>${lateCount}</b></span>
      <span class="att-cal-stat"><span class="dot" style="background:#ef4444"></span>Absent <b>${absentCount}</b></span>
      <span class="att-cal-stat">Attendance <b>${rate}%</b></span>
    `;
  }
}

/* ---------- Leave (Supabase) ---------- */
async function loadLeaveRequests() {
  const data = await API.fetchLeaveRequests(
    state.role === "admin" ? null : window.CURRENT_USER_ID
  );
  state.leaveRequests = data.map(r => ({
    id: r.id.toString(),
    employeeId: r.employee_id,
    type: r.type,
    from: r.from_date,
    to: r.to_date,
    days: r.days,
    reason: r.reason || "",
    status: r.status,
    reviewerNote: r.reviewer_note || "",
    reviewedBy: r.reviewed_by || "",
    appliedOn: r.applied_on,
  }));
}

function renderLeaveAdmin() {
  const pending = state.leaveRequests.filter(l => l.status === "Pending");
  const approved = state.leaveRequests.filter(l => l.status === "Approved").length;
  const rejected = state.leaveRequests.filter(l => l.status === "Rejected").length;

  document.getElementById("leave-admin-stats").innerHTML =
    statCardHTML("Pending Requests", pending.length, null, "chart3") +
    statCardHTML("Approved", approved, null, "chart5") +
    statCardHTML("Rejected", rejected, null, "primary");

  document.getElementById("leave-admin-pending").innerHTML = pending.map(l => {
    const emp = getEmployee(l.employeeId);
    return `<div class="list-row">
      ${avatarHTML(emp.name)}
      <div class="list-row-info">
        <div class="title">${escapeHtml(emp.name)} — ${escapeHtml(l.type)} Leave</div>
        <div class="sub">${formatDate(l.from)} to ${formatDate(l.to)} · ${l.days} days · ${escapeHtml(l.reason)}</div>
      </div>
      <button class="btn primary sm" onclick="setLeaveStatus('${l.id}','Approved')">Approve</button>
      <button class="btn outline sm" onclick="setLeaveStatus('${l.id}','Rejected')">Reject</button>
    </div>`;
  }).join("");
}

async function setLeaveStatus(id, status) {
  let reviewerNote = "";
  if (status === "Rejected") {
    reviewerNote = prompt("Reason for rejection:");
    if (reviewerNote === null) return;
  }
  try {
    const hrName = document.getElementById('user-name')?.textContent || 'HR';
    await API.updateLeaveStatus(parseInt(id), status, reviewerNote, hrName);
    showToast(`Leave ${status.toLowerCase()}`);
    await loadLeaveRequests();
    renderLeaveAdmin();
  } catch (err) {
    showToast("Failed to update leave status");
  }
}

function renderLeaveEmployee() {
  const myLeaves = state.leaveRequests.filter(l => l.employeeId === CURRENT_USER_ID);
  const approvedDays = myLeaves.filter(l => l.status === "Approved").reduce((s, l) => s + l.days, 0);

  document.getElementById("leave-emp-stats").innerHTML =
    statCardHTML("Leave Balance", 18 - approvedDays, "of 18 days", "chart5") +
    statCardHTML("Used", approvedDays, "Approved this year") +
    statCardHTML("Pending", myLeaves.filter(l => l.status === "Pending").length, null, "chart3");

  document.getElementById("leave-emp-requests").innerHTML = myLeaves.map(l => `
    <div class="list-row">
      <div class="list-row-info">
        <div class="title">${l.type} Leave</div>
        <div class="sub">${formatDate(l.from)} – ${formatDate(l.to)} · ${l.days}d</div>
      </div>
      <div class="leave-request-status">
        ${badgeHTML(l.status)}
        ${l.reviewerNote ? `<span class="leave-reviewer-note">${escapeHtml(l.reviewerNote)}</span>` : ""}
      </div>
    </div>
  `).join("");
}

function leaveFormError(msg) {
  const errEl = document.getElementById("leave-form-error");
  if (!errEl) return;
  errEl.textContent = msg;
  errEl.style.display = "block";
}

async function submitLeave() {
  const type = document.getElementById("leave-type").value;
  const from = document.getElementById("leave-from").value;
  const to = document.getElementById("leave-to").value;
  const reason = document.getElementById("leave-reason").value;
  if (!from || !to) { leaveFormError("Please select both From and To dates."); return; }
  if (new Date(to) < new Date(from)) { leaveFormError("To date cannot be earlier than the From date."); return; }
  const days = Math.max(1, Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1);
  try {
    await API.createLeaveRequest(CURRENT_USER_ID, type, from, to, days, reason);
    document.getElementById("leave-type").value = "Casual";
    document.getElementById("leave-from").value = "";
    document.getElementById("leave-to").value = "";
    document.getElementById("leave-reason").value = "";
    const errEl = document.getElementById("leave-form-error");
    if (errEl) errEl.style.display = "none";
    showToast("Leave request submitted!");
    await loadLeaveRequests();
    renderLeaveEmployee();
  } catch (err) {
    showToast("Failed to submit leave request");
  }
}

/* ---------- Travel Allowance (Supabase) ---------- */
function mapTravelAllowanceRow(r) {
  const distanceKm = r.travel_distance_km != null ? Number(r.travel_distance_km) : 0;
  const rate = state.reimbursementRate || 0;
  return {
    id: r.id.toString(),
    employeeId: r.employee_id,
    requestDate: r.request_date,
    fromLocation: r.from_location || "",
    destination: r.destination || "",
    distanceKm,
    travelCost: distanceKm,
    reimbursement: Math.round(distanceKm * rate * 100) / 100,
    purpose: r.purpose || "",
    additionalDetails: r.additional_details || "",
    status: r.status,
    reviewerNote: r.reviewer_note || "",
    reviewedBy: r.reviewed_by || "",
    reviewedAt: r.reviewed_at || "",
    createdAt: r.created_at,
  };
}

async function loadTravelAllowanceRequests() {
  await loadReimbursementRate();
  const data = await API.fetchTravelAllowanceRequests(
    state.role === "admin" ? null : window.CURRENT_USER_ID
  );
  state.travelRequests = data.map(mapTravelAllowanceRow);
}

async function loadReimbursementRate() {
  try {
    const { data, error } = await supabaseClient
      .from("app_meta")
      .select("value")
      .eq("key", "reimbursement_rate_per_km")
      .maybeSingle();
    if (error) throw error;
    state.reimbursementRate = data && data.value != null ? parseFloat(data.value) : 0;
  } catch (e) {
    console.warn("Could not load reimbursement rate", e);
    state.reimbursementRate = 0;
  }
}

async function saveReimbursementRate(rate) {
  const { error } = await supabaseClient
    .from("app_meta")
    .upsert({ key: "reimbursement_rate_per_km", value: String(rate) }, { onConflict: "key" });
  if (error) throw error;
  state.reimbursementRate = rate;
}

function renderTravelAllowanceAdmin() {
  const all = state.travelRequests;
  const pending = all.filter(r => r.status === "Pending");
  const approved = all.filter(r => r.status === "Approved").length;
  const rejected = all.filter(r => r.status === "Rejected").length;

  document.getElementById("travel-admin-stats").innerHTML =
    statCardHTML("Pending Requests", pending.length, null, "chart3") +
    statCardHTML("Approved", approved, null, "chart5") +
    statCardHTML("Rejected", rejected, null, "primary");

  // Reimbursement rate settings
  const rateInput = document.getElementById("reimb-rate");
  const rateSave = document.getElementById("reimb-rate-save");
  const rateNote = document.getElementById("reimb-rate-note");
  if (rateInput) rateInput.value = state.reimbursementRate || "";
  if (rateSave && !rateSave.dataset.wired) {
    rateSave.dataset.wired = "1";
    rateSave.onclick = async () => {
      const v = parseFloat(rateInput.value);
      if (isNaN(v) || v < 0) {
        rateNote.textContent = "Enter a valid rate ≥ 0.";
        rateNote.style.color = "var(--danger, #e04646)";
        return;
      }
      try {
        await saveReimbursementRate(v);
        rateNote.textContent = "Saved.";
        rateNote.style.color = "var(--muted-foreground)";
        renderTravelAllowanceAdmin();
      } catch (e) {
        rateNote.textContent = "Failed to save.";
        rateNote.style.color = "var(--danger, #e04646)";
      }
    };
  }

  // Employee filter (history per employee)
  const filter = document.getElementById("travel-emp-filter");
  if (filter) {
    const empIds = [...new Set(all.map(r => r.employeeId))].sort();
    const current = state.travelFilterEmp;
    filter.innerHTML = `<option value="all">All Employees</option>` +
      empIds.map(id => {
        const emp = getEmployee(id);
        return `<option value="${id}" ${current === id ? "selected" : ""}>${emp.name} (${id})</option>`;
      }).join("");
    filter.onchange = () => {
      state.travelFilterEmp = filter.value;
      renderTravelAllowanceAdmin();
    };
  }

  const filtered = state.travelFilterEmp === "all"
    ? all
    : all.filter(r => r.employeeId === state.travelFilterEmp);

  const listEl = document.getElementById("travel-admin-list");
  if (!listEl) return;

  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="empty-state">No travel allowance requests${state.travelFilterEmp !== "all" ? " for this employee" : ""}.</p>`;
    return;
  }

  listEl.innerHTML = filtered.map(r => {
    const emp = getEmployee(r.employeeId);
    return `<div class="list-row">
      ${avatarHTML(emp.name)}
      <div class="list-row-info">
        <div class="title">${escapeHtml(emp.name)} — ${escapeHtml(r.destination)}</div>
        <div class="sub">${escapeHtml(r.fromLocation)} → ${escapeHtml(r.destination)} · ${formatDate(r.requestDate)} · ${r.distanceKm} km · ₹${r.reimbursement.toLocaleString()}</div>
      </div>
      ${badgeHTML(r.status)}
      <button class="btn outline sm" onclick="openTravelAllowanceDetail('${r.id}')">View</button>
    </div>`;
  }).join("");
}

function renderTravelAllowanceEmployee() {
  const dateEl = document.getElementById("ta-date");
  if (dateEl && !dateEl.value) dateEl.value = iso(new Date());

  const mine = state.travelRequests;
  const pending = mine.filter(r => r.status === "Pending").length;
  const approved = mine.filter(r => r.status === "Approved").length;
  const rejected = mine.filter(r => r.status === "Rejected").length;

  document.getElementById("travel-emp-stats").innerHTML =
    statCardHTML("Total Requests", mine.length, null, "chart5") +
    statCardHTML("Pending", pending, null, "chart3") +
    statCardHTML("Approved", approved, "Rejected: " + rejected, "primary");

  const listEl = document.getElementById("travel-emp-requests");
  if (!listEl) return;

  if (mine.length === 0) {
    listEl.innerHTML = `<p class="empty-state">No travel allowance requests submitted yet.</p>`;
    return;
  }

  listEl.innerHTML = mine.map(r => `
    <div class="ta-request-card">
      <div class="ta-request-head">
        <div class="title">${escapeHtml(r.destination)}</div>
        ${badgeHTML(r.status)}
      </div>
      <div class="sub">${escapeHtml(r.fromLocation)} → ${escapeHtml(r.destination)} · ${formatDate(r.requestDate)}</div>
      <div class="ta-req-meta"><strong>Purpose:</strong> ${escapeHtml(r.purpose)}</div>
      <div class="ta-req-meta"><strong>Distance:</strong> ${r.distanceKm} km</div>
      <div class="ta-req-meta"><strong>Reimbursement:</strong> ₹${r.reimbursement.toLocaleString()}</div>
      ${r.additionalDetails ? `<div class="ta-req-meta"><strong>Details:</strong> ${escapeHtml(r.additionalDetails)}</div>` : ""}
      ${r.reviewerNote ? `<div class="ta-reviewer-note"><strong>HR remark:</strong> ${escapeHtml(r.reviewerNote)}${r.reviewedBy ? ` (${escapeHtml(r.reviewedBy)})` : ""}</div>` : ""}
    </div>
  `).join("");
}

async function openTravelAllowanceDetail(id) {
  const r = state.travelRequests.find(x => x.id === id);
  if (!r) return;
  const emp = getEmployee(r.employeeId);

  const modal = document.getElementById("travel-detail-modal");
  if (!modal) return;

  document.getElementById("ta-modal-title").textContent = `${emp.name} — ${r.destination}`;
  document.getElementById("ta-modal-body").innerHTML = `
    <div class="ta-detail-grid">
      <div><span class="ta-detail-label">Employee</span><span class="ta-detail-value">${escapeHtml(emp.name)} (${escapeHtml(r.employeeId)})</span></div>
      <div><span class="ta-detail-label">Date</span><span class="ta-detail-value">${formatDate(r.requestDate)}</span></div>
      <div><span class="ta-detail-label">From</span><span class="ta-detail-value">${escapeHtml(r.fromLocation)}</span></div>
      <div><span class="ta-detail-label">Destination</span><span class="ta-detail-value">${escapeHtml(r.destination)}</span></div>
      <div><span class="ta-detail-label">Distance (km)</span><span class="ta-detail-value">${r.distanceKm} km</span></div>
      <div><span class="ta-detail-label">Rate / km</span><span class="ta-detail-value">₹${(state.reimbursementRate || 0).toLocaleString()}</span></div>
      <div><span class="ta-detail-label">Reimbursement</span><span class="ta-detail-value">₹${r.reimbursement.toLocaleString()}</span></div>
      <div><span class="ta-detail-label">Status</span><span class="ta-detail-value">${badgeHTML(r.status)}</span></div>
    </div>
    <div class="ta-detail-block"><span class="ta-detail-label">Purpose / About</span><div class="ta-detail-value">${escapeHtml(r.purpose)}</div></div>
    ${r.additionalDetails ? `<div class="ta-detail-block"><span class="ta-detail-label">Additional Details</span><div class="ta-detail-value">${escapeHtml(r.additionalDetails)}</div></div>` : ""}
    ${r.reviewerNote ? `<div class="ta-detail-block"><span class="ta-detail-label">HR Remark</span><div class="ta-detail-value">${escapeHtml(r.reviewerNote)}${r.reviewedBy ? ` (${escapeHtml(r.reviewedBy)})` : ""}</div></div>` : ""}
    <div class="ta-detail-block">
      <span class="ta-detail-label">Reviewer Comment (optional)</span>
      <textarea class="input" id="ta-review-note" rows="2" placeholder="Add a comment for the employee...">${escapeHtml(r.reviewerNote || "")}</textarea>
    </div>
  `;

  const actions = document.getElementById("ta-modal-actions");
  if (r.status === "Pending") {
    actions.style.display = "flex";
    actions.innerHTML = `
      <button class="btn primary" onclick="setTravelAllowanceStatus('${r.id}','Approved')">Approve</button>
      <button class="btn outline" onclick="setTravelAllowanceStatus('${r.id}','Rejected')">Reject</button>
    `;
  } else {
    actions.style.display = "none";
    actions.innerHTML = "";
  }

  modal.dataset.taId = id;
  modal.style.display = "flex";
}

function closeTravelAllowanceModal() {
  const modal = document.getElementById("travel-detail-modal");
  if (modal) modal.style.display = "none";
}

async function setTravelAllowanceStatus(id, status) {
  const r = state.travelRequests.find(x => x.id === id);
  if (!r) return;

  let note = "";
  if (status === "Rejected") {
    const input = document.getElementById("ta-review-note");
    note = input ? input.value.trim() : "";
    if (!note) {
      note = prompt("Reason for rejection:") || "";
      if (note === null) return;
    }
  } else {
    const input = document.getElementById("ta-review-note");
    note = input ? input.value.trim() : "";
  }

  try {
    const hrName = document.getElementById('user-name')?.textContent || 'HR';
    await API.updateTravelAllowanceStatus(parseInt(id), status, note, hrName);
    showToast(`Travel Allowance ${status.toLowerCase()}`);
    closeTravelAllowanceModal();
    await loadTravelAllowanceRequests();
    renderTravelAllowanceAdmin();
  } catch (err) {
    showToast("Failed to update travel allowance status");
  }
}

async function submitTravelAllowance() {
  const requestDate = document.getElementById("ta-date").value;
  const fromLocation = document.getElementById("ta-from").value.trim();
  const destination = document.getElementById("ta-destination").value.trim();
  const distanceKm = parseFloat(document.getElementById("ta-cost").value) || 0;
  const purpose = document.getElementById("ta-purpose").value.trim();
  const additionalDetails = document.getElementById("ta-details").value.trim();
  const errEl = document.getElementById("ta-form-error");
  const btn = document.getElementById("ta-submit-btn");

  errEl.style.display = "none";

  if (!requestDate || !fromLocation || !destination || !purpose) {
    errEl.textContent = "Please fill Date, From, Destination and Purpose.";
    errEl.style.display = "block";
    return;
  }

  const empid = window.CURRENT_USER_ID;
  if (!empid) {
    errEl.textContent = "Session error. Please sign in again.";
    errEl.style.display = "block";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Submitting…";

  try {
    await API.createTravelAllowanceRequest({
      employeeId: empid,
      requestDate,
      fromLocation,
      destination,
      distanceKm,
      purpose,
      additionalDetails,
    });

    document.getElementById("ta-date").value = "";
    document.getElementById("ta-from").value = "CADD TECH AVDI BRANCH";
    document.getElementById("ta-destination").value = "";
    document.getElementById("ta-cost").value = "";
    document.getElementById("ta-purpose").value = "";
    document.getElementById("ta-details").value = "";

    showToast("Travel Allowance request submitted!");
    await loadTravelAllowanceRequests();
    renderTravelAllowanceEmployee();
  } catch (err) {
    errEl.textContent = err.message || "Failed to submit travel allowance request. Run travel_allowance_schema.sql in Supabase first.";
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit Request";
  }
}

/* ---------- Staff Performance (Supabase) ---------- */
const PERF_BASE_ATTRS = [
  { key: "google_reviews_avadi", label: "Google Reviews\n(Avadi)" },
  { key: "google_reviews_poonamallee", label: "Google Reviews\n(Poonamallee)" },
  { key: "google_reviews_arumbakkam", label: "Google Reviews\n(Arumbakkam)" },
  { key: "insta_follow", label: "Instagram\nFollowers" },
  { key: "youtube_sub", label: "YouTube\nSubscribers" },
  { key: "batch_completion", label: "Batch\nCompletion" },
  { key: "course_completion", label: "Course\nCompletion" },
  { key: "projects", label: "Projects" },
  { key: "reference_upgrade", label: "Reference\nUpgrades" },
  { key: "registration", label: "Registrations" },
  { key: "demo", label: "Demo\nClasses" },
  { key: "student_placement", label: "Student\nPlacements" },
  { key: "video_poster_edit", label: "Video/\nPoster Edits" },
];

const PERF_SKIP_COLS = ["id", "staff_name", "empid", "created_at", "updated_at"];

function getPerfAttrs() {
  const known = PERF_BASE_ATTRS.map(a => a.key);
  const cols = state.staffPerformance.length > 0 ? Object.keys(state.staffPerformance[0]) : null;
  const base = cols ? PERF_BASE_ATTRS.filter(a => cols.includes(a.key)) : PERF_BASE_ATTRS;
  const extra = cols
    ? cols
        .filter(k => !known.includes(k) && !PERF_SKIP_COLS.includes(k))
        .map(k => ({ key: k, label: k.replace(/_/g, " ") }))
    : [];
  return [...base, ...extra];
}

function totalPoints(r) {
  return getPerfAttrs().reduce((sum, a) => sum + (parseInt(r[a.key]) || 0), 0);
}

function maxForAttr(key) {
  let max = 0;
  state.staffPerformance.forEach(r => {
    const v = parseInt(r[key]) || 0;
    if (v > max) max = v;
  });
  return max;
}

/* Scale denominator for a column: HR-set target if present, else the
   highest value across staff, else 1. Used to compute the % bar. */
function scaleDenom(key) {
  const t = state.perfTargets && state.perfTargets[key];
  if (t != null && !isNaN(t)) return t > 0 ? t : 1;
  const m = maxForAttr(key);
  return m > 0 ? m : 1;
}

function renderLeaderboard() {
  const sorted = [...state.staffPerformance].sort((a, b) => totalPoints(b) - totalPoints(a));
  if (sorted.length === 0) {
    return `<p class="empty-state">No performance data yet.</p>`;
  }

  const top3 = sorted.slice(0, 3);
  // Visual order: 2nd, 1st, 3rd
  const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean);
  const podium = podiumOrder.map(r => {
    const rank = sorted.indexOf(r) + 1;
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉";
    const emp = getEmployee(r.empid || "");
    const name = r.staff_name || (emp && emp.name) || "Employee";
    return `<div class="perf-podium-step rank-${rank}" data-rec-id="${r.id}">
      <div class="perf-podium-medal">${medal}</div>
      <div class="perf-podium-avatar ${rank === 1 ? "gold" : rank === 2 ? "silver" : "bronze"}">${escapeHtml(getInitials(name))}</div>
      <div class="perf-podium-name">${escapeHtml(name)}</div>
      <div class="perf-podium-pts">${totalPoints(r)} <span>pts</span></div>
      <div class="perf-podium-base"></div>
    </div>`;
  }).join("");

  const rows = sorted.map((r, i) => {
    const rank = i + 1;
    const emp = getEmployee(r.empid || "");
    const name = r.staff_name || (emp && emp.name) || "Employee";
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
    return `<div class="perf-rank-row${rank <= 3 ? " top3" : ""}" data-rec-id="${r.id}">
      <span class="perf-rank-num">${medal}</span>
      <span class="perf-rank-avatar">${escapeHtml(getInitials(name))}</span>
      <span class="perf-rank-name">${escapeHtml(name)}</span>
      <span class="perf-rank-pts">${totalPoints(r)} pts</span>
    </div>`;
  }).join("");

  return `<div class="perf-podium">${podium}</div><div class="perf-rank-list">${rows}</div>`;
}

function downloadPerformanceCSV() {
  const attrs = getPerfAttrs();
  const sorted = [...state.staffPerformance].sort((a, b) => totalPoints(b) - totalPoints(a));

  const header = ["Rank", "Employee Name", "Employee ID",
    ...attrs.map(a => a.label.replace(/\n/g, " ")),
    "Total Points"];

  const escape = (v) => {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const rows = sorted.map((r, i) => [
    i + 1,
    r.staff_name || getEmployee(r.empid || "").name,
    r.empid || "",
    ...attrs.map(a => parseInt(r[a.key]) || 0),
    totalPoints(r)
  ]);

  const csv = [header, ...rows]
    .map(row => row.map(escape).join(","))
    .join("\n");

  // BOM so Excel reads UTF-8 correctly
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `performance_${iso(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Performance exported to Excel (CSV)");
}

function getPerfRank(record) {
  const sorted = [...state.staffPerformance].sort((a, b) => totalPoints(b) - totalPoints(a));
  const idx = sorted.findIndex(r => String(r.id) === String(record.id));
  return idx < 0 ? sorted.length : idx + 1;
}

/* Shared, interactive performance editor.
   `root` is a container element; `onSaved(updates)` is called after a successful save. */
function mountPerfEditor(root, record, onSaved) {
  const attrs = getPerfAttrs();
  const draft = {};
  const original = {};
  attrs.forEach(a => { draft[a.key] = parseInt(record[a.key]) || 0; original[a.key] = draft[a.key]; });

  root.innerHTML = `
    <div class="perf-hero">
      <div class="perf-hero-left">
        <div class="perf-ring" id="perf-ring">
          <div class="perf-ring-inner">
            <div class="perf-ring-value" id="perf-total-live">${totalPoints(record)}</div>
            <div class="perf-ring-label">Total Points</div>
          </div>
        </div>
      </div>
      <div class="perf-hero-right">
        <div class="perf-hero-name">${escapeHtml(record.staff_name || (getEmployee(record.empid || '').name) || 'Employee')}</div>
        <div class="perf-hero-sub">${getPerfRank(record) === 1 ? '🏆 Top Performer' : 'Rank #' + getPerfRank(record)}</div>
        <div class="perf-hero-hint">Drag the sliders or use + / − to update activity points. Your changes save with the button below.</div>
      </div>
    </div>
    <div class="perf-tiles" id="perf-tiles"></div>
    <div class="perf-editor-foot">
      <span id="perf-unsaved">0 unsaved changes</span>
      <div style="display:flex;gap:0.5rem">
        <button class="btn outline sm" id="perf-reset">Reset</button>
        <button class="btn primary sm" id="perf-save">Save Changes</button>
      </div>
    </div>
  `;

  const tilesEl = root.querySelector("#perf-tiles");

  function goal() { return Math.max(300, ...state.staffPerformance.map(totalPoints)); }

  function setRing() {
    const t = attrs.reduce((s, a) => s + (draft[a.key] || 0), 0);
    const pct = Math.min(100, Math.round((t / goal()) * 100));
    const ring = root.querySelector("#perf-ring");
    if (ring) ring.style.background = `conic-gradient(var(--primary) ${pct * 3.6}deg, var(--muted) 0deg)`;
  }

  function refresh() {
    const t = attrs.reduce((s, a) => s + (draft[a.key] || 0), 0);
    const tv = root.querySelector("#perf-total-live");
    if (tv) tv.textContent = t;
    setRing();
    let n = 0;
    attrs.forEach(a => { if ((draft[a.key] || 0) !== original[a.key]) n++; });
    const u = root.querySelector("#perf-unsaved");
    if (u) u.textContent = n + " unsaved change" + (n !== 1 ? "s" : "");
  }

  function syncTile(k) {
    const v = draft[k];
    const valEl = root.querySelector("#perf-val-" + k);
    if (valEl) valEl.textContent = v;
    const max = scaleDenom(k);
    const bar = root.querySelector("#perf-bar-" + k);
    if (bar) bar.style.width = Math.min(100, Math.round((v / max) * 100)) + "%";
    const sl = root.querySelector("#perf-slider-" + k);
    if (sl) sl.value = v;
  }

  tilesEl.innerHTML = attrs.map(a => {
    const val = draft[a.key];
    const max = scaleDenom(a.key);
    const pct = Math.min(100, Math.round((val / max) * 100));
    return `<div class="perf-tile" data-key="${a.key}">
      <div class="perf-tile-head">
        <span class="perf-tile-label">${a.label.replace(/\n/g, ' ')}</span>
        <span class="perf-tile-val" id="perf-val-${a.key}">${val}</span>
      </div>
      <input type="range" class="perf-slider" min="0" max="${Math.max(max * 1.5, 20)}" value="${val}" id="perf-slider-${a.key}" />
      <div class="perf-tile-bar"><div class="perf-tile-bar-fill" id="perf-bar-${a.key}" style="width:${pct}%"></div></div>
      <div class="perf-stepper">
        <button class="perf-step-btn" data-d="-1" data-key="${a.key}" aria-label="decrease">−</button>
        <button class="perf-step-btn" data-d="1" data-key="${a.key}" aria-label="increase">+</button>
      </div>
    </div>`;
  }).join("");

  tilesEl.querySelectorAll(".perf-step-btn").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.key;
    draft[k] = Math.max(0, (draft[k] || 0) + parseInt(b.dataset.d, 10));
    syncTile(k); refresh();
  }));
  tilesEl.querySelectorAll(".perf-slider").forEach(s => s.addEventListener("input", () => {
    const k = s.id.replace("perf-slider-", "");
    draft[k] = parseInt(s.value, 10) || 0;
    syncTile(k); refresh();
  }));

  root.querySelector("#perf-reset").addEventListener("click", () => {
    attrs.forEach(a => { draft[a.key] = original[a.key]; syncTile(a.key); });
    refresh();
  });

  root.querySelector("#perf-save").addEventListener("click", async (e) => {
    const updates = {};
    attrs.forEach(a => { const v = draft[a.key] || 0; if (v !== original[a.key]) updates[a.key] = v; });
    if (Object.keys(updates).length === 0) { if (onSaved) onSaved(null); return; }
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      if (!record.id) {
        await API.createStaffPerformance(
          record.empid || (state.role === 'employee' ? CURRENT_USER_ID : ''),
          record.staff_name || '',
          updates
        );
      } else {
        await API.updateStaffPerformance(record.id, {
          ...updates,
          empid: record.empid || (state.role === 'employee' ? CURRENT_USER_ID : ''),
          staff_name: record.staff_name || ''
        });
      }
      showToast("✓ Performance saved!");
      if (onSaved) onSaved(updates);
    } catch (err) {
      showToast("Save failed — " + (err.message || "check performance setup"));
      btn.disabled = false; btn.textContent = "Save Changes";
    }
  });

  setRing();
}

function openPerfEditorModal(record) {
  let overlay = document.getElementById("perf-editor-modal");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "perf-editor-modal";
    overlay.style.display = "none";
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="modal perf-editor-modal">
    <div class="perf-editor-head">
      <div>
        <h2>${escapeHtml(record.staff_name || 'Employee')}</h2>
        <p class="sub">HR · edit performance points</p>
      </div>
      <button class="modal-close-x" id="pe-close">×</button>
    </div>
    <div id="pe-root"></div>
  </div>`;

  mountPerfEditor(overlay.querySelector("#pe-root"), record, async () => {
    overlay.style.display = "none";
    await loadStaffPerformance();
    renderPerformanceAdmin();
  });

  overlay.querySelector("#pe-close").addEventListener("click", () => overlay.style.display = "none");
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.style.display = "none"; });
  overlay.style.display = "flex";
}

function openAddAttributeModal() {
  let overlay = document.getElementById("perf-addattr-modal");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "perf-addattr-modal";
    overlay.style.display = "none";
    document.body.appendChild(overlay);
  }
  renderManageColumnsModal(overlay);
  overlay.style.display = "flex";
}

function renderManageColumnsModal(overlay) {
  const attrs = getPerfAttrs();
  const targets = state.perfTargets || {};
  const listHTML = attrs.length
    ? attrs.map(a => {
        const t = targets[a.key];
        const targetTxt = t != null ? `Target: ${t}` : "No target";
        return `
        <div class="col-manage-row" data-key="${a.key}">
          <span class="col-manage-name">${a.label.replace(/\n/g, " ")}<br><span class="col-target-val">${targetTxt}</span></span>
          <div class="col-manage-actions">
            <button class="btn outline sm col-target-btn" data-key="${a.key}" data-label="${a.label.replace(/\n/g, " ").replace(/"/g, "&quot;")}">Set Target</button>
            <button class="btn danger sm col-del-btn" data-key="${a.key}" data-label="${a.label.replace(/\n/g, " ").replace(/"/g, "&quot;")}">Delete</button>
          </div>
        </div>`;
      }).join("")
    : `<p class="sub" style="color:var(--muted-foreground)">No columns yet.</p>`;

  overlay.innerHTML = `<div class="modal">
    <div class="perf-editor-head">
      <div><h2>Manage Columns</h2><p class="sub">Add or delete performance columns for every employee</p></div>
      <button class="modal-close-x" id="paa-close">×</button>
    </div>
    <div class="leave-form">
      <label>New column name</label>
      <input class="input" id="paa-input" placeholder="e.g. workshops_conducted" />
      <div id="paa-error" class="add-emp-error" style="display:none"></div>
      <p class="sub" style="font-size:0.75rem;color:var(--muted-foreground)">Lowercase letters, numbers &amp; underscores only. No spaces.</p>
      <button class="btn primary full" id="paa-submit">+ Add Column</button>
    </div>
    <div class="col-manage-list">
      <div class="col-manage-title">Existing columns</div>
      ${listHTML}
    </div>
  </div>`;

  const input = overlay.querySelector("#paa-input");
  const err = overlay.querySelector("#paa-error");
  overlay.querySelector("#paa-close").addEventListener("click", () => overlay.style.display = "none");
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.style.display = "none"; });

  overlay.querySelector("#paa-submit").addEventListener("click", async () => {
    const name = input.value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      err.textContent = "Use lowercase letters, numbers and underscores only (no spaces).";
      err.style.display = "block"; return;
    }
    err.style.display = "none";
    const btn = overlay.querySelector("#paa-submit");
    btn.disabled = true; btn.textContent = "Adding…";
    try {
      const res = await API.addStaffPerformanceColumn(name);
      if (res !== "ok") throw new Error(res || "Failed");
      showToast("✓ Column '" + name + "' added!");
      await loadStaffPerformance();
      renderManageColumnsModal(overlay);
      renderPerformanceAdmin();
    } catch (e) {
      err.textContent = (e.message || "Failed to add column.") + " Ensure the add_performance_column RPC is deployed.";
      err.style.display = "block";
      btn.disabled = false; btn.textContent = "+ Add Column";
    }
  });

  overlay.querySelectorAll(".col-del-btn").forEach(btn => {
    btn.addEventListener("click", () => confirmDeleteColumn(overlay, btn.dataset.key, btn.dataset.label));
  });

  overlay.querySelectorAll(".col-target-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.key;
      const current = (state.perfTargets && state.perfTargets[key] != null) ? state.perfTargets[key] : "";
      const val = window.prompt(`Set target for "${btn.dataset.label}"\n(enter a number, e.g. 10, 12, 15)`, current);
      if (val === null) return;
      const num = parseFloat(val);
      if (isNaN(num)) { alert("Please enter a valid number."); return; }
      try {
        await savePerfTarget(key, num);
        state.perfTargets[key] = num;
        showToast(`✓ Target for '${btn.dataset.label}' set to ${num}`);
        renderManageColumnsModal(overlay);
        renderPerformanceAdmin();
        if (typeof renderPerformanceEmployee === "function") renderPerformanceEmployee();
      } catch (e) {
        alert("Failed to save target: " + (e.message || e));
      }
    });
  });
}

async function savePerfTarget(attrKey, target) {
  const { error } = await supabaseClient
    .from("perf_targets")
    .upsert({ attr_key: attrKey, target: target }, { onConflict: "attr_key" });
  if (error) throw error;
}

async function loadPerfTargets() {
  try {
    const { data, error } = await supabaseClient.from("perf_targets").select("attr_key, target");
    if (error) throw error;
    const map = {};
    (data || []).forEach(r => { map[r.attr_key] = Number(r.target); });
    state.perfTargets = map;
  } catch (e) {
    console.warn("Could not load performance targets", e);
    state.perfTargets = {};
  }
}

function confirmDeleteColumn(overlay, key, label) {
  const row = overlay.querySelector(`.col-manage-row[data-key="${key}"]`);
  if (!row) return;
  row.innerHTML = `
    <span class="col-manage-name">Delete "${label}"? Are you sure?</span>
    <div class="col-manage-actions">
      <button class="btn danger sm col-del-yes">Yes</button>
      <button class="btn outline sm col-del-no">No</button>
    </div>`;
  row.querySelector(".col-del-no").addEventListener("click", () => renderManageColumnsModal(overlay));
  row.querySelector(".col-del-yes").addEventListener("click", async () => {
    const yes = row.querySelector(".col-del-yes");
    yes.disabled = true; yes.textContent = "Deleting…";
    try {
      const res = await API.dropStaffPerformanceColumn(key);
      if (res !== "ok") throw new Error(res || "Failed");
      showToast("✓ Column '" + label + "' deleted!");
      await loadStaffPerformance();
      renderManageColumnsModal(overlay);
      renderPerformanceAdmin();
    } catch (e) {
      showToast((e.message || "Failed to delete column.") + " Ensure the drop_performance_column RPC is deployed.");
      renderManageColumnsModal(overlay);
    }
  });
}

async function loadStaffPerformance() {
  const data = await API.fetchStaffPerformance();
  state.staffPerformance = data || [];
  await loadPerfTargets();
}

// Resets performance points once per month (when the calendar month changes).
async function ensureMonthlyPerfReset() {
  try {
    const { data: meta } = await supabaseClient
      .from('app_meta')
      .select('value')
      .eq('key', 'last_perf_reset')
      .maybeSingle();
    const current = new Date().toISOString().slice(0, 7); // YYYY-MM
    if (!meta || meta.value !== current) {
      await supabaseClient.rpc('reset_staff_performance_monthly');
      await loadStaffPerformance();
    }
  } catch (e) {
    console.warn('[Perf] monthly reset check skipped:', e);
  }
}

function renderPerformanceAdmin() {
  const top = [...state.staffPerformance].sort((a, b) => totalPoints(b) - totalPoints(a));
  const avgPts = top.length ? Math.round(top.reduce((s, r) => s + totalPoints(r), 0) / top.length) : 0;

  document.getElementById("perf-admin-stats").innerHTML =
    statCardHTML("Total Staff", top.length, null, "chart3") +
    statCardHTML("Avg Points", avgPts, "Per staff", "chart5") +
    statCardHTML("Top Performer", top.length ? `${top[0].staff_name} (${totalPoints(top[0])} pts)` : "—", null, "accent");

  document.getElementById("perf-admin-content").innerHTML = `
    <div class="card" style="margin-top:1.5rem">
      <div class="card-header">
        <h3>\uD83C\uDFC6 Leaderboard</h3>
        <div style="display:flex;gap:0.5rem">
          <button class="btn primary sm" id="perf-download-btn">⬇ Export Excel</button>
          <button class="btn outline sm" id="perf-add-attr-btn">⚙ Manage Columns</button>
        </div>
      </div>
      <div class="card-body" style="padding:0" id="perf-admin-leaderboard">${renderLeaderboard()}</div>
    </div>`;

  document.getElementById("perf-add-attr-btn").addEventListener("click", openAddAttributeModal);
  document.getElementById("perf-download-btn").addEventListener("click", downloadPerformanceCSV);

  const lb = document.getElementById("perf-admin-leaderboard");
  lb.querySelectorAll(".perf-podium-step, .perf-rank-row").forEach((row) => {
    const recId = row.dataset.recId;
    const rec = state.staffPerformance.find(r => String(r.id) === String(recId));
    if (!rec) return;
    row.style.cursor = "pointer";
    row.title = "Click to edit points";
    row.addEventListener("click", () => openPerfEditorModal(rec));
  });
}

function renderPerformanceEmployee() {
  const el = document.getElementById("perf-emp-content");
  if (!el) return;
  const myName = getEmployee(CURRENT_USER_ID).name;
  const myRecord = state.staffPerformance.find(r => r.empid && r.empid.toString().trim() === CURRENT_USER_ID.toString().trim())
    || state.staffPerformance.find(r => r.staff_name && r.staff_name.trim().toLowerCase() === myName.trim().toLowerCase());

  const leaderboardCard = `
    <div class="card" style="margin-top:1.5rem">
      <div class="card-header"><h3>\uD83C\uDFC6 Leaderboard</h3></div>
      <div class="card-body" style="padding:0">${renderLeaderboard()}</div>
    </div>`;

  if (!myRecord) {
    // No staff_performance row for this empid yet — still load an editable
    // (blank) performance table so the employee can add their points.
    const blankRecord = { id: null, empid: CURRENT_USER_ID, staff_name: myName };
    el.innerHTML = `
      ${leaderboardCard}
      <div class="card perf-my-card" style="margin-top:1.5rem">
        <div class="card-header">
          <div>
            <h3>\u270F\uFE0F My Performance</h3>
            <p class="perf-sub">No record yet — add your activity points below</p>
          </div>
        </div>
        <div class="card-body" id="perf-editor-root"></div>
      </div>`;
    mountPerfEditor(el.querySelector("#perf-editor-root"), blankRecord, async () => {
      await loadStaffPerformance();
      renderPerformanceEmployee();
    });
    return;
  }

  el.innerHTML = `
    ${leaderboardCard}
    <div class="card perf-my-card" style="margin-top:1.5rem">
      <div class="card-header">
        <div>
          <h3>\u270F\uFE0F My Performance</h3>
          <p class="perf-sub">Update your activity points below</p>
        </div>
      </div>
      <div class="card-body" id="perf-editor-root"></div>
    </div>`;

  mountPerfEditor(el.querySelector("#perf-editor-root"), myRecord, async () => {
    await loadStaffPerformance();
    renderPerformanceEmployee();
  });
}

/* ---------- Announcements (Supabase) ---------- */
async function loadAnnouncements() {
  const data = await API.fetchAnnouncements();
  state.announcements = data.map(r => ({
    id: r.id.toString(),
    title: r.title,
    body: r.body,
    category: r.category,
    author: r.author,
    date: r.date,
    pinned: r.pinned || false
  }));
}

function renderAnnouncements() {
  document.getElementById("announce-form-card").style.display = state.role === "admin" ? "block" : "none";

  const sorted = [...state.announcements].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  document.getElementById("announcements-list").innerHTML = sorted.map(a => `
    <div class="card" style="padding:1.25rem">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:600">${escapeHtml(a.title)} ${a.pinned ? "\uD83D\uDCCC" : ""}</div>
          <div class="sub" style="margin-top:0.25rem">${escapeHtml(a.category)} \u00B7 ${formatDate(a.date)} \u00B7 ${escapeHtml(a.author)}</div>
        </div>
        ${badgeHTML(a.category)}
      </div>
      <p style="margin-top:0.75rem;font-size:0.875rem">${escapeHtml(a.body)}</p>
    </div>
  `).join("");
}

async function publishAnnouncement() {
  const title = document.getElementById("announce-title").value;
  const body = document.getElementById("announce-body").value;
  const category = document.getElementById("announce-category").value;
  if (!title || !body) return;

  try {
    const empName = document.getElementById('user-name')?.textContent || 'HR Admin';
    await API.createAnnouncement(title, body, category, empName, window.CURRENT_USER_ID);
    document.getElementById("announce-title").value = "";
    document.getElementById("announce-body").value = "";
    showToast("Announcement published!");
    await loadAnnouncements();
    renderAnnouncements();
    if (state.page === "dashboard") {
      state.role === "admin" ? renderAdminDashboard() : renderEmployeeDashboard();
    }
  } catch (err) {
    showToast("Failed to publish announcement");
  }
}




/* ---------- Chat (Supabase) ---------- */

// In-memory cache for loaded chats
state.chatProfiles = {};      // uuid -> { name, empid }
state.chatConvs = [];         // [{ conversationId, participantUuid, participantName, lastMsg }]
state.chatMessages = [];      // messages for active conversation
state.activeContactUuid = ""; // active selected member's UUID

async function loadChatData() {
  const msgEl = document.getElementById('chat-messages');
  if (!msgEl) return;

  const myUid = window.CURRENT_USER_UUID;
  if (!myUid) {
    console.error("CURRENT_USER_UUID is not set.");
    return;
  }

  // 1. Fetch all profiles to build a lookup and the list of members
  const profiles = await API.fetchAllProfiles();
  state.chatProfiles = {};
  profiles.forEach(p => { state.chatProfiles[p.id] = p; });

  if (profiles.length <= 1) {
    console.warn(
      "[CHAT] Only " + profiles.length + " profile(s) returned. " +
      "Team Chat needs a profiles SELECT policy that lets authenticated users read all profiles. " +
      "Run setup/fix_profiles_select_policy.sql (and setup/chat_schema.sql section 5) in the Supabase SQL editor."
    );
  }

  // 2. Fetch conversations the current user is part of
  const rawConvs = await API.fetchMyConversations();

  // 3. Fetch all messages the current user has access to
  let allMsgs = [];
  try {
    const { data, error } = await supabaseClient
      .from('employee_chat_messages')
      .select('id, conversation_id, sender_id, text, created_at')
      .order('created_at', { ascending: true });
    if (!error && data) {
      allMsgs = data;
    }
  } catch (e) {
    console.error("Error fetching messages in loadChatData:", e);
  }

  // Create a map of conversation_id -> last message text
  const lastMsgMap = {};
  allMsgs.forEach(m => {
    lastMsgMap[m.conversation_id] = m.text;
  });

  // 4. Map other profiles to conversation items (our sidebar contacts)
  const otherProfiles = profiles.filter(p => p.id !== myUid);

  state.chatConvs = otherProfiles.map(p => {
    const conv = rawConvs.find(c =>
      (c.user1_id === myUid && c.user2_id === p.id) ||
      (c.user2_id === myUid && c.user1_id === p.id)
    );

    return {
      conversationId: conv ? conv.id : null,
      participantUuid: p.id,
      participantName: p.name || p.empid,
      participantEmpid: p.empid,
      participantDepartment: p.department || '',
      lastMsg: conv ? (lastMsgMap[conv.id] || '') : ''
    };
  });

  // 5. Set default active contact if none set
  if (!state.activeContactUuid && state.chatConvs.length > 0) {
    state.activeContactUuid = state.chatConvs[0].participantUuid;
    state.activeConversationId = state.chatConvs[0].conversationId;
  } else if (state.activeContactUuid) {
    // Sync conversationId in case it was created/updated
    const matched = state.chatConvs.find(c => c.participantUuid === state.activeContactUuid);
    state.activeConversationId = matched ? matched.conversationId : null;
  }

  // Load messages for active conversation
  await loadActiveMessages();
  renderChat();
}

async function loadActiveMessages() {
  if (!state.activeConversationId) { 
    state.chatMessages = []; 
    return; 
  }
  const msgs = await API.fetchChatMessages(state.activeConversationId);
  state.chatMessages = msgs;
}

function renderChat() {
  const convListEl = document.getElementById('chat-conversations');
  if (!convListEl) return;

  const myUid = window.CURRENT_USER_UUID;
  const searchQ = (document.getElementById('chat-search')?.value || '').toLowerCase();
  const filtered = state.chatConvs.filter(c =>
    c.participantName.toLowerCase().includes(searchQ) ||
    c.participantEmpid.toLowerCase().includes(searchQ)
  );

  if (filtered.length === 0 && state.chatConvs.length === 0) {
    convListEl.innerHTML = `<div class="empty-state">No members found.</div>`;
  } else if (filtered.length === 0) {
    convListEl.innerHTML = `<div class="empty-state">No results.</div>`;
  } else {
    convListEl.innerHTML = filtered.map(c => {
      const isActive = state.activeContactUuid === c.participantUuid;
      return `<button class="chat-conv-btn ${isActive ? 'active' : ''}" data-contact-uuid="${c.participantUuid}" data-conv-id="${c.conversationId || ''}">
        ${avatarHTML(c.participantName, 'md', 'accent')}
        <div class="chat-conv-info">
          <div class="chat-conv-name">${escapeHtml(c.participantName)}</div>
          <div class="chat-conv-msg">${escapeHtml(c.lastMsg || '')}</div>
        </div>
      </button>`;
    }).join('');
  }

  // Bind contact clicks
  document.querySelectorAll('.chat-conv-btn[data-contact-uuid]').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.activeContactUuid = btn.dataset.contactUuid;
      state.activeConversationId = btn.dataset.convId || null;
      await loadActiveMessages();
      renderChat();
    });
  });

  // Render message area
  const active = state.chatConvs.find(c => c.participantUuid === state.activeContactUuid);
  const headerEl = document.getElementById('chat-partner-header');
  const msgEl = document.getElementById('chat-messages');
  const inputRow = document.getElementById('chat-input-row');

  if (active) {
    if (headerEl) { 
      headerEl.textContent = active.participantName; 
      headerEl.style.display = 'block'; 
    }
    if (inputRow) inputRow.style.display = 'flex';
    if (msgEl) {
      if (!state.activeConversationId || state.chatMessages.length === 0) {
        msgEl.innerHTML = `<div class="empty-state">No messages yet. Say hello!</div>`;
      } else {
        msgEl.innerHTML = state.chatMessages.map(m => {
          const isMine = m.sender_id === myUid;
          const time = new Date(m.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          return `<div class="chat-bubble ${isMine ? 'mine' : 'their'}" style="position:relative">
            ${escapeHtml(m.text)}
            <div style="font-size:0.65rem;opacity:0.7;margin-top:0.25rem">${time}</div>
            ${isMine ? `<button class="chat-delete-btn" data-msg-id="${m.id}" title="Delete message" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:1px solid var(--border);background:var(--card);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;color:#9ca3af;font-size:12px;line-height:1">&times;</button>` : ''}
          </div>`;
        }).join('');
        // Bind delete buttons with inline confirmation
        msgEl.querySelectorAll('.chat-delete-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.msgId;

            if (btn.dataset.confirming === "true") {
              try {
                await API.deleteChatMessage(id);
                await loadActiveMessages();
                renderChat();
              } catch (err) {
                showToast('Failed to delete message');
              }
              return;
            }

            btn.dataset.confirming = "true";
            btn.innerHTML = "Delete?";
            btn.style.width = "auto";
            btn.style.height = "auto";
            btn.style.borderRadius = "4px";
            btn.style.padding = "2px 6px";
            btn.style.fontSize = "11px";
            btn.style.color = "#dc2626";
            btn.style.borderColor = "#dc2626";
            btn.style.background = "#fef2f2";
            btn.style.whiteSpace = "nowrap";
            btn.title = "Click again to confirm delete";

            setTimeout(() => {
              if (btn.dataset.confirming === "true") {
                btn.dataset.confirming = "false";
                btn.innerHTML = "&times;";
                btn.style.width = "20px";
                btn.style.height = "20px";
                btn.style.borderRadius = "50%";
                btn.style.padding = "0";
                btn.style.fontSize = "12px";
                btn.style.color = "#9ca3af";
                btn.style.borderColor = "var(--border)";
                btn.style.background = "var(--card)";
                btn.style.whiteSpace = "normal";
                btn.title = "Delete message";
              }
            }, 3000);
          });
        });
        msgEl.scrollTop = msgEl.scrollHeight;
      }
    }
  } else {
    if (headerEl) headerEl.style.display = 'none';
    if (inputRow) inputRow.style.display = 'none';
    if (msgEl) msgEl.innerHTML = `<div class="empty-state">Select a conversation</div>`;
  }
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input?.value.trim();
  const myUid = window.CURRENT_USER_UUID;
  if (!text || !state.activeContactUuid || !myUid) return;

  input.value = '';
  try {
    // If conversation doesn't exist yet, find or create one dynamically
    if (!state.activeConversationId) {
      const conv = await API.findOrCreateConversation(myUid, state.activeContactUuid);
      state.activeConversationId = conv.id;
      // Sync it in local state list
      const matched = state.chatConvs.find(c => c.participantUuid === state.activeContactUuid);
      if (matched) matched.conversationId = conv.id;
    }

    await API.sendChatMessage(state.activeConversationId, myUid, text);
    // Refresh fully to reload list & messages
    await loadChatData();
  } catch (err) {
    showToast('Failed to send message. Check your connection.');
    console.error('[Chat] sendChatMessage error:', err);
  }
}



/* ---------- Timetable ---------- */
function renderTimetable() {
  const slots = state.scheduleSlots;
  const container = document.getElementById("timetable-content");

  if (!slots || slots.length === 0) {
    container.innerHTML = `<div class="card" style="padding:2rem;text-align:center"><p class="empty-state">No classes scheduled yet.</p></div>`;
    return;
  }

  let minH = 23, maxH = 0;
  slots.forEach(s => {
    if (s.startH < minH) minH = s.startH;
    if (s.endH > maxH) maxH = s.endH;
  });
  minH = Math.max(0, minH);
  maxH = Math.min(24, maxH);
  const hours = [];
  for (let h = minH; h <= maxH; h++) hours.push(h);

  const sorted = [...slots].sort((a, b) => timeToMinutes(a.startH, a.startM) - timeToMinutes(b.startH, b.startM));
  const columns = [];
  sorted.forEach(slot => {
    const slotStart = timeToMinutes(slot.startH, slot.startM);
    let placed = false;
    for (let col = 0; col < columns.length; col++) {
      const lastInCol = columns[col][columns[col].length - 1];
      const lastEnd = timeToMinutes(lastInCol.endH, lastInCol.endM);
      if (slotStart >= lastEnd) { columns[col].push(slot); placed = true; break; }
    }
    if (!placed) columns.push([slot]);
  });
  const totalCols = columns.length;
  const slotColMap = {};
  columns.forEach((col, colIdx) => col.forEach(s => { slotColMap[s.id] = colIdx; }));

  const totalHeight = (maxH - minH) * 80;

  let hoursHTML = hours.map(h => `
    <div style="height:80px;display:flex;align-items:flex-start;justify-content:flex-end;padding-right:0.75rem;padding-top:0.25rem;font-size:0.75rem;font-weight:600;color:#6b7280;border-bottom:1px solid #f3f4f6">
      ${fmtTime(h, 0)}
    </div>
  `).join("");

  let gridLines = hours.map(h => `<div style="position:absolute;top:${(h - minH) * 80}px;left:0;right:0;height:1px;background:#f3f4f6"></div>`).join("");

  let slotsHTML = sorted.map(slot => {
    const startMin = timeToMinutes(slot.startH, slot.startM) - minH * 60;
    const endMin = timeToMinutes(slot.endH, slot.endM) - minH * 60;
    const top = (startMin / 60) * 80;
    const height = Math.max(((endMin - startMin) / 60) * 80 - 4, 28);
    const col = slotColMap[slot.id];
    const leftPct = (col / totalCols) * 100;
    const widthPct = (1 / totalCols) * 100;
    return `<div style="position:absolute;top:${top + 2}px;left:calc(${leftPct}% + 4px);width:calc(${widthPct}% - 8px);height:${height}px;background:${slot.color};border-radius:0.5rem;padding:0.5rem 0.75rem;color:#fff;overflow:hidden;display:flex;flex-direction:column;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.15);font-size:0.8125rem">
      <div style="font-weight:700;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(slot.className)}</div>
      <div style="font-size:0.6875rem;opacity:0.85;margin-top:2px">${fmtTime(slot.startH, slot.startM)} - ${fmtTime(slot.endH, slot.endM)}</div>
    </div>`;
  }).join("");

  container.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden">
      <div style="display:flex;position:relative;min-height:${totalHeight}px">
        <div style="width:80px;flex-shrink:0;border-right:1px solid #e5e7eb;background:#fafafa">${hoursHTML}</div>
        <div style="flex:1;position:relative;min-height:${totalHeight}px">${gridLines}${slotsHTML}</div>
      </div>
    </div>`;
}

/* ============================================================
   Event Binding — moved to individual dashboard HTML files
   (employee-dashboard.html and hr-dashboard.html each have their
   own local initApp() that handles event binding after auth)
   ============================================================ */


/* ============================================================
   Employee Analytics (HR)
   ============================================================ */

/* Parse a time string in any supported format to {h, m} */
function parseAnyTime(t) {
  if (!t) return null;
  const s = String(t).trim();
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) {
    const p = s.split(':');
    return { h: parseInt(p[0], 10), m: parseInt(p[1], 10) };
  }
  const ap = parseAMPMTime(s);
  if (ap) return ap;
  const p2 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (p2) return { h: parseInt(p2[1], 10), m: parseInt(p2[2], 10) };
  return null;
}

function hoursBetween(ci, co) {
  const a = parseAnyTime(ci), b = parseAnyTime(co);
  if (!a || !b) return 0;
  let mins = (b.h * 60 + b.m) - (a.h * 60 + a.m);
  if (mins < 0) mins += 24 * 60; // overnight shift wraps to next day
  return Math.round((mins / 60) * 10) / 10;
}

function isValidCheckIn(t) {
  return t && t !== "--:--" && t !== "12:00 AM" && t !== "Invalid Date" && t !== "00:00:00";
}

function getLast4Months() {
  const now = new Date();
  const arr = [];
  for (let i = 0; i < 4; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  return arr;
}

function getAttendanceRecordForDate(empid, dateStr) {
  let r = (state.monthlyAttendance || []).find(a => a.employeeId === empid && a.date === dateStr);
  if (!r) r = (state.last6Months || []).find(a => a.employeeId === empid && a.date === dateStr);
  if (!r) r = (state.attendance || []).find(a => a.employeeId === empid && a.date === dateStr);
  return r || null;
}

/* Build a day-by-day record set for an employee & month (within eligible range) */
function computeMonthDayRecords(empid, year, month) {
  const now = new Date();
  const isCurrent = (year === now.getFullYear() && month === now.getMonth());
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const eligible = isCurrent ? Math.min(now.getDate(), daysInMonth) : daysInMonth;

  const records = [];
  for (let day = 1; day <= eligible; day++) {
    const d = new Date(year, month, day);
    const dateStr = iso(d);
    const r = getAttendanceRecordForDate(empid, dateStr);
    const ci = r ? r.checkIn : null;
    const co = r ? r.checkOut : null;
    const hasCI = isValidCheckIn(ci);
    const hasCO = isValidCheckIn(co);

    let status = "absent";
    let hours = 0;
    const punches = (r && Array.isArray(r.punches)) ? r.punches : [];

    if (hasCI) {
      status = (r.status === "Late") ? "late" : "present";
      if (r.overtime && Number(r.overtime) > 0) {
        hours = Number(r.overtime);
      } else if (hasCO) {
        hours = hoursBetween(ci, co);
      }
    }

    records.push({
      dateStr, day,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      status,
      checkIn: hasCI ? ci : null,
      checkOut: hasCO ? co : null,
      hours, punches
    });
  }
  return { records, eligible, isCurrent, daysInMonth };
}

function computeMonthStats(empid, year, month) {
  const { records, eligible, isCurrent } = computeMonthDayRecords(empid, year, month);
  let present = 0, late = 0, absent = 0, totalHours = 0, totalPunches = 0;

  records.forEach(r => {
    if (r.status === "absent") {
      absent++;
    } else {
      if (r.status === "late") late++;
      present++;
      totalHours += r.hours;
      totalPunches += r.punches.length;
    }
  });

  const pct = eligible ? Math.round((present / eligible) * 100) : 0;
  const avgHours = present ? Math.round((totalHours / present) * 10) / 10 : 0;

  return {
    present, absent, late,
    totalHours: Math.round(totalHours * 10) / 10,
    totalPunches, pct, avgHours,
    eligible, isCurrent, records
  };
}

/* Build day-by-day records for an arbitrary list of dates (may span months) */
function buildDayRecordsForDates(empid, dates) {
  return dates.map(d => {
    const dateStr = iso(d);
    const r = getAttendanceRecordForDate(empid, dateStr);
    const ci = r ? r.checkIn : null;
    const co = r ? r.checkOut : null;
    const hasCI = isValidCheckIn(ci);
    const hasCO = isValidCheckIn(co);

    let status = "absent";
    let hours = 0;
    const punches = (r && Array.isArray(r.punches)) ? r.punches : [];

    if (hasCI) {
      status = (r.status === "Late") ? "late" : "present";
      if (r.overtime && Number(r.overtime) > 0) {
        hours = Number(r.overtime);
      } else if (hasCO) {
        hours = hoursBetween(ci, co);
      }
    }

    return {
      dateStr, day: d.getDate(),
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      status,
      checkIn: hasCI ? ci : null,
      checkOut: hasCO ? co : null,
      hours, punches
    };
  });
}

/* Render the HTML for a Date/Check-in/Check-out/Punch/Hours table body (HR format) */
function dayRecordsTableHTML(recs) {
  if (!recs || recs.length === 0) {
    return `<tr><td colspan="5" class="empty-state">No attendance records.</td></tr>`;
  }
  return recs.map(r => {
    const punchHTML = r.punches.length
      ? r.punches.map(p => `<div>${formatPunchTime(p.in)} → ${formatPunchTime(p.out)}</div>`).join("")
      : '<span style="color:#9ca3af">—</span>';

    const statusBadge = r.status === "absent"
      ? '<span class="badge absent">Absent</span>'
      : (r.status === "late" ? '<span class="badge warning">Late</span>' : '<span class="badge success">Present</span>');

    return `<tr>
      <td>${formatDate(r.dateStr)} ${statusBadge}</td>
      <td>${r.checkIn || "—"}</td>
      <td>${r.checkOut || "—"}</td>
      <td>${punchHTML}</td>
      <td>${r.status === "absent" ? "—" : r.hours + "h"}</td>
    </tr>`;
  }).join("");
}

/* Last 7 calendar days table on the employee dashboard.
   Falls back to last-6-months data when the current month has fewer elapsed days. */
function renderLast7DaysTable() {
  const tbody = document.getElementById("emp-last7-tbody");
  if (!tbody) return;

  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d);
  }
  const recs = buildDayRecordsForDates(window.CURRENT_USER_ID, dates);
  tbody.innerHTML = dayRecordsTableHTML(recs);
}

function statCardClickable(stat, label, value, hint, accent = "primary") {
  const trendIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`;
  return `<div class="card stat-card clickable" data-stat="${stat}">
    <div class="stat-card-top">
      <div><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>
      <div class="stat-icon ${accent}">${trendIcon}</div>
    </div>
    ${hint ? `<div class="stat-hint">${hint}</div>` : ""}
    <div class="stat-click-hint">Click for details →</div>
  </div>`;
}

function renderEmployeeAnalytics() {
  const grid = document.getElementById("analytics-employee-grid");
  if (!grid) return;

  grid.innerHTML = employees.map(emp => `
    <div class="card employee-card analytics-emp-box" data-emp-id="${emp.id}">
      <div class="employee-card-head">
        ${avatarHTML(emp.name, "lg")}
        <div>
          <div class="name">${escapeHtml(emp.name)}</div>
          <div class="title">${escapeHtml(emp.title)}</div>
        </div>
      </div>
      <div class="divider"></div>
      <div class="meta-line"><span>${escapeHtml(emp.department)}</span></div>
      <div class="meta-line"><span>ID: ${escapeHtml(emp.id)}</span></div>
      <div style="margin-top:1rem">${badgeHTML(emp.status)}</div>
    </div>
  `).join("");

  grid.querySelectorAll(".analytics-emp-box").forEach(card => {
    card.addEventListener("click", () => {
      window.location.href = `hr-attendance.html?emp=${encodeURIComponent(card.dataset.empId)}`;
    });
  });

  if (state.analytics.selectedEmpId) {
    renderAnalyticsDetail();
  } else {
    const detail = document.getElementById("analytics-detail");
    if (detail) detail.style.display = "none";
  }
}

function initAnalytics() {
  document.getElementById("analytics-back-btn")?.addEventListener("click", () => {
    state.analytics.selectedEmpId = null;
    const detail = document.getElementById("analytics-detail");
    if (detail) detail.style.display = "none";
  });

  document.getElementById("analytics-view-tabs")?.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      state.analytics.view = btn.dataset.view;
      renderAnalyticsDetail();
    });
  });
}

function selectAnalyticsEmployee(empid) {
  state.analytics.selectedEmpId = empid;
  state.analytics.monthIndex = 0;
  state.analytics.view = "statistics";
  const detail = document.getElementById("analytics-detail");
  if (detail) detail.style.display = "block";
  renderAnalyticsDetail();
}

function renderAnalyticsDetail() {
  const empid = state.analytics.selectedEmpId;
  if (!empid) return;

  const emp = getEmployee(empid);
  const avatarEl = document.getElementById("analytics-emp-avatar");
  const nameEl = document.getElementById("analytics-emp-name");
  const metaEl = document.getElementById("analytics-emp-meta");
  if (avatarEl) avatarEl.textContent = getInitials(emp.name);
  if (nameEl) nameEl.textContent = emp.name;
  if (metaEl) metaEl.textContent = `ID: ${emp.id} · ${emp.department}`;

  const months = getLast4Months();

  // Month tabs
  const tabsEl = document.getElementById("analytics-month-tabs");
  if (tabsEl) {
    tabsEl.innerHTML = months.map((m, i) => {
      const label = `${MONTH_NAMES[m.month]} ${String(m.year).slice(2)}`;
      return `<button class="month-tab ${i === state.analytics.monthIndex ? 'active' : ''}" data-month-index="${i}">${label}</button>`;
    }).join("");
    tabsEl.querySelectorAll(".month-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        state.analytics.monthIndex = parseInt(btn.dataset.monthIndex, 10);
        renderAnalyticsDetail();
      });
    });
  }

  // View tabs
  const vt = document.getElementById("analytics-view-tabs");
  if (vt) vt.querySelectorAll("button").forEach(b => {
    b.classList.toggle("active", b.dataset.view === state.analytics.view);
  });

  const m = months[state.analytics.monthIndex];
  const stats = computeMonthStats(empid, m.year, m.month);
  state.analytics.dayRecords = stats.records;
  state.analytics.monthMeta = { year: m.year, month: m.month, isCurrent: stats.isCurrent, label: `${MONTH_NAMES[m.month]} ${m.year}` };

  const showStats = state.analytics.view === "statistics";
  const showCal = state.analytics.view === "calendar";
  const showTable = state.analytics.view === "table";

  const statsEl = document.getElementById("analytics-statistics-view");
  const calEl = document.getElementById("analytics-calendar-view");
  const tableEl = document.getElementById("analytics-table-view");
  if (statsEl) statsEl.style.display = showStats ? "block" : "none";
  if (calEl) calEl.style.display = showCal ? "block" : "none";
  if (tableEl) tableEl.style.display = showTable ? "block" : "none";

  if (showStats) renderAnalyticsStats(stats);
  if (showCal) renderAnalyticsCalendar(empid, m.year, m.month);
  if (showTable) renderAnalyticsTable(stats);
}

function renderAnalyticsStats(stats) {
  const el = document.getElementById("analytics-statistics-view");
  if (!el) return;
  const range = stats.isCurrent ? `of first ${stats.eligible} days` : `of ${stats.eligible} days`;

  el.innerHTML = `
    <div class="stats-grid cols-4" style="margin-top:1rem">
      ${statCardClickable("present", "Present", `${stats.present}/${stats.eligible}`, range, "chart5")}
      ${statCardClickable("absent", "Absent", `${stats.absent}/${stats.eligible}`, range, "chart3")}
      ${statCardHTML("Attendance %", `${stats.pct}%`, "Present / eligible days", "primary")}
      ${statCardClickable("hours", "Total Hours", `${stats.totalHours}`, "across present days", "accent")}
    </div>
    <div class="stats-grid cols-3" style="margin-top:1rem">
      ${statCardClickable("late", "Late Arrivals", `${stats.late}`, "after 11:00 AM", "chart3")}
      ${statCardClickable("punches", "Total Punches", `${stats.totalPunches}`, "multiple logins", "chart5")}
      ${statCardHTML("Avg Hours / Day", `${stats.avgHours}`, "on present days", "primary")}
    </div>
    <div id="analytics-stat-detail" class="analytics-stat-detail"></div>
  `;

  el.querySelectorAll(".stat-card.clickable").forEach(card => {
    card.addEventListener("click", () => showAnalyticsStatDetail(card.dataset.stat, stats));
  });
}

function statRowHTML(r) {
  const badge = r.status === "late"
    ? '<span class="badge warning">Late</span>'
    : '<span class="badge success">Present</span>';
  return `<div class="analytics-detail-row">
    <span>${formatDate(r.dateStr)}</span>
    <span>${r.checkIn || '—'} → ${r.checkOut || '—'} ${badge}</span>
  </div>`;
}

function showAnalyticsStatDetail(stat, stats) {
  const panel = document.getElementById("analytics-stat-detail");
  if (!panel) return;

  const presentRecs = stats.records.filter(r => r.status === "present" || r.status === "late");
  let title = "";
  let rows = [];

  if (stat === "present") {
    title = `Present Days (${presentRecs.length})`;
    rows = presentRecs.map(statRowHTML);
  } else if (stat === "absent") {
    title = `Absent Days (${stats.absent})`;
    rows = stats.records.filter(r => r.status === "absent").map(r =>
      `<div class="analytics-detail-row"><span>${formatDate(r.dateStr)}</span><span class="badge absent">Absent</span></div>`
    );
  } else if (stat === "late") {
    title = `Late Arrivals (${stats.late})`;
    rows = stats.records.filter(r => r.status === "late").map(statRowHTML);
  } else if (stat === "hours") {
    title = `Hours Worked Breakdown (${stats.totalHours}h total)`;
    rows = presentRecs.map(r =>
      `<div class="analytics-detail-row"><span>${formatDate(r.dateStr)}</span><span><b>${r.hours}h</b> · ${r.checkIn} → ${r.checkOut}</span></div>`
    );
  } else if (stat === "punches") {
    title = `Punch (Login) Details (${stats.totalPunches} total)`;
    rows = presentRecs.map(r => {
      const p = r.punches.length
        ? r.punches.map(x => `${formatPunchTime(x.in)} → ${formatPunchTime(x.out)}`).join('<br>')
        : '—';
      return `<div class="analytics-detail-row"><span>${formatDate(r.dateStr)}</span><span>${p}</span></div>`;
    });
  }

  panel.innerHTML = `<div class="analytics-detail-card">
    <div class="analytics-detail-title">${title}</div>
    ${rows.join("") || '<div class="empty-state">No records.</div>'}
  </div>`;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderAnalyticsCalendar(empid, year, month) {
  const todayDateStr = iso(new Date());
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let presentCount = 0, lateCount = 0, absentCount = 0;

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let calHTML = dayNames.map(d => `<div class="att-cal-day-header">${d}</div>`).join("");

  for (let i = 0; i < firstDay; i++) calHTML += `<div class="att-cal-cell empty"></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const dateStr = iso(d);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const isToday = dateStr === todayDateStr;

    let statusClass = "", statusText = "", checkInStr = "", checkOutStr = "";

    const r = getAttendanceRecordForDate(empid, dateStr);
    const hasCI = r && isValidCheckIn(r.checkIn);
    const hasCO = r && isValidCheckIn(r.checkOut);

    if (hasCI || hasCO) {
      checkInStr = hasCI ? r.checkIn : "—";
      checkOutStr = hasCO ? r.checkOut : "—";
      statusClass = (r.status === "Late") ? "cal-late" : "cal-present";
      statusText = (r.status === "Late") ? "Late" : "Present";
      if (statusClass === "cal-late") lateCount++; else presentCount++;
    } else if (r) {
      statusClass = "cal-absent";
      statusText = "Absent";
      absentCount++;
    }

    const cellClass = ["att-cal-cell", statusClass, isWeekend ? "weekend" : "", isToday ? "today" : ""]
      .filter(Boolean).join(" ");

    calHTML += `
      <div class="${cellClass}">
        <div class="att-cal-cell-top">
          <span class="att-cal-date">${day}</span>
          ${statusText ? `<span class="att-cal-badge ${statusClass.replace('cal-', '')}">${statusText}</span>` : ""}
        </div>
        ${checkInStr ? `<div class="att-cal-time"><span class="att-cal-checkin">${checkInStr}</span><span class="att-cal-sep">→</span><span class="att-cal-checkout">${checkOutStr}</span></div>` : ""}
      </div>`;
  }

  const totalCells = firstDay + daysInMonth;
  const rem = totalCells % 7;
  if (rem > 0) for (let i = 0; i < (7 - rem); i++) calHTML += `<div class="att-cal-cell empty"></div>`;

  const grid = document.getElementById("analytics-cal-grid");
  if (grid) grid.innerHTML = calHTML;

  const summaryEl = document.getElementById("analytics-cal-summary");
  if (summaryEl) {
    const totalMarked = presentCount + lateCount + absentCount;
    const rate = totalMarked ? Math.round(((presentCount + lateCount) / totalMarked) * 100) : 0;
    summaryEl.innerHTML = `
      <span class="att-cal-stat"><span class="dot" style="background:#10b981"></span>Present <b>${presentCount}</b></span>
      <span class="att-cal-stat"><span class="dot" style="background:#f59e0b"></span>Late <b>${lateCount}</b></span>
      <span class="att-cal-stat"><span class="dot" style="background:#ef4444"></span>Absent <b>${absentCount}</b></span>
      <span class="att-cal-stat">Attendance <b>${rate}%</b></span>`;
  }
}

function renderAnalyticsTable(stats) {
  const tbody = document.getElementById("analytics-table-body");
  if (!tbody) return;

  const recs = stats.records;
  if (recs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No attendance records.</td></tr>`;
    return;
  }

  tbody.innerHTML = recs.map(r => {
    const punchHTML = r.punches.length
      ? r.punches.map(p => `<div>${formatPunchTime(p.in)} → ${formatPunchTime(p.out)}</div>`).join("")
      : '<span style="color:#9ca3af">—</span>';

    const statusBadge = r.status === "absent"
      ? '<span class="badge absent">Absent</span>'
      : (r.status === "late" ? '<span class="badge warning">Late</span>' : '<span class="badge success">Present</span>');

    return `<tr>
      <td>${formatDate(r.dateStr)} ${statusBadge}</td>
      <td>${r.checkIn || "—"}</td>
      <td>${r.checkOut || "—"}</td>
      <td>${punchHTML}</td>
      <td>${r.status === "absent" ? "—" : r.hours + "h"}</td>
    </tr>`;
  }).join("");
}

/* ---------- Toggle button style helper ---------- */
function updateChartToggleStyles(prefix, activeValue) {
  const activeStyle = { background: "#ffffff", color: "#111827", boxShadow: "0 1px 2px rgba(0,0,0,0.1)" };
  const inactiveStyle = { background: "transparent", color: "#6b7280", boxShadow: "none" };

  if (prefix === "pie-mode") {
    applyToggleStyle("pie-mode-week", activeValue === "Week" ? activeStyle : inactiveStyle);
    applyToggleStyle("pie-mode-month", activeValue === "Month" ? activeStyle : inactiveStyle);
  }
  if (prefix === "hours-mode") {
    applyToggleStyle("hours-mode-bar", activeValue === "Bar" ? activeStyle : inactiveStyle);
    applyToggleStyle("hours-mode-line", activeValue === "Line" ? activeStyle : inactiveStyle);
  }
}

function applyToggleStyle(id, styles) {
  const el = document.getElementById(id);
  if (!el) return;
  Object.assign(el.style, styles);
}

/* ---------- Supabase Sync & Profile Helpers ---------- */
async function syncEmployeesFromSupabase() {
  try {
    const profiles = await API.fetchAllProfiles();
    if (!profiles || profiles.length === 0) return;

    // Fetch extra details from new employee_details table
    let detailsMap = {};
    try {
      const { data: details } = await supabaseClient.from('employee_details').select('*');
      if (details) {
        details.forEach(d => detailsMap[d.empid] = d);
      }
    } catch (e) {
      console.warn("Could not fetch employee_details, table might not exist yet", e);
    }

    const syncedList = profiles.map(p => {
      const mock = employees.find(e => e.id === p.empid);
      const det = detailsMap[p.empid] || {};

      return {
        id: p.empid,
        name: p.name,
        title: det.designation || mock?.title || (p.role === 'hr' ? 'HR Manager' : 'CAD Trainer'),
        description: det.description || mock?.about || 'Employee profile stored in system.',
        department: det.department || p.department || 'Training',
        email: det.email || p.email || `${p.empid}@caddtech.com`,
        phone: det.phone || p.phone || '+91 99001 22334',
        branch: det.branch || null,
        location: det.location || p.location || 'Bengaluru',
        manager: mock ? mock.manager : 'Priya Nair',
        joinDate: det.join_date || p.join_date || '2024-01-01',
        employmentType: det.employment_type || p.employment_type || 'Full-time',
        status: mock ? mock.status : 'Active',
        about: det.description || mock?.about || 'Employee profile stored in system.',
        shiftCheckin: p.shift_checkin || null,
        shiftCheckout: p.shift_checkout || null
      };
    });

    employees.length = 0;
    employees.push(...syncedList);
  } catch (err) {
    console.error("Failed to sync employees from database:", err);
  }
}

/* ---------- Custom-capable selects (branch / department) ---------- */
const CUSTOM_OPTION = "__custom__";

function setupCustomSelect(selectId, inputId) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(inputId);
  if (!sel || !inp) return;
  if (sel._customBound) return;
  sel._customBound = true;
  const toggle = () => { inp.style.display = sel.value === CUSTOM_OPTION ? "block" : "none"; };
  sel.addEventListener("change", toggle);
  toggle();
}

function getCustomValue(selectId, inputId) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(inputId);
  if (!sel) return "";
  if (sel.value === CUSTOM_OPTION && inp) return inp.value.trim();
  return sel.value;
}

function addExtraOptions(selectId, values) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const customOpt = sel.querySelector(`option[value="${CUSTOM_OPTION}"]`);
  values.forEach(v => {
    if (!v) return;
    const exists = Array.from(sel.options).some(o => o.value === v);
    if (!exists) {
      const opt = document.createElement("option");
      opt.value = v; opt.textContent = v;
      if (customOpt) sel.insertBefore(opt, customOpt);
      else sel.appendChild(opt);
    }
  });
}

/* Pull previously-saved custom branches/departments from other employees */
async function loadCustomOptionsFromDb() {
  try {
    const { data } = await supabaseClient.from("employee_details").select("branch, department");
    if (!data) return;
    const branches = new Set(), depts = new Set();
    data.forEach(d => { if (d.branch) branches.add(d.branch); if (d.department) depts.add(d.department); });
    addExtraOptions("profile-branch", branches);
    addExtraOptions("profile-dept", depts);
  } catch (e) { /* employee_details may not exist yet */ }
}

function renderProfile() {
  const me = getEmployee(CURRENT_USER_ID);
  if (!me) return;
  
  const empIdEl = document.getElementById("profile-empid");
  const nameEl = document.getElementById("profile-name");
  const emailEl = document.getElementById("profile-email");
  const phoneEl = document.getElementById("profile-phone");
  const deptEl = document.getElementById("profile-dept");
  const locEl = document.getElementById("profile-location");
  const branchEl = document.getElementById("profile-branch");
  const joinedEl = document.getElementById("profile-joined");
  const empTypeEl = document.getElementById("profile-employment");
  const desigEl = document.getElementById("profile-designation");
  const descEl = document.getElementById("profile-description");

  if (empIdEl) empIdEl.value = me.id || "";
  if (nameEl) nameEl.value = me.name || "";
  if (emailEl) emailEl.value = me.email || "";
  if (phoneEl) phoneEl.value = me.phone || "";
  if (deptEl) deptEl.value = me.department || "Training";
  if (locEl) locEl.value = me.location || "";
  if (branchEl) branchEl.value = me.branch || "Avadi";
  if (desigEl) desigEl.value = me.title || "";
  if (descEl) descEl.value = me.description || me.about || "";

  // Bring in any custom branches/departments previously saved by others
  loadCustomOptionsFromDb().then(() => {
    if (deptEl && me.department && !Array.from(deptEl.options).some(o => o.value === me.department)) {
      const opt = document.createElement("option"); opt.value = me.department; opt.textContent = me.department;
      deptEl.insertBefore(opt, deptEl.querySelector(`option[value="${CUSTOM_OPTION}"]`));
      deptEl.value = me.department;
    }
    if (branchEl && me.branch && !Array.from(branchEl.options).some(o => o.value === me.branch)) {
      const opt = document.createElement("option"); opt.value = me.branch; opt.textContent = me.branch;
      branchEl.insertBefore(opt, branchEl.querySelector(`option[value="${CUSTOM_OPTION}"]`));
      branchEl.value = me.branch;
    }
  });

  setupCustomSelect("profile-dept", "profile-dept-custom");
  setupCustomSelect("profile-branch", "profile-branch-custom");
  
  if (joinedEl) {
    if (me.joinDate) {
      try {
        const d = new Date(me.joinDate);
        if (!isNaN(d.getTime())) {
          joinedEl.value = d.toISOString().split("T")[0];
        } else {
          joinedEl.value = me.joinDate;
        }
      } catch(e) {
        joinedEl.value = "";
      }
    } else {
      joinedEl.value = "";
    }
  }
  
  if (empTypeEl) empTypeEl.value = me.employmentType || "Full-time";
}

async function saveProfile(e) {
  e.preventDefault();
  const saveBtn = document.getElementById("profile-save-btn");
  const saveText = document.getElementById("profile-save-text");
  if (!saveBtn || !saveText) return;

  saveBtn.disabled = true;
  saveText.textContent = "Saving...";

  const email = document.getElementById("profile-email").value.trim();
  const phone = document.getElementById("profile-phone").value.trim();
  const dept = getCustomValue("profile-dept", "profile-dept-custom");
  const location = document.getElementById("profile-location").value;
  const branch = getCustomValue("profile-branch", "profile-branch-custom");
  const joined = document.getElementById("profile-joined").value;
  const employment = document.getElementById("profile-employment").value;
  const designation = document.getElementById("profile-designation")?.value.trim() || "";
  const description = document.getElementById("profile-description")?.value.trim() || "";

  if (!dept) { alert("Please select or type a department."); saveBtn.disabled = false; saveText.textContent = "Save Changes"; return; }

  try {
    const user = await Session.getUser();
    if (!user) throw new Error("No user session found");

    // Upsert into employee_details table
    const { data, error } = await supabaseClient
      .from('employee_details')
      .upsert({
        empid: CURRENT_USER_ID,
        designation: designation,
        description: description,
        email: email,
        phone: phone,
        department: dept,
        branch: branch || null,
        location: location || null,
        join_date: joined || null,
        employment_type: employment
      }, {
        onConflict: 'empid'
      })
      .select();

    if (error) {
      console.error("[saveProfile] Supabase error:", error);
      throw new Error(error.message);
    }

    // Update local employees array so directory shows new info
    const me = employees.find(emp => emp.id === CURRENT_USER_ID);
    if (me) {
      me.email = email;
      me.phone = phone;
      me.department = dept;
      me.branch = branch;
      me.location = location;
      me.joinDate = joined;
      me.employmentType = employment;
      me.title = designation;
      me.description = description;
      me.about = description;
    }

    showToast("✓ Profile updated successfully!");
  } catch(err) {
    console.error("[saveProfile] Error:", err);
    alert("Failed to save profile: " + (err.message || "Unknown error"));
  } finally {
    saveBtn.disabled = false;
    saveText.textContent = "Save Changes";
  }
}

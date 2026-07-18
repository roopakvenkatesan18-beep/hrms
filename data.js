/* CADD Tech HRMS — Data Layer */
// CURRENT_USER_ID is now set dynamically by the dashboard based on the logged-in user.

const _today = new Date();
const iso = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const _daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};
const _daysAhead = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};

const employees = [];

function _seedAttendance() {
  const records = [];
  const sample = ["e1", "e2", "e3", "e5", "e6", "e7"];
  for (let day = 1; day <= 5; day++) {
    for (const empId of sample) {
      const late = Math.random() > 0.8;
      records.push({
        id: `${empId}-${_daysAgo(day)}`,
        employeeId: empId,
        date: _daysAgo(day),
        checkIn: late ? "09:42 AM" : `09:0${(day % 6) + 1} AM`,
        checkOut: `06:1${day % 9} PM`,
        status: late ? "Late" : "Present",
      });
    }
  }
  return records;
}

function seedInitialAttendance() {
  return _seedAttendance();
}

function getInitials(name) {
  return name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

// Escape user-supplied text before inserting into innerHTML (prevents stored XSS)
function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(d) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

function getEmployee(id) {
  return employees.find((e) => e.id === id) || {
    id, name: "Employee " + id, role: "Employee", department: "Unknown",
    saturdayPlan: "every_saturday_work", sundayPlan: "two_sundays_work"
  };
}



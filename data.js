/* CADD Tech HRMS — Data Layer */
// CURRENT_USER_ID is now set dynamically by the dashboard based on the logged-in user.

const iso = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const employees = [];

function getInitials(name) {
  return String(name || "").split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
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
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

function getEmployee(id) {
  return employees.find((e) => e.id === id) || {
    id, name: "Employee " + id, role: "Employee", department: "Unknown",
    saturdayPlan: "every_saturday_work", sundayPlan: "two_sundays_work"
  };
}



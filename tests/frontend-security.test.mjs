import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = ['../data.js', '../app.js'].map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
const payload = '\"><img src=x onerror=alert(1)>';

function createHarness() {
  const elements = new Map();
  const listeners = new Map();
  let exportedBlob;
  const getElement = id => {
    if (!elements.has(id)) {
      const handlers = new Map();
      elements.set(id, {
        innerHTML: '', textContent: '', value: '', style: {}, handlers,
        addEventListener(name, callback) { handlers.set(name, callback); },
        querySelectorAll() { return []; },
        reset() {},
      });
    }
    return elements.get(id);
  };
  const sandbox = {
    window: { location: {} }, console, Blob, payload,
    setTimeout: () => 1, clearTimeout() {},
    URL: {
      createObjectURL(blob) { exportedBlob = blob; return 'blob:test'; },
      revokeObjectURL() {},
    },
    API: { formatTime: value => value, fetchAllProfiles: async () => [] },
    document: {
      addEventListener(name, callback) { listeners.set(name, callback); },
      getElementById: getElement,
      querySelectorAll: () => [],
      createElement: () => ({ click() {} }),
      body: { appendChild() {}, removeChild() {} },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return {
    sandbox, getElement,
    run: code => vm.runInContext(code, sandbox),
    click: dataset => listeners.get('click')({ target: { closest: () => ({ dataset }) } }),
    csv: () => exportedBlob.text(),
  };
}

test('employee-controlled top-performer names remain text in the HR dashboard', () => {
  const harness = createHarness();
  harness.run('state.staffPerformance = [{ id: 1, empid: "employee", staff_name: payload, projects: 999 }]; renderPerformanceAdmin();');
  const summary = harness.getElement('perf-admin-stats').innerHTML;
  assert.ok(summary.includes('&lt;img'));
  assert.ok(summary.includes('999 pts'));
  assert.ok(!summary.includes('<img'));
  assert.ok(!harness.getElement('perf-admin-content').innerHTML.includes('<img'));
});

test('profile names and identifiers never enter executable event attributes', () => {
  const harness = createHarness();
  harness.run('_allProfiles = [{ empid: payload, name: payload, role: "employee" }]; renderRemoveList("");');
  const markup = harness.getElement('re-employee-list').innerHTML;
  assert.ok(markup.includes('data-action="edit-employee"'));
  assert.ok(markup.includes('data-name="&quot;&gt;&lt;img'));
  assert.ok(!markup.includes('<img'));
  assert.ok(!markup.includes('onclick='));
  harness.run('state.role = "admin"; openEditEmployee = (id, name) => { window.received = [id, name]; };');
  harness.click({ action: 'edit-employee', id: payload, name: payload });
  assert.deepEqual(Array.from(harness.sandbox.window.received), [payload, payload]);
});

test('delegated actions reject unauthorized roles, unknown actions, and invalid approval states', () => {
  const harness = createHarness();
  harness.run('window.calls = []; state.role = "employee"; openEditEmployee = () => window.calls.push("edit"); setLeaveStatus = (id, status) => window.calls.push([id, status]);');
  harness.click({ action: 'edit-employee', id: 'employee' });
  assert.equal(harness.sandbox.window.calls.length, 0);
  harness.run('state.role = "admin";');
  harness.click({ action: 'leave-status', id: '1', status: payload });
  harness.click({ action: 'window.calls.push("injected")' });
  assert.equal(harness.sandbox.window.calls.length, 0);
  harness.click({ action: 'leave-status', id: '1', status: 'Approved' });
  assert.deepEqual(Array.from(harness.sandbox.window.calls[0]), ['1', 'Approved']);
  harness.click({ action: 'change-password' });
  assert.equal(harness.sandbox.window.location.href, 'change-password.html');
});

test('malicious schedule fields cannot create elements or escape CSS values', () => {
  const harness = createHarness();
  harness.run('state.scheduleSlots = [{ id: payload, color: payload, className: payload, startH: 9, startM: 0, endH: 10, endM: 0 }]; renderScheduleSlots(); renderTimetable();');
  for (const id of ['schedule-slots', 'timetable-content']) {
    const markup = harness.getElement(id).innerHTML;
    assert.ok(!markup.includes('<img'));
    assert.ok(markup.includes('background:#3b82f6'));
    assert.ok(markup.includes('&lt;img'));
  }
  assert.equal(harness.run('safeScheduleColor("#Aa12Ff")'), '#Aa12Ff');
});

test('attendance renders imported punch strings as text and starts without synthetic records', () => {
  const harness = createHarness();
  assert.equal(harness.run('state.attendance.length'), 0);
  assert.equal(harness.run('employees.length'), 0);
  assert.equal(harness.run('typeof seedInitialAttendance'), 'undefined');
  assert.ok(harness.run('getPerfAttrs().some(attribute => attribute.key === "demo")'));
  const markup = harness.run('dayRecordsTableHTML([{ dateStr: "2026-08-31", status: "present", checkIn: payload, checkOut: payload, hours: 1, punches: [{ in: payload, out: payload }] }])');
  assert.ok(!markup.includes('<img'));
  assert.ok(markup.includes('&lt;img'));
  assert.ok(!harness.run('badgeHTML(payload)').includes('<img'));
  assert.equal(harness.run('formatDate(payload)'), '—');
});

test('CSV exports neutralize formulas while preserving ordinary names and numeric points', async () => {
  const harness = createHarness();
  harness.run('state.staffPerformance = [{ id: 1, empid: "=1+1", staff_name: "=2+2", projects: 5 }, { id: 2, empid: "staff2", staff_name: "Ordinary Name", projects: 3 }]; downloadPerformanceCSV();');
  const csv = await harness.csv();
  assert.ok(csv.includes("'=2+2,'=1+1,5,5"));
  assert.ok(csv.includes('Ordinary Name,staff2,3,3'));
});

test('employee onboarding rejects eleven-character passwords and accepts twelve', async () => {
  const harness = createHarness();
  const created = [];
  harness.sandbox.API.addEmployee = async (...args) => { created.push(args); };
  harness.getElement('ae-empid').value = 'test-employee';
  harness.getElement('ae-name').value = 'Test Employee';
  harness.getElement('ae-role').value = 'hr';
  harness.getElement('ae-dept').value = 'HR';
  harness.getElement('ae-password').value = 'a'.repeat(11);
  await harness.run('renderEmpManagement()');
  const submit = harness.getElement('add-emp-inline-form').handlers.get('submit');
  await submit({ preventDefault() {} });
  assert.equal(created.length, 0);
  assert.match(harness.getElement('ae-error').textContent, /12 characters/);
  harness.getElement('ae-password').value = 'a'.repeat(12);
  await submit({ preventDefault() {} });
  assert.equal(created.length, 1);
  assert.equal(created[0][4].length, 12);
});

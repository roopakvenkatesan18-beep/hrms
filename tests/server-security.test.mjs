import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createServer, readConfig, isPublicKey } from '../server.mjs';

function configuration() {
  return readConfig({
    APP_ORIGIN: 'http://localhost:3000', SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + randomBytes(24).toString('hex'),
    SUPABASE_SERVICE_ROLE_KEY: randomBytes(32).toString('hex'),
    RATE_LIMIT_SECRET: randomBytes(32).toString('hex'), REDIS_URL: 'redis://127.0.0.1:6379'
  });
}

async function fixture(context, options = {}) {
  const config = { ...configuration(), ...options.config };
  const attempts = [];
  const calls = [];
  const logs = [];
  const server = createServer({
    config,
    limiter: options.limiter || { async consume(ip, empid) { attempts.push({ ip, empid }); return { allowed: true }; } },
    fetchImpl: options.fetchImpl || (async (url, request) => {
      calls.push({ url, request });
      return Response.json({ error: 'Invalid credentials' }, { status: 400 });
    }),
    logger: entry => logs.push(entry)
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (path, body, extra = {}) => fetch(base + path, {
    method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify(body)
  });
  return { config, attempts, calls, logs, base, request };
}

test('every HTML response supplies enforcing headers; private files are unreachable', async context => {
  const { base } = await fixture(context);
  for (const path of ['/', '/login.html', '/change-password.html', '/hr-dashboard.html', '/employee-dashboard.html', '/hr-attendance.html', '/unauthorized.html']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    const policy = response.headers.get('content-security-policy');
    assert.match(policy, /frame-ancestors 'self'/);
    assert.match(policy, /script-src-attr 'none'/);
    assert.doesNotMatch(policy.split(';').find(part => part.trim().startsWith('script-src ')), /unsafe-inline|https:/);
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.match(response.headers.get('permissions-policy'), /camera=\(\)/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const path of ['/.env', '/.git/config', '/server.mjs', '/setup/auth_user_management.sql', '/HRMS_Architecture.docx', '/js/demo.js', '/node_modules/redis/package.json', '/%2e%2e/.env']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test('runtime configuration cannot leak server secrets', async context => {
  const { base, config } = await fixture(context);
  const response = await fetch(base + '/js/config.js');
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.ok(text.includes(config.publicKey));
  assert.ok(!text.includes(config.serviceRoleKey));
  assert.ok(!text.includes(config.rateLimitSecret));
  assert.ok(!text.includes(config.redisUrl));
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('login ignores forged proxy IP and normalizes account identity', async context => {
  const { request, attempts, calls, logs } = await fixture(context);
  const password = randomBytes(18).toString('hex');
  const response = await request('/api/login', { empid: ' EmP_01 ', password }, { 'X-Forwarded-For': '203.0.113.8' });
  assert.equal(response.status, 401);
  assert.deepEqual(attempts, [{ ip: '127.0.0.1', empid: 'emp_01' }]);
  assert.equal(calls[0].url, 'https://example.supabase.co/auth/v1/token?grant_type=password');
  assert.equal(calls[0].request.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].request.body), { email: 'emp_01@caddtech.com', password });
  assert.ok(!JSON.stringify(logs).includes(password));
  assert.ok(!JSON.stringify(logs).includes('emp_01'));
});

test('blocked login returns real HTTP 428 before authentication; other routes unaffected', async context => {
  let consumed = 0;
  const { request, base, calls } = await fixture(context, {
    limiter: { async consume() { consumed++; return { allowed: false, retryAfterMs: 899001 }; } }
  });
  const response = await request('/api/login', { empid: '0002', password: randomBytes(18).toString('hex') });
  assert.equal(response.status, 428);
  assert.equal(response.headers.get('retry-after'), '900');
  assert.equal(calls.length, 0);
  assert.equal((await fetch(base + '/login.html')).status, 200);
  assert.equal((await request('/api/employees', {})).status, 401);
  assert.equal(consumed, 1);
});

test('login fails closed when shared limiter fails', async context => {
  const { request, calls } = await fixture(context, { limiter: { async consume() { throw new Error('offline'); } } });
  assert.equal((await request('/api/login', { empid: '0002', password: randomBytes(18).toString('hex') })).status, 503);
  assert.equal(calls.length, 0);
});

test('only an explicitly trusted proxy can supply one client IP', async context => {
  const { request, attempts } = await fixture(context, { config: { trustedProxyIps: ['127.0.0.1'] } });
  const body = { empid: '0002', password: randomBytes(18).toString('hex') };
  assert.equal((await request('/api/login', body)).status, 400);
  assert.equal((await request('/api/login', body, { 'X-Forwarded-For': '203.0.113.8, 203.0.113.9' })).status, 400);
  assert.equal((await request('/api/login', body, { 'X-Forwarded-For': '203.0.113.8' })).status, 401);
  assert.deepEqual(attempts, [{ ip: '203.0.113.8', empid: '0002' }]);
});

test('origin, content type, body and method restrictions precede upstream access', async context => {
  const { request, base, calls } = await fixture(context);
  assert.equal((await request('/api/login', {}, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await request('/api/login', {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await request('/api/login', { padding: 'x'.repeat(9000) })).status, 413);
  assert.equal((await fetch(base + '/api/login')).status, 405);
  assert.equal(calls.length, 0);
});

test('server accepts successful token exchange without leaking full user metadata', async context => {
  const tokens = { access_token: randomBytes(32).toString('hex'), refresh_token: randomBytes(32).toString('hex') };
  const { request } = await fixture(context, { fetchImpl: async () => Response.json({ ...tokens, user: { id: 'test-user', private_metadata: 'hidden' } }) });
  const response = await request('/api/login', { empid: '0002', password: randomBytes(18).toString('hex') });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), tokens);
});

test('direct upstream throttling is preserved as HTTP 428', async context => {
  const { request } = await fixture(context, { fetchImpl: async () => Response.json({ error: 'Limited' }, { status: 428 }) });
  const response = await request('/api/login', { empid: '0002', password: randomBytes(18).toString('hex') });
  assert.equal(response.status, 428);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
});

test('employee cannot invoke privileged Auth creation using editable metadata', async context => {
  const userId = '00000000-0000-4000-8000-000000000002';
  const destinations = [];
  const { request } = await fixture(context, { fetchImpl: async url => {
    destinations.push(url);
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId, user_metadata: { role: 'hr' } });
    return Response.json([{ id: userId, role: 'employee' }]);
  } });
  assert.equal((await request('/api/employees', {}, { Authorization: 'Bearer test-token' })).status, 403);
  assert.ok(destinations.every(url => !url.includes('/admin/')));
});

test('configuration rejects SSRF destinations and service-role browser keys', () => {
  for (const role of ['service_role', 'authenticated']) {
    assert.equal(isPublicKey('header.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.signature'), false);
  }
  assert.equal(isPublicKey('sb_secret_' + randomBytes(24).toString('hex')), false);
  for (const url of ['http://example.supabase.co', 'https://localhost', 'https://example.supabase.co.attacker.example', 'https://example.supabase.co/other']) {
    assert.throws(() => readConfig({ SUPABASE_URL: url, APP_ORIGIN: 'http://localhost:3000', REDIS_URL: 'redis://localhost:6379' }));
  }
});

test('HR provisioning uses Admin API only after verification and caller JWT for database RPCs', async context => {
  const callerId = '00000000-0000-4000-8000-000000000001';
  const newId = '00000000-0000-4000-8000-000000000002';
  const calls = [];
  const { request } = await fixture(context, { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: callerId });
    if (url.includes('/rest/v1/profiles?')) return Response.json([{ id: callerId, role: 'hr' }]);
    if (url.endsWith('/auth/v1/admin/users')) return Response.json({ id: newId });
    return new Response(null, { status: 204 });
  } });
  const response = await request('/api/employees', {
    empid: '0002', name: 'Test Employee', role: 'employee', department: 'Training', password: randomBytes(18).toString('hex')
  }, { Authorization: 'Bearer verified-hr-token' });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { user: { id: newId } });
  const creation = calls.find(call => call.url.endsWith('/auth/v1/admin/users'));
  assert.deepEqual(JSON.parse(creation.options.body).app_metadata, { hrms_managed: true, empid: '0002', role: 'employee' });
  for (const call of calls.filter(call => call.url.includes('/rpc/'))) {
    assert.equal(call.options.headers.Authorization, 'Bearer verified-hr-token');
  }
  assert.ok(calls.some(call => call.url.endsWith('/rpc/ensure_staff_performance')));
});

test('failed profile provisioning rolls back only the newly created Auth user', async context => {
  const callerId = '00000000-0000-4000-8000-000000000001';
  const newId = '00000000-0000-4000-8000-000000000002';
  const deletions = [];
  const { request } = await fixture(context, { fetchImpl: async (url, options) => {
    if (options.method === 'DELETE') { deletions.push(url); return new Response(null, { status: 204 }); }
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: callerId });
    if (url.includes('/rest/v1/profiles?')) return Response.json([{ id: callerId, role: 'hr' }]);
    if (url.endsWith('/auth/v1/admin/users')) return Response.json({ id: newId });
    return Response.json({ error: 'Denied' }, { status: 403 });
  } });
  assert.equal((await request('/api/employees', {
    empid: '0002', name: 'Test Employee', role: 'employee', department: 'Training', password: randomBytes(18).toString('hex')
  }, { Authorization: 'Bearer verified-hr-token' })).status, 503);
  assert.deepEqual(deletions, ['https://example.supabase.co/auth/v1/admin/users/' + newId]);
});

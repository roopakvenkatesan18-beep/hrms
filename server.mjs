import { createServer as createHttpServer } from 'node:http';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLoginLimiter, limiterId } from './server/login-limit.mjs';

const defaultRoot = dirname(fileURLToPath(import.meta.url));
const publicFiles = new Set([
  'index.html', 'login.html', 'change-password.html', 'employee-dashboard.html',
  'hr-dashboard.html', 'hr-attendance.html', 'unauthorized.html',
  'styles.css', 'login-styles.css', 'logo.jpg', 'app.js', 'data.js',
  'js/api.js', 'js/auth.js', 'js/supabase.js', 'js/session.js', 'js/roleGuard.js'
]);
const mimeTypes = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', jpg: 'image/jpeg' };
const vendorFiles = new Map([
  ['vendor/supabase.js', 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'],
  ['vendor/chart.js', 'node_modules/chart.js/dist/chart.umd.js']
]);

export function isPublicKey(key) {
  if (typeof key !== 'string' || key.includes('\n') || key.includes('\r')) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key)) return true;
  try {
    const pieces = key.split('.');
    return pieces.length === 3 && JSON.parse(Buffer.from(pieces[1], 'base64url').toString()).role === 'anon';
  } catch {
    return false;
  }
}

export function readConfig(env = process.env) {
  let supabaseUrl;
  let origin;
  let redisUrl;
  try {
    supabaseUrl = new URL(env.SUPABASE_URL);
    origin = new URL(env.APP_ORIGIN);
    redisUrl = new URL(env.REDIS_URL);
  } catch {
    throw new Error('APP_ORIGIN, SUPABASE_URL and REDIS_URL must be valid URLs');
  }
  if (supabaseUrl.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl.hostname) || supabaseUrl.port || supabaseUrl.username || supabaseUrl.password || supabaseUrl.pathname !== '/' || supabaseUrl.search || supabaseUrl.hash) {
    throw new Error('SUPABASE_URL must be an HTTPS Supabase project origin');
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('APP_ORIGIN must be an HTTP(S) origin');
  if (origin.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Non-local APP_ORIGIN requires HTTPS');
  if (!['redis:', 'rediss:'].includes(redisUrl.protocol)) throw new Error('REDIS_URL must use redis or rediss');
  if (!isPublicKey(env.SUPABASE_PUBLISHABLE_KEY)) throw new Error('SUPABASE_PUBLISHABLE_KEY must be a publishable or legacy anon key');
  if (!env.RATE_LIMIT_SECRET || env.RATE_LIMIT_SECRET.length < 32 || /replace|example|change.?me|your.secret/i.test(env.RATE_LIMIT_SECRET)) throw new Error('RATE_LIMIT_SECRET must be a random secret of at least 32 characters');
  if (env.TRUST_PROXY && env.TRUST_PROXY !== 'false') throw new Error('Proxy header trust is not supported');
  const trustedProxyIps = (env.TRUSTED_PROXY_IPS || '').split(',').map(value => value.trim().replace(/^::ffff:/, '')).filter(Boolean);
  if (trustedProxyIps.some(value => !isIP(value))) throw new Error('TRUSTED_PROXY_IPS must contain exact IP addresses');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid');
  return {
    origin: origin.origin, supabaseUrl: supabaseUrl.origin,
    publicKey: env.SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    redisUrl: redisUrl.href, rateLimitSecret: env.RATE_LIMIT_SECRET,
    host: env.HOST || '127.0.0.1', port, trustedProxyIps
  };
}

export function contentSecurityPolicy(config, html = '') {
  const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(match => !/\bsrc\s*=/i.test(match[1]) && match[2].trim())
    .map(match => `'sha256-${createHash('sha256').update(match[2].replace(/\r\n?/g, '\n')).digest('base64')}'`);
  return [
    "default-src 'self'", `script-src 'self' ${hashes.join(' ')}`,
    "script-src-attr 'none'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "img-src 'self' data: blob:", `connect-src 'self' ${config.supabaseUrl} ${config.supabaseUrl.replace('https:', 'wss:')}`,
    "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'", "form-action 'self'"
  ].join('; ');
}

function headers(response, config, html = '') {
  response.setHeader('Content-Security-Policy', contentSecurityPolicy(config, html));
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  response.setHeader('Cache-Control', 'no-store');
  if (config.origin.startsWith('https:')) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw Object.assign(new Error('JSON required'), { status: 415 });
  if (Number(request.headers['content-length']) > 8192) throw Object.assign(new Error('Body too large'), { status: 413 });
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 8192) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw Object.assign(new Error('Invalid request'), { status: 400 });
  }
}

export function normalizeEmpid(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(normalized) ? normalized : '';
}

export function createServer({ config, limiter, fetchImpl = fetch, rootDir = defaultRoot, logger = event => console.info(JSON.stringify(event)) }) {
  async function upstream(path, { method = 'GET', token, body, admin = false } = {}) {
    const apiKey = admin ? config.serviceRoleKey : config.publicKey;
    const response = await fetchImpl(`${config.supabaseUrl}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { apikey: apiKey, ...(token || admin ? { Authorization: `Bearer ${token || apiKey}` } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return response;
  }

  async function login(request, response) {
    const body = await readJson(request);
    const empid = normalizeEmpid(body.empid);
    let ip = (request.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
    if (config.trustedProxyIps?.includes(ip)) {
      const forwarded = request.headers['x-forwarded-for'];
      if (typeof forwarded !== 'string' || !isIP(forwarded.trim())) return json(response, 400, { error: 'Invalid proxy client address' });
      ip = forwarded.trim().replace(/^::ffff:/, '');
    }
    const eventId = limiterId(config.rateLimitSecret, 'empid', empid || 'invalid');
    let rate;
    try {
      rate = await limiter.consume(ip, empid || 'invalid');
    } catch {
      logger({ event: 'login_store_unavailable', id: eventId });
      json(response, 503, { error: 'Sign-in is temporarily unavailable' });
      return;
    }
    if (!rate.allowed) {
      response.setHeader('Retry-After', Math.max(1, Math.ceil(rate.retryAfterMs / 1000)));
      logger({ event: 'login_throttled', id: eventId });
      json(response, 428, { error: 'Too many login attempts. Please try again later.', retryAfterMs: rate.retryAfterMs });
      return;
    }
    if (!empid || typeof body.password !== 'string' || !body.password || body.password.length > 1024) {
      json(response, 400, { error: 'Invalid Employee ID or password' });
      return;
    }
    const result = await upstream('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: `${empid}@caddtech.com`, password: body.password } });
    if (!result.ok) {
      logger({ event: 'login_failed', id: eventId });
      if (result.status === 428 || result.status === 429) {
        response.setHeader('Retry-After', '900');
        return json(response, 428, { error: 'Too many login attempts. Please try again later.', retryAfterMs: 900000 });
      }
      json(response, result.status >= 500 ? 503 : 401, { error: 'Invalid Employee ID or password' });
      return;
    }
    const session = await result.json();
    if (!session.access_token || !session.refresh_token || !session.user?.id) throw new Error('Invalid authentication response');
    logger({ event: 'login_succeeded', id: eventId });
    json(response, 200, { access_token: session.access_token, refresh_token: session.refresh_token });
  }

  async function createEmployee(request, response) {
    const authorization = request.headers.authorization || '';
    if (!/^Bearer [A-Za-z0-9._-]+$/.test(authorization) || authorization.length > 8192) return json(response, 401, { error: 'Authentication required' });
    const token = authorization.slice(7);
    const verified = await upstream('/auth/v1/user', { token });
    if (!verified.ok) return json(response, 401, { error: 'Authentication required' });
    const caller = await verified.json();
    if (!/^[0-9a-f-]{36}$/i.test(caller.id || '')) return json(response, 401, { error: 'Authentication required' });
    const profileResult = await upstream(`/rest/v1/profiles?id=eq.${encodeURIComponent(caller.id)}&select=id,role&limit=1`, { token });
    if (!profileResult.ok) return json(response, 403, { error: 'HR access required' });
    const profiles = await profileResult.json();
    if (profiles.length !== 1 || profiles[0].id !== caller.id || profiles[0].role !== 'hr') return json(response, 403, { error: 'HR access required' });
    if (!config.serviceRoleKey) return json(response, 503, { error: 'Employee provisioning is not configured' });
    const body = await readJson(request);
    const empid = normalizeEmpid(body.empid);
    const role = body.role || 'employee';
    if (!empid || !/^[a-z0-9]/.test(empid) || !['employee', 'hr'].includes(role) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200 || typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 1024 || typeof body.department !== 'string' || !body.department.trim() || body.department.length > 100) return json(response, 400, { error: 'Invalid employee details; password must contain at least 12 characters' });
    for (const field of ['shift_checkin', 'shift_checkout']) {
      if (body[field] != null && body[field] !== '' && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(body[field])) return json(response, 400, { error: 'Invalid shift time' });
    }
    const satPlan = body.saturday_plan || 'every_saturday_work';
    const sunPlan = body.sunday_plan || 'two_sundays_work';
    if (typeof satPlan !== 'string' || typeof sunPlan !== 'string' || satPlan.length > 64 || sunPlan.length > 64) return json(response, 400, { error: 'Invalid weekend plan' });
    const created = await upstream('/auth/v1/admin/users', {
      method: 'POST', admin: true,
      body: { email: `${empid}@caddtech.com`, password: body.password, email_confirm: true,
        app_metadata: { hrms_managed: true, empid, role }, user_metadata: { name: body.name.trim() } }
    });
    if (!created.ok) return json(response, created.status >= 500 ? 503 : 409, { error: 'Unable to create employee' });
    const newUser = await created.json();
    if (!/^[0-9a-f-]{36}$/i.test(newUser.id || '')) throw new Error('Invalid provisioning response');
    try {
      const provisioned = await upstream('/rest/v1/rpc/create_employee_profile', {
        method: 'POST', token,
        body: { p_id: newUser.id, p_empid: empid, p_name: body.name.trim(), p_role: role,
          p_department: body.department, p_shift_checkin: body.shift_checkin || null,
          p_shift_checkout: body.shift_checkout || null, p_sat_plan: satPlan, p_sun_plan: sunPlan }
      });
      if (!provisioned.ok) throw new Error('Profile provisioning failed');
    } catch {
      try {
        const rolledBack = await upstream(`/auth/v1/admin/users/${encodeURIComponent(newUser.id)}`, { method: 'DELETE', admin: true });
        if (!rolledBack.ok) throw new Error('Rollback failed');
      } catch {
        logger({ event: 'employee_rollback_failed', id: limiterId(config.rateLimitSecret, 'user', newUser.id) });
      }
      return json(response, 503, { error: 'Unable to complete employee provisioning. Contact your administrator.' });
    }
    try {
      const performance = await upstream('/rest/v1/rpc/ensure_staff_performance', {
        method: 'POST', token, body: { p_empid: empid, p_staff_name: body.name.trim() }
      });
      if (!performance.ok) throw new Error('Performance initialization failed');
    } catch {
      logger({ event: 'employee_performance_initialization_failed', id: limiterId(config.rateLimitSecret, 'user', newUser.id) });
    }
    json(response, 201, { user: { id: newUser.id } });
  }

  const server = createHttpServer(async (request, response) => {
    headers(response, config);
    try {
      const url = new URL(request.url, config.origin);
      if (url.pathname.startsWith('/api/')) {
        if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed' });
        if (request.headers.origin !== config.origin || request.headers['sec-fetch-site'] === 'cross-site') return json(response, 403, { error: 'Request origin is not allowed' });
        if (url.pathname === '/api/login') return await login(request, response);
        if (url.pathname === '/api/employees') return await createEmployee(request, response);
        return json(response, 404, { error: 'Not found' });
      }
      if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Method not allowed' });
      if (url.pathname === '/js/config.js') {
        const configJson = JSON.stringify({ supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.publicKey }).replace(/</g, '\\u003c');
        response.writeHead(200, { 'Content-Type': mimeTypes.js });
        return response.end(request.method === 'HEAD' ? undefined : `const APP_CONFIG = Object.freeze(${configJson});\n`);
      }
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!publicFiles.has(file) && !vendorFiles.has(file)) return json(response, 404, { error: 'Not found' });
      let bytes;
      try {
        bytes = await readFile(join(rootDir, vendorFiles.get(file) || file));
      } catch {
        return json(response, 404, { error: 'Not found' });
      }
      const extension = file.split('.').pop();
      if (extension === 'html') headers(response, config, bytes.toString('utf8'));
      else response.setHeader('Cache-Control', 'public, max-age=300');
      response.writeHead(200, { 'Content-Type': mimeTypes[extension], 'Content-Length': bytes.length });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (!response.headersSent) json(response, error.status || 503, { error: error.status ? 'Invalid request' : 'Service temporarily unavailable' });
      else response.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

async function main() {
  const config = readConfig();
  const { createClient } = await import('redis');
  const client = createClient({ url: config.redisUrl, RESP: 2, disableOfflineQueue: true, socket: { connectTimeout: 3000 } });
  client.on('error', () => console.error(JSON.stringify({ event: 'rate_limit_store_error' })));
  await client.connect();
  const server = createServer({ config, limiter: createLoginLimiter(client, config.rateLimitSecret) });
  server.listen(config.port, config.host, () => console.info(JSON.stringify({ event: 'server_started', port: config.port })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error(JSON.stringify({ event: 'server_start_failed', message: 'Check the required environment and Redis connection' }));
    process.exitCode = 1;
  });
}

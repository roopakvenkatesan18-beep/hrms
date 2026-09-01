# CADD Tech HRMS

Browser-based HR and employee dashboards built with HTML, CSS, JavaScript, Supabase Auth, and PostgreSQL.

## Features

- Employee and HR role-based dashboards
- Attendance, leave, WFH, travel, and permission requests
- Employee profiles, schedules, announcements, performance, and chat
- Supabase authentication and database Row Level Security (RLS)
- Vercel security headers and locally bundled Supabase/Chart.js libraries
- No demo mode or fabricated attendance/profile data

## Current deployment

Production: <https://hrmsdemo-psi.vercel.app/login.html>

The current application is a static Vercel deployment. Login goes directly from the browser to Supabase Auth; no Node or Redis server is required.

Every push to the GitHub `main` branch triggers the connected Vercel project to redeploy automatically.

## Configuration

Browser configuration is stored in `js/config.js`:

- `supabaseUrl` is the public Supabase project URL.
- `supabaseAnonKey` is the public publishable/legacy anon key required by the browser.

These values are public by design and provide no administrative access. Never place a Supabase service-role key, database password, Redis credential, personal access token, or other secret in frontend files.

Authorization depends on Supabase RLS policies and protected database functions. Review and apply `setup/security_upgrade.sql` to the correct Supabase project before production use, then run `setup/security_checks.sql`.

## Running locally

Open `login.html` directly in a browser, or serve the directory with a local static server:

```powershell
cd "C:\Users\Venkatesan. V\Desktop\caddtech-hrms"
npx serve .
```

Then open the localhost URL printed in the terminal.

## Authentication

Employee IDs are normalized and mapped to `<employee-id>@caddtech.com` for Supabase email/password authentication.

After login, the application fetches the authenticated user's real `profiles` row. Only `hr` and `employee` roles are accepted. Missing profiles, invalid roles, and unauthenticated sessions are rejected; there is no role fallback or demo override.

Employee account creation is intentionally disabled in the static browser deployment because securely creating Auth users requires a server-side administrative credential. Create accounts through an authorized Supabase administrator.

## Security

The static deployment retains:

- Supabase RLS and authenticated database operations
- Role checks backed by real profile rows
- XSS-safe dynamic rendering and no inline event-handler dispatch
- CSV formula-injection protection
- Local version-locked Supabase and Chart.js bundles
- Content-Security-Policy, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, Referrer-Policy, and Permissions-Policy on Vercel
- No committed administrative credentials or passwords

The static deployment does **not** provide the custom Redis-backed `15 attempts per 15 minutes` login limiter or HTTP `428` response. Supabase Auth protections and any configured Supabase password-verification hook remain responsible for brute-force protection.

Security headers are supplied by Vercel through `vercel.json`; they do not apply when pages are opened with `file://`.

See `SECURITY_REMEDIATION.md` for the full audit report, resolved findings, remaining deployment work, and OWASP category status.

## Optional hardened server

`server.mjs` and `server/login-limit.mjs` remain available as an optional Node/Redis deployment. That mode adds the shared login limiter and server-authorized employee provisioning, but it requires private environment variables, Redis, and a supported Node.js runtime.

Use `.env.example` only as a template. `.env` is ignored by Git and must never be committed.

## Verification

```powershell
npm ci --ignore-scripts
npm test
npm audit --omit=dev
```

The test suite covers frontend injection defenses, authorization boundaries, security headers, runtime configuration, server login limiting, and employee provisioning controls.

## Important operational steps

- Rotate any credential previously shared in chat, documents, Git URLs, or screenshots.
- Keep public signup disabled unless it is intentionally required and safely provisioned.
- Enforce a strong Supabase password policy and review Auth audit logs.
- Review existing HR memberships and revoke suspicious sessions.
- Do not assume a hidden frontend key provides security; enforce all access in RLS and database functions.

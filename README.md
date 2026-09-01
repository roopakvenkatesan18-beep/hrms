# CADD Tech HRMS

Vanilla HTML/CSS/JavaScript HR and employee dashboards, backed by Supabase Auth/PostgreSQL and a Node.js server. Features include attendance, leave/WFH/travel requests, permission quotas, employee management, performance, announcements, schedules, and private chat.

## Static Vercel deployment

This repository now supports static Vercel hosting. Vercel serves the site and the small `/api/config` function supplies only the public Supabase URL and publishable key. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the Vercel project's Environment Variables before deploying. Do not set `SUPABASE_SERVICE_ROLE_KEY` in Vercel for this static configuration.

The static deployment signs users in directly with Supabase Auth. It retains database RLS, restrictive browser headers, safe UI rendering, and protected pages, but it does **not** provide the custom Redis-backed login rate limit or browser-based employee provisioning. Create employee accounts through the Supabase administrator and ensure RLS policies from `setup/security_upgrade.sql` are applied.

## Optional hardened Node deployment

The optional Node server provides the stronger Redis-backed login limit and server-authorized employee provisioning. GitHub Pages, `python -m http.server`, and static Vercel hosting do not enforce that server-side login limit.

1. Use a supported Node.js 22+ release and a private Redis service with authentication, persistence, and TLS for non-local connections. All application instances must share Redis and the same rate-limit secret. Do not use an evicting cache: losing Redis state resets counters.
2. Run `npm ci --ignore-scripts`. Exact dependency versions and integrity hashes are committed in `package-lock.json`.
3. Copy `.env.example` to `.env` and fill it locally or use your hosting secret manager. Never paste secrets into browser JavaScript, Git, screenshots, or logs.
4. Supply `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (a publishable key or legacy anon key). Supply the **server-only** `SUPABASE_SERVICE_ROLE_KEY` for HR account provisioning. The service-role key must never be sent to a browser.
5. Generate a random `RATE_LIMIT_SECRET` with at least 32 characters. Set `REDIS_URL`, `APP_ORIGIN`, `HOST`, and `PORT`. `APP_ORIGIN` is the exact browser origin, without a subdirectory; production origins require HTTPS.
6. Back up the existing database and inspect `setup/security_upgrade.sql`. It is a transactional upgrade for an existing HRMS schema, not a complete empty-database installer. Apply it only to the correct project after reviewing its required-table preflight and existing HR memberships.
7. Run `setup/security_checks.sql` and the local database regression harness. Review Supabase security advisors, deployed grants, and Auth settings.
8. Disable public signup. New employees are provisioned through the HR-authorized server endpoint and trusted Auth app metadata. Bootstrap the first HR account through an authorized administrator; never grant HR using user-editable metadata.
9. Set Supabase's server-side minimum password length to at least 12, enable leaked-password protection where supported, and review secure password-change/session settings. Browser validation alone is not a password policy.
10. Configure the upstream password-verification hook described below before treating brute-force protection as complete.
11. Start with `npm start` and verify the deployed response headers and login behavior.

No database changes or deployment are implied by editing these files. Review existing HR accounts and revoke suspicious sessions: fixing policies does not undo previously exploited access.

## Authentication and rate limiting

`POST /api/login` accepts an Employee ID and password. The server normalizes the ID, permits at most **15 accepted attempts in a rolling 15-minute window per IP and per account**, and returns **HTTP 428** plus `Retry-After` on the next attempt. Successful logins do not reset counters. An atomic Redis script uses the Redis clock so concurrent requests and multiple app instances share the limit. Redis failure or timeout denies login with 503.

The limiter runs only on the login endpoint. Password re-verification on the change-password page uses that same endpoint. Refresh tokens, static files, ordinary data requests, and employee provisioning are not subject to this custom login counter. Supabase can independently enforce its own service limits.

The browser receives the signed-in user's access/refresh tokens, then the Supabase SDK manages that session. Protected pages require a real database profile with an allowed role; there is no employee-ID-based role fallback or demo override. Database RLS and RPC authorization remain the real data-access boundary.

### Direct Supabase Auth requests

A frontend Supabase client requires a public project key. Consequently, an attacker can call the project's Auth endpoint directly and bypass an application-only proxy.

`setup/password_login_hook.sql` provides a separate per-user rolling 15-attempt password-verification hook returning 428. Apply it and configure **Authentication > Hooks > Password Verification Attempt** to call `public.password_login_hook`. It counts both valid and invalid attempts for known accounts without forcing logout. Unknown account identifiers cannot be counted by this user-ID hook. Verify failed-attempt persistence, concurrency, and HTTP status behavior against the actual Auth service before production.

Supabase currently documents this hook for Teams/Enterprise plans. If unavailable, the full requirement remains **unresolved** until an equivalent upstream control or an architecture that prevents direct password authentication is deployed. Do not assume CORS or hiding a public key closes the bypass. See [Supabase Auth hooks](https://supabase.com/docs/guides/auth/auth-hooks) and [password verification](https://supabase.com/docs/guides/auth/auth-hooks/password-verification-hook).

### Reverse proxies

By default the server uses the socket peer IP and ignores forwarding headers. For a single trusted reverse proxy, set `TRUSTED_PROXY_IPS` to its exact comma-separated IP addresses, restrict network access to the application port, and configure that proxy to **overwrite** `X-Forwarded-For` with one verified client IP (not append a client-supplied chain). Missing, invalid, or multi-address headers from trusted peers are rejected.

Never use a blanket `TRUST_PROXY=true`. Without this explicit configuration, clients behind a proxy share one IP bucket. Multiple employees behind an office NAT also naturally share an IP limit; the per-account limit remains independent.

## Headers and frontend integrity

All server responses include Content-Security-Policy, X-Frame-Options SAMEORIGIN, X-Content-Type-Options nosniff, strict-origin-when-cross-origin Referrer-Policy, and a restrictive Permissions-Policy. HTTPS deployments also receive HSTS.

CSP permits local scripts and exact hashes of the page's inline script blocks, with inline event handlers disabled. Dynamic handlers use explicit action dispatch. Inline styles remain allowed for the existing UI; scripts do not use unsafe-inline or unsafe-eval. Supabase and Chart.js browser bundles are served from the locked local dependencies, not mutable CDNs.

The server publishes only explicitly listed frontend assets. Environment files, SQL, documents, Git metadata, dependencies outside the two vendor bundles, tests, and server code are not static routes.

## Sensitive information

The public project URL and publishable/anon key are intentionally sent through the runtime `/js/config.js` response; they are not secrets and do not replace authorization. Environment variables included in frontend responses are still public.

Employee data belongs in protected database rows, not in environment variables. Signed-in users necessarily receive their permitted data and session tokens. Administrative keys, Redis credentials, and the rate-limit HMAC secret stay on the server.

The audit found and redacted a plaintext account password from the local, Git-ignored architecture DOCX. Its owner must rotate that password and revoke sessions; removing local text cannot retract copies or prove it was never exposed. Commented example passwords and hardcoded public Supabase configuration were also removed. No live credential is needed in committed application source.

## Verification

- `npm test`: offline frontend injection and HTTP server security regressions; upstream requests are stubbed.
- `node --check server.mjs`: server syntax.
- `npm audit --omit=dev`: dependency advisories at the time of execution.
- `python tests/login-limit-redis.py`: executes the production Lua through an isolated Redis emulator, including expiry and concurrent calls. Requires the temporary `fakeredis[lua]` dependency under `.security-qa/python`; this is not a production dependency.
- The disposable PostgreSQL test harness uses PGlite under `.security-qa`; see its invocation in the security remediation report. It does not connect to the real project.

Logs contain security event types and HMAC identifiers, not passwords or tokens. Route those logs and Supabase Auth audit logs to your monitoring system, restrict retention/access, and configure alerts for repeated failures, throttling, and employee-provisioning rollback failures. Provisioning uses compensating deletion on known failures, not a distributed transaction; ambiguous upstream failures require administrator reconciliation.

See `SECURITY_REMEDIATION.md` for the requested category-by-category status, verification results, and remaining production work.

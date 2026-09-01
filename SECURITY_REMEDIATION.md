# Security remediation report

Audit date: 2026-08-31. Scope: the complete first-party application, all local SQL setup scripts (including previously Git-ignored scripts), configuration, dependencies, and the local architecture document. Existing uncommitted changes were retained and corrected where they implemented incomplete security controls.

**The repository fixes are implemented and locally verified. Production is not certified secure:** no live database migration, deployment, credential rotation, or Auth-setting change was performed. The initially connected Supabase account did not contain this project's database; subsequent connector access became unavailable during account reconnection.

## Requested changes

| Request | Status | Result / remaining work |
|---|---|---|
| 0. Remove demo mode | Resolved | Removed the 815-line demo module, script references, demo styling, generated attendance and fabricated personal-data fallbacks. The legitimate business metric “Demo Classes” remains. |
| 1. Login: 15 attempts / 15 minutes, HTTP 428 | Unresolved | Implemented and tested on `/api/login`, per IP and account, using atomic shared Redis counters. Password re-verification uses the same endpoint. Direct Supabase Auth also needs the supplied hook or equivalent upstream enforcement; it is not enabled or live-tested. |
| 2. Remove hardcoded credentials | Unresolved | Removed hardcoded public Supabase configuration and example passwords; redacted a real-looking plaintext account password in the local DOCX. Its owner must rotate it and revoke sessions. Credential validity was not tested. |
| 3. Environment-only secrets | Resolved locally | Server configuration uses environment variables; `.env*` is ignored except the placeholder template. Administrative key, Redis URL and HMAC secret are never emitted by public config. No live environment was populated. |
| 4. Missing security headers | Resolved locally | All seven HTML routes and error/API responses receive real HTTP headers from the Node server. CSP, SAMEORIGIN, nosniff, Referrer-Policy and Permissions-Policy verified. Production hosting must run this server. |
| 5. Full audit and remaining risks | Completed locally | Independent source reviews, dependency advisory audit, HTTP/browser tests, Redis Lua tests and disposable PostgreSQL checks completed. Live configuration and incident-response checks remain open. |

## OWASP category status

“Resolved” means the identified repository defects are fixed and locally verified, not that every possible vulnerability in that category is impossible. “Unresolved” identifies required external configuration, deployment or incident-response work. “NA” means no applicable attacker-controlled surface was established in this codebase.

| # | Category | Status | Evidence and remaining work |
|---|---|---|---|
| 1 | Broken Access Control | Unresolved | Fixed anonymous definer RPCs, signup role assignment, self-role insertion, ownership fallbacks, public announcement access, profileless reads and shared settings access. SQL tests pass. Apply to the correct database and inspect existing HR memberships. |
| 2 | Cryptographic Failures | Unresolved | DOCX plaintext password redacted; rotation/session revocation outstanding. Supabase handles password hashing; production TLS, backup encryption and secret-manager settings were not inspectable. |
| 3 | Injection | Resolved | Fixed stored HTML/attribute injection, unsafe style values and CSV formula injection. Queries remain parameterized; dynamic SQL identifiers are quoted. No independent SQL injection path established. |
| 4 | Insecure Design | Unresolved | Removed demo bypass/fallback authorization and enforced permission duration/quota in PostgreSQL. Direct upstream authentication control and provisioning-failure reconciliation still require operational setup. |
| 5 | Security Misconfiguration | Unresolved | Added enforcing response headers, strict static allowlist, fail-closed environment validation and secure legacy SQL. Deployment, real database grants, signup settings and trusted proxy configuration remain unverified. |
| 6 | Vulnerable & Outdated Components | Resolved | Exact Supabase 2.112.4, Chart.js 4.5.1 and Redis client 6.2.1 pins, committed lockfile integrity, and npm audit: **0 known vulnerabilities** at audit time. This is not a guarantee against undisclosed defects. |
| 7 | Identification & Authentication Failures | Unresolved | Server login limit and real profile requirements implemented. Enable/live-test the password hook or equivalent, set the Auth password policy, review session settings, and revoke suspect sessions. |
| 8 | Software & Data Integrity Failures | Resolved | Mutable CDN scripts replaced by local locked bundles; protected reset marker, HR-only schema changes, safe setup reruns and CSV output verified. Supply-chain updates still need continuing review. |
| 9 | Security Logging & Monitoring Failures | Unresolved | Structured login/throttle/store-failure and provisioning-failure logs contain HMAC IDs rather than passwords/tokens. Central retention, alerts, Supabase audit-log review and database-change auditing are not configured. |
| 10 | SSRF | NA | No user-supplied outbound URL feature found. New server requests use a validated fixed HTTPS Supabase origin, explicit paths and redirect rejection. |

## Significant source findings fixed

1. Account deletion, lookup, arbitrary role/profile upsert and profile editing were exposed through unchecked SECURITY DEFINER functions, including explicit anonymous grants.
2. Public signup metadata could set `profiles.role`; profileless users could also insert an HR role under the original self-insert policy.
3. Writable performance names reached an unescaped HR stat card; profile names/IDs entered quoted JavaScript event attributes. Shared escaping helpers and inert action attributes now replace those paths.
4. WFH/travel policies treated a missing identity as the caller-provided employee ID. Policies now require verified ownership.
5. `app_meta` lacked RLS, and performance reset trusted a writable marker. Settings and reset operations now have explicit permissions and serialization.
6. Legacy performance SQL could restore broad writes or unchecked privileged RPCs. Every supported legacy script was hardened and rerun in regression verification.
7. Permission duration and the 180-minute monthly quota existed only in browser logic. Constraints and a serialized database trigger enforce them.
8. Announcements allowed anonymous reads under the original policy. Existing-profile authentication is now required.
9. Performance CSV exports could contain executable spreadsheet formulas. Formula-capable cells are neutralized.
10. Browser-local rate counters could be cleared and did not return real HTTP 428 responses. Server enforcement replaces them; upstream enforcement remains a deployment condition.
11. A plaintext account password existed in `HRMS_Architecture.docx`; it has been redacted without copying its value into this report.

## Verification results

- `npm test`: HTTP/frontend regressions pass, including stored XSS, CSV formulas, authorization, header presence, private-file denial, secret-free public config, origin checks, limiter failures, real 428 responses and trusted-proxy behavior.
- `node tests/database-security.mjs`: disposable PostgreSQL via PGlite passes repeated upgrade and legacy-script reruns, grants/RLS checks, forged metadata rejection, legitimate HR operations, permission quota/duration, preserved legacy data, preserved chat data, anonymous/profileless denial, and hook attempt 16 returning 428.
- `python tests/login-limit-redis.py`: production Lua executed through an isolated RESP2 Redis emulator. First 15 admitted, 16th denied, account/IP limits independent, expiry boundary correct, and **100 concurrent attempts admitted exactly 15**.
- `npm audit --omit=dev`: zero reported vulnerabilities.
- In-app browser: login and password-change pages load under the CSP without console errors; blocked login displays the expected error. Used only dummy local test values; no real credentials or production login attempts.
- Post-edit credential-pattern scan: no matching hardcoded JWT, privileged key or private-key block in application/setup source. DOCX scan finds zero remaining password assignments; ZIP integrity passes.
- `git diff --check`: passes; existing CRLF normalization notices are informational.

SQL tests use minimal fixtures for externally provisioned `staff_performance` and `emp_last6months` base tables; their complete real schema was absent from the original repository. PostgreSQL multi-row quota enforcement was tested, but simultaneous real database connection contention and actual Supabase Auth hook transaction behavior still need staging verification. Redis tests use an emulator, not the production Redis deployment.

The DOCX edit preserves its original XML/package structure except the credential text. The documents renderer could not run because LibreOffice is unavailable; no visual-layout verification is claimed.

## Remaining actions, in priority order

1. **Rotate the password formerly in the architecture DOCX and revoke sessions.** Review prior copies/backups. The document was ignored by Git, but that does not prove it was never shared. Git history was not rewritten or exhaustively scanned.
2. Connect the Supabase account owning the HRMS project. Back up the database, inspect the 17-table preflight in `setup/security_upgrade.sql`, review existing HR profiles, and apply the upgrade only after validating the real schema. Run `setup/security_checks.sql` and Supabase security advisors afterward.
3. Configure trusted employee provisioning, disable public signup, set a server-side minimum password length of 12, and review secure password-change/leaked-password/session controls. UI password validation is not sufficient.
4. Enable `public.password_login_hook` from `setup/password_login_hook.sql` in Auth's Password Verification Attempt setting. Supabase documents this capability for Teams/Enterprise; if unavailable, an equivalent upstream control or architecture change is required. A proxy alone cannot prevent direct calls to a public Auth project. [Supabase documentation](https://supabase.com/docs/guides/auth/auth-hooks).
5. Deploy the Node server with a protected persistent Redis service and secret-manager configuration. Use TLS. Configure only exact trusted proxy IPs; the proxy must overwrite `X-Forwarded-For` with one verified IP. Without this, proxy/NAT users share a conservative IP bucket.
6. Review invalid legacy rows before validating the new `NOT VALID` constraints. They deliberately preserve existing data rather than silently deleting it.
7. Forward security logs to monitored storage, configure alerts, review historical Auth activity, and reconcile ambiguous or failed employee-provisioning operations. Known failures attempt rollback, but multi-service provisioning is not atomic.

## What is intentionally public / not applicable

- Supabase project URL and publishable/anon key must be visible to this frontend architecture. They are not administrative secrets; RLS and authenticated policies enforce data access. Putting them in an environment variable does not make their browser response secret.
- Authorized employee data belongs in protected database rows, not environment variables. A logged-in browser necessarily receives its permitted data and session tokens.
- Header meta tags cannot replace server response headers. Static-only hosting cannot implement the requested server login limiter.
- No application feature needed an embedded production password or secret; none was retained for compatibility.

## Reproduce deeper offline checks

Temporary test dependencies are isolated under ignored `.security-qa`, not in the application dependency tree:

```powershell
npm ci --ignore-scripts
npm test
npm install --prefix .security-qa --ignore-scripts @electric-sql/pglite
node tests/database-security.mjs
python -m pip install --target .security-qa/python "fakeredis[lua]"
python tests/login-limit-redis.py
```

No commit or deployment was performed. The formal Codex scan records baseline findings and their local remediation status separately from this implementation checklist. Token usage for the audit was not available.

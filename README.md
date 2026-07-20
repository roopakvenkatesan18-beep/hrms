# CADD Tech Solutions — HRMS (Human Resource Management System)

A client-side HR management web application for **CADD Tech Solutions**, built with plain HTML/CSS/JavaScript and powered by **Supabase** (PostgreSQL + Auth + Realtime) as the backend-as-a-service. It serves two types of users — **HR Administrators** and **Employees** — through two dedicated dashboards.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Authentication & JWT](#authentication--jwt)
- [Database Schema](#database-schema)
- [Setup & Installation](#setup--installation)
- [Running the App](#running-the-app)
- [Supabase Configuration](#supabase-configuration)
- [Navigation Changes](#navigation-changes)
- [Deployment](#deployment)
- [Security Notes](#security-notes)

---

## Overview

The HRMS lets employees manage their day-to-day workplace activities (attendance, leave, WFH, travel allowance, performance, profile) while giving HR a company-wide control panel (approvals, employee lifecycle management, directory, announcements, analytics).

Everything runs in the browser. There is **no custom backend server** — the app talks directly to Supabase via its JavaScript SDK using a public "anon" key, with **Row Level Security (RLS)** policies and `SECURITY DEFINER` database functions enforcing access rules on the server side.

---

## Features

### Employee
- **Dashboard** — attendance pie chart, working-hours chart, last-7-days attendance, today's check-in, class schedule.
- **My Attendance** — timeline / calendar / table views of monthly attendance with late/present/absent status.
- **My Leave** — apply for Casual/Sick/Earned/Unpaid leave; track request status.
- **My WFH** — request Work-From-Home and track approvals.
- **My Travel Allowance** — submit travel/commute reimbursement requests.
- **My Performance** — personal review history and goal progress.
- **Announcements** — view company news, holidays, events, policies.
- **Team Chat** — one-to-one internal messaging.
- **Employee Directory** — search/filter all staff.
- **My Profile** — edit personal & professional details.

### HR Admin
- Everything above, plus:
- **Attendance** — company-wide attendance analytics, employee-by-employee drill-down.
- **Leave Management** — approve/reject all leave requests, with history.
- **WFH Approvals** — approve/reject WFH requests (approved WFH overrides scraped attendance status).
- **Travel Allowance Management** — approve/reject travel claims.
- **Performance Leaderboard** — company-wide staff rankings by points.
- **Announcements** — post company announcements.
- **Add / Remove Employee** — full employee lifecycle management (creates Supabase auth user + profile, or deactivates).
- **Employee Directory** — with edit capability.
- **Permission requests** — monthly 3-hour permission quota management.

---

## Architecture

```
                         ┌──────────────────────────────────────┐
                         │            Browser (Static SPA)        │
                         │                                        │
   Employee / HR  ──────▶│  login.html ─▶ hr-dashboard.html       │
                         │                   employee-dashboard.html│
                         │                                        │
                         │  js/supabase.js   (Supabase client)    │
                         │  js/auth.js       (login / logout)     │
                         │  js/session.js    (session + profile)  │
                         │  js/roleGuard.js  (route protection)   │
                         │  js/api.js        (data layer)         │
                         │  app.js / data.js (UI logic)           │
                         └───────────────┬────────────────────────┘
                                         │ HTTPS (REST + Realtime)
                                         ▼
                         ┌──────────────────────────────────────┐
                         │            Supabase (Backend)          │
                         │  • Auth (JWT sessions)                 │
                         │  • PostgreSQL (RLS-protected tables)  │
                         │  • Storage (logo, assets)             │
                         │  • Realtime (Team Chat)               │
                         └──────────────────────────────────────┘
```

### Request Flow (typical)
1. User opens `login.html` and submits Employee ID + password.
2. `Auth.login()` converts the Employee ID to `<empid>@caddtech.com` and calls `supabaseClient.auth.signInWithPassword()`.
3. Supabase returns a **JWT access token + refresh token**; the SDK stores the session in `localStorage`.
4. `RoleGuard.requireAuth(['hr'] | ['employee'])` validates the session and fetches the `profiles` row to determine the role, then redirects/blocks accordingly.
5. UI modules call `API.fetch*()` which run parameterized Supabase queries (`select`/`insert`/`update`) guarded by RLS.
6. For privileged operations (add/remove employee, profile edits), `SECURITY DEFINER` Postgres functions (`create_employee_profile`, `update_employee_profile`, `delete_auth_user_by_empid`) are invoked — bypassing restrictive RLS while staying server-enforced.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| UI | HTML5, CSS3 (custom design system in `styles.css` + `login-styles.css`) |
| Logic | Vanilla JavaScript (ES modules as IIFEs), no framework |
| Charts | Chart.js 4.4.4 (CDN) |
| Backend | Supabase (PostgreSQL + Auth + Realtime) |
| Auth | Supabase Auth (email/password → JWT) |
| Hosting | Any static host (GitHub Pages, Netlify, Vercel, Azure Static Web Apps) |

---

## Project Structure

```
caddtech-hrms/
├── index.html              # Landing / entry redirect
├── login.html              # Sign-in page (Employee ID + password)
├── change-password.html    # Self-service password change
├── unauthorized.html       # Shown when role does not match the page
├── hr-dashboard.html       # HR admin dashboard (route-guarded: role = hr)
├── employee-dashboard.html # Employee dashboard (route-guarded: role = employee)
├── styles.css              # Core app design system
├── login-styles.css        # Login/authentication screen styles
├── data.js                 # Mock/seed employee data (fallback + helpers)
├── app.js                  # Main UI controller / rendering / navigation
├── logo.jpg                # Company logo asset
├── js/
│   ├── supabase.js         # Supabase client init (URL + anon key)
│   ├── auth.js             # Login / logout logic
│   ├── session.js          # Session, profile, auto-redirect, role routes
│   ├── roleGuard.js        # Page protection (auth + role checks)
│   └── api.js              # Data-access layer (all Supabase queries)
└── setup/                  # SQL migration / schema scripts for Supabase
    ├── seed-users.sql              # profiles, emp_attendance, emp_monthly
    ├── auth_user_management.sql    # create/update/delete employee RPCs + trigger
    ├── leave_schema.sql            # leave_requests
    ├── wfh_schema.sql              # wfh_requests
    ├── travel_allowance_schema.sql # travel_allowance_requests, perf_targets, employee_details
    ├── permission_schema.sql       # permission_requests, hr_notifications
    ├── announcements_schema.sql    # announcements
    ├── schedule_schema.sql         # employee_schedule_slots
    ├── chat_schema.sql             # employee_chat_conversations, employee_chat_messages
    ├── performance_*.sql           # staff performance tables + monthly reset
    ├── security_hardening.sql      # RLS policies + hardening
    └── ...                         # other RLS / fix scripts
```

---

## Authentication & JWT

The "JWT" in this project is the **Supabase Auth access token**. There is no custom JWT issuer — Supabase mints and signs the token.

1. **Login** (`js/auth.js`)
   - Employee ID (e.g. `0001`) is mapped to the email `0001@caddtech.com`.
   - `supabaseClient.auth.signInWithPassword({ email, password })` authenticates against Supabase Auth.
   - On success, Supabase returns a **JWT access token** (`data.session.access_token`) and a **refresh token**. The `supabase-js` SDK automatically persists the session (default: `localStorage`) and refreshes the access token transparently before expiry.

2. **Session verification** (`js/session.js`)
   - `Session.getSession()` → `supabaseClient.auth.getSession()` reads the persisted session/JWT.
   - `Session.getProfile()` fetches the matching `profiles` row (id, empid, name, role, department, shift times, weekend plans).
   - If the DB profile is missing, a fallback profile is built from metadata / attendance data so the UI never crashes.

3. **Route protection** (`js/roleGuard.js`)
   - Every protected page calls `RoleGuard.requireAuth(['hr'])` or `['employee']` first.
   - If there is **no valid JWT/session** → redirect to `login.html`.
   - If the session exists but the `profile.role` is not allowed → redirect to `unauthorized.html`.
   - A loading skeleton is shown while verifying, then removed on success.
   - `supabaseClient.auth.onAuthStateChange(...)` signs the user out to `login.html` if the session expires/SIGNED_OUT.

4. **Logout** (`js/auth.js`)
   - `supabaseClient.auth.signOut()` invalidates the refresh token server-side and clears local storage, then redirects to `login.html`.

5. **Authorization on data**
   - Every Supabase query from `js/api.js` is executed with the user's JWT attached automatically by the SDK.
   - **Row Level Security (RLS)** on each table decides what rows the JWT's user can read/write. Privileged mutations use `SECURITY DEFINER` functions so HR can act without needing broad INSERT policies.

> ⚠️ Note: The Supabase **anon key is public by design** — it only grants access together with a valid JWT *and* RLS must allow the operation. Never rely on the anon key alone for secrecy; all protection lives in RLS + `SECURITY DEFINER` functions.

---

## Database Schema

Core tables (provisioned via the `setup/*.sql` scripts in Supabase SQL Editor):

| Table | Purpose |
|-------|---------|
| `profiles` | One row per auth user — empid, name, role (`hr`/`employee`), department, shift times, weekend plans. |
| `emp_attendance` | Daily attendance punches (check-in/out, sessions, hours). |
| `emp_monthly` | Pre-aggregated monthly attendance (primary source for charts/calendar). |
| `emp_last6months` | Rolling 6-month attendance history for calendar views. |
| `leave_requests` | Leave applications + HR decision. |
| `wfh_requests` | Work-from-home applications + HR decision. |
| `travel_allowance_requests` | Travel/commute reimbursement claims. |
| `permission_requests` | Short (≤3h/month) permission requests. |
| `announcements` | Company announcements (posted by HR). |
| `employee_schedule_slots` | Employee class/schedule slots. |
| `employee_chat_conversations` / `employee_chat_messages` | Team chat threads & messages (Realtime). |
| `staff_performance` / `perf_targets` | Performance points & leaderboard targets. |
| `app_meta` / `hr_notifications` | Misc app state & HR notification queue. |

Key server-side functions:
- `create_employee_profile(...)` — idempotent insert of a profile for a new employee.
- `update_employee_profile(...)` — HR edit of department/shift/weekend plans.
- `delete_auth_user_by_empid(...)` — deactivate/remove an employee (deletes auth user by email).
- `handle_new_user()` — trigger guaranteeing a `profiles` row for every new auth user.

---

## Setup & Installation

### Prerequisites
- A **Supabase** project (free tier is fine).
- A static-file host or just a local web server for development.
- (Optional) Node.js for a simple local server.

### 1. Clone the repository
```bash
git clone https://github.com/roopakvenkatesan18-beep/hrms.git
cd hrms
```

### 2. Configure Supabase
- Open `js/supabase.js` and confirm `SUPABASE_URL` and `SUPABASE_ANON_KEY` point to your project.
- In the Supabase dashboard → **SQL Editor**, run the scripts in `setup/` in order, starting with `seed-users.sql`, then `auth_user_management.sql`, `security_hardening.sql`, and the individual `*_schema.sql` files. These create tables, RLS policies, and the management functions.
- Seed initial users via `setup/seed-users.sql` (the default HR admin is `0001`).

### 3. Set employee credentials
Employee login emails follow `<empid>@caddtech.com`. Passwords are managed in Supabase Auth (HR creates accounts via **Add / Remove Employee**; password resets go through HR).

---

## Running the App

Because the app uses `fetch`/modules and Supabase, serve it over HTTP (don't open via `file://`):

```bash
# Python (any)
py -m http.server 8080

# or Node
npx serve .
```

Then open `http://localhost:8080/login.html`.

---

## Supabase Configuration

- **Auth provider:** Email/Password enabled; email confirmation can be left off for internal use (the code maps "Email not confirmed" to "Contact HR").
- **RLS:** Enabled on all tables. Employees may read/write only their own rows; HR may read all. Privileged writes go through `SECURITY DEFINER` functions.
- **Realtime:** Enabled for the chat tables so messages appear live.

---

## Navigation Changes

As of the latest update, the **WFH** nav item was moved to the **end** of the sidebar in **both** dashboards for a more logical menu order (core items first, WFH last):

- `hr-dashboard.html` → `WFH Approvals` now appears after `Add / Remove Employee`.
- `employee-dashboard.html` → `My WFH` now appears after `My Profile`.

This is a pure UI ordering change; navigation (`data-page="wfh"`) and the WFH page sections are unchanged.

---

## Deployment

The app is fully static. To deploy (e.g., GitHub Pages):

1. Push the repo to GitHub.
2. In repo **Settings → Pages**, set the source to the `main` branch root.
3. Visit the published URL (`https://<user>.github.io/hrms/login.html`).

Any static host (Netlify, Vercel, Azure Static Web Apps, Firebase Hosting) works identically — just point it at the repository root. No build step is required.

---

## Security Notes

- The Supabase **anon key is public**; real protection comes from **RLS** + `SECURITY DEFINER` functions.
- `SECURITY DEFINER` functions use `SET search_path = public` to prevent search-path injection.
- Password resets are HR-gated (no self-service reset link in the UI) to keep account control internal.
- Sessions auto-redirect on expiry via `onAuthStateChange`.
- Avoid committing real secrets; the anon key is intended to be public but should still be rotated if leaked.

---

## License

Internal use — CADD Tech Solutions.

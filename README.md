# ODDLY

**Everything your agency needs. All in one place.**

ODDLY is the internal agency management platform: lead management, CRM & sales, clients,
content studio, website management, projects, analytics and an AI assistant, in one
desktop app backed by one shared database.

| Part | Stack | Folder |
|---|---|---|
| Desktop app | Tauri 2, React, TypeScript, Vite, Tailwind, shadcn/ui-style components, Recharts | `desktop/` |
| API | Rust, Axum, Tokio, SQLx | `backend/` |
| Database, auth, files | Supabase (Postgres, Auth, Storage) | `supabase/` |

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first. Also: [`docs/DATABASE.md`](docs/DATABASE.md),
[`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md),
[`docs/OPERATIONS.md`](docs/OPERATIONS.md) (backups, releases, monitoring), [`docs/SECURITY.md`](docs/SECURITY.md).

## Status

| Phase | Status |
|---|---|
| 1 Foundation — schema, auth, team & roles, shell, dashboard | Done |
| 2 Lead Management — leads, filters, saved filters, bulk actions, XLSX/CSV import & export, duplicates & merge, lead lists, research | Done |
| 3 CRM & Sales — pipeline board, custom stages, outreach log, follow-ups & reminders, meetings, deals, proposals (versions, templates, PDF), lead → client conversion | Done |
| 4 Clients — client workspace, contacts, onboarding checklist, services, contracts & documents, service catalog, history | Done |
| 5 Agency Operations — projects & tasks (templates, Kanban, calendar), content studio (workflow, approvals, captions, media library), websites (maintenance, encrypted credentials, uptime monitoring, renewal reminders), team workload, activity log | Done |
| 6 Analytics & AI — lead, sales, client, financial (per currency) and team reports with CSV/PDF export; AI assistant with permission-scoped tools, draft writer, lead opportunity analyzer, dashboard insights | Done |
| 7 Production readiness — HTTP hardening, route code-splitting, signed installer with auto-update, backup script, operations & security docs | Done |

Background jobs in the API: follow-up and meeting reminders (every 5 min), uptime checks and
renewal reminders for domains, hosting, SSL and contracts (every 10 min).

## Prerequisites

- Node.js 22.22+ and npm
- Rust (stable) — on Windows also the Visual Studio C++ Build Tools
- A Supabase project ([supabase.com](https://supabase.com))

## 1. Set up Supabase

1. Create a project. Note the **database password** you choose.
2. **Authentication → Sign In / Providers → Email:** keep Email enabled and **turn off
   "Allow new users to sign up"**. ODDLY creates accounts itself (owner setup and
   Team Members). Leaving sign-ups open would let anyone with the app create an account.
3. Apply the migrations in `supabase/migrations/` (in filename order), either:
   - **CLI:** `npx supabase db push --db-url "<session pooler connection string>"`, or
   - **Dashboard:** SQL Editor → paste and run each file in order.

## 2. Configure and run the API

```bash
cp backend/.env.example backend/.env
```

Fill in `backend/.env` (each value is explained in the file):

- `DATABASE_URL` — Project Settings → Database → Connection string → **Session pooler**
- `SUPABASE_URL` and `SUPABASE_SECRET_KEY` — Project Settings → API Keys (secret / service_role)
- `SUPABASE_JWT_SECRET` — only if your project still uses the legacy JWT secret

- `OPENAI_API_KEY` — turns on the AI assistant (optional; `OPENAI_MODEL` defaults to `gpt-4.1-mini`).
  Without it every AI screen says it isn't set up — nothing is faked.
- `SECRETS_KEY` — encrypts stored website credentials (32 random bytes, base64:
  `openssl rand -base64 32`). **Back it up somewhere safe**: without it, stored credentials
  can't be read. Without it set, the credential vault is simply disabled.

```bash
cargo run -p oddly-api
```

New migrations are applied with `powershell -File scripts/db-push.ps1`.

### Smoke tests

End-to-end tests that call the API handlers against the configured database as the workspace
owner. They create records tagged `__oddly_smoke__` and delete them afterwards (including
uploaded files):

```bash
ODDLY_SMOKE=1 cargo test -p oddly-api -- --test-threads=1
```

Check it: <http://localhost:8080/api/v1/health> should return `{"status":"ok","database":"ok"}`.

## 3. Configure and run the desktop app

```bash
cp desktop/.env.example desktop/.env
```

Fill in `desktop/.env`: `VITE_API_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`
(the **publishable / anon** key — never the secret key).

```bash
cd desktop
npm install
npm run tauri dev
```

On first launch ODDLY shows **Set up your workspace**: create the owner account, which
becomes Super Admin. Then add the team from **Settings → Team Members**.

`npm run dev` runs the same UI in a browser at <http://localhost:1420> (the session is kept
in localStorage there instead of the OS keychain).

## Building an installer

```bash
powershell -ExecutionPolicy Bypass -File scripts/build-desktop-release.ps1
```

Builds the signed Windows installer against the production API (`desktop/.env.production`)
plus the `latest.json` update manifest, and publishes both through the API. See [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
for publishing updates. The API is deployed separately ([`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)).

## Security checklist

- Secret key, database URL and OpenAI key live **only** in `backend/.env` (or the server's
  environment). `desktop/.env` holds public values only.
- Supabase sign-ups disabled (step 1.2).
- Every table has RLS enabled with no policies — the public key can't read data.
- Set `SETUP_TOKEN` if the API is reachable from the internet before the owner account exists.
- Supabase handles password hashing, sessions and token refresh; the API checks every
  request's token and permissions.

## Repository layout

```
backend/            Rust API (Axum)
desktop/            Tauri 2 shell + React app
docs/               Architecture, database and design-system notes
supabase/migrations SQL migrations
```

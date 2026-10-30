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
[`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md).

## Status

**Phase 1 — Foundation** is built: Supabase schema for every module, Supabase sign-in,
first-run owner setup, team members & roles, the app shell (collapsible sidebar, Ctrl+K
search, notifications) and a live dashboard. Modules from Phase 2 onward show a roadmap page
until they are built — no fake data.

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

```bash
cargo run -p oddly-api
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
cd desktop
npm run tauri build
```

The API is deployed separately (it is one binary: `cargo build -p oddly-api --release`).
Point `VITE_API_URL` at its HTTPS address before building the desktop app, and add that
address to `connect-src` in `desktop/src-tauri/tauri.conf.json`.

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

# ODDLY — Architecture

ODDLY is an agency management platform (lead management, CRM, clients, content studio,
website management, projects, analytics, AI). This document records the architecture and
the decisions behind it. Read it before adding a module.

## System overview

```
┌──────────────────────────────┐         ┌────────────────────────────────────┐
│  ODDLY Desktop (Tauri 2)     │         │  Supabase                          │
│  React + TypeScript + Vite   │──auth──▶│  Auth  (sign-in, sessions, tokens) │
│                              │         │                                    │
│  supabase-js: AUTH ONLY      │         │  Postgres  (all business data,     │
│  Rust shell: OS keychain     │         │            RLS on, no policies)    │
└──────────────┬───────────────┘         │  Storage   (private buckets)       │
               │ HTTPS + Bearer token    └──────────────▲─────────────────────┘
               ▼                                        │ SQL (owner role)
┌──────────────────────────────┐                        │ Admin API (service key)
│  ODDLY API (Rust / Axum)     │────────────────────────┘
│  verifies Supabase JWT       │
│  RBAC, validation, audit     │──────▶ OpenAI API (Phase 6, server-side only)
└──────────────────────────────┘
```

**One rule:** the desktop app talks to Supabase for *authentication only*. Every business
read and write goes through the ODDLY API. This keeps authorization, validation, audit
logging and AI access in one place, and lets a future web app reuse the same API.

## Why these pieces

| Concern | Choice | Reason |
|---|---|---|
| Database | Supabase Postgres | Managed Postgres with backups, point-in-time recovery and a table editor. Shared by the whole team. |
| Auth | Supabase Auth | Battle-tested password storage, sessions, token refresh, password resets. ODDLY keeps roles/permissions in its own tables. |
| Files | Supabase Storage (private buckets) | S3-compatible. The API issues short-lived signed URLs after a permission check. |
| API | Rust, Axum, Tokio, SQLx | Fast, typed, one binary to deploy. SQLx gives parameterized queries (no SQL injection). |
| Desktop | Tauri 2 | Small native app; Rust shell stores the session in the OS keychain. |
| UI | React, Tailwind v4, shadcn/ui pattern, Lucide, Recharts | Reusable components, consistent dark design system. |
| Data fetching | TanStack Query | Caching plus loading / error / empty states without hand-rolled effects. |

## Authentication & authorization flow

1. User signs in in the desktop app with `supabase.auth.signInWithPassword`.
2. supabase-js keeps the session (access + refresh token). In the desktop build the session
   is persisted through Tauri commands into the OS keychain (Windows Credential Manager,
   macOS Keychain, Secret Service on Linux), never in plain files.
3. Each API request sends `Authorization: Bearer <supabase access token>`.
4. The API verifies the JWT signature (Supabase JWKS for asymmetric keys, or the legacy
   HS256 secret), the audience (`authenticated`) and expiry.
5. The API loads the user's `profiles` row, roles and permissions **on every request**, so
   suspending a user or removing a role takes effect immediately.
6. Each handler calls `user.require("permission.key")`. Record-level scoping (e.g. sales reps
   only see leads assigned to them unless they hold `leads.view_all`) is applied in SQL.

**Account creation.** Public sign-ups must be disabled in Supabase (see README). Accounts are
created by the API using the Supabase Admin API:

- *First run:* if the workspace has no users, the app shows an owner setup screen. The API
  creates that account and the database trigger makes it **Super Admin**.
- *Afterwards:* admins add team members from Settings → Team Members. The API creates the
  account with a one-time temporary password, which the member must change on first sign-in.

**Row Level Security.** Every table has RLS enabled with **no policies**. The public
anon/publishable key shipped in the desktop app therefore cannot read or write any ODDLY table
through Supabase's REST API. The ODDLY API connects as the table owner and enforces
permissions itself. If a feature later needs direct client access (e.g. Realtime
notifications), add a narrow policy for exactly that table.

## Secrets

| Secret | Lives in | Never in |
|---|---|---|
| Supabase service-role / secret key | API environment | Desktop app, repo |
| Database URL & password | API environment | Desktop app, repo |
| OpenAI API key | API environment | Desktop app, repo |
| Website credential encryption key | API environment | Database, repo |
| Supabase URL + anon/publishable key | Desktop build env | — (public by design; RLS protects data) |

Website access credentials are encrypted by the API (AES-256-GCM) before they reach the
database (`website_secrets`).

## Data model summary

Full schema: `supabase/migrations/`. See `docs/DATABASE.md` for the entity map.

- **companies** are the anchor. A company's `lead`, `deals`, `proposals` and — once won —
  its `client` all reference the same company row, so conversion never duplicates data.
- **leads** carry the pipeline stage (`pipeline_stages`, admin-customizable, each with a
  `kind` of open/won/lost so reports survive renames).
- **deals** are priced opportunities. Won deals drive revenue figures.
- Money is `numeric(14,2)` with an ISO-4217 `currency` on every amount. **Reports never sum
  different currencies together**; they return one total per currency until a documented
  conversion-rate table and reporting currency are introduced.
- Polymorphic tables (`activities`, `comments`, `files`, `notifications`) use
  `(entity_type, entity_id)` constrained by the `entity_kind` domain.
- Soft delete (`deleted_at`) on user-facing records; hard delete only for join rows.
- `audit_logs` is the security trail; `activities` is the human-readable timeline.

## Repository layout

```
Oddlyy/
├─ Cargo.toml                  Rust workspace (backend + desktop shell)
├─ docs/                       Architecture, database, design system
├─ supabase/
│  └─ migrations/              SQL migrations (apply with `supabase db push`)
├─ backend/                    ODDLY API (Rust / Axum)
│  └─ src/
│     ├─ main.rs               Startup, router, graceful shutdown
│     ├─ config.rs             Environment configuration
│     ├─ error.rs              AppError -> JSON error responses
│     ├─ state.rs              Shared state (pool, config, verifier, Supabase admin)
│     ├─ auth/                 JWT verification, AuthUser extractor, permissions
│     ├─ supabase.rs           Supabase Admin API client (create users)
│     ├─ audit.rs              Audit log + activity helpers
│     ├─ validate.rs           Input validation helpers
│     └─ routes/               One module per API area
└─ desktop/                    ODDLY Desktop (Tauri 2 + React)
   ├─ src-tauri/               Rust shell (keychain commands, window config)
   └─ src/
      ├─ components/ui/        shadcn-style primitives (Button, Card, Dialog…)
      ├─ components/layout/    App shell, sidebar, command palette
      ├─ components/states/    Loading / empty / error states
      ├─ config/navigation.ts  Single source of truth for the sidebar & routes
      ├─ features/<module>/    Pages, hooks and API calls per module
      └─ lib/                  API client, Supabase client, formatting, utils
```

## API conventions

- Base path `/api/v1`. JSON in and out. `snake_case` field names.
- Errors: `{ "error": { "code": "forbidden", "message": "…", "fields": { … } } }`.
- Validation runs in the frontend for feedback and **again** in the API, which is the
  authority.
- List endpoints will use `?page=&per_page=` with `{ items, total }` responses.
- Every mutating endpoint writes `audit_logs` (and an `activities` row where it belongs in a
  timeline).

## Delivery phases

1. **Foundation** — workspace, schema, auth, layout, navigation, dashboard API. *(this step)*
2. **Lead Management** — lead CRUD, XLSX/CSV import with mapping & dedupe, lists, research.
3. **CRM & Sales** — pipeline board, interactions, follow-ups, meetings, proposals + PDF, deals.
4. **Clients** — conversion workflow, profiles, services, contracts, history.
5. **Agency Operations** — content studio, media library, websites, projects, team.
6. **Analytics & AI** — reports, exports, OpenAI assistant, automated insights.
7. **Production readiness** — tests, performance, security review, packaging, auto-update.

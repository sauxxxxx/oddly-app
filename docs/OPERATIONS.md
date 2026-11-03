# Running ODDLY in production

Day-to-day operation of the live system: backups, restores, keys, updates and monitoring.
Deployment itself is in [DEPLOYMENT.md](DEPLOYMENT.md).

## What must be backed up

| What | Where it lives | How it's backed up |
|---|---|---|
| Database (all records, users) | Supabase Postgres | Supabase daily backups (Pro plan) **and** `scripts/db-backup.ps1` |
| Uploaded files | Supabase Storage buckets `media`, `documents` | Supabase dashboard → Storage, or the Storage API (not in the database dump) |
| `SECRETS_KEY` | API host environment, `backend/.env` | Password manager. Without it, saved website credentials can't be decrypted |
| Updater signing key | `%USERPROFILE%\.tauri\oddly-updater.key` | Password manager / encrypted drive. Without it, installed apps can't be updated |
| `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `OPENAI_API_KEY` | API host environment | Can be re-issued from Supabase / OpenAI if lost |

### Database backup

```bash
powershell -ExecutionPolicy Bypass -File scripts/db-backup.ps1
```

Writes `backups/oddly-YYYYMMDD-HHMM.dump` (public data + auth users). Needs `pg_dump` 17+
(`winget install PostgreSQL.PostgreSQL.17`). Backups contain personal data: keep them on an
encrypted drive. `backups/` is git-ignored.

Suggested routine: weekly manual dump plus Supabase's automatic daily backups; test a restore
every few months.

### Restore

Restore into a **new** Supabase project (never over the live one unless you mean to):

```bash
pg_restore --dbname="<new project's session pooler URL>" --no-owner --no-privileges --clean --if-exists backups/oddly-YYYYMMDD-HHMM.dump
```

Then point the API's `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY` at the new
project, keep the **same** `SECRETS_KEY`, and update the apps' `VITE_SUPABASE_*` values.

## Desktop releases and auto-update

1. Bump `version` in `desktop/src-tauri/tauri.conf.json`, `desktop/package.json` and the root
   `Cargo.toml` (all three must match).
2. Build: `powershell -ExecutionPolicy Bypass -File scripts/build-desktop-release.ps1 -Notes "What's new"`
3. Upload both files from `release/updates/` (`ODDLY_<version>_x64-setup.exe` and `latest.json`)
   to `https://app.workwithoddly.com/updates/`.

Installed apps check `latest.json` on start and every 6 hours. When there's a newer version an
**Update** button appears; nothing installs until the user clicks *Install and restart*. Every
update is verified against the public key built into the app, so only builds signed with
`oddly-updater.key` are accepted.

## AI assistant

Set on the API host and restart:

| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | from platform.openai.com → API keys (a project key with a spending limit is best) |
| `OPENAI_MODEL` | optional, default `gpt-4.1-mini` |
| `OPENAI_BASE_URL` | optional, any OpenAI-compatible endpoint (default `https://api.openai.com/v1`) |

Settings → Integrations shows whether it's connected. Each user is limited to 40 AI requests
per 10 minutes; dashboard insights are cached for an hour per user.

## Monitoring

- Health: `GET https://api.workwithoddly.com/api/v1/health` → `{"status":"ok","database":"ok"}`.
  Point an uptime monitor (e.g. UptimeRobot) at it.
- Logs: the API logs to stdout (`RUST_LOG=oddly_api=info,tower_http=info`). Errors never include
  secrets or AI keys.
- Settings → Activity Log shows security-relevant actions (sign-ins aside): role changes, exports,
  credential reveals, AI lead analyses, deletions.

## Checks before each release

```bash
cargo test -p oddly-api
```

```bash
npm --prefix desktop run build
```

With `ODDLY_SMOKE=1` set, `cargo test -p oddly-api -- --test-threads=1` also runs the end-to-end
smoke tests against the real database (they create and remove `__oddly_smoke__` records).

# Deploying ODDLY

ODDLY is a **desktop app** the team installs. Only one piece goes online:

| Piece | Address | What it is |
|---|---|---|
| API | `https://api.workwithoddly.com` | The Rust server (`Dockerfile` at the repo root). Holds all secrets, and serves the installer and updates. |

Supabase (database, auth, file storage) stays where it is. The secrets can't be built into the
desktop app: anyone with the installer could extract them and bypass every permission.

(The same React code can also be published as a website — see [Optional: web version](#optional-web-version).)

---

## 1. Put the code on GitHub

Render deploys from Git. Use a **private** repository; `.env` files, keys and installers are
git-ignored and never uploaded.

## 2. Create the API on Render

`render.yaml` describes the service. Render → **New → Blueprint** → connect GitHub → choose the
repo → branch `main`. Render asks once for the secret values:

| Variable | Value |
|---|---|
| `DATABASE_URL` | copy from `backend/.env` (Supabase session pooler) |
| `SUPABASE_SECRET_KEY` | copy from `backend/.env` (`sb_secret_…`) |
| `SECRETS_KEY` | copy from `backend/.env` — **must be the same value**, or stored website credentials can't be decrypted |
| `OPENAI_API_KEY` | your OpenAI key to turn on AI (optional — set a spending limit first), or leave empty |

Copy them from the files on this PC — never paste them into chat. The rest is preset in
`render.yaml`:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://uevhngxijollpkrkbcwq.supabase.co` |
| `CORS_ALLOWED_ORIGINS` | `http://tauri.localhost,tauri://localhost` (the desktop app) |
| `TRUST_PROXY` | `true` |
| `RATE_LIMIT_PER_MINUTE` | `600` |
| `RUST_LOG` | `oddly_api=info,tower_http=info` |

Why these settings:

- **Region Frankfurt.** Supabase is in Ireland (eu-west-1) and the API talks to the database many
  times per request, so it must sit next to the database, not next to the users.
- **Starter plan, one instance.** Free instances sleep, which stops reminders and uptime checks;
  rate limiting and background jobs live in memory, so run exactly one instance.
- Health check `/api/v1/health`; the platform's `PORT` is used automatically.

The first build compiles Rust from scratch (10–20 minutes). Later deploys happen automatically
when `backend/` changes on `main`.

## 3. Custom domain

Render → **oddly-api → Settings → Custom Domains** → add `api.workwithoddly.com`. At your domain
provider add the record Render shows:

| Type | Name | Target |
|---|---|---|
| CNAME | `api` | `oddly-api.onrender.com` (use exactly what Render shows) |

Render issues the HTTPS certificate once DNS points to it. Check
`https://api.workwithoddly.com/api/v1/health` returns `{"status":"ok","database":"ok",…}`.

## 4. Publish the desktop app

Once (creates the private `releases` storage bucket):

```bash
powershell -File scripts/db-push.ps1
```

For every version:

```bash
powershell -ExecutionPolicy Bypass -File scripts/build-desktop-release.ps1 -Notes "What's new"
```

This builds the signed installer against `https://api.workwithoddly.com` and uploads it with
`latest.json` to the `releases` bucket. Then:

- **New teammates** download the latest installer from
  `https://api.workwithoddly.com/api/v1/updates/download`, install it, and sign in with the
  account you created for them in Settings → Team Members.
- **Installed apps** see the new version and show an **Update** button.

Details on versions and signing keys: [OPERATIONS.md](OPERATIONS.md).

## Checklist

1. Code on a private GitHub repo.
2. `oddly-api` live on Render with the secret values; `/api/v1/health` OK on `api.workwithoddly.com`.
3. `releases` bucket created; installer published; download link works.
4. Teammates installed the app and can sign in.

---

## Optional: web version

The same UI can run in a browser at e.g. `https://app.workwithoddly.com`. Host `desktop/` on any
static host (Render Static Site, Cloudflare Pages, Netlify): build command `npm ci && npm run build`
in `desktop`, output `desktop/dist`, Node 22+, and set `VITE_API_URL`
(`https://api.workwithoddly.com/api/v1`), `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
(the publishable key from `desktop/.env.production`). Add the site's address to the API's
`CORS_ALLOWED_ORIGINS`, and set it as the Site URL in Supabase → Authentication → URL Configuration.

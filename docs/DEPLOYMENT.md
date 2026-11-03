# Deploying ODDLY to workwithoddly.com

Two things go online:

| Piece | Address | What it is |
|---|---|---|
| Web app | `https://app.workwithoddly.com` | Static files built from `desktop/` (React). No server code. |
| API | `https://api.workwithoddly.com` | The Rust server (`Dockerfile` at the repo root). Holds all secrets. |

Supabase (database, auth, file storage) stays where it is.

---

## 1. API — `api.workwithoddly.com`

Host it on any service that runs a Dockerfile (Railway, Render, Fly.io, a VPS with Docker…).

- **Region: Europe (London, Amsterdam or Frankfurt).** Your Supabase project is in Ireland
  (eu-west-1) and the API talks to the database many times per request, so the API must sit
  next to the database — not next to the users. This also makes ODDLY faster than running
  the API from Cebu.
- **Run exactly one instance.** Rate limiting is in memory, and the reminder/uptime jobs run
  inside the API.
- Build: Dockerfile at the repository root (build context = repo root).
- Health check path: `/api/v1/health`
- Port: the platform's `PORT` is used automatically.

### API environment variables

Copy the secret values **from `backend/.env` on this PC** — never from chat, and never into the
web app.

| Variable | Value |
|---|---|
| `DATABASE_URL` | copy from `backend/.env` (Supabase session pooler) |
| `SUPABASE_URL` | `https://uevhngxijollpkrkbcwq.supabase.co` |
| `SUPABASE_SECRET_KEY` | copy from `backend/.env` (`sb_secret_…`) |
| `SECRETS_KEY` | copy from `backend/.env` — **must be the same value**, or stored website credentials can't be decrypted |
| `CORS_ALLOWED_ORIGINS` | `https://app.workwithoddly.com,http://tauri.localhost,tauri://localhost` |
| `TRUST_PROXY` | `true` |
| `RATE_LIMIT_PER_MINUTE` | `600` |
| `RUST_LOG` | `oddly_api=info,tower_http=info` |
| `API_BIND_ADDR` | leave unset (the platform's `PORT` is used) |
| `SETUP_TOKEN` | leave unset (the owner account already exists) |
| `OPENAI_API_KEY` | your OpenAI key, to turn on the AI assistant (optional — set a spending limit first) |
| `OPENAI_MODEL` | optional, default `gpt-4.1-mini` |

The two `tauri` origins let the installed desktop app use the same API.

Then add the custom domain `api.workwithoddly.com` in the host's settings and check
`https://api.workwithoddly.com/api/v1/health` returns `{"status":"ok","database":"ok"}`.

---

## 2. Web app — `app.workwithoddly.com`

Host the static build on Cloudflare Pages, Netlify or Vercel (or any static host).

| Setting | Value |
|---|---|
| Root / base directory | `desktop` |
| Build command | `npm ci && npm run build` |
| Output directory | `dist` (i.e. `desktop/dist`) |
| Node version | 22 or newer |
| SPA rewrites | Not needed (the app uses `#/` routes) |

### Web app environment variables (public by design)

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://api.workwithoddly.com/api/v1` |
| `VITE_SUPABASE_URL` | `https://uevhngxijollpkrkbcwq.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the **publishable** key (`sb_publishable_…`) — copy it from `desktop/.env.production` |

`desktop/.env.production` on this PC already contains exactly these values, so
`npm run build` here produces a ready-to-upload `desktop/dist` folder (for hosts where you
drag-and-drop a folder instead of building from Git).

Never put the secret key, database URL or `SECRETS_KEY` in the web app's variables.

---

## 3. DNS at your domain provider

| Type | Name | Target |
|---|---|---|
| CNAME | `app` | the address your static host gives you (e.g. `oddly.pages.dev`) |
| CNAME | `api` | the address your API host gives you |

HTTPS certificates are issued by the hosts once DNS points to them.

---

## 4. Supabase settings

Authentication → URL Configuration:

- **Site URL:** `https://app.workwithoddly.com`
- **Redirect URLs:** add `https://app.workwithoddly.com/**`

(ODDLY signs in with email and password, so these are only used for any emails Supabase sends.)

---

## 5. Desktop installer and updates

```bash
powershell -ExecutionPolicy Bypass -File scripts/build-desktop-release.ps1
```

Produces `release/updates/ODDLY_<version>_x64-setup.exe` and `latest.json`, built against
`https://api.workwithoddly.com`. Share the installer with the team, and upload **both** files to
`https://app.workwithoddly.com/updates/` so installed apps find later versions
(with a Git-based static host: copy them into `desktop/public/updates/` before deploying, or
upload them alongside `dist/`). Details: [OPERATIONS.md](OPERATIONS.md).

---

## Checklist

1. API deployed in Europe with the variables above; `/api/v1/health` is OK.
2. Web app deployed with the three `VITE_` variables.
3. DNS `app` and `api` CNAMEs point to the hosts; both load over HTTPS.
4. Supabase Site URL set.
5. Sign in at `https://app.workwithoddly.com` with your owner account.

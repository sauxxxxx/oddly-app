# Deploying ODDLY

ODDLY is a **desktop app** the team installs. Only one piece runs online:

| Piece | Address | What it is |
|---|---|---|
| API | `https://scout.remarugsimar.com` | The Rust server (`Dockerfile` at the repo root). Holds all secrets, and serves the installer and updates. |

Supabase (database, auth, file storage) stays where it is. The secrets can't be built into the
desktop app: anyone with the installer could extract them and bypass every permission.

## How it runs

The API runs on a VPS in Docker, named **scout**, alongside other apps that it shares nothing with:

| What | Where |
|---|---|
| Files and secrets | `/opt/scout` (`.env` is `chmod 600`, readable by root only) |
| Container | Docker project `scout`, service `api`, restarts automatically |
| Port | `127.0.0.1:3201` — not reachable from the internet |
| HTTPS | nginx site `scout` with a Let's Encrypt certificate that renews automatically |
| DNS | `A` record `scout` → the VPS IP, **DNS only**, in Cloudflare (remarugsimar.com) |

Supabase is in Ireland and the VPS in Malaysia, about 190 ms per database round trip. That's why
endpoints use set-based SQL and concurrent queries. If it ever feels slow, moving the database
closer (Supabase Singapore) helps more than a faster server.

SSH uses the key at `%USERPROFILE%\.ssh\oddly_vps`. The VPS IP is deliberately not in this repo.

## Deploying a new API version

Commit first — only committed code is deployed.

```bash
powershell -ExecutionPolicy Bypass -File scripts/deploy-vps.ps1 -Server root@<vps-ip>
```

This uploads the source, builds on 2 of the 4 CPU cores so the other apps keep running, and
restarts only Scout. Add `-UpdateEnv` when `backend/.env` changed. Then check
`https://scout.remarugsimar.com/api/v1/health`.

The `.env` on the server is a copy of `backend/.env`. `deploy/compose.vps.yml` overrides the
settings that differ in production (`TRUST_PROXY`, CORS, bind address).

### First-time setup on a new server

1. Add an `A` record for the address, then deploy with `-UpdateEnv`.
2. Create the nginx site on port 80 only, run `certbot certonly --webroot -w /var/www/html -d <address>`,
   then install `deploy/nginx-scout.conf` to `/etc/nginx/sites-available/scout`.
   Always run `nginx -t` before `systemctl reload nginx`: the server hosts other sites.

## Publishing the desktop app

Once (creates the private `releases` storage bucket):

```bash
powershell -File scripts/db-push.ps1
```

For every version:

```bash
powershell -ExecutionPolicy Bypass -File scripts/build-desktop-release.ps1 -Notes "What's new"
```

This builds the signed installer against the API in `desktop/.env.production` and uploads it
with `latest.json` to the `releases` bucket. Then:

- **New teammates** download the latest installer from
  `https://scout.remarugsimar.com/api/v1/updates/download`, install it, and sign in with the
  account you created for them in Settings → Team Members.
- **Installed apps** see the new version and show an **Update** button.

Details on versions and signing keys: [OPERATIONS.md](OPERATIONS.md).

# Security model

How ODDLY protects data, and what was checked before release 1.0.

## Boundaries

- **Apps hold no secrets.** The desktop and web apps only know the API URL and Supabase's
  publishable key (used for sign-in). The database URL, Supabase secret key, `SECRETS_KEY`
  and OpenAI key exist only on the API server.
- **All data goes through the API.** Every table has Row Level Security enabled with no
  policies, so the publishable key can't read or write anything directly. The API connects
  as the table owner and enforces permissions itself.
- **Every request is authenticated and authorized.** The API verifies the Supabase JWT
  (JWKS, ES256/RS256), loads the member's profile, roles and permissions, and each handler
  checks a permission key (`leads.view`, `finance.view`, …). Lead visibility is narrowed to
  assigned leads and assigned lead lists unless the role has `leads.view_all`.
- **Deactivated users are locked out** on their next request, and their Supabase account is banned.
- **Temporary passwords** must be changed before anything else is allowed.

## AI

- The OpenAI key stays on the server; the apps call ODDLY's API, never OpenAI.
- The assistant's tools are read-only and call the same handlers as the app, **as the signed-in
  user**, so it can only see what that user can see. Tools for areas the role can't access aren't
  offered at all.
- The assistant cannot send messages, change records, approve proposals or publish content.
  Drafts are shown for the user to edit and copy.
- Lead analyses are stored separately from the team's research, labeled "AI suggestions — not
  verified", and list what must be checked. Prompts forbid inventing business facts and
  combining currencies; text inside records is treated as data, not instructions.
- Conversations are private to their owner. AI calls are rate-limited per user.

## Stored credentials

Website logins are encrypted with AES-256-GCM (`SECRETS_KEY`), revealed only to users with
`websites.secrets`, and every reveal is written to the audit log.

## HTTP hardening

- CORS limited to the desktop app's origins.
- Installers and `latest.json` are served from a private bucket; only file names of the form
  `ODDLY_<version>_x64-setup.exe` can be requested, through 10-minute signed links.
- Per-IP rate limit. With `TRUST_PROXY=true` the client IP comes from the proxy; nginx replaces
  `X-Forwarded-For`, so clients can't fake it.
- The API listens only on `127.0.0.1`; the internet reaches it through nginx over HTTPS.
- 2 MB request body limit; uploads go straight to Supabase Storage through short-lived signed URLs.
- 150 s request timeout; panics return a 500 instead of dropping the connection.
- Responses carry `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- Uptime checks refuse private, loopback, link-local and CGNAT addresses and don't follow
  redirects (no server-side request forgery into internal networks).
- The desktop app has a strict Content Security Policy; external links open in the system browser.

## Desktop app

- The session is stored in the OS keychain (Windows Credential Manager), not in browser storage.
- Updates are signed; the app only installs builds that verify against its built-in public key,
  and only after the user clicks *Install and restart*.

## Release checklist (1.0)

- [x] No secrets in the web bundle (checked: only the publishable key and API URL).
- [x] `.env` files, backups and installers are git-ignored and docker-ignored.
- [x] RLS enabled on every table; `lead_overview` view uses `security_invoker`.
- [x] Permission checks on every route; smoke tests cover a restricted member for analytics and AI.
- [x] Money is reported per currency only.
- [x] AI: server-side key, read-only tools under the user's permissions, no autonomous actions.
- [ ] Rotate `SUPABASE_SECRET_KEY` if it was ever shared outside the API host.
- [ ] Set an OpenAI spending limit before adding `OPENAI_API_KEY`.
- [ ] Back up `SECRETS_KEY` and the updater signing key to a password manager.

# YouTube Guardian

A Chrome Manifest V3 parental-control extension for YouTube, plus an optional family **portal** you can run locally or on [Railway](https://railway.app). The parent sets a password, maintain two independent allowlists (regular videos vs Shorts), and can pair the browser with the portal to edit lists from anywhere.

The repository is a small monorepo:

```
extension/   Chrome MV3 unpacked extension
portal/      Node/TypeScript admin app + device API
tests/       Allowlist, password, storage, and headless Chrome checks
```

## Defaults (read this)

| List | Empty list means | Independent? |
| --- | --- | --- |
| **Channels** (regular `/watch` videos) | **Allow all** regular videos | Yes |
| **Shorts** (`/shorts/…`) | **Block all** Shorts | Yes |

A channel allowed for regular videos is **not** automatically allowed for Shorts, and vice versa. These defaults are shown in the popup and on the portal.

If you migrate from the old single whitelist, existing `chrome.storage.sync` entries are copied once into the **channel** allowlist. Shorts stay blocked until you add channels there.

## Load the extension (unpacked)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** and select the `extension/` folder in this repo
4. Pin **YouTube Guardian**

### Onboarding

1. Click the toolbar icon.
2. On first use, set a parent password and confirm it (minimum 8 characters).
3. Only a **salted PBKDF2-SHA-256 hash** is stored in `chrome.storage.local`. The password is never written in plaintext and is never committed to git.
4. Unlock to edit lists, change the password, or pair with the portal.

There is **no password recovery**. If you forget it, remove the extension (this clears local storage) and load it again. If the browser was paired, re-pair after setup to pull allowlists from the portal.

### Using it on YouTube

- Non-allowlisted regular videos (when the channel list is non-empty) and all non-allowlisted Shorts are paused and covered with a block screen.
- The block screen shows the channel **@handle** and/or **UC… id** with a **Copy** button.
- A parent can type the password on that screen to add the channel to the **matching** list (Shorts vs regular) and resume. Password checks run in the **service worker**, not in page JavaScript. The hash is not exposed to the page, `externally_connectable` is not enabled, and the overlay uses a closed shadow root.

## Run the portal locally

Requires **Node.js 22+**.

```bash
cd portal
cp .env.example .env
# edit ADMIN_PASSWORD and SESSION_SECRET
npm install
# SQLite file ./data/portal.db by default
ADMIN_PASSWORD='…' SESSION_SECRET='…' npm run dev
```

Open http://localhost:3000, sign in with `ADMIN_PASSWORD`, create a device, copy the **pairing token** (shown once) and the portal URL.

### Pair the extension

1. Unlock the popup → **Portal pairing**
2. Paste the portal URL (e.g. `http://localhost:3000` or your Railway URL)
3. Paste the pairing token
4. Chrome will ask for permission to contact that origin — allow it
5. Lists pull on startup, every 5 minutes, after local edits, and via **Sync now**

Unpaired browsers keep working with **local-only** storage.

## Environment variables (portal)

| Variable | Required | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | **yes** | Password for the web UI (never commit this) |
| `SESSION_SECRET` | **yes** | Signs the admin session cookie; use a long random string |
| `DATABASE_URL` | for Postgres | `postgresql://…` on Railway (or any hosted Postgres) |
| `SQLITE_PATH` | no | SQLite file when `DATABASE_URL` is not Postgres (default `./data/portal.db`) |
| `PORT` | no | Listen port (Railway sets this; local default `3000`) |
| `PUBLIC_URL` | recommended in prod | Canonical portal URL shown with pairing tokens (`https://your-app.up.railway.app`) |
| `NODE_ENV` | no | Set `production` in deploy so the session cookie is `Secure` |

## Railway deploy

1. Create a Railway project and add a **Postgres** plugin/service.
2. Create a service from this GitHub repo (root directory = repository root).
3. Railway picks up `railway.toml` → `portal/Dockerfile` and `/health`.
4. Set variables on the **web service** (not only on Postgres):

   - `ADMIN_PASSWORD`
   - `SESSION_SECRET`
   - `DATABASE_URL` (Railway usually injects this when you link Postgres; confirm it)
   - `PUBLIC_URL` = `https://<your-service>.up.railway.app`

5. Deploy. Check `GET /health` → `{ "ok": true, ... }`.
6. Sign in, create a device, pair the extension using `PUBLIC_URL` + the one-time token.

Without `DATABASE_URL`, the container uses SQLite on a ephemeral filesystem — **lists will disappear on restart**. Use Postgres on Railway.

Alternative: set the service **root directory** to `portal/` and use a Node build (`npm run build` / `npm start`) with the same env vars. You still need Node 22 for `node:sqlite` if you are not on Postgres.

## Tests & build

```bash
npm --prefix portal install
npm test                 # unit tests + portal API tests + headless Chrome (if available)
npm run portal:build     # TypeScript compile
```

## Storage / sync design

The extension wraps allowlists and settings behind a **storage facade**:

- Synchronous reads from an in-memory cache
- Cache is hydrated from `chrome.storage.local` and kept in sync with `onChanged`
- Async writes
- Optional **portal adapter** (`GET/PUT /api/device/state` with `Authorization: Bearer <pairing token>`)

Swap or add another backend by implementing the same `pull` / `push` adapter.

## Data model notes (future)

Tables already exist in the portal database (no UI/API yet):

- `watch_events` — playback history and stats
- `daily_time_limits` — per-weekday minute caps (`weekday` 0 = Sunday … 6 = Saturday)
- `channel_age_analysis` — stub for age-appropriateness of a channel

## Security notes

- Never commit `.env`, pairing tokens, or `ADMIN_PASSWORD`.
- The old hardcoded popup password was removed; do not put a real password in source.
- Device pairing tokens are stored as SHA-256 hashes. The plaintext token is shown **once** at creation.
- Page JavaScript on YouTube cannot call the extension (no `externally_connectable`). Quick-add verifies the password in the background service worker.

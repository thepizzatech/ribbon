# Ribbon

A mobile-first family gift tracker you host yourself. Track gifts your household gives and receives, see what needs you (thank-yous, gifts still to buy), look back over the year, and ask plain-language questions about your ledger. Light and dark themes.

> **Status: pre-release (`0.2.0-dev`).** It works and keeps your data on your own server, but expect rough edges. It is built for one family.

Everything (family, people, gifts, occasions, logins) lives in one SQLite file on the server, so every phone and laptop sees the same data.

## Run it for your family (Docker)

You need Docker with the Compose plugin, on Ubuntu or anywhere else.

```bash
git clone https://github.com/thepizzatech/ribbon && cd ribbon
cat > .env <<'ENV'
SITE_ADDRESS=ribbon.example.com   # or ribbon.lan, or your server's IP like 10.15.40.16
ENV
docker compose -f docker-compose.prod.yml up -d --build
```

Open `https://<SITE_ADDRESS>`. The first visit walks you through setup: your family name, who is in the family (name, relationship, whether they live in your household), then the owner login. There is no sample data in production. Add the rest of the family's logins later in **Settings → Family logins**.

What runs:

- **ribbon**: the app. It publishes no port to the host; only the proxy can reach it.
- **caddy**: terminates HTTPS and publishes ports `80` (redirects to HTTPS) and `443`. Change them with `HTTP_PORT` and `HTTPS_PORT` in `.env` if something else on the host already uses them (see below).

The database lives in the `ribbon_data` Docker volume and survives restarts, rebuilds and `docker compose down` (only `down -v` deletes it).

### HTTPS and certificates

HTTPS is required in production (`ENFORCE_HTTPS=true` in the production compose): plain HTTP is redirected, cookies are marked `Secure`, and the app sends HSTS, a Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy` and `frame-ancestors 'none'`.

`SITE_ADDRESS` decides how the certificate is made:

| `SITE_ADDRESS` | Certificate |
| --- | --- |
| A real domain pointing at your server (`ribbon.example.com`), with ports 80 and 443 reachable from the internet | Let's Encrypt, automatic. Set `ACME_EMAIL` if you want expiry notices. |
| A LAN IP (`10.15.40.16`), a LAN name (`ribbon.lan`, `myserver`) or `localhost` | Caddy's own local certificate authority (`tls internal`). Browsers don't trust it until you install its root certificate (next section). |

`TLS_MODE=internal` or `TLS_MODE=acme` overrides the automatic choice.

### Trusting the local certificate on phones and PCs (LAN setups)

With a LAN address the browser shows a certificate warning until each device trusts Caddy's local root CA. Do this once per device.

1. Export the root certificate from the server:

   ```bash
   docker compose -f docker-compose.prod.yml cp caddy:/data/caddy/pki/authorities/local/root.crt ./ribbon-root.crt
   ```

2. Copy `ribbon-root.crt` to the device (AirDrop, email, USB) and install it:
   - **iPhone/iPad:** open the file, then Settings → General → VPN & Device Management → install the profile. Then Settings → General → About → Certificate Trust Settings → turn on full trust for "Caddy Local Authority".
   - **Android:** Settings → Security (or Security & privacy) → More security settings → Encryption & credentials → Install a certificate → CA certificate, then pick the file.
   - **Windows:** double-click the file → Install Certificate → Local Machine → "Trusted Root Certification Authorities".
   - **macOS:** open it in Keychain Access (System keychain), double-click the certificate → Trust → "Always Trust".
   - **Linux (Chrome/Chromium):** Settings → Privacy and security → Security → Manage certificates → Authorities → Import. Firefox has its own list under Settings → Privacy & Security → View Certificates → Authorities.

Keep the `caddy_data` volume: it holds that root key. If you delete it, devices have to trust the new root again.

### Ports already in use

Caddy needs one port for HTTPS. If `443` (or `80`) is taken on the host, pick others in `.env`:

```
HTTP_PORT=8081
HTTPS_PORT=8443
```

Then open `https://<SITE_ADDRESS>:8443`. Plain-HTTP requests to the HTTP port are redirected to the HTTPS port. Let's Encrypt needs the standard 80 and 443, so use a LAN address with custom ports.

To adjust things for your host without editing the compose file, use a `docker-compose.override.yml`. Don't publish the `ribbon` service's port in an override: that gives a side door that skips the proxy.

### Settings (environment variables)

Put these in `.env` next to the compose file (never commit it).

| Variable | Default | What it does |
| --- | --- | --- |
| `SITE_ADDRESS` | `localhost` | Address people type; picks the certificate type. |
| `HTTP_PORT` / `HTTPS_PORT` | `80` / `443` | Ports Caddy listens on and the host publishes. |
| `TLS_MODE` | `auto` | `auto`, `internal` (local CA) or `acme` (Let's Encrypt). |
| `ACME_EMAIL` | unset | Contact address for Let's Encrypt. |
| `SETUP_CODE` | unset | If set, whoever creates the first owner login must type it. Use it if the server is on a network you don't fully trust. |
| `XAI_API_KEY` | unset | Turns on the Ask page. A question sends a trimmed copy of your gift list to xAI. Everything else works without it. |
| `SEED_SAMPLE_DATA` | `false` in production, `true` in development | Loads a sample household into a brand-new database. |
| `ENFORCE_HTTPS` | `true` in the production compose, `false` in the bare image | Redirect to HTTPS, HSTS, Secure cookies. |
| `DATA_DIR` | `/data` | Folder holding `ribbon.db`. |
| `GIT_COMMIT` | unset | Short commit SHA shown in Settings → About. Set at build time. |
| `PORT` | `8080` | Port the app listens on inside the container. |

Running the bare image without the proxy (not recommended): `ENFORCE_HTTPS=false`. If you do enforce HTTPS but terminate TLS somewhere else, set `PUBLIC_URL=https://your.host` so redirects point at the right place, and make sure your proxy sets `X-Forwarded-Proto`.

### Accounts

- Sign in with a username (or email) and password. Passwords are stored as scrypt hashes; sessions are kept server-side and last 14 days; the cookie is `HttpOnly`, `SameSite=Lax` and `Secure`.
- Every change is protected with a CSRF token and an Origin check.
- Repeated wrong passwords lock the account out for 15 minutes.
- **Owners** can add and remove logins and set roles in Settings. **Members** can use the ledger.
- Everyone can change their own password (other devices are signed out) and sign out.
- Forgot the owner password? Another owner can add a new login. If you have no other owner, stop the container, and ask for help in an issue: there is deliberately no back door.

### Upgrading

```bash
cd ribbon && git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Your data volume is kept and migrated in place. Coming from a version before accounts (`APP_PASSCODE`, no sign-in): the first visit asks you to create the owner login. Nothing is wiped, and no family setup is asked for, because your ledger already exists. `APP_PASSCODE` no longer does anything and can be removed from `.env`. See [CHANGELOG.md](CHANGELOG.md).

### Backups

Your data is one file, `ribbon.db`, inside the `ribbon_data` volume. Either:

- **Export from the app:** Settings → Export ledger saves a JSON file (gifts, people, occasions; not logins). Import restores it. The same JSON is at `/api/export` when signed in.
- **Copy the database file** (logins and sessions included). Stop the app for a perfectly clean copy:

  ```bash
  docker compose -f docker-compose.prod.yml stop ribbon
  docker run --rm -v ribbon_ribbon_data:/data -v "$PWD":/backup busybox cp /data/ribbon.db /backup/ribbon-backup.db
  docker compose -f docker-compose.prod.yml start ribbon
  ```

  The volume is named `<folder>_ribbon_data`; check with `docker volume ls`. To restore, put the file back at `/data/ribbon.db` while the app is stopped.

## Develop

Needs Node 22.13 or newer (Ribbon uses Node's built-in `node:sqlite`).

```bash
npm ci
DATA_DIR=./data npm run dev      # http://localhost:8080
```

In development `SEED_SAMPLE_DATA` defaults to on: a sample household is loaded and a dev login is created, with a loud message in the terminal (username `admin`, password `ribbon-dev-password`; override with `DEV_USERNAME` / `DEV_PASSWORD`). It is never created in production or when sample data is off. Set `SEED_SAMPLE_DATA=false` to try first-run setup.

With Docker: `docker compose up --build`, then open http://localhost:8080. Source is mounted, so edits show live; dev data lives in the `ribbon_dev_data` volume.

Scripts: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`, `npm start` (runs `.output`; set `DATA_DIR`).

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/RELEASING.md](docs/RELEASING.md).

## How it works

- TanStack Start (React, Vite, Tailwind), built to a standalone Node server (Nitro).
- `src/server/` holds the SQLite schema and migrations (run on startup), accounts and sessions, security checks, the ledger rules and the JSON API at `/api/*`. `server/middleware` adds HTTPS redirect and security headers in production.
- The browser keeps an instant copy of the ledger (React Query) and sends each change to the API; if the server refuses one, the screen snaps back to the server's copy.
- Version: `/api/health` returns `{ ok, version, commit }`; Settings → About and the sidebar footer show the same.

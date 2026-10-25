# Ribbon

A mobile-first family gift tracker you host yourself. Track gifts your household gives and receives, see what needs you (thank-yous, gifts still to buy), look back over the year, and ask plain-language questions about your ledger. Light and dark themes.

> **Status: pre-release (`0.2.0-dev`).** It works and keeps your data on your own server, but expect rough edges. It is built for one family.

Everything (family, people, gifts, occasions, logins) lives in one SQLite file on the server, so every phone and laptop sees the same data.

## Run it for your family (Docker)

You need Docker with the Compose plugin.

```bash
mkdir ribbon && cd ribbon
curl -fsSLO https://raw.githubusercontent.com/thepizzatech/ribbon/main/docker-compose.yml
docker compose up -d
```

Open `http://<your-server-ip>:8080`. The first visit walks you through setup: your family name, who is in the family, then the owner login. Add the rest of the family's logins later in **Settings**.

Ribbon speaks plain HTTP on port 8080, which is fine on your home network. For HTTPS (needed to reach it from outside, and to install it as an app on a phone), put it behind a reverse proxy: see [docs/REVERSE-PROXY.md](docs/REVERSE-PROXY.md) for Nginx Proxy Manager, Caddy, Traefik, Tailscale and Cloudflare Tunnel. Ribbon refuses password sign-in over plain HTTP from outside your private network unless you set `ALLOW_INSECURE_LOGIN=true`.

The database lives in the `ribbon_data` Docker volume and survives restarts and `docker compose down` (only `down -v` deletes it). To build from source instead of pulling the image: `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.

### Settings (environment variables)

Put these in a `.env` file next to the compose file (see `.env.example`; never commit it).

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8080` | Host port the compose file publishes (the app always listens on 8080 inside). |
| `RIBBON_TAG` | `latest` | Image tag: `latest`, `dev` (newest main) or a version. |
| `PUBLIC_URL` | unset | The address people type when behind an HTTPS proxy. |
| `TRUSTED_PROXIES` | loopback + private ranges | Peers whose `X-Forwarded-*` headers are believed (`none`, or a CIDR list). |
| `ALLOW_INSECURE_LOGIN` | `false` | Allow password sign-in over plain HTTP from public addresses. |
| `HSTS` | on | `off` disables the Strict-Transport-Security header (only sent over HTTPS anyway). |
| `SETUP_CODE` | unset | If set, whoever creates the first owner login must type it. |
| `XAI_API_KEY` | unset | Turns on the Ask page. A question sends a trimmed copy of your gift list to xAI. |
| `SEED_SAMPLE_DATA` | `false` in production, `true` in development | Loads a sample household into a brand-new database. |
| `DATA_DIR` | `/data` | Folder holding `ribbon.db`. |
| `GIT_COMMIT` | unset | Short commit SHA shown in Settings → About. Set at build time. |

### Accounts

- Sign in with a username (or email) and password. Passwords are stored as scrypt hashes; sessions are kept server-side and last 14 days; the cookie is `HttpOnly` and `SameSite=Lax`, and `Secure` whenever the connection is HTTPS.
- Every change is protected with a CSRF token and an Origin check.
- Repeated wrong passwords lock the account out for 15 minutes.
- **Owners** can add and remove logins and set roles in Settings. **Members** can use the ledger.
- Everyone can change their own password (other devices are signed out) and sign out.
- Forgot the owner password? Another owner can add a new login. If you have no other owner, stop the container, and ask for help in an issue: there is deliberately no back door.

### Upgrading

```bash
cd ribbon && git pull
docker compose pull && docker compose up -d
```

Your data volume is kept and migrated in place. Coming from a version before accounts (`APP_PASSCODE`, no sign-in): the first visit asks you to create the owner login. Nothing is wiped, and no family setup is asked for, because your ledger already exists. `APP_PASSCODE` no longer does anything and can be removed from `.env`. See [CHANGELOG.md](CHANGELOG.md).

### Backups

Your data is one file, `ribbon.db`, inside the `ribbon_data` volume. Either:

- **Export from the app:** Settings → Export ledger saves a JSON file (gifts, people, occasions; not logins). Import restores it. The same JSON is at `/api/export` when signed in.
- **Copy the database file** (logins and sessions included). Stop the app for a perfectly clean copy:

  ```bash
  docker compose stop ribbon
  docker run --rm -v ribbon_ribbon_data:/data -v "$PWD":/backup busybox cp /data/ribbon.db /backup/ribbon-backup.db
  docker compose start ribbon
  ```

  The volume is named `<folder>_ribbon_data`; check with `docker volume ls`. To restore, put the file back at `/data/ribbon.db` while the app is stopped.

## Develop

Needs Node 22.13 or newer (Ribbon uses Node's built-in `node:sqlite`).

```bash
npm ci
DATA_DIR=./data npm run dev      # http://localhost:8080
```

In development `SEED_SAMPLE_DATA` defaults to on: a sample household is loaded and a dev login is created, with a loud message in the terminal (username `admin`, password `ribbon-dev-password`; override with `DEV_USERNAME` / `DEV_PASSWORD`). It is never created in production or when sample data is off. Set `SEED_SAMPLE_DATA=false` to try first-run setup.

With Docker: `docker compose -f docker-compose.dev.yml up --build`, then open http://localhost:8080. Source is mounted, so edits show live; dev data lives in the `ribbon_dev_data` volume.

Scripts: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`, `npm start` (runs `.output`; set `DATA_DIR`).

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/RELEASING.md](docs/RELEASING.md).

## How it works

- TanStack Start (React, Vite, Tailwind), built to a standalone Node server (Nitro).
- `src/server/` holds the SQLite schema and migrations (run on startup), accounts and sessions, security checks, the ledger rules and the JSON API at `/api/*`. `server/middleware` adds HTTPS redirect and security headers in production.
- The browser keeps an instant copy of the ledger (React Query) and sends each change to the API; if the server refuses one, the screen snaps back to the server's copy.
- Version: `/api/health` returns `{ ok, version, commit }`; Settings → About and the sidebar footer show the same.

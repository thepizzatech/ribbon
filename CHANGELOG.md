# Changelog

All notable changes to Ribbon are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/) (pre-releases look like `0.2.0-beta.1`).

## [Unreleased]

## [0.3.0-dev.1] - 2026-10-25

Development build. Not released: `main` stays the development branch. Details of each feature: [docs/FEATURES.md](docs/FEATURES.md).

### Added

- **Wishlists** per person with surprise-safe reserve and purchased marks (hidden from the list's owner by the server), and "convert to gift".
- **Budgets** per person or occasion, **upcoming dates** (birthdays, anniversaries, recurring occasions) and a secret-link **calendar feed (.ics)** with reminders.
- **Scheduled SQLite backups** (`BACKUP_CRON`, `BACKUP_KEEP`) with download, back-up-now and restore.
- **CSV import and export** with a template, column mapping and a preview.
- **Households as separate ledgers**, with **sharing between households** (invite, choose shared people, unlink) and server-side visibility checks.
- **Secret Santa** across linked households, with exclusions and a derangement draw.
- **Single sign-on** (OIDC with PKCE) and **passkeys**.
- **Settings page** (general, account, data, sharing, help).
- **PWA**: manifest, icons, service worker, offline page.
- **Guided tour** (driver.js, seven skippable steps), replayable from Settings → Help. State is saved per login via `POST /api/me/tour`. Off by default in sample-data development mode; `TOUR_ALWAYS=true` forces it.
- A `ghcr.io/thepizzatech/ribbon:dev` image is published from every push to `main`.

### Changed

- Version bumped to 0.3.0-dev.1.
- A production image never contains sample data; first run asks for the family name, members and roles.

### Breaking

- **The bundled Caddy proxy is gone.** `docker-compose.prod.yml`, `deploy/caddy-entrypoint.sh` and the `SITE_ADDRESS`, `HTTP_PORT`, `HTTPS_PORT` and `TLS_MODE` settings no longer exist, and Ribbon no longer redirects HTTP to HTTPS itself. Ribbon listens on plain HTTP, port 8080, and `docker-compose.yml` publishes `${PORT:-8080}:8080`. Put your own HTTPS proxy in front (see `docs/REVERSE-PROXY.md`), or use the optional `docker-compose.caddy.yml` overlay.
- The default `docker-compose.yml` now **pulls `ghcr.io/thepizzatech/ribbon`** instead of building. Build from source with `docker-compose.build.yml`; the old development compose is `docker-compose.dev.yml`. The `ribbon_data` volume name is unchanged, so data carries over.
- `ENFORCE_HTTPS` is deprecated (logs a warning). It now means "refuse password sign-in over plain HTTP from everywhere".
- If you ran the old production compose, update your reverse-proxy/bookmarks to the new address, and remove any override that published the app port next to Caddy.

### Added (HTTPS and proxies)

- `PUBLIC_URL` and `TRUSTED_PROXIES`. `X-Forwarded-Proto`, `-Host` and `-For` are honoured only from trusted peers (default: loopback and private ranges, including Tailscale's `100.64/10`); previously any client could set them.
- The `Secure` cookie flag, the `__Host-` prefix and HSTS follow the effective scheme. HSTS is six months without `includeSubDomains`; `HSTS=off` disables it. Plain-HTTP LAN sign-in works.
- Password sign-in over plain HTTP from public addresses is refused unless `ALLOW_INSECURE_LOGIN=true`. A "Connection not secure" notice appears on the sign-in page and in Settings.
- `docs/REVERSE-PROXY.md` with recipes for Nginx Proxy Manager, Caddy, Traefik, Tailscale and Cloudflare Tunnel.

## [0.2.0-dev.1] - 2026-10-24

First development build of 0.2. Not released yet: `main` is the development branch (see [docs/RELEASING.md](docs/RELEASING.md)).

### Breaking

- **`APP_PASSCODE` is removed**, along with the shared-passcode screen. Ribbon now has real accounts. After upgrading, the first visit asks you to create the owner login (your existing ledger is kept). The variable is ignored and can be deleted from `.env`.
- **`docker-compose.prod.yml` now runs Caddy in front of the app** and the app no longer publishes port 8080. Open `https://<SITE_ADDRESS>` instead of `http://<server>:8080`. If your own override file publishes the app's port, remove that.
- Production sets `ENFORCE_HTTPS=true`: plain HTTP is redirected and cookies are `Secure`.

### Added

- **New look**: a "Margin"-style dashboard. Overview with a "Gifts this year" hero, a Needs-you list, a 12-month chart, a breakdown by occasion or person, and an insight card tied to Ask. Sortable Ledger table with status dots, People grid with a person detail view, Ask restyled. Full-screen on phones with a bottom nav.
- **Dark theme**: follows your device first; the toggle is remembered.
- **First-run setup** instead of sample data: family name, family members (name, relationship, in your household or not), then the owner login. Lands on an empty Overview with "Add your first gift".
- `SEED_SAMPLE_DATA` (default on in development, off in production and in the image).
- **Accounts**: username or email plus password (scrypt), server-side sessions, CSRF protection, Origin checks, login lockout, sign out, change password. Owners add and remove family logins (owner or member) in Settings.
- **HTTPS**: `ENFORCE_HTTPS` redirect, HSTS, Secure cookies, CSP and other security headers. A Caddy proxy in the production compose, with Let's Encrypt for real domains and a local CA for LAN addresses. `HTTP_PORT` and `HTTPS_PORT` for hosts where 80 and 443 are taken.
- People have a relationship (wife, son, aunt, ...). Existing people are migrated by guessing from their old role text, defaulting to "other".
- Version shown in Settings → About, the sidebar footer and `/api/health` (with the short commit when built with `GIT_COMMIT`).
- Optional `SETUP_CODE` to protect creation of the first owner login.
- `LICENSE` (MIT), `SECURITY.md`, `CONTRIBUTING.md`, issue templates and the release workflow.

### Fixed
- Caddy: set `default_sni` so HTTPS works when the site is opened by IP address behind Docker port mapping.

### Changed

- A ledger saved by an older browser-only version is now offered for import once after sign-in, instead of being copied automatically. It is only offered when the server has no gifts of its own yet (or only the sample household).
- Database migration 2 (additive): `users` and `sessions` tables and `people.relationship`. Existing data is untouched.

## [0.1.0] - 2026-10-23

### Added

- SQLite storage on a Docker volume with a JSON API, import and export, and `/api/health`.
- Docker image (non-root, health check), compose files, README and CI.
- Optional shared passcode (`APP_PASSCODE`).

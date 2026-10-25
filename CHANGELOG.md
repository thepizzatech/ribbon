# Changelog

All notable changes to Ribbon are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/) (pre-releases look like `0.2.0-beta.1`).

## [Unreleased]

## [0.3.0-dev.2] - 2026-10-25

Development build. Adds the Welcome setup and the result of a full security review ([docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md)).

### Changed

- **Onboarding is split in two.** The first visit only creates the owner account. Right after the first sign-in a full-page **Welcome setup** asks for the family name and family members (name and role), then opens the empty Overview and the guided tour. Progress is saved on the server so it resumes if abandoned, and the server holds the rest of the API closed (`409 welcome_setup_required`) until it is done. Existing installs with data count as complete, members never see it, and sample-data development mode skips it. `POST /api/setup` still accepts `familyName` and `people` for scripts.
- Password hashing is stronger (scrypt N=2^16, r=8, p=2). Existing hashes keep working and are upgraded on the owner's next sign-in.
- Sign-in lockout counts misses per account and address, per account from anywhere, and per address across accounts, so rotating or forging `X-Forwarded-For` no longer dodges it. Passkey sign-in has its own counters and no longer shares one global lockout.
- Passkeys now require user verification (PIN, fingerprint or face).
- `docker-compose.yml` drops all Linux capabilities and sets `no-new-privileges`. GitHub Actions use read-only tokens by default, job-level write permissions and SHA-pinned actions; Dependabot is enabled.
- A Secret Santa organiser can no longer switch peeking on after the names are drawn (turn it on before drawing).

### Added

- `ALLOW_PUBLIC_SETUP`. **Heads-up:** with no `SETUP_CODE`, the first owner can now only be created from your home network (the setup page says so). If your server is reachable from the internet and you have not created the owner yet, set `SETUP_CODE` first.
- Setup-code guesses are rate limited and compared in constant time.
- `.env.example` is now actually tracked in git.

### Fixed (security)

- A request path with broken percent-encoding (such as `/%E0%A4%A`) left the connection hanging forever; it now answers 400.
- Chunked uploads without `Content-Length` are cut off at the 5 MB (256 MB for restore) cap while reading instead of after buffering.
- A restore file with no owner login is refused (it would have locked everyone out and re-opened first-run setup). Uploaded databases are opened with `trusted_schema=OFF`, and backup files and folder are owner-only on disk.
- The person who set up Ribbon can no longer be demoted or removed by another owner.
- Wishlist links imported from CSV follow the same http(s)-only rule as the form; the client also checks before rendering a link.
- A person's name with a bare carriage return or control character can no longer inject lines into the calendar feed.
- Removing yourself from the ledger no longer reveals whether a surprise is planned for you.
- Single sign-on: the provider's endpoints must be https (or private-network http), redirects are refused when talking to the provider, and starting SSO is rate limited.
- Ask: per-person rate limit, Origin and Welcome-setup checks, and the ledger is passed to the model as delimited untrusted data.
- Passkey ids with broken percent-encoding no longer cause a 500; the open passkey-challenge table is capped and its options endpoint is rate limited.
- `Cross-Origin-Resource-Policy: same-origin` on every response and `Cache-Control: no-cache` on the HTML shell.
- Dependencies updated (`npm audit`: 0 known vulnerabilities).

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

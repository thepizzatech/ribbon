# Changelog

All notable changes to Ribbon are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/) (pre-releases look like `0.2.0-beta.1`).

## [Unreleased]

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

### Changed

- A ledger saved by an older browser-only version is now offered for import once after sign-in, instead of being copied automatically. It is only offered when the server has no gifts of its own yet (or only the sample household).
- Database migration 2 (additive): `users` and `sessions` tables and `people.relationship`. Existing data is untouched.

## [0.1.0] - 2026-10-23

### Added

- SQLite storage on a Docker volume with a JSON API, import and export, and `/api/health`.
- Docker image (non-root, health check), compose files, README and CI.
- Optional shared passcode (`APP_PASSCODE`).

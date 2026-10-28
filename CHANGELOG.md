# Changelog

All notable changes to Ribbon are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/) (pre-releases look like `0.2.0-beta.1`).

## [Unreleased]

Development build `0.4.0-dev.3`: the desktop layout. Phones are unchanged apart from the Calendar's new title. No data or settings changes.

### Changed

- **Every page fills the desktop screen.** The page used to stop at 1240 px and sit in the middle, which left wide empty margins on a 1080p or larger monitor while the Calendar filled the window. All pages now use the full width beside the sidebar (up to 2200 px), with the same side padding as the Calendar.
- **Overview** keeps its three columns but they now grow with the window instead of stopping at 1240 px.
- **People** shows as many cards per row as fit, adds each person's birthday, and has a "Coming up" panel beside the cards on screens 1440 px and wider.
- **A person's page** is two columns (wishlist, budget and by-occasion on the left, the timeline on the right) and three on screens 1700 px and wider.
- **Ledger** uses the whole width for the table (long gift names are no longer cut at 280 px) and, from 1440 px, a summary panel: gifts, received, given and the recorded total for the current filters, plus one-tap "Thank-yous owed" and "Still to give" filters.
- **Shared wishlists** and the **Secret Santa** exchange list are an even grid of cards (they were split into a fixed 340 px column and one stretched column). An open exchange lays its cards out in two columns.
- **Ask** puts the question prompts and the box on the left and the answer on the right, from 1100 px.
- **Settings** cards flow into two columns (three from 1800 px) instead of one 760 px strip, on every tab.
- **Sign-in, create account and Welcome setup** are bigger on a desktop, and the people in the Welcome wizard sit two to a row.
- **The Calendar has a page title** like the other pages: "Calendar" in the same heading style, with the visible range ("This week · Oct 26 – Nov 1, 2026") as the subtitle. Today, the arrows, Day/Week/Month and + Event sit on the right of it, where other pages keep their buttons.

## [0.4.0-dev.2] - 2026-10-26

Development build `0.4.0-dev.2`: fixes from a UI and accessibility audit of the Calendar and the app shell. No data or settings changes.

### Fixed

- **Focus returns to where you were after closing a sheet** (event details, Add event, gift and person sheets). It used to fall to the top of the page, which lost keyboard and screen-reader users their place.
- **Coming up and "Next birthday" are in date order.** They followed the order people were added, so the KPI could name a birthday weeks away while one was due tomorrow.
- **Long text no longer breaks layouts.** A pasted URL in an event note, a long location, or a long calendar or person name wraps inside the event sheet instead of scrolling it sideways. In Settings → Calendars the "It's …", "Add … as a new person" and "Ignore" buttons wrap instead of pushing the page wider than the screen.
- **Overlapping events stay readable.** Events at the same time are never narrower than 60 px; a crowded day scrolls sideways inside its column. The all-day row of a week shows three chips per day plus "+N more" (opens the day) instead of growing without limit.
- **Valid ARIA on the calendar.** The week and month grids no longer claim `role="grid"` without rows, cells or arrow keys (each day is a labelled group instead). The phone day strip is a set of pressed/unpressed buttons, "How to connect" in Settings is a real tab set (arrow keys, Home/End, one tab stop, a tab panel), and the colour swatches are a real radio group (one tab stop, arrow keys). The tour's × button can be reached with Tab again (driver.js and Ribbon both handled Tab and cancelled each other out).
- **People filter shows everyone**, not the first eight. Initials are emoji-safe ("🦊 Fox" is 🦊F, not a broken character).
- **Contrast.** Event times use the full tone colour (no 80% opacity), days outside the month are tinted instead of faded, and the subtle grey is slightly darker. All now meet 4.5:1.
- **Plurals and "ago"** go through one helper: "1 event", "1 year", "yesterday", "2 days ago" instead of "1 events", "1 years", "1 days ago". The notification badge reads "3 things need you".
- Errors are red instead of the body colour; the hidden file picker is not a Tab stop; "Sync now" has an accessible name that starts with its visible text; switch rows toggle from anywhere on the row.
- **The page rolls over at midnight.** A calendar left open overnight updates "today" and the now-line without a reload.

### Changed

- **Phones.**
    - Form controls are 16 px on touch screens (iOS no longer zooms the page when you focus the Year, budget, person-link or feed-address fields).
    - Calendar controls (view buttons, avatar and source filters, arrows, Today, + Event, "+N more", swatches, day strip) have 44 px touch targets without changing how they look. A month cell on a phone is one big tap target.
    - Hover styles apply only on devices that can hover, so a tap no longer leaves buttons looking hovered. Chart tooltips keep working on tap.
    - No grey tap flash, no double-tap zoom delay on controls, a shared pressed state, and sheets no longer scroll the page behind them.
    - The browser bar colour matches the page in light and dark, and follows the theme toggle; the app manifest agrees.
    - The title field of Add event is not auto-focused on touch screens, so the keyboard does not cover the sheet.
- **Calendar load animation** plays once per browser session, over about a quarter of a second (items rise in 180 ms, staggered across 100 ms), and numbers count for 0.4 s instead of 0.8 s. Later visits and later week or month changes show content straight away. Still off with `prefers-reduced-motion`.

## [0.4.0-dev.1] - 2026-10-25

Development build `0.4.0-dev.1`: the Calendar.

### Added

- **Calendar page.** Day, Week and Month views of birthdays, anniversaries, yearly occasions, gift deadlines, Secret Santa dates, your own events and imported events. Filter chips per person and per source, three KPI tiles (events this week, birthdays in 30 days, gifts still needed), an event detail sheet with **Add gift idea** or **Go to person**, manual events (all day or timed, optional person, yearly repeat, private or shared), a "Coming up" panel and a Calendar item in the sidebar and phone tab bar.
- **Settings → Calendars.** Connect external calendars, read-only and private to the person who adds them unless they share a connection:
    - an **ICS link** (Google secret address, iCloud public calendar, Outlook published calendar, `webcal://`), refreshed every 6 hours with ETag and `If-None-Match`, repeating events (`RRULE`, exceptions, cancellations) expanded;
    - an **.ics file** upload;
    - **Sign in with Google** (OAuth 2.0 with PKCE and state, read-only, optional contact birthdays, encrypted tokens, refresh, revoke on disconnect), only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set;
    - **CalDAV** (experimental, read-only, for iCloud with an app-specific password, Fastmail, Nextcloud, Radicale and others);
    - per-connection name, colour, show/hide, share with household, refresh interval, **Sync now** and error messages;
    - a **birthday review**: events that look like birthdays or anniversaries are offered to match an existing person, add a new one, or ignore. Nothing is created automatically.
- **Calendar security.** A new SSRF-safe fetcher used for every calendar address (checks after DNS resolution and connects to the checked address, re-checks every redirect, blocks private, loopback, link-local, metadata and special ranges, 5 MB and 10 s limits, credentials only over https and only to the entered host), AES-256-GCM encryption of saved logins (`APP_SECRET` or a generated `DATA_DIR/app-secret`), rate limits, and a calendar section in the [security audit](docs/SECURITY-AUDIT.md).
- **Load animation across the app.** No skeleton blocks: numbers count up over about 0.8 s, events and cards fade in and rise a few pixels with a staggered delay, panels cascade, sidebar dots fade in. Off with `prefers-reduced-motion`.
- **Guided tour** has a Calendar step (eight steps).
- New settings: `APP_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOW_PRIVATE_CALENDAR_URLS`, `CALENDAR_SYNC_HOURS`, `CALENDAR_MAX_CONNECTIONS`, `CALENDAR_SYNC`. Sample-data mode includes sample calendar events; real installs start with no calendars.
- Docs: **Connecting calendars** guide (Google, iCloud, Outlook, CalDAV, creating a Google OAuth client), a Calendar section in Features, calendar notes in Configuration and Securing your install.

- **Documentation site** at <https://ribbon.thepizza.tech> (MkDocs Material, built from `docs/` and published to GitHub Pages by the new Docs workflow): getting started, a full configuration reference, a guide to securing your install, features, backups and restore, upgrading, troubleshooting and contributing. The existing docs pages are part of it.

### Changed

- **Look.** A lighter page background and hairline borders, and a shared pastel palette for people and calendars.
- The outbound reminder feed (Settings → Account) is unchanged and never includes imported calendar events.
- The README is rewritten with screenshots (light and dark, desktop and phone), a quick start for the `dev` image tag and a short configuration table; the detail now lives on the docs site.

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

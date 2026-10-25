# Features

A tour of what Ribbon does beyond the basic ledger. Everything here is in `0.3.0-dev`.

## Wishlists

Every person has a wishlist (item, link, price, note). Anyone in the household can reserve or mark an item bought. **Surprise-safe:** the person whose list it is never sees reserved or purchased marks on their own list. The server strips them from the response, so it holds even if someone opens the API directly. "Convert to gift" turns an item into a planned gift and reserves it.

## Budgets

Set a yearly budget per person or per occasion. Overview and the person page show spent against budget.

## Upcoming dates and recurring occasions

People have birthdays and anniversaries; occasions can repeat yearly. The Overview "Upcoming" card lists what is coming, with the days left.

## Calendar feed (ICS)

Settings → Account → Calendar creates a secret link (`/api/calendar/<token>.ics`) to subscribe to from Google, Apple or Outlook calendar. It carries upcoming dates with a reminder (default 14 days). Regenerating the link revokes the old one. Treat the link like a password.

## Backups

The database is snapshotted on a schedule (`BACKUP_CRON`, default daily 03:00; `off` disables) into `<DATA_DIR>/backups`, keeping the newest `BACKUP_KEEP` (14). Settings → Data (instance owner only) lists them, takes one now, downloads one, and restores one. You can also upload a backup file to restore. A restore takes a safety copy first; logins that are not in the restored file stop working.

## CSV import and export

Settings → Data exports gifts or people as CSV, offers a template, and imports with a column-mapping step and a preview of what will be created or skipped before anything is written.

## Sharing between households

An instance can hold several households, each with its own private ledger. Owners invite another household with a short single-use code that expires (Settings → Sharing). Linked households choose which of their **people** to share; the other side sees only those people, their wishlists and the marks that are safe for that viewer. Gifts, budgets and everything else stay private. Unlinking removes access immediately. Visibility is enforced on the server and covered by tests (`households.test.ts`, `wishlist.test.ts`).

## Secret Santa

Create an exchange across your household or linked households: pick participants, add exclusions (couples, last year's match), check the draw is possible, then draw. Everyone sees only who they give to. The organiser sees the full draw only if they turned on "organiser peek" when setting it up.

## Sign-in options

- **Single sign-on (OpenID Connect, PKCE).** Set `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`. Register `<PUBLIC_URL>/api/auth/oidc/callback` as the redirect URI. People link SSO to their existing login under Settings → Account (or set `OIDC_AUTO_LINK_BY_EMAIL=true` to match by verified email). `DISABLE_PASSWORD_LOGIN=true` hides the password form once SSO works. The issuer must be `https://` unless it is on a private address (or `OIDC_ALLOW_HTTP_ISSUER=true`).
- **Passkeys.** Add one under Settings → Account, then sign in with a fingerprint, face or security key. Passkeys need HTTPS (or `localhost`).

## Install as an app (PWA)

Over HTTPS Ribbon offers "install" on phones and desktops, has an icon set and an offline page. On plain HTTP it is a normal web page.

## Guided tour

Seven skippable steps (dashboard, add a gift, ledger, people, Ask, theme, settings and backups), built with [driver.js](https://driverjs.com) (MIT). It opens on a login's first visit, remembers "done" or "skipped" per login (`user_prefs.tour_state`, saved with `POST /api/me/tour`), and can be replayed from Settings → Help.

- In development with `SEED_SAMPLE_DATA` on, the tour stays off unless `TOUR_IN_DEV=true`.
- `TOUR_ALWAYS=true` shows it on every visit until it is finished with Done (for testing, in any mode).

## Real installs never ship sample data

`SEED_SAMPLE_DATA` defaults to off in production and in the Docker image. A new database starts with onboarding: family name, family members with their relationship and roles, then the owner login.

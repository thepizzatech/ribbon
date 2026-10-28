# Features

A tour of what Ribbon does beyond the basic ledger. Everything here is in `0.4.0-dev`.

![A person's page with a wishlist, a budget and a timeline (light)](assets/screenshots/wishlist-desktop-light.webp#only-light)
![A person's page with a wishlist, a budget and a timeline (dark)](assets/screenshots/wishlist-desktop-dark.webp#only-dark)

## The basics

The **Overview** shows gifts this year (received, given, spent, thank-yous sent) against last year, upcoming dates, where the money went by occasion or person, budgets, and a **Needs you** list of thank-yous to write and gifts still to buy. The **Ledger** lists every gift, **People** lists everyone you give to or receive from (with what you gave and got), and a global search (`Ctrl`/`⌘` + `K`) finds anything. Ribbon is built for the phone first and follows your light or dark theme.

## Calendar

![The Calendar page, week view (light)](assets/screenshots/calendar-desktop-light.webp#only-light)
![The Calendar page, week view (dark)](assets/screenshots/calendar-desktop-dark.webp#only-dark)

The **Calendar** page shows birthdays, anniversaries, yearly occasions, gift deadlines, Secret Santa dates, your own events and events imported from other calendars, in a **Day**, **Week** or compact **Month** view with previous/next and **Today**. Filter chips pick family members and kinds of events (including each connected calendar). Three tiles at the top count **events this week**, **birthdays in the next 30 days** and **gifts still needed**; a side panel lists what is coming up and gift deadlines, with **Add gift idea** one tap away. Click an event for details and the actions that fit it: add a gift idea for that person, go to their page, or edit your own events. On a phone it collapses to one day at a time with the panel below.

You can add your own events (title, date and time or all day, an optional person, repeat every year, private or shared with the household).

**Dates are picked from a calendar.** Every date box in Ribbon (a person's birthday and anniversary, an occasion's yearly date under Settings → General, a gift's date, an event's date and a Secret Santa date) is a text box you can type in (`2016-12-02`, `12/2/2016`, or `12-02` for a birthday without a year) with a calendar button beside it. The calendar has month and year lists, so a birthday in 1985 is two taps away, and a **"I don’t know the year"** switch for birthdays and anniversaries that saves only the month and day. Whatever you save shows on the Calendar page straight away. With the keyboard, the arrow keys move by day, Page Up and Page Down by month, Enter picks, and Escape closes just the calendar. On a phone the calendar opens inside the sheet, below the box. Events are only shown to the household in the ways you choose, and a gift planned for you never appears on your own calendar.

**Settings → Calendars** connects Google, Apple/iCloud, Outlook, Fastmail, Nextcloud and anything else that offers an iCal link, an `.ics` file or CalDAV, read-only and private to you unless you share a connection. Birthday-like events found there go through a review step (match a person, create one, or ignore). Details, including the Google OAuth setup, are in [Connecting calendars](calendars.md).

Everything on the page loads with a short staggered fade-in and counting numbers (switched off for people who prefer reduced motion), also on Overview and the lists.

## Ask

If the server has an `XAI_API_KEY`, the **Ask** page answers plain-language questions about your ledger ("how much did we spend on birthdays?"). A question sends a trimmed copy of your gift list to xAI, so leave the key unset if you do not want that. Each login gets 30 questions an hour.

## Wishlists

Every person has a wishlist (item, link, price, note). Anyone in the household can reserve or mark an item bought. **Surprise-safe:** the person whose list it is never sees reserved or purchased marks on their own list. The server strips them from the response, so it holds even if someone opens the API directly. "Convert to gift" turns an item into a planned gift and reserves it.

## Budgets

Set a yearly budget per person or per occasion. Overview and the person page show spent against budget.

## Upcoming dates and recurring occasions

People have birthdays and anniversaries; occasions can repeat yearly. The Overview "Upcoming" card lists what is coming, with the days left.

## Calendar feed (ICS)

The opposite direction of [Connecting calendars](calendars.md): Ribbon's own reminders for your calendar app. It never includes events imported from other calendars.

Settings → Account → Calendar creates a secret link (`/api/calendar/<token>.ics`) to subscribe to from Google, Apple or Outlook calendar. It carries the same things as the Calendar page for the next twelve months: birthdays, anniversaries and yearly occasions (each repeating every year, with a "Start shopping" reminder, default 14 days ahead, when something is still to buy), gift deadlines, Secret Santa dates and your own events (yearly ones repeat; timed ones keep their clock time). A gift planned for you is never in your feed. Regenerating the link revokes the old one. Treat the link like a password.

## Backups

The database is snapshotted on a schedule (`BACKUP_CRON`, default daily 03:00; `off` disables) into `<DATA_DIR>/backups`, keeping the newest `BACKUP_KEEP` (14). Settings → Data (instance owner only) lists them, takes one now, downloads one, and restores one. You can also upload a backup file to restore. A restore takes a safety copy first; logins that are not in the restored file stop working.

## CSV import and export

Settings → Data exports gifts or people as CSV, offers a template, and imports with a column-mapping step and a preview of what will be created or skipped before anything is written.

## Sharing between households

An instance can hold several households, each with its own private ledger. Owners invite another household with a short single-use code that expires (Settings → Sharing). Linked households choose which of their **people** to share; the other side sees only those people, their wishlists and the marks that are safe for that viewer. Gifts, budgets and everything else stay private. Unlinking removes access immediately. Visibility is enforced on the server and covered by tests (`households.test.ts`, `wishlist.test.ts`).

## Secret Santa

![Secret Santa: the names are drawn (light)](assets/screenshots/secret-santa-desktop-light.webp#only-light)
![Secret Santa: the names are drawn (dark)](assets/screenshots/secret-santa-desktop-dark.webp#only-dark)

Create an exchange across your household or linked households: pick participants, add exclusions (couples, last year's match), check the draw is possible, then draw. Everyone sees only who they give to. The organiser sees the full draw only if they turned on "organiser peek" when setting it up.

## Sign-in options

- **Single sign-on (OpenID Connect, PKCE).** Set `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`. Register `<PUBLIC_URL>/api/auth/oidc/callback` as the redirect URI. People link SSO to their existing login under Settings → Account (or set `OIDC_AUTO_LINK_BY_EMAIL=true` to match by verified email). `DISABLE_PASSWORD_LOGIN=true` hides the password form once SSO works. The issuer must be `https://` unless it is on a private address (or `OIDC_ALLOW_HTTP_ISSUER=true`).
- **Passkeys.** Add one under Settings → Account, then sign in with a fingerprint, face or security key. Passkeys need HTTPS (or `localhost`).

## Install as an app (PWA)

Over HTTPS Ribbon offers "install" on phones and desktops, has an icon set and an offline page. On plain HTTP it is a normal web page.

## Guided tour

![The guided tour on a new install (light)](assets/screenshots/tour-desktop-light.webp#only-light)
![The guided tour on a new install (dark)](assets/screenshots/tour-desktop-dark.webp#only-dark)

Eight skippable steps (dashboard, add a gift, calendar, ledger, people, Ask, theme, settings and backups), built with [driver.js](https://driverjs.com) (MIT). It opens on a login's first visit, remembers "done" or "skipped" per login (`user_prefs.tour_state`, saved with `POST /api/me/tour`), and can be replayed from Settings → Help.

- In development with `SEED_SAMPLE_DATA` on, the tour stays off unless `TOUR_IN_DEV=true`.
- `TOUR_ALWAYS=true` shows it on every visit until it is finished with Done (for testing, in any mode).

## Welcome setup

![Welcome setup, step 2 (light)](assets/screenshots/welcome-setup-desktop-light.webp#only-light)
![Welcome setup, step 2 (dark)](assets/screenshots/welcome-setup-desktop-dark.webp#only-dark)

The first visit creates only the owner account (and asks for `SETUP_CODE` when one is configured). Straight after the first sign-in the owner lands on a full-page **Welcome setup**: step one names the family or household, step two adds family members with a name and a role (son, wife, grandparent, friend and so on) and whether they are in your household. **Finish** opens the empty Overview, and the guided tour follows.

- The state lives on the server (`households.setup_complete`, `setup_step`), so an abandoned setup resumes on the same step from any device.
- It is enforced server-side: until it is complete the owner's other API calls answer `409 welcome_setup_required` (only the welcome endpoints, sign-out and change-password work), and the tour does not auto-open. Members and other owners never see it, and it never appears for a household that already has data or in sample-data development mode.
- API: `GET /api/welcome`, `PUT /api/welcome` (save a step), `POST /api/welcome/complete`. They answer 404 once finished. Scripts can still send `familyName` and `people` to `POST /api/setup` to skip the page.
- The first owner can only be created from your home network unless `SETUP_CODE` is set (or `ALLOW_PUBLIC_SETUP=true`).

## Real installs never ship sample data

`SEED_SAMPLE_DATA` defaults to off in production and in the Docker image. A new database starts with the owner account, then the Welcome setup (see above), and with no calendars connected. The sample household (when you switch it on for development) includes a few sample calendar events.

# Connecting calendars

Ribbon has its own **Calendar** page: birthdays, anniversaries, yearly occasions, gift deadlines, Secret Santa dates, events you add yourself, and events pulled in from the calendars you already use (Google, Apple/iCloud, Outlook, Fastmail, Nextcloud and anything else that speaks iCalendar or CalDAV).

![The Calendar page, week view (light)](assets/screenshots/calendar-desktop-light.webp#only-light)
![The Calendar page, week view (dark)](assets/screenshots/calendar-desktop-dark.webp#only-dark)

Connect calendars under **Settings → Calendars**.

![Settings, Calendars (light)](assets/screenshots/calendars-settings-desktop-light.webp#only-light)
![Settings, Calendars (dark)](assets/screenshots/calendars-settings-desktop-dark.webp#only-dark)

## How it behaves

- **Read-only.** Ribbon reads your calendar. It never creates, changes or deletes anything in it.
- **Private by default.** A connection belongs to the person who added it. Nobody else in the household sees its events unless that person turns on **Share with the household** for that connection. Ribbon's own dates (birthdays, gift deadlines) are household-wide as before, and a gift planned for you never shows up on your calendar.
- **Refreshes itself.** Links, Google and CalDAV refresh about every 6 hours (`CALENDAR_SYNC_HOURS`), cheaply: Ribbon asks the server "has it changed?" (ETag, `If-None-Match`, CalDAV ctag) and downloads only when it has. **Sync now** refreshes one calendar immediately (rate limited).
- **Birthdays become reminders, with your say-so.** If an imported event looks like "Sam's birthday" or "Alex & Jo's anniversary", Ribbon lists it under **Birthdays found in your calendars**. For each one you choose: **it's an existing person**, **add as a new person**, or **ignore**. Nothing is created automatically. Once matched, the person's own birthday takes over (so it is not shown twice) and gift reminders work.
- **Removing a calendar deletes its events** from Ribbon, and for Google it also revokes Ribbon's access at Google.
- Each connection has a name, a colour, a **show/hide** switch, a share switch, a last-synced time, and a plain-language error if something is wrong.
- Ribbon looks from two months back to fourteen months ahead, and repeating events (`RRULE`, with exceptions and cancellations) are expanded for you. Imported text is always shown as plain text.
- The **outbound reminder feed** (Settings → Account → Calendar) still exists and is separate. It carries what the Calendar page shows from Ribbon itself (birthdays, anniversaries, occasions, gift deadlines, Secret Santa dates and your own events) and never re-exports imported events.
- **Dates you enter show up here at once.** Birthdays, anniversaries, occasion dates, gift dates, events and Secret Santa dates all use the same date box: type it, or pick it from the calendar button. See [Features](FEATURES.md#calendar).

## Which way should I connect?

| Your calendar | Use | Notes |
| --- | --- | --- |
| Google | A **secret iCal link** (simplest), or **Sign in with Google** if you set up an OAuth client | The link needs no setup. Google sign-in can also read birthdays from Google Contacts. |
| Apple / iCloud | **CalDAV** with an app-specific password (experimental), or a **public calendar link** | The public link is the more reliable of the two. |
| Outlook.com / Microsoft 365 | A **published calendar link** (ICS) | Some work accounts do not allow publishing. |
| Fastmail, Nextcloud, Radicale, Synology, ... | **CalDAV** (experimental), or their ICS link | |
| Anything else | An **.ics file** | A one-time import that does not refresh. |

## An ICS link

Paste the calendar's iCal (`.ics`) address, or a `webcal://` address (Ribbon uses `https://` for it). Ribbon checks it, imports it, and keeps it fresh. A link that cannot be read is not kept.

!!! warning "Treat the link like a password"

    Anyone who has a calendar's secret link can read that calendar. Ribbon stores it encrypted and never shows it again.

### Google Calendar

1. Open Google Calendar on a computer, then **Settings** (the gear).
2. Under **Settings for my calendars**, pick the calendar.
3. Scroll to **Integrate calendar** and copy **Secret address in iCal format** (a long link ending in `basic.ics`).
4. Paste it in Ribbon: **Settings → Calendars → Link**.

Use the *secret address*, not the "public address", which only works if you made the calendar public. To get birthdays, add Google's "Birthdays" calendar the same way, or use Google sign-in with the contacts option below.

### iCloud (public link)

In the Calendar app on a Mac, or at icloud.com: share the calendar, tick **Public Calendar**, and copy the link (it starts with `webcal://`). Anyone with the link can read it, so use a calendar that is fine to share.

### Outlook.com and Microsoft 365

1. Open Outlook on the web, **Settings → Calendar → Shared calendars**.
2. Under **Publish a calendar**, pick the calendar and the permission **Can view all details**, then **Publish**.
3. Copy the **ICS** link.

## An .ics file

Export an `.ics` file from your calendar app (Google: Settings → Import & export → Export; Apple Calendar: File → Export), then **Settings → Calendars → File**. The file is imported once. Up to 5 MB. To update it later, remove it and upload the newer file.

## Google sign-in (OAuth)

This is optional and needs a little setup, because Ribbon is self-hosted: **you create your own Google OAuth client**, so the keys stay yours and nothing goes through anyone else's server. It is only offered in Settings once `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.

!!! note "What was tested"

    The OAuth flow (PKCE, state, token storage, refresh, revoke, paging, contact birthdays) is tested against a **fake Google** in the test suite. It has not been run against real Google yet. If something is off with real Google, the secret-link method above does not depend on any of this.

### Create the OAuth client

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a project (any name, for example "Ribbon").
2. **APIs & Services → Library**: enable **Google Calendar API**, and **People API** if you want contact birthdays.
3. **APIs & Services → OAuth consent screen** (called *Google Auth Platform* in newer consoles): choose **External**, give it a name and your email, and add these scopes:
    - `https://www.googleapis.com/auth/calendar.readonly`
    - `https://www.googleapis.com/auth/contacts.readonly` (only for contact birthdays)
4. **Publishing status:** while the app is in **Testing**, Google expires refresh tokens after **7 days**, so Ribbon would stop syncing weekly. For a personal install, set the status to **In production**. Google shows an "unverified app" warning on the sign-in screen for apps without verification, which is fine for your own use (click *Advanced*, then *Go to … (unsafe)*).
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
    - Application type: **Web application**.
    - **Authorized redirect URI:** `<PUBLIC_URL>/api/calendars/google/callback`, for example `https://ribbon.example.com/api/calendars/google/callback`. It must match exactly, and Google requires `https://` except for `localhost`.
6. Copy the **client ID** and **client secret** into your `.env`:

    ```bash
    GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
    GOOGLE_CLIENT_SECRET=GOCSPX-...
    PUBLIC_URL=https://ribbon.example.com
    ```

7. `docker compose up -d`. **Settings → Calendars** now has a **Google** tab.

Set `PUBLIC_URL`: Ribbon builds the redirect address from it. Without it, Ribbon falls back to the address in the request, which behind a proxy may not match what you registered.

### What Ribbon asks for and stores

- Only **read-only** scopes: calendar read-only, plus contacts read-only if you tick the box. Ribbon uses PKCE and a `state` value tied to your login and browser, and asks for offline access to keep refreshing.
- The refresh token and access token are stored **encrypted** (AES-256-GCM, key from `APP_SECRET` or an auto-generated file in the data folder). They are never logged or sent to the browser.
- **Disconnect** revokes the grant at Google and deletes the tokens and every imported event.
- If Google stops accepting the token (you revoked access, or the app was in Testing for over a week), the connection shows **Reconnect needed** and syncing stops until you sign in again.

## Apple / iCloud and other CalDAV servers (experimental)

CalDAV (read-only) reads calendars straight from your provider, with no public link. It is marked **experimental**: it is tested against a fake CalDAV server that follows the standard (discovery, `ctag` change checks, `REPORT` queries, Basic auth), not against iCloud itself, and providers differ in small ways.

### iCloud

1. Sign in at [appleid.apple.com](https://appleid.apple.com) → **Sign-In and Security → App-Specific Passwords** → **+**, name it "Ribbon", and copy the password it shows (like `abcd-efgh-ijkl-mnop`). This needs two-factor authentication to be on.
2. In Ribbon: **Settings → Calendars → Apple / CalDAV**.
3. Server: `https://caldav.icloud.com`. User name: your Apple ID email. Password: the **app-specific password**, never your Apple ID password.
4. **Find my calendars**, tick the ones you want, **Connect selected**.

Revoke it any time in the same Apple ID page. Apple's built-in "Birthdays" calendar may not be offered over CalDAV; add birthdays to Ribbon on the person's page, or import them from a contacts export.

### Other servers

| Provider | Server address |
| --- | --- |
| Fastmail | `https://caldav.fastmail.com` (use an app password) |
| Nextcloud | `https://cloud.example.com/remote.php/dav` (an app password from Settings → Security) |
| Radicale, Baïkal, Synology | The server's CalDAV address |

For a server on your home network (for example Nextcloud at `192.168.1.20`), set `ALLOW_PRIVATE_CALENDAR_URLS=true`. See the next section.

Passwords are only ever sent over **HTTPS** (except to a private address you allowed, where plain HTTP is accepted), only to the server you entered, and are stored encrypted.

## Private addresses and `ALLOW_PRIVATE_CALENDAR_URLS`

By default Ribbon refuses to fetch calendars from private, loopback, link-local or cloud-metadata addresses, so that a calendar link cannot be used to reach other things on your network. If your calendar server is on your own network (a homelab Nextcloud, Radicale or an `.ics` file on a NAS), set `ALLOW_PRIVATE_CALENDAR_URLS=true` and restart. Leave it off otherwise. More in [Securing your install](securing.md#calendar-connections).

## Backups and moving to another server

Backups include the connections and their encrypted logins, but **not** the encryption key. If you restore onto another machine, either set the same `APP_SECRET` there, or reconnect each calendar (a connection whose login can't be read says so and can be removed and re-added). If you let Ribbon generate the key, it lives in `<DATA_DIR>/app-secret`; copy it with the database if you move by hand.

## Troubleshooting

| You see | Usually means |
| --- | --- |
| "That address did not return a calendar (.ics) file." | You pasted a web page, not the iCal link. Use the *secret iCal address* (Google), or the ICS link, not the calendar's web view. |
| "The server refused access (403/401)" for a link | The link was reset or the calendar was unshared. Get the new link. |
| "That address is on a private network" | Ribbon blocks private addresses by default. See `ALLOW_PRIVATE_CALENDAR_URLS`. |
| "Passwords are only sent over https" | A CalDAV server on plain `http://`. Use `https://`. |
| "The server rejected the user name or password" (iCloud) | Use an **app-specific password**, not your Apple ID password. |
| "Reconnect needed" on Google | Access was revoked or expired. Press **Remove** and connect again. |
| "can't read the saved login" | `APP_SECRET` changed or `app-secret` was lost. Remove the connection and add it again. |
| "That is a lot of refreshing" | **Sync now** is limited to 12 a person per 10 minutes. The background refresh keeps going on its own. |

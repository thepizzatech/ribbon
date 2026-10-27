# Upgrading

Ribbon is in development, so upgrades matter more than they will later. The short version:

```bash
cd ribbon                 # the folder with your docker-compose.yml and .env
docker compose pull
docker compose up -d
```

Your data volume is kept and **migrated in place** the first time the new version starts. Check the version afterwards in **Settings → About**, in the sidebar footer, or at `/api/health`:

```json
{ "ok": true, "version": "0.4.0-dev.2", "commit": "a5c662f" }
```

## Before you upgrade

1. **Take a backup.** **Settings → Data → Back up now**, then download it. See [Backups & restore](backups.md).
2. **Read the [changelog](changelog.md)** for anything marked as a heads-up or a breaking change.
3. If you build from source, `git pull` first, then `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.

!!! warning "Downgrading is not supported"

    Database migrations run forward only. If an upgrade goes wrong, restore the backup you took beforehand into the *older* image rather than pointing an old image at a migrated database.

## Which tag should I run?

| Tag | What it is | Use it for |
| --- | --- | --- |
| `dev` | Built from every push to `main`. It moves. | Trying Ribbon today. There is no release yet. |
| `sha-<short>` | One specific commit of `main`. | Staying put on a build you tested. Set `RIBBON_TAG=sha-a5c662f`. |
| `0.3.0-beta.1`, ... | Pre-releases. *Not yet published.* | Testing a release candidate. |
| `0.3`, `latest` | Stable releases. *Not yet published.* | Normal installs, once there is a stable release. |

Until the first release is cut, `RIBBON_TAG=latest` (the compose default) has nothing to pull, so keep `RIBBON_TAG=dev` in your `.env`.

## Version-specific notes

### Coming from a version before accounts

Older builds had a single shared passcode (`APP_PASSCODE`) and no sign-in. After updating, the first visit asks you to create the owner login. Nothing is wiped, and no Welcome setup is asked for, because your ledger already exists (installs that already have data count as set up). `APP_PASSCODE` no longer does anything and can be removed from `.env`.

### Moving to 0.4.0-dev.2

Nothing to do: UI and accessibility fixes only, no migration and no new settings.

### Moving to 0.4.0-dev.1

- **New: Calendar page and Settings → Calendars.** Nothing changes for existing data. A migration adds the calendar tables; real installs start with no calendars.
- Optional new settings: `APP_SECRET`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `CALENDAR_SYNC_HOURS`, `CALENDAR_MAX_CONNECTIONS`, `CALENDAR_SYNC`, `ALLOW_PRIVATE_CALENDAR_URLS` (all in [Configuration](configuration.md#calendars)). If you use your own compose file, add the ones you want to its `environment:` list.
- If you connect calendars, note that Ribbon creates `app-secret` in the data volume to encrypt their logins. Backups do not contain it: set `APP_SECRET` if you plan to restore onto a different machine ([details](calendars.md#backups-and-moving-to-another-server)).
- The guided tour has a new Calendar step (eight steps now).

### Moving to 0.3.0-dev.2

- **Heads-up:** with no `SETUP_CODE`, the first owner can now only be created from your home network. If your server is reachable from the internet and you have not created the owner yet, set `SETUP_CODE` first. (`ALLOW_PUBLIC_SETUP=true` restores the old behaviour; it is not recommended.)
- Password hashing is stronger. Old hashes keep working and are upgraded when the owner next signs in.
- `docker-compose.yml` now drops all Linux capabilities and sets `no-new-privileges`. If you use your own compose file, copy those two lines.

See the [changelog](changelog.md) for the full list.

## Rolling back

1. `docker compose down` (not `down -v`; that deletes your data).
2. Set `RIBBON_TAG` to the previous tag or `sha-...`.
3. Restore the backup you took before upgrading ([how](backups.md#restore)).
4. `docker compose up -d`.

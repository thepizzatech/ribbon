# Backups & restore

Everything Ribbon knows (family, people, gifts, occasions, wishlists, logins) lives in **one SQLite file**, `ribbon.db`, in the `ribbon_data` Docker volume. That makes backups simple: keep a copy of that file somewhere other than the server.

!!! warning "A backup on the same disk is not a backup"

    Ribbon's scheduled snapshots are stored inside the same volume as the database. They protect you from mistakes (a bad import, an accidental delete), not from a dead disk or a lost server. Copy them elsewhere too.

## Scheduled backups

Ribbon snapshots the database on a schedule into `<DATA_DIR>/backups` (`/data/backups` in Docker).

| Setting | Default | Meaning |
| --- | --- | --- |
| `BACKUP_CRON` | `0 3 * * *` | When to snapshot: five-field cron (minute hour day month weekday). `off` disables. |
| `BACKUP_KEEP` | `14` | How many scheduled snapshots to keep. |

The schedule uses the container's clock (UTC unless you set `TZ`). Snapshots are consistent copies taken while Ribbon is running (`VACUUM INTO`), written with owner-only permissions.

Files are named `auto-YYYYMMDD-HHMMSS.db` (scheduled), `manual-...` (taken from Settings) and `pre-restore-...` (the safety copy taken just before a restore; the newest 5 are kept).

## In the app: Settings → Data

Only the **instance owner** (the first owner) sees the backup tools. They let you:

- **Back up now**, taking a snapshot immediately.
- **Download** any snapshot to your computer.
- **Restore from a file** by choosing a snapshot from the list, or by uploading a `.db` file.

A restore takes a safety copy first. Logins that are not in the restored file stop working, and a file with no owner login is refused (it would lock everyone out). Files from a newer version of Ribbon, and files that are not Ribbon databases, are refused.

## Other ways to export

- **Export ledger (JSON):** **Settings → Data → Export ledger** saves gifts, people and occasions (not logins). **Import ledger** restores it. The same JSON is at `/api/export` when you are signed in.
- **CSV:** gifts, people or wishlists as spreadsheets. See [CSV import and export](FEATURES.md#csv-import-and-export). CSV is for moving data around, not a full backup.

## Copy the database file by hand

Copy `ribbon.db` (logins and sessions included). For a perfectly clean copy, stop the app first:

```bash
docker compose stop ribbon
docker run --rm -v ribbon_ribbon_data:/data -v "$PWD":/backup busybox \
  cp /data/ribbon.db /backup/ribbon-backup.db
docker compose start ribbon
```

The volume is named `<folder>_ribbon_data` (here the folder is `ribbon`); check with `docker volume ls`. To copy the whole backups folder too, replace the `cp` with `cp -a /data/. /backup/ribbon-data/`.

!!! tip "Back up the volume with your usual tool"

    If you already back up your Docker volumes with restic, borg, Duplicati or a snapshotting filesystem, point it at the `ribbon_data` volume. SQLite is safe to copy while idle; the nightly `backups/` snapshots are always safe to copy.

## Restore

=== "From the app"

    1. Sign in as the instance owner.
    2. **Settings → Data**, then pick a snapshot (or upload a `.db` file) and choose **Restore**.
    3. Sign in again if asked. Ribbon takes a `pre-restore` safety copy first.

=== "From a file, with Ribbon stopped"

    ```bash
    docker compose stop ribbon
    docker run --rm -v ribbon_ribbon_data:/data -v "$PWD":/backup busybox \
      cp /backup/ribbon-backup.db /data/ribbon.db
    docker compose start ribbon
    ```

    Put the file back at `/data/ribbon.db` while the app is stopped. If the container runs as the `node` user and the new file is not readable, fix ownership with `chown 1000:1000 /data/ribbon.db` in the same helper container.

=== "On a brand-new server"

    Install Ribbon as in [Getting started](getting-started.md), stop it after the first start, copy your `ribbon.db` over `/data/ribbon.db` as above and start it again. Your owner login and family are already there, so there is no first-run setup.

## Test your backup

A backup you have never restored is a hope, not a backup. Once, on a spare machine, install Ribbon, restore a snapshot and sign in. It takes five minutes.

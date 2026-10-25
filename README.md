# Ribbon

A mobile-first family gift tracker. Track gifts your household receives and gives, with editable occasions, a dashboard, a dark theme, and an Ask tab for plain-language questions about your ledger.

> **Status: in development.** It works and stores data on your own server, but expect rough edges and breaking changes. It is built for a single household.

Your ledger (household name, people, gifts, occasions) is saved in a SQLite database on the server, so every phone and laptop sees the same data.

## Self-host with Docker (Ubuntu or anywhere with Docker)

```bash
git clone https://github.com/thepizzatech/ribbon && cd ribbon
# optional: create a .env file with APP_PASSCODE=... (see Settings below)
docker compose -f docker-compose.prod.yml up -d --build
```

Open `http://<your-server>:8080`. The database lives in the `ribbon_data` Docker volume and survives restarts, rebuilds, and `docker compose down` (it is only deleted if you add `-v`).

The production image runs as an unprivileged user and has a built-in health check (`docker ps` shows `healthy`).

Ribbon speaks plain HTTP. If it will be reachable beyond your home network, put it behind a reverse proxy that adds HTTPS (Caddy, nginx, Traefik) and set `APP_PASSCODE`.

## Develop with Docker

```bash
docker compose up --build
```

Open http://localhost:8080. Your source is mounted into the container, so edits show up live. Dev data lives in a separate `ribbon_dev_data` volume.

## Develop without Docker

Needs Node 22.13 or newer (Ribbon uses Node's built-in `node:sqlite`).

```bash
npm ci
DATA_DIR=./data npm run dev      # http://localhost:8080
```

Other scripts: `npm run typecheck`, `npm test`, `npm run build`, and `npm start` (runs the production build from `.output`; set `DATA_DIR` there too).

## Settings (environment variables)

| Variable | Default | What it does |
| --- | --- | --- |
| `DATA_DIR` | `/data` | Folder holding the database file `ribbon.db`. Created if missing. |
| `APP_PASSCODE` | unset | If set, everyone must enter this one shared passcode (stored as a 30-day cookie). If unset, there is no sign-in. |
| `XAI_API_KEY` | unset | Turns on the Ask tab. A question sends a trimmed copy of your gift list to xAI. Everything else works without it. |
| `PORT` | `8080` | Port the production server listens on. |

With Docker, put these in a `.env` file next to the compose file (never commit it).

## Backups

Your data is one file, `ribbon.db`, inside the `ribbon_data` volume. Either:

- **Export from the app:** Settings → Export ledger saves a JSON file; Settings → Import ledger restores it. You can also fetch the same JSON from `/api/export`.
- **Copy the database file** (stop the container first for a perfectly clean copy):

  ```bash
  docker compose -f docker-compose.prod.yml stop
  docker run --rm -v ribbon_ribbon_data:/data -v "$PWD":/backup busybox cp /data/ribbon.db /backup/ribbon-backup.db
  docker compose -f docker-compose.prod.yml start
  ```

  The volume name is prefixed with your folder name (`<folder>_ribbon_data`); check with `docker volume ls`.

To restore, put the file back at `/data/ribbon.db` in the volume while the container is stopped.

## Moving from the old browser-only version

The first time you open Ribbon after upgrading, any ledger saved in that browser is copied up to the server automatically (only if the server is still empty or holding the sample household). The original browser copy is left untouched. Open Ribbon once on the browser that has your data.

## How it works

- TanStack Start (React, Vite, Tailwind), built to a standalone Node server.
- `src/server/` holds the SQLite schema and migrations (run on startup), the ledger rules, and the JSON API at `/api/*` (people, gifts, occasions, household, export/import, `/api/health`).
- The browser keeps an instant local copy of the ledger with React Query and sends each change to the API; if the server refuses one, the screen snaps back to the server's copy.

## Roadmap

- [x] Backend storage for gifts, people, and occasions
- [x] Persistent volume in the container
- [ ] Deploy to a test host

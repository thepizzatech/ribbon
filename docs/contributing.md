# Contributing

Thanks for helping. Ribbon is small on purpose: a family gift tracker you host yourself.

- **Bugs and ideas:** open an [issue](https://github.com/thepizzatech/ribbon/issues) using the templates. For security problems, see the [security policy](https://github.com/thepizzatech/ribbon/blob/main/SECURITY.md) and don't open a public issue.
- **Pull requests:** branch from `main`, keep changes focused, add a test when you change server behaviour, and add a line under `[Unreleased]` in [CHANGELOG.md](https://github.com/thepizzatech/ribbon/blob/main/CHANGELOG.md) for anything a user would notice.
- **Commits:** short imperative subject ("Add login lockout"), a few lines of why if it isn't obvious.
- **Releases** are cut by the maintainer; see [Releasing](RELEASING.md). Fixes for a released version go to its `release/X.Y` branch.
- **No secrets** in commits, issues or screenshots, and no real family data in test fixtures.

By contributing you agree your work is released under the [MIT License](https://github.com/thepizzatech/ribbon/blob/main/LICENSE).

## Set up a development environment

Ribbon needs **Node 22.13 or newer** (it uses Node's built-in `node:sqlite`).

```bash
git clone https://github.com/thepizzatech/ribbon.git && cd ribbon
npm ci
DATA_DIR=./data npm run dev      # http://localhost:8080
```

In development `SEED_SAMPLE_DATA` defaults to on: a sample household is loaded and a dev login is created, with a loud message in the terminal (username `admin`, password `ribbon-dev-password`; override with `DEV_USERNAME` and `DEV_PASSWORD`). It is never created in production or when sample data is off. Set `SEED_SAMPLE_DATA=false` to try first-run setup.

With Docker instead: `docker compose -f docker-compose.dev.yml up --build`, then open <http://localhost:8080>. Source is mounted so edits show live; dev data lives in the `ribbon_dev_data` volume.

| Command | What it does |
| --- | --- |
| `npm run typecheck` | TypeScript check |
| `npm test` | Server and logic tests |
| `npm run lint` | ESLint |
| `npm run build` | Production build into `.output` |
| `npm start` | Run `.output` (set `DATA_DIR`) |

`typecheck`, `lint` and `test` must pass; CI runs them plus a build and a Docker build.

## Where things are

- `src/server/`: the SQLite schema and migrations (run on start-up), accounts and sessions, security checks, the ledger rules and the JSON API at `/api/*`.
- `server/middleware` and `server/plugins`: security headers, the malformed-path guard, and the database and backup start-up in production.
- `src/routes`, `src/components`: the TanStack Start app (React, Tailwind).
- `docs/`: this site's pages, built with MkDocs Material.

## Working on these docs

The site is plain Markdown in `docs/`, configured by `mkdocs.yml`.

```bash
python3 -m venv .venv-docs && . .venv-docs/bin/activate
pip install -r requirements-docs.txt
mkdocs serve                 # live preview at http://127.0.0.1:8000
mkdocs build --strict        # what CI runs; warnings fail the build
```

Pages like `FEATURES.md`, `REVERSE-PROXY.md`, `SECURITY-AUDIT.md` and `RELEASING.md` are also readable on GitHub, so keep their links relative and working in both places. The changelog page is pulled from the repository's `CHANGELOG.md` at build time. Pushes to `main` that touch the docs are published to GitHub Pages by the **Docs** workflow.

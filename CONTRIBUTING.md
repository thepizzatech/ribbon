# Contributing

Thanks for helping. Ribbon is small on purpose: a family gift tracker you host yourself.

- **Bugs and ideas:** open an issue using the templates. For security problems, see [SECURITY.md](SECURITY.md) and don't open a public issue.
- **Set up:** Node 22.13+, `npm ci`, then `npm run dev` (see the README). `npm run typecheck`, `npm run lint` and `npm test` must pass; CI runs them plus a build.
- **Pull requests:** branch from `main`, keep changes focused, add a test when you change server behaviour, and add a line under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.
- **Commits:** short imperative subject ("Add login lockout"), a few lines of why if it isn't obvious.
- **Releases** are cut by the maintainer; see [docs/RELEASING.md](docs/RELEASING.md). Fixes for a released version go to its `release/X.Y` branch.
- **No secrets** in commits, issues or screenshots, and no real family data in test fixtures.

By contributing you agree your work is released under the [MIT License](LICENSE).

# Ribbon

A mobile-first family gift tracker. Track gifts your household receives and gives, with editable occasions, a dashboard, a dark theme, and an Ask tab for plain-language questions about your ledger.

> **Status: in development.** Gifts are currently stored in the browser. A server-side database is the next milestone, so expect breaking changes.

## Run locally with Docker

```bash
docker compose up --build
```

Open http://localhost:8080. Source is mounted into the container, so edits show up live.

Production image:

```bash
docker build --target runner -t ribbon .
docker run --rm -p 8080:8080 ribbon
```

## Run without Docker

```bash
npm ci
npm run dev
```

## Roadmap

- [ ] Backend storage for gifts, people, and occasions
- [ ] Persistent volume in the container
- [ ] Deploy to a test host

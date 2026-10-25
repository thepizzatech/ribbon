# Security

## Reporting a problem

Please **don't open a public issue** for a security problem. Use GitHub's private reporting: the repository's **Security** tab → **Report a vulnerability**. Include what you found, how to reproduce it, and the version (Settings → About, or `/api/health`).

You'll get a reply within a week. Fixes go to the newest release branch and `main`, and are noted in the [CHANGELOG](CHANGELOG.md).

## Supported versions

Only the newest `release/X.Y` branch and `main`.

## What Ribbon does for you

Passwords are hashed with scrypt; sessions are stored on the server; cookies are `HttpOnly`, `SameSite=Lax` and `Secure`; writes need a CSRF token and a same-site Origin; repeated wrong passwords lock an account for a while; production redirects to HTTPS and sends HSTS, CSP, `nosniff`, `Referrer-Policy` and `frame-ancestors 'none'`.

## What's on you when self-hosting

- Keep the app behind the bundled Caddy proxy (or another TLS proxy that sets `X-Forwarded-Proto`). Don't publish the app's own port.
- Back up `ribbon.db` and keep the `caddy_data` volume.
- Keep `.env` out of git; it may hold `XAI_API_KEY` and `SETUP_CODE`.
- Set `SETUP_CODE` if the server is reachable from a network you don't fully trust before you have created the owner login.
- Update when new releases come out.

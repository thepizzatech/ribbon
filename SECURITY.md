# Security

## Reporting a problem

Please **don't open a public issue** for a security problem. Use GitHub's private reporting: the repository's **Security** tab → **Report a vulnerability**. Include what you found, how to reproduce it, and the version (Settings → About, or `/api/health`).

You'll get a reply within a week. Fixes go to the newest release branch and `main`, and are noted in the [CHANGELOG](CHANGELOG.md).

## Supported versions

Only the newest `release/X.Y` branch and `main`.

## What Ribbon does for you

Passwords are hashed with scrypt; sessions are stored on the server; cookies are `HttpOnly`, `SameSite=Lax` and `Secure`; writes need a CSRF token and a same-site Origin; repeated wrong passwords lock an account for a while; password sign-in over plain HTTP is refused from public addresses; X-Forwarded-* headers are trusted only from configured proxies; HSTS (over HTTPS), CSP, `nosniff`, `Referrer-Policy` and `frame-ancestors 'none'` are sent.

## What's on you when self-hosting

- Put an HTTPS reverse proxy in front before using Ribbon outside your home network ([docs/REVERSE-PROXY.md](docs/REVERSE-PROXY.md)), set `PUBLIC_URL`, and don't publish the app's own port to the internet.
- Back up the `ribbon_data` volume (Ribbon also makes nightly backups into it).
- Keep `.env` out of git; it may hold `XAI_API_KEY` and `SETUP_CODE`.
- Set `SETUP_CODE` if the server is reachable from a network you don't fully trust before you have created the owner login.
- Update when new releases come out.

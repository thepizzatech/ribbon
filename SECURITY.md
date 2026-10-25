# Security

## Reporting a problem

Please **don't open a public issue** for a security problem. Use GitHub's private reporting: the repository's **Security** tab → **Report a vulnerability**. Include what you found, how to reproduce it, and the version (Settings → About, or `/api/health`).

You'll get a reply within a week. Fixes go to the newest release branch and `main`, and are noted in the [CHANGELOG](CHANGELOG.md).

## Supported versions

Only the newest `release/X.Y` branch and `main`.

## Known limitations

See the "Accepted risks" section of [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md) (for example, CSP still allows inline scripts, and household members are trusted editors of the shared ledger).

The most recent full review, with every finding, how it was verified and what is accepted, is in [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md).

## What Ribbon does for you

Passwords are hashed with scrypt (N=2^16, r=8, p=2) and upgraded automatically; sessions are stored on the server (only a hash of the token is kept); cookies are `HttpOnly`, `SameSite=Lax` and `Secure`; writes need a CSRF token and a same-site Origin; repeated wrong passwords lock sign-in for a while per account and address, per account, and per address, and cannot be dodged with a forged `X-Forwarded-For`; password sign-in over plain HTTP is refused from public addresses; `X-Forwarded-*` headers are trusted only from configured proxies; the first owner account can only be created from your home network unless you set `SETUP_CODE`; passkeys require user verification; request bodies are size-capped while they are read; uploaded backups are validated and never bring views or triggers with them; HSTS (over HTTPS), CSP, `nosniff`, `Referrer-Policy`, `Cross-Origin-Resource-Policy` and `frame-ancestors 'none'` are sent.

## What's on you when self-hosting

- Put an HTTPS reverse proxy in front before using Ribbon outside your home network ([docs/REVERSE-PROXY.md](docs/REVERSE-PROXY.md)), set `PUBLIC_URL`, and don't publish the app's own port to the internet.
- Back up the `ribbon_data` volume (Ribbon also makes nightly backups into it).
- Keep `.env` out of git; it may hold `XAI_API_KEY` and `SETUP_CODE`.
- Set `SETUP_CODE` if the server is reachable from a network you don't fully trust before you have created the owner login. (Without it, Ribbon refuses to create the first owner from a public address; `ALLOW_PUBLIC_SETUP=true` turns that guard off.)
- Set `TRUSTED_PROXIES` to just your reverse proxy's address if other devices on your network are not trusted.
- Keep the container's hardening options from `docker-compose.yml` (`cap_drop: ALL`, `no-new-privileges`) if you write your own compose file.
- Update when new releases come out.

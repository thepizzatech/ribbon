# Troubleshooting & FAQ

## Sign-in and setup

### "Sign-in over plain HTTP is only allowed from your home network"

You are opening Ribbon from a public address over `http://`. Passwords would cross the internet readable, so Ribbon refuses. Open it through its **HTTPS** address instead. If you have not set up HTTPS, see [Securing your install](securing.md). Make sure `PUBLIC_URL` matches the address you type and that your proxy is trusted (see below).

Only if you understand the risk, `ALLOW_INSECURE_LOGIN=true` turns the check off.

### "Ribbon has no owner yet, and this connection isn't on your home network"

Nobody has created the first owner and the connection is not from a private address. Either finish setup from your home network, or set `SETUP_CODE` in `.env`, run `docker compose up -d`, and type that code on the setup page.

### "Too many tries. Wait a few minutes and try again."

Sign-in is locked for 15 minutes after repeated wrong passwords (5 for one account from one address, 20 for one account from anywhere, 30 from one address across accounts). Wait it out, use a passkey or SSO (they have their own counters), or restart the container, which clears the counters (they are in memory).

### I forgot the owner password

Another owner can add you a new login in **Settings**. If there is no other owner, stop the container and ask for help in an [issue](https://github.com/thepizzatech/ribbon/issues). There is deliberately no back door.

### I see "Welcome setup" and nothing else

That is expected right after you create the owner: the server holds the rest of the app closed until the two setup steps are finished. Finish it (you can skip adding people). Other API calls answer `409 welcome_setup_required` until then.

## HTTPS and proxies

### Settings says "Connection not secure"

Ribbon thinks the connection is plain HTTP. Behind a proxy, check that:

1. `PUBLIC_URL` is set to the exact `https://` address people use, and you ran `docker compose up -d` after editing `.env`.
2. Your proxy sends `X-Forwarded-Proto: https` (Caddy, Traefik, NPM and Cloudflare Tunnel do by default).
3. The proxy's address is trusted. The default trusts private ranges; if the proxy arrives from a public address, add it to `TRUSTED_PROXIES`. Remember that setting `TRUSTED_PROXIES` replaces the default list.

Verify with `curl -sI https://ribbon.example.com/ | grep -i strict-transport`. You should see the header.

### The "install app" prompt never appears

The install prompt, the offline page and passkeys need a secure context: an `https://` address (or `http://localhost`). On `http://192.168.x.x` Ribbon is a normal web page.

### Passkeys fail or are not offered

Passkeys are tied to the address in `PUBLIC_URL`. Set it correctly and open Ribbon through that address, not an IP. Changing the domain later means adding new passkeys.

### A calendar link has the wrong address

Calendar links are built from `PUBLIC_URL`. Set it, then regenerate the link under **Settings → Account → Calendar** (this also revokes the old one).

### SSO shows an error about the issuer

The issuer must be `https://`, unless it is on a private address or you set `OIDC_ALLOW_HTTP_ISSUER=true`. The redirect URI registered at your provider must be exactly `<PUBLIC_URL>/api/auth/oidc/callback`.

## Running it

### The container is "unhealthy" or restarting

Look at the log:

```bash
docker compose logs --tail 100 ribbon
docker compose ps
```

The health check calls `/api/health`. Common causes: the `ribbon_data` volume is not writable (do not bind-mount a root-owned folder over `/data`; the image runs as user `node`, uid 1000), or an invalid value in `.env`.

### `pull access denied` or `manifest unknown`

Compose is trying to pull `ghcr.io/thepizzatech/ribbon:latest`, which does not exist until the first release. Set `RIBBON_TAG=dev` in `.env`.

### I changed `.env` and nothing happened

Run `docker compose up -d` (not just `restart`) so Compose recreates the container with the new values. Check that the file is named `.env` and sits next to `docker-compose.yml`.

### Backups are not appearing

Only the **instance owner** sees **Settings → Data**. Check `BACKUP_CRON` (an invalid expression disables scheduled backups and logs an error; `off` disables them on purpose), and remember times are in the container's time zone.

### Where is my data?

In the `ribbon_data` Docker volume (`/data/ribbon.db`). `docker volume ls` shows it as `<folder>_ribbon_data`. It is deleted only by `docker compose down -v` or `docker volume rm`.

## FAQ

### Is Ribbon ready for real use?

It works and the data is yours, but it is a development build: no release yet, so expect rough edges and read the [changelog](changelog.md) before updating. Keep backups.

### Can several families use one server?

Yes. An instance can hold several households, each with its own private ledger, and owners can [link households](FEATURES.md#sharing-between-households) to share chosen people and wishlists.

### Does Ribbon phone home or use the cloud?

No. The only outbound feature is **Ask**, and only if you set `XAI_API_KEY`; a question then sends a trimmed copy of your gift list to xAI. Leave the key unset to keep it fully local. SSO contacts the provider you configure.

### Can the person a gift is for see it?

No. Gifts planned for you, reserved wishlist marks, budgets, CSV rows and calendar entries are stripped on the **server**, so it holds even if someone calls the API directly. See [Features](FEATURES.md#wishlists).

### Does it work offline?

Over HTTPS Ribbon installs as an app and has an offline page, but signed-in data is never cached by the service worker, so you need a connection to see your ledger.

### Which browsers are supported?

Current Chrome, Safari, Firefox and Edge. The project's own checks use headless Chrome.

### How do I report a bug or a security problem?

Bugs and ideas: [GitHub issues](https://github.com/thepizzatech/ribbon/issues). Security problems: **do not open a public issue**; use the repository's **Security** tab → **Report a vulnerability** ([policy](https://github.com/thepizzatech/ribbon/blob/main/SECURITY.md)).

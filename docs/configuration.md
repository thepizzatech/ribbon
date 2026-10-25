# Configuration

Ribbon is configured with environment variables. With Docker Compose, put them in a **`.env`** file next to `docker-compose.yml` (copy [`.env.example`](https://github.com/thepizzatech/ribbon/blob/main/.env.example) to start). Every setting is optional, and a blank value means "use the default". Never commit your `.env`: it can hold `SETUP_CODE`, `XAI_API_KEY` and `OIDC_CLIENT_SECRET`.

After you change `.env`, apply it with:

```bash
docker compose up -d
```

Compose recreates the container with the new values; your data volume is untouched.

!!! info "True/false values"

    Settings described as on/off accept `1`, `true`, `yes` or `on` (any case) for **on**. Anything else, and blank, means the default. The one exception is `HSTS`, described below.

## Image and ports

These are read by Docker Compose, not by the app.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8080` | Host port the compose file publishes. The app always listens on 8080 inside the container. |
| `RIBBON_TAG` | `latest` | Image tag to run: `latest` (newest release), `dev` (newest `main`) or a version like `0.3.0-beta.1`. **Use `dev` until the first release exists.** |

## Public address and proxies

How Ribbon learns whether a connection is really HTTPS. Read [Securing your install](securing.md) and [HTTPS and reverse proxies](REVERSE-PROXY.md) before changing these.

| Variable | Default | What it does |
| --- | --- | --- |
| `PUBLIC_URL` | unset | The address people type when Ribbon is behind an HTTPS proxy, for example `https://ribbon.example.com`. Used for cookie and HSTS decisions, calendar links, SSO redirects and passkeys. |
| `TRUSTED_PROXIES` | loopback and private ranges | Peers whose `X-Forwarded-Proto`, `-Host` and `-For` headers are believed. A comma-separated list of CIDRs, or `none`. The default is `127.0.0.0/8`, `::1/128`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7` and `100.64.0.0/10` (Tailscale). Tighten it to just your proxy if other devices on your network are not trusted. |
| `ALLOW_INSECURE_LOGIN` | `false` | Allow password sign-in over plain HTTP from addresses outside the private ranges. Leave off unless you know why you need it. |
| `HSTS` | on | `off` (also `false`, `0`, `no`) stops Ribbon sending `Strict-Transport-Security`. It is only ever sent over HTTPS anyway. |
| `ENFORCE_HTTPS` | `false` | **Deprecated.** Logs a warning and means "refuse password sign-in over plain HTTP from everywhere". Use a reverse proxy and `PUBLIC_URL` instead. |

## First owner and sign-in

| Variable | Default | What it does |
| --- | --- | --- |
| `SETUP_CODE` | unset | If set, whoever creates the first owner login must type it once. Strongly recommended whenever the server can be reached from outside your home network. Guesses are rate limited and the code is compared in constant time. Without it, the first owner can only be created from your home network. |
| `ALLOW_PUBLIC_SETUP` | `false` | Let the first owner be created from a public address with no `SETUP_CODE`. Not recommended. |
| `DISABLE_PASSWORD_LOGIN` | `false` | Hide the password form. Only takes effect when single sign-on is configured, so it cannot lock everyone out by accident. |

### Single sign-on (OpenID Connect)

Set `OIDC_ISSUER` and `OIDC_CLIENT_ID` (plus `OIDC_CLIENT_SECRET` for a confidential client) to turn SSO on. Register `<PUBLIC_URL>/api/auth/oidc/callback` as the redirect URI at your provider. See [Passkeys and single sign-on](securing.md#passkeys-and-single-sign-on).

| Variable | Default | What it does |
| --- | --- | --- |
| `OIDC_ISSUER` | unset | The provider's issuer URL, such as `https://id.example.com`. Must be `https://` unless it is on a private address (or `OIDC_ALLOW_HTTP_ISSUER=true`). |
| `OIDC_CLIENT_ID` | unset | Client ID registered for Ribbon. |
| `OIDC_CLIENT_SECRET` | unset | Client secret. |
| `OIDC_SCOPES` | `openid profile email` | Scopes to request. `openid` is always included. Separate with spaces or commas. |
| `OIDC_AUTO_LINK_BY_EMAIL` | `false` | Link an SSO sign-in to the existing login with the same email, when the provider says the address is verified. Otherwise people link SSO themselves under **Settings → Account**. |
| `OIDC_BUTTON_LABEL` | `Sign in with SSO` | Text of the sign-in button (40 characters at most). |
| `OIDC_ALLOW_HTTP_ISSUER` | `false` | Allow an `http://` provider that is not on a private address. |

## Data and backups

| Variable | Default | What it does |
| --- | --- | --- |
| `DATA_DIR` | `/data` | Folder holding `ribbon.db` and the `backups/` folder. In Docker this is the `ribbon_data` volume; you rarely need to change it. |
| `BACKUP_CRON` | `0 3 * * *` | Five-field cron expression (minute hour day month weekday) for scheduled backups, in the container's time zone (UTC unless you set `TZ`). `off` disables scheduled backups. An invalid expression turns them off and logs an error. |
| `BACKUP_KEEP` | `14` | How many scheduled backups to keep (1 to 1000). Older ones are deleted. Manual and pre-restore backups are not counted. |

See [Backups & restore](backups.md).

## Optional features

| Variable | Default | What it does |
| --- | --- | --- |
| `XAI_API_KEY` | unset | Turns on the **Ask** page. A question sends a trimmed copy of your gift list to xAI, so leave it unset if you do not want that. Each login gets 30 questions an hour. |

## Tour, sample data and development

| Variable | Default | What it does |
| --- | --- | --- |
| `TOUR_ALWAYS` | `false` | Show the guided tour on every sign-in until someone finishes it with **Done** (testing). |
| `TOUR_IN_DEV` | `false` | Allow the auto-opening tour in sample-data development mode. |
| `SEED_SAMPLE_DATA` | `false` in production, `true` in `npm run dev` | Load a sample household into a brand-new database. Never use it for a real install. In development it also creates a dev login. |
| `DEV_USERNAME`, `DEV_PASSWORD` | `admin`, `ribbon-dev-password` | The dev login created when sample data is on. Development only. |

## Set by the image

You normally never touch these.

| Variable | Value | What it does |
| --- | --- | --- |
| `NODE_ENV` | `production` | Production behaviour (secure cookies on HTTPS, no sample data, the Welcome setup). |
| `HOST`, `NITRO_HOST` | `0.0.0.0` | Address the server binds to. |
| `PORT`, `NITRO_PORT` | `8080` | Port the server listens on inside the container. |
| `GIT_COMMIT` | build argument | Short commit SHA shown in **Settings → About** and `/api/health`. |

## A starting `.env`

```bash
# Image: use "dev" until the first release exists
RIBBON_TAG=dev

# Behind an HTTPS reverse proxy
PUBLIC_URL=https://ribbon.example.com

# Required to create the owner if the server is reachable from the internet
SETUP_CODE=change-me-to-something-long

# Nightly backups at 03:00, keep two weeks (these are the defaults)
BACKUP_CRON=0 3 * * *
BACKUP_KEEP=14
```

# Securing your install

Ribbon holds your family's names, birthdays and gift plans, so treat it like any other service with logins. The defaults are safe for a home network. This page is the checklist for anything beyond that.

!!! success "The short version"

    1. Put an **HTTPS reverse proxy** in front and set **`PUBLIC_URL`**.
    2. Do not publish port 8080 to the internet; publish only the proxy.
    3. Set **`SETUP_CODE`** before the first owner exists if the server can be reached from outside.
    4. Set **`TRUSTED_PROXIES`** to just your proxy if other devices on your LAN are not trusted.
    5. **Back up** the `ribbon_data` volume somewhere off the machine.
    6. Turn on **passkeys** (or SSO) and keep the container hardening from `docker-compose.yml`.

## HTTPS and a reverse proxy

Ribbon speaks **plain HTTP on port 8080** and leaves TLS to whatever you already run in front of it. On plain HTTP, passwords and session cookies cross the network readable. Ribbon helps by refusing password sign-in over plain HTTP from addresses outside your private network, but that is a seatbelt, not a substitute for HTTPS.

HTTPS is also needed for the "install as an app" prompt, the offline page and passkeys (a browser *secure context*: an `https://` address or `http://localhost`).

Pick the recipe that matches what you already run, all in [HTTPS and reverse proxies](REVERSE-PROXY.md):

| You run | Use |
| --- | --- |
| Nothing yet | [Caddy overlay](REVERSE-PROXY.md#caddy) bundled in the repo: one command, automatic Let's Encrypt certificate |
| Nginx Proxy Manager | [NPM recipe](REVERSE-PROXY.md#nginx-proxy-manager) |
| Traefik | [Traefik labels](REVERSE-PROXY.md#traefik) |
| Tailscale | [`tailscale serve`](REVERSE-PROXY.md#tailscale): private HTTPS, nothing on the internet |
| Cloudflare | [Cloudflare Tunnel](REVERSE-PROXY.md#cloudflare-tunnel) |

A minimal Caddy site, for reference:

```
ribbon.example.com {
	reverse_proxy ribbon:8080
}
```

!!! danger "Do not publish port 8080 when a proxy is in front"

    Publish only the proxy, or firewall 8080 to the proxy host. If the proxy runs on the same Docker network you can drop `ports:` from the Ribbon service entirely (the Caddy overlay does this for you).

## The settings that matter

### `PUBLIC_URL`

The address people type, for example `https://ribbon.example.com`. Ribbon uses it to decide whether a request is HTTPS (so it can mark the session cookie `Secure` with the `__Host-` prefix and send `Strict-Transport-Security`), and for calendar links, SSO redirects and passkey origins. Set it whenever you use a proxy, then `docker compose up -d`.

### `TRUSTED_PROXIES`

Which peers may tell Ribbon about the real connection through `X-Forwarded-Proto`, `-Host` and `-For`. Headers from anyone else are ignored, so a stranger who reaches port 8080 directly cannot pretend the connection is HTTPS or forge their address.

The default trusts loopback and private ranges, which suits a home setup with a proxy on another machine on the LAN. The cost is that another LAN device could forge `X-Forwarded-For` to look public or private (it can no longer use that to dodge sign-in lockout). If your network is not fully trusted, set it to just the proxy:

```bash
TRUSTED_PROXIES=172.18.0.5/32      # your proxy's address
# or, to trust nobody (and set PUBLIC_URL instead):
TRUSTED_PROXIES=none
```

### `SETUP_CODE`

Until the first owner exists, `/api/setup` is open to anyone who can reach the server. A server exposed before setup could be claimed by a stranger. `SETUP_CODE` closes that: the person creating the first owner must type the code. Guesses are rate limited (10 per 15 minutes per address) and the comparison is constant time.

```bash
SETUP_CODE=a-long-random-phrase
```

Without a code, Ribbon only creates the first owner from a private, home-network address and the setup page explains why it refused. A start-up warning is logged while no owner exists.

### `ALLOW_PUBLIC_SETUP`

`ALLOW_PUBLIC_SETUP=true` lets the first owner be created from a public address with **no** code. Not recommended. Prefer `SETUP_CODE`.

### `ALLOW_INSECURE_LOGIN`

By default Ribbon refuses password sign-in over plain HTTP from addresses outside the private ranges ("Sign-in over plain HTTP is only allowed from your home network"). `ALLOW_INSECURE_LOGIN=true` turns that guard off. Only use it if you have a reason, such as a tunnel that terminates TLS in a way Ribbon cannot see and you cannot yet set `PUBLIC_URL`.

## Passkeys and single sign-on

**Passkeys** let people sign in with a fingerprint, face or security key. Add one under **Settings → Account** (it needs HTTPS or `localhost`). Ribbon requires *user verification* (a PIN, fingerprint or face), so a stolen unlocked device or a key with no PIN is not enough. Passkey sign-in has its own rate limits, separate from the password lockout.

**Single sign-on** (OpenID Connect with PKCE) works with a standard OpenID Connect provider such as Authelia, Authentik or Keycloak. (It is covered by automated tests against a fake provider; it has not yet been checked against a particular real one, so please report any trouble.)

1. At your provider, create a client for Ribbon with the redirect URI `<PUBLIC_URL>/api/auth/oidc/callback`.
2. Set `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` in `.env`, and run `docker compose up -d`.
3. Each person links SSO to their existing login under **Settings → Account**, or set `OIDC_AUTO_LINK_BY_EMAIL=true` to match by verified email.
4. Once it works for everyone, `DISABLE_PASSWORD_LOGIN=true` hides the password form. It only takes effect when SSO is configured, so it cannot lock you out by accident.

Ribbon checks every provider endpoint against the same https rule as the issuer (plain `http://` only on a private address, or with `OIDC_ALLOW_HTTP_ISSUER=true`) and refuses redirects, so a tampered discovery document cannot point the server at an internal address.

!!! tip "Keep a way back in"

    Passkeys and SSO have separate lockout counters from passwords. If someone is locked out by wrong passwords, a passkey or SSO sign-in still works, and the lockout ends on its own after 15 minutes.

## Sign-in protection

- Passwords are hashed with **scrypt** (N=2^16, r=8, p=2); older hashes are upgraded when someone next signs in.
- Sessions are stored on the server (only a hash of the token is kept) and last 14 days. The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` over HTTPS.
- Every change needs a CSRF token and a same-site `Origin`.
- **Lockout:** 5 wrong passwords for one account from one address, 20 for one account from anywhere, or 30 from one address across accounts lock sign-in for 15 minutes. A forged `X-Forwarded-For` cannot dodge it. The counters are in memory and reset when the container restarts.

## Container hardening

The image runs as the unprivileged `node` user and only `/data` is writable. The shipped `docker-compose.yml` also does:

```yaml
cap_drop:
  - ALL
security_opt:
  - no-new-privileges:true
```

Ribbon needs no extra privileges, so keep both if you write your own compose file. A further step you can try is a read-only root filesystem (`read_only: true` with a `tmpfs` for `/tmp`); it has not been tested by the project.

The image also has a health check on `/api/health`, which answers over plain HTTP so Docker health checks keep working behind any proxy.

## Backups and secrets

- Back up the `ribbon_data` volume. Ribbon writes nightly snapshots into it, but those live on the same disk, so copy them elsewhere. See [Backups & restore](backups.md). Backup files are owner-only on disk (`0600`, folder `0700`) because they hold every household's data.
- Keep `.env` out of git and out of screenshots; it can hold `SETUP_CODE`, `XAI_API_KEY` and `OIDC_CLIENT_SECRET`.
- Treat your ICS calendar link like a password. Regenerating it revokes the old one.

## Security audit summary

Ribbon `0.3.0-dev.2` had a full review against a **running production build**, not just the code. Every finding was reproduced with a proof-of-concept request before the fix and re-checked after; each fix has a regression test.

**Result:** no way to read or change another household's data, no SQL injection, no stored XSS and no sign-in bypass were found. One availability bug (a hanging request), several brute-force and takeover weaknesses and a number of smaller hardening gaps were found and fixed.

| Severity | Count | Examples (all fixed) |
| --- | --- | --- |
| High | 2 | First-owner takeover on an exposed server; a malformed URL path that hung the connection |
| Medium | 7 | Bypassable sign-in lockout; global passkey lockout; Secret Santa peeking after the draw; restore with no owner; demoting the instance admin; scrypt strength; unbounded request bodies |
| Low | 12 | CSV link checks, calendar-feed injection, passkey user verification, SSO endpoint checks, Ask limits, backup file permissions, headers, CI hygiene, container capabilities, dependencies |

**Accepted risks** include a CSP that still allows inline scripts (the framework's server rendering needs them), household members being trusted editors of their shared ledger, and the instance admin being able to read everything in backups. Each has its reasoning in the report.

The complete list, with how each item was verified, what was checked and found sound, and what was not tested, is in the [full security audit](SECURITY-AUDIT.md). To report a problem privately, see the [security policy](https://github.com/thepizzatech/ribbon/blob/main/SECURITY.md) (do not open a public issue).

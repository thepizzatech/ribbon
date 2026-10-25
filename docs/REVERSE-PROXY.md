# HTTPS and reverse proxies

Ribbon listens on **plain HTTP, port 8080**, and leaves TLS to whatever you already run in front of it. Out of the box `http://<server-ip>:8080` works on your home network, and that is fine for trying it out. Before you reach it from outside your home, or want to install it as an app on a phone, put HTTPS in front.

**Why HTTPS matters:** passwords and session cookies cross the network. On plain HTTP anyone on the path can read them. Ribbon helps by refusing password sign-in over plain HTTP from addresses outside the private ranges (see below), but that is a seatbelt, not a substitute.

**PWA install needs HTTPS.** The "install as an app" prompt, the offline service worker, passkeys and the share target only work in a *secure context*: an `https://` address, or `http://localhost`. On `http://192.168.x.x` the site works as a normal web page, and Settings tells you installing needs HTTPS.

## The three settings that matter

| Variable | What it does |
| --- | --- |
| `PUBLIC_URL` | The address people type, for example `https://ribbon.example.com`. Ribbon uses it for cookie and HSTS decisions, calendar links, OIDC redirects and passkeys. |
| `TRUSTED_PROXIES` | Which peers may tell Ribbon about the real connection via `X-Forwarded-Proto`, `-Host` and `-For`. Default: loopback plus private ranges (`127.0.0.0/8`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`, `100.64.0.0/10` for Tailscale). `none` trusts nobody. Otherwise a comma-separated list of CIDRs. |
| `ALLOW_INSECURE_LOGIN` | `true` lets people sign in with a password over plain HTTP even from outside the private ranges. Leave it off unless you know why. |

Forwarded headers from any other peer are ignored, so a stranger who can reach port 8080 directly cannot pretend the connection is HTTPS.

How Ribbon decides if a request is HTTPS: `PUBLIC_URL` (when the request is for that host), else `X-Forwarded-Proto` from a trusted proxy, else the socket. Only when it is HTTPS does Ribbon mark the session cookie `Secure` (with the `__Host-` prefix) and send `Strict-Transport-Security` (6 months, no `includeSubDomains`; `HSTS=off` turns it off). A LAN request to `http://10.0.0.5:8080` keeps working next to a public `https://` address.

`/api/health` always answers over HTTP, so Docker health checks keep working.

`ENFORCE_HTTPS=true` still exists as a deprecated alias: it logs a warning and means "refuse password sign-in over plain HTTP from everywhere".

> **Do not publish port 8080 to the internet** when a proxy is in front. Publish only the proxy, or firewall 8080 to the proxy host. If your proxy runs on the same Docker network you can drop `ports:` from the Ribbon service entirely.

Pick the recipe that matches what you already run.

## Nginx Proxy Manager

1. **Network.** Put NPM and Ribbon on one Docker network so NPM can reach it by name. Add this to Ribbon's compose file (and the same network to NPM's):

   ```yaml
   services:
     ribbon:
       networks: [proxy]
   networks:
     proxy:
       external: true   # docker network create proxy
   ```

2. **Proxy Host → Details:** Domain `ribbon.example.com`; Scheme `http`; Forward Hostname `ribbon` (the container name) or the server's IP; Forward Port `8080`; **Websockets Support on**; **Block Common Exploits on**; Cache Assets off.
3. **SSL tab:** pick or request a certificate; turn on **Force SSL**, **HTTP/2 Support** and **HSTS Enabled**; leave **HSTS Subdomains off**.
4. Set `PUBLIC_URL=https://ribbon.example.com` in Ribbon's `.env` and restart it.

NPM sits on a private address, so Ribbon already trusts it. For a **LAN-only name** (not reachable from the internet) use the DNS challenge: in the SSL tab choose "Use a DNS Challenge" with your DNS provider (Cloudflare, DuckDNS, ...) so Let's Encrypt can issue a certificate for a name that points at a private IP. Then point that name at the server in your router's DNS.

## Caddy

Caddy's whole config for Ribbon:

```
ribbon.example.com {
	reverse_proxy ribbon:8080
}
```

Use `localhost:8080` instead of `ribbon:8080` if Caddy runs on the host. A public domain gets a Let's Encrypt certificate on its own. Set `PUBLIC_URL=https://ribbon.example.com`.

**Bundled overlay.** `docker-compose.caddy.yml` adds exactly that in a container (Compose 2.24+):

```bash
SITE_ADDRESS=ribbon.example.com docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
```

It publishes 80 and 443 and hides Ribbon's own port. For a LAN IP or private name use `tls internal` (add it inside the site block of `deploy/Caddyfile`); Caddy then issues from its own local CA, and each device has to trust the root once: copy `/data/caddy/pki/authorities/local/root.crt` out of the `caddy` container (`docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt .`) and install it as a trusted root on the phone or PC. Keep the `caddy_data` volume; it holds that CA.

## Traefik

Labels on the Ribbon service, with Traefik on the same network and an entrypoint named `websecure` plus a certificate resolver named `letsencrypt`:

```yaml
services:
  ribbon:
    labels:
      - traefik.enable=true
      - traefik.http.routers.ribbon.rule=Host(`ribbon.example.com`)
      - traefik.http.routers.ribbon.entrypoints=websecure
      - traefik.http.routers.ribbon.tls.certresolver=letsencrypt
      - traefik.http.services.ribbon.loadbalancer.server.port=8080
    networks: [proxy]
```

Traefik sets the `X-Forwarded-*` headers itself. Set `PUBLIC_URL=https://ribbon.example.com`. If Traefik reaches Ribbon from a public address (unusual), add its address to `TRUSTED_PROXIES`.

## Tailscale

The simplest private HTTPS: nothing is exposed to the internet, only to your tailnet.

```bash
tailscale serve --bg 8080
```

Tailscale prints an address like `https://myserver.tail1234.ts.net`. Set `PUBLIC_URL` to it and restart Ribbon. Tailscale's connections arrive from loopback or `100.64.0.0/10`, both trusted by default. (`tailscale funnel` would make it public: only do that on purpose.)

## Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:8080          # quick test
```

or in the Zero Trust dashboard add a public hostname `ribbon.example.com` → service `HTTP` → `ribbon:8080` (or `localhost:8080`). Cloudflare terminates HTTPS and `cloudflared` connects from a private address, so Ribbon trusts it. Set `PUBLIC_URL=https://ribbon.example.com`. Consider Cloudflare Access in front if you want a second lock.

## Checking it worked

- Open the `https://` address: Settings → About should not show "Connection not secure".
- Sign in, then check that the cookie is `Secure` in your browser's dev tools.
- `curl -sI https://ribbon.example.com/` should show `strict-transport-security`.
- Direct `http://<server-ip>:8080` on your LAN should still load (unless you removed the published port).

#!/bin/sh
# Builds the Caddyfile from environment variables and starts Caddy.
#
#   SITE_ADDRESS  what people type in the browser: a domain (ribbon.example.com), a LAN
#                 hostname (ribbon.lan) or an IP (10.15.40.16). Default: localhost.
#   HTTP_PORT / HTTPS_PORT  the ports Caddy listens on (and the host publishes). Default 80 / 443.
#   TLS_MODE      auto (default) | internal | acme. "auto" picks "internal" (Caddy's own local CA)
#                 for IPs, localhost and private names, and "acme" (Let's Encrypt) for real domains.
#   ACME_EMAIL    optional contact address for Let's Encrypt.
#   UPSTREAM      where the app is. Default ribbon:8080.
set -eu

SITE_ADDRESS="${SITE_ADDRESS:-localhost}"
HTTP_PORT="${HTTP_PORT:-80}"
HTTPS_PORT="${HTTPS_PORT:-443}"
TLS_MODE="${TLS_MODE:-auto}"
UPSTREAM="${UPSTREAM:-ribbon:8080}"
OUT="${CADDYFILE_OUT:-/tmp/Caddyfile}"

# The bare host name: no scheme, no port, no path.
host="${SITE_ADDRESS#*://}"
host="${host%%/*}"
case "$host" in
  \[*) host="${host%%]*}]" ;;      # [::1]:8443 -> [::1]
  *:*) host="${host%%:*}" ;;       # name:8443  -> name
esac

if [ "$TLS_MODE" = "auto" ]; then
  case "$host" in
    localhost|*.localhost|*.local|*.lan|*.home|*.internal|*.home.arpa|*.test|*.intranet|*.private) TLS_MODE=internal ;;
    \[*) TLS_MODE=internal ;;
    *[!0-9.]*)
      case "$host" in
        *.*) TLS_MODE=acme ;;      # looks like a public domain
        *)   TLS_MODE=internal ;;  # single-label host name, e.g. "myserver"
      esac ;;
    *) TLS_MODE=internal ;;        # IPv4 address
  esac
fi

case "$TLS_MODE" in
  internal|acme) ;;
  *) echo "TLS_MODE must be auto, internal or acme (got '$TLS_MODE')" >&2; exit 1 ;;
esac

{
  echo "{"
  echo "	admin off"
  echo "	http_port $HTTP_PORT"
  echo "	https_port $HTTPS_PORT"
  # Caddy's own HTTP->HTTPS redirect drops a non-standard port, so spell it out below.
  [ "$HTTPS_PORT" != "443" ] && echo "	auto_https disable_redirects"
  [ -n "${ACME_EMAIL:-}" ] && echo "	email $ACME_EMAIL"
  echo "}"
  echo
  if [ "$HTTPS_PORT" != "443" ]; then
    echo "http://$host:$HTTP_PORT {"
    echo "	redir https://{host}:$HTTPS_PORT{uri} permanent"
    echo "}"
    echo
  fi
  echo "$SITE_ADDRESS {"
  [ "$TLS_MODE" = "internal" ] && echo "	tls internal"
  echo "	encode zstd gzip"
  echo "	reverse_proxy $UPSTREAM"
  echo "}"
} > "$OUT"

echo "[ribbon] $SITE_ADDRESS: TLS mode '$TLS_MODE', http $HTTP_PORT, https $HTTPS_PORT, upstream $UPSTREAM"
if [ "${DRY_RUN:-}" = "1" ]; then cat "$OUT"; exit 0; fi
exec caddy run --config "$OUT" --adapter caddyfile

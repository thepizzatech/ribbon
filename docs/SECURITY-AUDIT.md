# Security audit: 0.4.0-dev.1

A review of the whole app (server and client) done against a **running production build**, not just by reading code. Every finding below was either reproduced with a proof-of-concept request against a local server (before the fix) or checked with one (after the fix); each fix has a regression test in `src/server/*.test.ts` (most in `hardening.test.ts`). Scope: the `main` branch at 0.3.0-dev.1, plus the Welcome setup added in 0.3.0-dev.2. **0.4.0-dev.1 adds calendar connections, which got their own focused review: see [Calendar connections](#calendar-connections).** The numbered findings below are from the earlier full review.

**Result:** no way to read or change another household's data, no SQL injection, no stored XSS, and no sign-in bypass were found. One availability bug (a hanging request), several brute-force and takeover weaknesses, and a number of smaller hardening gaps were found and fixed. Items that remain are listed as accepted, with the reason.

## How it was tested

- A harness started the built server (`.output/server/index.mjs`, `NODE_ENV=production`) on a fresh data directory, created two households with an owner, two members and a second owner, planted a surprise gift, a wishlist and a Secret Santa draw, and then attacked it over HTTP as an anonymous visitor, a member, the recipient of a surprise, and another household's owner.
- About 28 write and read routes were replayed across households (IDOR); the surprise-safe views (gifts, ledger, export, CSV, calendar, budgets, wishlist) were diffed for the recipient; sign-in, setup and passkey endpoints were hammered with concurrent and forged-header requests; malformed paths, oversized and chunked bodies, hostile backups, hostile CSV and hostile names were sent in.
- Dependencies (`npm audit`), the git history (secret patterns, committed key or database files), the built assets (source maps), the Dockerfile, compose files and workflows were reviewed.
- After the fixes the same scripts were re-run: every item below marked fixed reports clean.

## Findings

Severity is the impact if exploited on a typical home-hosted install. "Verified" says how the issue was shown and how the fix is checked.

| ID | Severity | Finding | Status | Verified |
| --- | --- | --- | --- | --- |
| S1 | High | **First-owner takeover.** Until the first owner exists, `/api/setup` is open to anyone who can reach the server, and a server exposed to the internet before setup could be claimed by a stranger (the only brake was the optional `SETUP_CODE`, which also had no guess limit and a non-constant-time compare). | **Fixed.** Without `SETUP_CODE` the first owner can only be created from a private/home-network address (`ALLOW_PUBLIC_SETUP=true` opts out); setup attempts are rate limited (10 per 15 min per address); the code is compared in constant time; the setup page explains the refusal; a start-up warning is logged while no owner exists. | PoC: 15 concurrent setups gave exactly one owner (the race itself is fine). Tests: public address refused, code accepted, guesses throttled (`hardening.test.ts`). |
| S2 | High | **A request path with broken percent-encoding hangs forever** (`GET /%E0%A4%A`, also under `/api/` and `/assets/`). The framework throws before any middleware runs and never answers, so a handful of requests can tie up connections. | **Fixed** with a Nitro plugin that wraps the app's fetch and answers `400` first. | PoC against the built server: request timed out before; `400` now for four malformed paths. Test: `pathIsWellFormed`. |
| S3 | Medium | **Sign-in lockout was bypassable and abusable.** Misses were counted per account and per address, so (a) anyone on the home network, or anything behind a trusted proxy, could rotate a forged `X-Forwarded-For` to get unlimited guesses at one account, and (b) five wrong tries from anywhere locked the real owner out. | **Fixed.** Counters are now per account+address (5), per account from anywhere (20) and per address across accounts (30), kept in a pruned, size-capped map. A good sign-in forgives only that address's own misses. | PoC: 40 guesses with 40 forged addresses got 0×429 before. Tests in `hardening.test.ts` (rotation, spraying, proxy address, Retry-After). |
| S4 | Medium | **Passkey sign-in shared one global lockout key,** so 20 failures from any address blocked passkey sign-in for everyone (denial of service). | **Fixed.** Per-address counters (20 misses) replace the shared bucket; the options endpoint is rate limited (60 per 15 min per address) and the open-challenge table is capped at 500 rows. | PoC: after failures from one address another address got 429. Test: lockout isolation. |
| S5 | Medium | **Secret Santa organiser could switch peeking on after the draw** and read every pairing, with no sign to participants. | **Fixed.** Peeking can only be enabled before the draw (409 afterwards). | PoC reproduced the leak; test in `hardening.test.ts` and the updated `secretsanta.test.ts`. |
| S6 | Medium | **Restoring a database with no owner login** locks everyone out and re-opens first-run setup to the next visitor. | **Fixed.** A restore file must contain an owner; setup is also guarded by S1. Uploaded files are opened with `trusted_schema=OFF`, only table data is copied (views and triggers in the file are never imported), and a safety backup is taken first. | Test: no-owner file refused (400), hostile view/trigger not imported. PoC re-run: restore 400, setup still closed. |
| S7 | Medium | **Another owner could demote or remove the instance admin** (the first owner, who alone manages backups and other households), so a second owner could take over those powers. | **Fixed.** That login can't be demoted or removed by anyone. | Test: both refused (409), backups stay admin-only. |
| S8 | Medium | **Password hashing was at the low end** (scrypt N=2^15, p=1), and a restored or edited row could carry absurd scrypt costs. | **Fixed.** New hashes use N=2^16, r=8, p=2; old hashes are upgraded after a successful sign-in; stored parameters are bounds-checked; password-less (SSO-only) logins burn a hash so timing matches. | Tests: parameters, rehash on login, tampered cost refused fast. Timing PoC: unknown, wrong-password and SSO-only logins within ±8 ms. |
| S9 | Medium | **Chunked or unbounded request bodies were buffered before the size check** (`request.text()`), so a large upload could exhaust memory. | **Fixed.** Bodies are counted while they are read and cut off at 5 MB (256 MB for restore, admin only). | PoC: a 150 MB body is refused with 413 in under a second with no memory growth; test with a 12 MB chunked stream. |
| S10 | Low | **Wishlist URLs imported from CSV skipped the http(s) check** used by the form, so junk such as `https://javascript:alert(1).x` was stored. (React would not run it, but it is not a link.) | **Fixed** server-side with the same `safeUrl`, plus a client check before rendering a link. | PoC reproduced; CSV test. |
| S11 | Low | **iCalendar injection:** a bare CR or control character in a person's name could start a new property line in the calendar feed (for example an `ATTENDEE`). | **Fixed.** Control characters are stripped and newlines escaped. | PoC showed the raw CR; test checks no injected line. |
| S12 | Low | **Passkeys did not require user verification,** so a stolen unlocked device (or a key with no PIN) was a complete sign-in. | **Fixed.** Registration and sign-in require user verification. | Passkey tests pass with verification required. |
| S13 | Low | **Deleting your own person revealed whether a surprise was planned for you** ("This person is on a gift"). | **Fixed.** Removing yourself always answers the same way. | Test compares the answer with and without a surprise. |
| S14 | Low | **SSO provider endpoints were not checked,** and redirects were followed: a hijacked discovery document could point the server at an internal address (SSRF) or a plain-HTTP endpoint. `/api/auth/oidc/start` wrote a database row per hit with no limit. | **Fixed.** Every endpoint must pass the same https rule as the issuer (private-network http only when allowed), redirects are refused, and start is limited to 30 per 15 min per address. | Tests with a fake provider naming a public HTTP token endpoint, and a 31-request burst. |
| S15 | Low | **Ask feature:** no per-person limit (a family member could burn the xAI key), no Origin or Welcome-setup check on the server function, and the ledger was pasted into the prompt without delimiting, so a note such as "ignore your rules" was taken as an instruction. | **Fixed.** 30 questions per hour per login, Origin and Welcome checks, ledger passed as `<ledger>` untrusted data with rules not to follow instructions in it or emit links. The model has no tools, so injection can only change the wording of an answer the same person sees. The API key never leaves the server. | Code review plus the build; behaviour of the model itself is not testable offline. |
| S16 | Low | **Passkey delete with a malformed id returned 500** (an uncaught `URIError`). | **Fixed.** 400. | Test. |
| S17 | Low | **Backups were world-readable** under the container's default umask. | **Fixed.** Backup folder `0700`, files `0600`. | Test checks the modes. |
| S18 | Low | **Missing `Cross-Origin-Resource-Policy`, and the HTML shell had no `Cache-Control`.** | **Fixed.** `same-origin` on everything, `no-cache` on HTML. | Headers diffed against the running server. |
| S19 | Low | **CI/CD hygiene:** CI had default token permissions, release gave `contents: write` to every job, actions were pinned to moving tags, checkout kept the token, no dependency update automation. | **Fixed.** Read-only default, job-level write, SHA-pinned actions, `persist-credentials: false`, Dependabot for Actions, npm and Docker. | Workflow diff; CI run on the pushed commit. |
| S20 | Low | **Container:** all Linux capabilities were kept by default in compose. | **Fixed.** `cap_drop: ALL` and `no-new-privileges`. The image already runs as the unprivileged `node` user with only `/data` writable. | Compose validated in CI; not run under Docker on the test box (see Not tested). |
| S21 | Low | **Dependencies:** `npm audit` reported known issues in vite, zod and fast-uri. | **Fixed.** Updated; 0 known vulnerabilities. | `npm audit`. |
| S22 | Info | `.env.example` was referenced by the README but git-ignored, so it was never published. | **Fixed.** Tracked and updated. | `git ls-files`. |

## Checked and found sound

- **Authorization / IDOR:** every route was replayed from another household, from a member, and (for surprises) from the recipient: gifts, people, wishlist, budgets, occasions, users, exchanges and participants, sharing links, backups, households, CSV preview/import/export, `/api/export`, `/api/ledger`, `/api/calendar`. Responses are `404` or `403`, and the data was unchanged afterwards. Lists and exports of one household never contained another's records.
- **Surprise safety:** the recipient never sees the gift, its budget, its CSV row, its calendar entry, or the reserved/purchased mark on their own wishlist, and cannot edit or delete it.
- **Secret Santa:** each participant gets only their own draw; the organiser sees no pairings unless they chose to peek before the draw; non-organisers cannot change or redraw.
- **Sessions and cookies:** 256-bit random tokens, only a SHA-256 hash stored, 14-day sliding expiry, `HttpOnly`, `SameSite=Lax`, `Secure` and the `__Host-` prefix over HTTPS, sessions revoked on password change, deleted with the user.
- **CSRF and Origin:** every write needs the per-session token and a matching Origin; `text/plain` and cross-site form posts are refused; there is no CORS.
- **Proxy trust:** a client-sent `X-Ribbon-Peer` is discarded; `X-Forwarded-*` is believed only from trusted peers.
- **User enumeration:** same message and timing for unknown, wrong-password and SSO-only accounts.
- **SQL injection:** every query is parameterised; the few dynamic identifiers (table names in restore) come from the database's own schema, not from input.
- **XSS:** React escapes all output; the only `dangerouslySetInnerHTML` is a static theme script. No markdown or HTML is rendered from user text. Wishlist URLs are http(s) only.
- **CSV:** exports prefix `= + - @` cells so spreadsheets don't run them as formulas; imports are capped at the row limit and validated.
- **ICS feed token:** 192 bits, regenerating kills the old link, no token gives 404.
- **Backup download and restore:** names must match a strict pattern, so `../`, encoded separators and NUL bytes all fail; non-SQLite and newer-schema files are refused.
- **OIDC:** state, nonce and PKCE (S256) with single-use, expiring flows tied to a cookie; the callback address comes from `PUBLIC_URL` or the trusted request host and must be registered at the provider, and there is no `next=` style redirect parameter; accounts are only linked by e-mail when the provider says it is verified, the address is unique, and `OIDC_AUTO_LINK_BY_EMAIL` is on.
- **WebAuthn:** the relying-party ID and origin come from `PUBLIC_URL` or the trusted request host; challenges are single use and expire.
- **Service worker:** `/api/*` is never intercepted, navigations are network-only, and only hashed assets and icons are cached, so signed-in data is never stored.
- **Errors and logs:** the API returns generic 500s, stack traces go only to the server log, and no log line contains a password, token or the SETUP_CODE. Static probes (`/.env`, `/package.json`, `../` paths) return the app shell with 404.
- **Docker image:** non-root `node` user, `/data` is the only writable location, health check uses `/api/health`, `.dockerignore` excludes `.env`, `.git` and data.
- **Git history:** 39 commits scanned for API keys, tokens, private keys, key/database/`.env` files: nothing found. Test fixtures contain throwaway passwords only.
- **Source maps:** none are shipped in the production assets.

## Accepted risks and limitations

| ID | Severity | What | Why it is accepted |
| --- | --- | --- | --- |
| A1 | Low | **CSP allows inline scripts** (`script-src 'self' 'unsafe-inline'`). | The framework's server rendering needs inline bootstrap scripts, and nonces are not supported by this build. With no HTML injection point found (see XSS above), the practical risk is low. Revisit when the framework supports nonces. |
| A2 | Low | **Default trusted proxies are all private ranges,** so another machine on your LAN can forge `X-Forwarded-For` (it can no longer use that to dodge sign-in lockout, but it can make itself look public or private). | Needed for the common home setup with a proxy on another LAN host. Set `TRUSTED_PROXIES` to just your proxy to tighten it. |
| A3 | Low | **Household members are trusted editors:** a member can replace or delete the household's whole ledger through the import or the normal edit calls. | This is the product's model (a family shares one ledger); owners control logins, sharing and backups. |
| A4 | Low | **The instance admin can read everything in backups,** including surprises planned for them. | Backups are a full copy of the database; only the person who runs Ribbon can open them. |
| A5 | Low | **DNS rebinding** could let a web page reach a Ribbon on the home network. | Such a page has no cookie or CSRF token, so it can read nothing private; the Host-based Origin check still holds. |
| A6 | Low | **Sign-in lockout is in memory** and resets on restart; the 20-per-account limit means a determined stranger can keep the real owner locked out for 15-minute stretches. | Chosen over letting guesses through; the owner can use a passkey or SSO, which have separate counters. |
| A7 | Info | **A few existence oracles remain** (for example "that login is gone" for ids in your own household). | They only reveal what a signed-in member of that household can already see. |
| A8 | Info | **A LAN IP address appears in old test fixtures in git history.** | Private address, no secret. |
| A9 | Info | **The base image is pinned by tag, not digest,** and the container's root filesystem is writable. | Dependabot tracks the tag; `read_only: true` with a tmpfs for `/tmp` is a good extra step but was not tested here. |

## Calendar connections

Calendars make the server fetch addresses that users type in and store third-party credentials, so they were reviewed as their own surface: a mini-review of the code, then probes against the **built production server** (`ALLOW_PRIVATE_CALENDAR_URLS` off) as a signed-in owner and as an anonymous client. Calendar logic has about 100 tests; the ones that matter here are named below.

### What was probed

- **Server-side request forgery.** 19 calendar addresses were submitted to `POST /api/calendars` and `/api/calendars/caldav/discover`: `127.0.0.1`, `localhost`, `[::1]`, `169.254.169.254`, `2130706433` (decimal), `0x7f.1`, `127.1`, `[::ffff:127.0.0.1]`, `[::ffff:7f00:1]`, `10.0.0.1`, `192.168.1.1`, `100.64.0.1`, `0.0.0.0`, `metadata.google.internal`, names that resolve to loopback (`localtest.me`, `127.0.0.1.nip.io`), `file://`, `ftp://` and `user:pw@host`. Every one was refused with a plain message and **nothing was fetched or stored**. A CalDAV password to `http://` is refused outright.
- **Fetch limits (tests).** The address is checked after DNS resolution and the socket connects to that checked address, so a hostname cannot change its answer between check and connect. Redirects are followed manually, at most 5, each hop re-checked, and non-http schemes stop the chain. The body is capped at 5 MB (also after decompression), there is a 10 s timeout, and `Authorization` is only sent to the first host (`safe-fetch.test.ts`).
- **Access control.** Without a session: 401. Without the CSRF token: 403. Another login, and another household, cannot list, change, sync, share or delete a connection, review its suggestions or use its Google link (`calendar-connections.test.ts`, `google.test.ts`, `caldav.test.ts`). Shared connections show events read-only, to the same household only.
- **Surprise safety.** Gift deadlines and "still to buy" never list the person the gift is for; a shared event about you is hidden from you; Secret Santa dates only reach people who can see the exchange (`calendar-events.test.ts`).
- **Hostile content.** A calendar with a hostile title (`<img onerror>`), control and bidirectional-override characters, thousands of recurring series, a hostile `RRULE` and a huge file is capped (`MAX_SERIES`, `MAX_ROWS`, 5 MB) and cleaned; titles render as React text. The CalDAV XML reader refuses `DOCTYPE` and entity declarations and absurd nesting. Calendar and event addresses used with CalDAV come from the server's own discovery, not from the caller.
- **Secrets at rest.** Saved ICS links, CalDAV passwords and Google tokens are AES-256-GCM sealed, bound to their table row, with a key from `APP_SECRET` or a `0600` file; tampering or the wrong key is detected (`secrets.test.ts`). The API never returns them and logs carry messages only. A truncated key file is an error, not a silent new key.
- **Google OAuth.** Only read-only scopes, PKCE (S256) and a `state` bound to the login and a `HttpOnly` cookie. The callback rejects forged, replayed, cross-user and unsigned requests; revoking a grant is handled; disconnect revokes at Google (`google.test.ts`, against a fake Google).
- **Rate limits.** Adding calendars 10 per 10 minutes, **Sync now** 12 per 10 minutes, CalDAV discovery 10 per 10 minutes, Google callback 30 per 15 minutes per address.
- **The outbound reminder feed** does not re-export imported events (test added).

### Findings

| ID | Severity | What | Status |
| --- | --- | --- | --- |
| C1 | Low | **Google redirect address falls back to the request's `Host`** when `PUBLIC_URL` is unset. A forged Host cannot steal a code (Google only redirects to addresses registered for the client), but it can make the sign-in fail. | Documented: set `PUBLIC_URL` (the Google setup steps say so). |
| C2 | Low | **Backups contain the encrypted calendar logins but not `DATA_DIR/app-secret`.** A restore onto another machine cannot read them, and the connection says so. This is deliberate (key and data are separate), but it can surprise. | Documented in Connecting calendars, Securing and Upgrading: set `APP_SECRET` if you restore elsewhere. |
| C3 | Info | **With `ALLOW_PRIVATE_CALENDAR_URLS=true`, a signed-in person can use calendar errors ("refused", "timed out") to probe your private network.** | Off by default and documented as the cost of the flag. Rate limits and a per-person connection cap slow it down. |
| C4 | Info | **A secret iCal link is a bearer credential** to the person's calendar at Google, Apple or Microsoft. | Stored encrypted and never shown again; the guide tells people to treat it like a password. |

No way to read another person's connections or events, reach internal addresses (default configuration), run script through imported text, or read stored credentials was found.

### Not tested here

- A real Google account, real iCloud or a real CalDAV provider. Google OAuth ran against a fake Google, CalDAV and iCloud discovery against a fake CalDAV server that follows the protocol. Provider quirks are the main remaining risk.
- DNS rebinding was tested with a fake resolver (the address that is checked is the address that is connected to), not with a live rebinding service.

## Not tested

- The Docker image and `docker-compose.yml` hardening options were not run (no Docker on the test box); CI builds and starts the image.
- Behaviour against a real OIDC provider, real WebAuthn authenticators and a real xAI key (fake provider and software authenticators were used).
- Load and long-running behaviour; TLS termination (done by your reverse proxy).
- Browsers other than headless Chrome.

## Reporting

See [SECURITY.md](../SECURITY.md).

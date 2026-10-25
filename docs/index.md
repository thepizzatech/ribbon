---
title: Ribbon
hide:
  - navigation
  - toc
---

# Ribbon

**A mobile-first family gift tracker you host yourself.**

Ribbon keeps track of the gifts your household gives and receives, shows what needs you (thank-yous to write, gifts still to buy), and looks back over the year. Everything (family, people, gifts, occasions, logins) lives in one SQLite file on your own server, so every phone and laptop sees the same data and nothing goes to anyone else's cloud.

[Get started :material-arrow-right:](getting-started.md){ .md-button .md-button--primary }
[Browse the features](FEATURES.md){ .md-button }
[View on GitHub](https://github.com/thepizzatech/ribbon){ .md-button }

![The Ribbon overview in light mode](assets/screenshots/overview-desktop-light.webp#only-light)
![The Ribbon overview in dark mode](assets/screenshots/overview-desktop-dark.webp#only-dark)

!!! warning "Status: in development (`0.3.0-dev`)"

    Ribbon works and keeps your data on your own server, but there is no release yet and you should expect rough edges. It is built for one family. The Docker image to use today is the `dev` tag, built from the newest `main`. See [Upgrading](upgrading.md) for what that means in practice.

## What you get

<div class="grid cards" markdown>

-   :material-gift-outline: **A ledger of gifts**

    Log what you give and receive, who it was for, the occasion and the cost. See what still needs buying and which thank-yous are owed.

-   :material-format-list-checks: **Surprise-safe wishlists**

    Reserve an item so nobody double-buys. The person whose list it is never sees the marks, even through the API. [Wishlists](FEATURES.md#wishlists)

-   :material-calendar-heart: **Dates and a calendar feed**

    Birthdays, anniversaries and yearly occasions with a countdown, plus a secret ICS link for your calendar app. [Upcoming dates](FEATURES.md#upcoming-dates-and-recurring-occasions)

-   :material-shuffle-variant: **Secret Santa**

    Draw names across a household or linked households, with exclusions and no peeking. [Secret Santa](FEATURES.md#secret-santa)

-   :material-home-group: **Households that can share**

    Several households on one server, each with a private ledger. Link two and share just the people you choose. [Sharing](FEATURES.md#sharing-between-households)

-   :material-shield-lock-outline: **Built to be self-hosted safely**

    Passkeys and single sign-on, scrypt passwords, sign-in lockout, nightly backups, and a documented [security review](SECURITY-AUDIT.md).

</div>

## On a phone

Ribbon is designed for the phone first and installs as an app over HTTPS.

| Overview | Wishlist | Secret Santa |
| :---: | :---: | :---: |
| ![Overview on a phone](assets/screenshots/overview-mobile-light.webp#only-light){ width="240" } ![Overview on a phone](assets/screenshots/overview-mobile-dark.webp#only-dark){ width="240" } | ![A wishlist on a phone](assets/screenshots/wishlist-mobile-light.webp#only-light){ width="240" } ![A wishlist on a phone](assets/screenshots/wishlist-mobile-dark.webp#only-dark){ width="240" } | ![Secret Santa on a phone](assets/screenshots/secret-santa-mobile-light.webp#only-light){ width="240" } ![Secret Santa on a phone](assets/screenshots/secret-santa-mobile-dark.webp#only-dark){ width="240" } |

## Where to go next

| I want to... | Read |
| --- | --- |
| Install Ribbon and create my family's ledger | [Getting started](getting-started.md) |
| Look up an environment variable | [Configuration](configuration.md) |
| Reach it from outside my home safely | [Securing your install](securing.md) and [HTTPS and reverse proxies](REVERSE-PROXY.md) |
| Know what a feature does | [Features](FEATURES.md) |
| Back up or restore my data | [Backups & restore](backups.md) |
| Fix something that is not working | [Troubleshooting & FAQ](troubleshooting.md) |
| Help build Ribbon | [Contributing](contributing.md) |

## Under the hood

- TanStack Start (React, Vite, Tailwind), built to a standalone Node server (Nitro).
- One SQLite database (Node's built-in `node:sqlite`), migrated automatically on start-up.
- A small JSON API at `/api/*`; the browser keeps an instant copy of the ledger and sends each change to the server.
- A single container image for `linux/amd64` and `linux/arm64`, running as an unprivileged user.
- MIT licensed. Source: [github.com/thepizzatech/ribbon](https://github.com/thepizzatech/ribbon).

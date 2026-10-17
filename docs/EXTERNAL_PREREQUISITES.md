# What you need to install or provide

Everything marked **required** is needed to run Creator OS. Everything marked **optional** only unlocks an integration; with none of
them the app is fully usable (the Integrations page tells you exactly what each one is missing).

## On the PC that runs Creator OS (24x7)

| Item                                      | Required?         | Why / how                                                                                                                                                                                                              |
| ----------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 11 with WSL2                      | required          | Docker Desktop's engine. `wsl --install`, then reboot.                                                                                                                                                                 |
| Docker Desktop (Compose v2)               | required          | Runs Postgres, Redis, API, worker, web and Caddy. Enable **Start Docker Desktop when you sign in**. Give WSL 4 GB RAM or more.                                                                                         |
| Node.js 22 or newer and pnpm 12           | for development   | Not needed just to run the stack, only for `pnpm dev`, tests and the helper scripts (`pnpm backup`, `pnpm restart-test`, ...). `corepack enable` provides pnpm.                                                        |
| Go 1.27 or newer                          | to build agent    | Only to compile the scanner agent (`pnpm agent:build`). Prebuilt binaries land in `apps/scanner-agent/dist`.                                                                                                           |
| ffmpeg / ffprobe on PATH                  | recommended       | Used by the scanner agent for video/audio duration, codecs and thumbnails. Without it files are still indexed and hashed; probing and thumbnails are skipped (shown as such).                                          |
| Git                                       | recommended       | To track this repository.                                                                                                                                                                                              |
| Tailscale                                 | optional (HTTPS)  | HTTPS for phones and laptops away from home. `pnpm tailscale enable` publishes to your tailnet only (never the public internet). Without it, the LAN address works over HTTP.                                          |
| Windows power plan: never sleep on AC     | required for 24x7 | A sleeping PC is an offline server. Settings → System → Power → Screen and sleep → Sleep: Never (plugged in).                                                                                                          |
| Firewall rule for TCP 8080 (private only) | for LAN           | The stack listens on all interfaces. Windows may ask to allow Docker on first start: allow **Private** networks only, never Public. If phones cannot connect, add an inbound rule for TCP 8080 on the private profile. |
| Disk space                                | required          | Roughly 5 GB for images and volumes plus the database and previews (`MEDIA_PREVIEW_MAX_GB`, default 20). Your media itself is never copied.                                                                            |

Ports used: **8080** (Caddy, LAN HTTP) and optionally **8443** (Tailscale HTTPS, chosen so it never replaces an app you already
serve on 443). PostgreSQL (5432) and Redis (6379) are **not** published, except on `127.0.0.1` while the `dev` profile is running.

## On every machine that holds media you want indexed

The scanner agent (`creatoros-agent`) is one small binary. It needs read access to the folders, outbound access to the Creator OS
address, and (for streaming previews) the Creator OS server must be able to reach the agent's listen port (default 7755) over the LAN or tailnet.
Windows: `creatoros-agent install` as Administrator (runs as a service, opens the firewall for the private profile). Linux:
`creatoros-agent systemd-unit`. See [OPERATIONS.md](OPERATIONS.md#install-the-scanner-agent).

## Accounts and credentials you provide (all optional)

| Integration                        | What you need to create                                                                                                                                                                                                                                              | Status in this repository                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Gmail (read-only inbox triage)     | Google Cloud project → OAuth consent screen (External, you as a test user) → enable Gmail API → OAuth client "Web application" with redirect URI `<APP_BASE_URL>/api/v1/integrations/oauth/callback`. Put `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` in `.env`, restart. | Built and tested against a fake Gmail. **Not exercised against real Google**: needs your credentials (`BLOCKED_EXTERNAL`). |
| YouTube (import posts + analytics) | Same Google project: enable YouTube Data API v3 (and YouTube Analytics API for statistics).                                                                                                                                                                          | Built and tested against a fake YouTube. Not exercised against real Google.                                                |
| Todo app                           | The Todo PWA's API base URL and an API token. If its API differs from the defaults, set endpoint and field names in Integrations → Todo ([contract](TODO_ADAPTER_CONTRACT.md)).                                                                                      | Built against the contract and a fake server; real Todo not yet connected.                                                 |
| Postiz (scheduling)                | A running Postiz you host elsewhere, its URL and API key. Creator OS only reports `PUBLISHED_VERIFIED` when Postiz returns a release URL.                                                                                                                            | Gated: reports `NOT_CONFIGURED`; never schedules or posts by itself.                                                       |
| Instagram / Facebook (Meta)        | A Meta developer app, a business-verified account and app review for the permissions you need.                                                                                                                                                                       | Gated with an explanation. Manual publishing + pasted links work today.                                                    |
| TikTok                             | A TikTok developer app approved for the Display/Content APIs.                                                                                                                                                                                                        | Gated with an explanation. Manual publishing + pasted links work today.                                                    |
| Snapchat                           | Not available without a partner programme.                                                                                                                                                                                                                           | Gated; explained in the UI.                                                                                                |

Never paste any of these into chat, issues, or git. They go in `.env` (secrets) or in the Integrations page (stored encrypted with `ENCRYPTION_KEY`).

## Secrets to back up separately

`ENCRYPTION_KEY` is **not** inside database backups on purpose. Without it, restored integration tokens and 2FA secrets cannot be decrypted (you
would only have to reconnect integrations and re-enrol 2FA). Store a copy in your password manager.

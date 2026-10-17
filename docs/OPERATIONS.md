# Operations guide

All commands are run from the repository root in PowerShell. In an agent or automation shell where Docker's credential helper is
unavailable, run `. .\infra\scripts\docker-env.ps1` first.

## First start

```powershell
node infra/scripts/init-env.mjs        # creates .env with fresh random secrets (never overwrites an existing .env)
docker compose up -d --build           # db, redis, migrate (once), api, worker, web, caddy
docker compose ps                      # everything "healthy" / "running"
```

Open <http://localhost:8080>. The first visit leads to the setup wizard, where you create the owner account (no default password
exists), name your organisation, and optionally add your first brand, channel and account. Then:

1. **Use it on your phone:** open `http://<pc-lan-ip>:8080` (add that exact origin to `ALLOWED_ORIGINS` in `.env`, then `docker compose up -d`).
   For HTTPS see [Tailscale](#https-over-tailscale). Install it from the browser menu ("Add to Home screen").
2. **Index your media:** [install a scanner agent](#install-the-scanner-agent).
3. **Look around with samples:** _Settings → Demo data → Load demo data_ adds clearly labelled "DEMO" records; _Remove demo data_ clears only those.

Everything restarts by itself after a reboot: containers use `restart: unless-stopped` and Docker Desktop starts at sign-in (enable it in Docker Desktop
settings; turn on automatic sign-in or run the PC as a kiosk user so sign-in happens unattended).

## Daily operations

| Task                        | Command                                                        |
| --------------------------- | -------------------------------------------------------------- |
| Status                      | `docker compose ps`                                            |
| Logs of one service         | `docker compose logs -f api` (or `worker`, `web`, `caddy`)     |
| Update after pulling code   | `git pull; docker compose up -d --build`                       |
| Stop / start                | `docker compose stop` / `docker compose start`                 |
| Support bundle (no secrets) | `pnpm diagnostics` → `diagnostics/creatoros-diagnostics-*.txt` |
| System health in the UI     | _Settings → System_                                            |
| Prove restarts are safe     | `pnpm restart-test` (see below)                                |

The app's own health endpoints: `/api/v1/health/live` and `/api/v1/health/ready` (database reachable). The worker's heartbeat shows in _Settings → System_.

## Backup and restore

The worker writes a nightly backup (03:15) and runs a weekly restore test into a scratch database (Sunday 03:45), which also compares nine
relationship counts (assets in projects, publications per variant, deliverables per deal, invoices per deal, payments per invoice, ...) between the
live database and the restored copy.

```powershell
pnpm backup                              # backups/creatoros-<timestamp>.dump + .manifest.json (SHA-256) + attachments archive
pnpm restore backups/creatoros-<ts>.dump           # dry run: verifies the checksum and explains
pnpm restore backups/creatoros-<ts>.dump --yes     # DESTRUCTIVE: safety backup of the current data first, then replace
```

- Your **original media files are not in the backup** (they live on their machines). The preview cache is not included (rebuildable).
- **`ENCRYPTION_KEY` is not in the backup.** Keep a copy in your password manager, or restored Gmail/YouTube tokens and 2FA secrets will be unreadable.
- Copy `backups/` to another disk or cloud storage regularly. A backup on the same disk does not protect against disk failure.
- Test your backups: _Settings → Backups → Run restore test_ restores into a throwaway database and verifies relationships. It never touches live data.

## Restart and failure test (T31, T34)

```powershell
pnpm restart-test
```

Runs against the live stack. It records every table's row count, a Redis key and a delayed BullMQ job, restarts **all** containers, and checks that the API returns,
no table lost a row, the Redis key and the queued job survived, and the worker processes jobs again. It then restarts **only Redis** and checks that the API
stays ready and the worker reconnects. It adds nothing to your business data and removes its probes afterwards. Exit code 1 if anything fails.

## HTTPS over Tailscale

Tailscale Serve gives a trusted HTTPS address reachable only from your tailnet (it uses `serve`, never `funnel`).

```powershell
pnpm tailscale status                    # shows what you already serve; nothing is changed
pnpm tailscale enable                    # https://<machine>.<tailnet>.ts.net:8443 -> http://127.0.0.1:8080
pnpm tailscale disable
```

It uses its own HTTPS port (8443 by default, `--port=` to change) so an app you already serve on 443 is not replaced. The script prints the two `.env` lines to add
(`APP_BASE_URL` and `ALLOWED_ORIGINS`); run `docker compose up -d` afterwards. If Tailscale says HTTPS certificates are not enabled, turn them on once in the Tailscale
admin console (DNS → HTTPS Certificates). The LAN address (`http://<pc-ip>:8080`) keeps working.

## Install the scanner agent

The agent is a single Go binary that reads your media folders and reports to Creator OS. It never modifies, moves or deletes a file.

1. Build (once): `pnpm agent:build` (Windows binary in `apps/scanner-agent/dist/creatoros-agent-windows-amd64.exe`; `pnpm agent:build -- --all` adds Linux and macOS).
2. In the app: _Storage & Devices → Pair a device_ shows a one-time code (valid 30 minutes, usable once).
3. On the machine with the media (PowerShell):

```powershell
.\creatoros-agent-windows-amd64.exe pair --server http://localhost:8080 --code ABCD-EFGH --label "Studio PC"
.\creatoros-agent-windows-amd64.exe install        # as Administrator: Windows service, starts at boot, firewall for the private profile
.\creatoros-agent-windows-amd64.exe status
```

For a machine other than the server use the server's LAN or Tailscale address in `--server`. The server must be able to reach the agent's listen port (default 7755) to stream
previews; if the agent runs on the same PC as Docker, the API reaches it through `host.docker.internal` automatically (`AGENT_LOOPBACK_HOST`).
Linux: `creatoros-agent systemd-unit` prints a unit file. `creatoros-agent reset-state` clears the local scan cache (next scan re-hashes everything).

4. In the app: _Storage & Devices → Add folder_ on that device.

### Folder (scan root) recipes

| Situation                                | Suggested settings                                                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main editing drive on a 12 GB RAM PC     | `extensions: mp4, mov, mkv, wav, mp3, png, jpg`; `hashMode: candidates` (hash only files that share size + quick signature); `scanIntervalMinutes: 30`; `settleSeconds: 120`; exclude `**/Cache/**`, `**/Proxy*/**` |
| Smaller, important library on a 24 GB PC | `hashMode: all` (everything fingerprinted, exact duplicates found at once); `scanIntervalMinutes: 15`; `settleSeconds: 60`                                                                                          |
| Renders still being written              | Raise `settleSeconds` (up to 3600). Files modified more recently than that are shown as "still writing" and are not hashed until stable.                                                                            |
| NAS / SMB share seen from several PCs    | Add the share once, on the machine that is always on. Set `accessMethod: SMB` and `smbPath` (`\\NAS\Media`) so _Copy path_ gives the path every PC can open. Do not add the same share from two machines.           |
| Folder mounted on a Linux server         | `accessMethod: SERVER_MOUNT` with `mountPath` (`/mnt/media`)                                                                                                                                                        |
| Folder with symlinks / junctions         | Off by default (links are skipped so a link can never expose files outside the folder). Turn on `followLinks` only for links you trust.                                                                             |

How to read the results: a file on an **offline** device or an **unreachable** drive is shown as _temporarily unavailable_, never as missing. A file is only marked
_missing_ after a complete scan does not see it, a second complete scan confirms it, and a grace period passes.

## Troubleshooting

**The page does not load on my phone.** Use the PC's LAN address (`ipconfig`), make sure the PC and phone are on the same network, and that the address is in `ALLOWED_ORIGINS`.
Windows Firewall must allow TCP 8080 on the _private_ profile.

**"Cross-site request blocked".** The address in the browser is not in `ALLOWED_ORIGINS`. Add it to `.env`, then `docker compose up -d`.

**Sign-in works but I am sent back to the login page over HTTPS.** `APP_BASE_URL` should be the https address you use. Caddy trusts Tailscale's forwarded headers; confirm with `docker compose logs caddy`.

**A device shows Offline.** The agent has not checked in for two minutes: PC asleep, service stopped (`creatoros-agent status`), or wrong server address. Files stay in the library as
_Device offline_. They are not missing.

**Files do not play ("Device offline" or 503).** The server cannot reach the agent's listen port. Check Windows Firewall on the agent machine (private profile) and that the device
shows Online.

**No thumbnails / durations.** ffmpeg and ffprobe are not on the agent machine's PATH. Install them; the next scan fills in the gaps.

**Files seem stuck on "still writing".** They changed within `settleSeconds`. They are indexed as soon as they stay unchanged for that long.

**Todo says "not configured" on Today.** Configure it under Integrations → Todo and press Test connection ([contract](TODO_ADAPTER_CONTRACT.md)).

**Gmail/YouTube say "not configured".** Add the Google credentials to `.env` ([steps](EXTERNAL_PREREQUISITES.md)) and restart the stack.

**I forgot my password.** There is no e-mail reset (nothing here sends e-mail). Another owner can set a new one in _Settings → Team → New password_. If you are the only owner, run this on the PC that hosts the stack:

```powershell
docker compose exec -it api node apps/api/dist/cli/reset-password.js you@example.com
```

It asks for the new password (hidden), applies the same strength rules, clears any sign-in lock and signs that person out everywhere.

**Disk is filling up.** Previews are capped by `MEDIA_PREVIEW_MAX_GB` and cleaned by the nightly maintenance job. Docker logs rotate (10 MB x 5 per service). Old backups in `backups/` are yours to prune.

**Something is wrong and I do not know what.** `pnpm diagnostics` writes a text bundle with container state, health, port exposure and recent error lines, with secrets redacted.

## Security checklist

- `.env` is never committed (it is in `.gitignore`). Rotate by editing it and `docker compose up -d`; changing `ENCRYPTION_KEY` requires reconnecting integrations.
- `docker compose ps` must show no published port for `db` or `redis`. `pnpm diagnostics` checks this for you.
- Keep Docker Desktop, Windows, Tailscale and the images (`docker compose pull; docker compose up -d --build`) up to date.
- Enable two-factor authentication under _Settings → Security_.

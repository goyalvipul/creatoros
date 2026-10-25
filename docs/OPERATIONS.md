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

## Restarting after a change

Run these in the repo folder on the server (on Ubuntu, `docker` needs no extra setup; on Windows see the note at the top).

### After editing `.env`

```bash
docker compose up -d
```

Compose recreates only the containers whose settings changed. Data lives in Docker volumes and is kept.

| What you changed                                                                                                    | What to run                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `ALLOWED_ORIGINS`, `APP_BASE_URL`, `HTTP_PORT`, Google or other keys, `AGENT_LOOPBACK_HOST`, rate limits, log level | `docker compose up -d`                                                                                                            |
| `API_INTERNAL_URL` (baked into the web image at build time)                                                         | `docker compose up -d --build web`                                                                                                |
| `ENCRYPTION_KEY`                                                                                                    | `docker compose up -d`, then reconnect integrations and re-enrol two-factor (old encrypted secrets cannot be read with a new key) |
| `POSTGRES_PASSWORD`                                                                                                 | Do not change it after first start: the database keeps the old password and the API would fail to connect                         |

If a change does not seem to take effect: `docker compose up -d --force-recreate`.

### After changing the application code

```bash
git pull                          # or copy the new files across
docker compose up -d --build
```

This rebuilds the api, worker, web and migrate images. Database migrations run by themselves (the `migrate` container) before the API starts, and your data is untouched. The first build is slow; later ones reuse cached layers. To rebuild one service only: `docker compose up -d --build web`.

### Plain restarts (nothing changed)

```bash
docker compose restart               # everything
docker compose restart api worker    # just those two
docker compose stop && docker compose start
```

`restart` does **not** reread `.env` or pick up new code. Use `up -d` for that.

### Check that it came back

```bash
docker compose ps                                     # all healthy / running
curl -s http://localhost:8080/api/v1/health/ready     # {"data":{"status":"ready"} ...
docker compose logs --tail 50 api worker              # look for errors
```

Notes:

- Restarting is safe: containers also restart by themselves after a reboot, and data and queued jobs survive (`pnpm restart-test` proves it).
- You are offline for a few seconds to a minute. Scanner agents keep their own queue and catch up when the API returns, so nothing is lost.
- A scanner agent is a separate program on each media machine and is **not** restarted with the server: `sudo systemctl restart creatoros-agent` on Linux, or `creatoros-agent stop` then `start` on Windows (see [Install the scanner agent](#install-the-scanner-agent)).
- After changing code, run `pnpm check` and the tests on your development machine before deploying: the server only runs the built result.

## Backup and restore

The worker writes one backup a day at 03:15 America/Vancouver and runs a weekly restore test into a scratch database (Sunday 03:45 Pacific), which also compares nine
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
- A second automatic backup is skipped if one already succeeded in the last 20 hours. **Back up now** is not skipped.
- Scheduled files are inside the Docker volume at `/data/backups` (the Location column in Settings). Copy one out before `pnpm restore`:

  ```bash
  docker compose cp worker:/data/backups/creatoros-<timestamp>.dump ./backups/
  docker compose cp worker:/data/backups/creatoros-<timestamp>.dump.manifest.json ./backups/
  pnpm restore ./backups/creatoros-<timestamp>.dump          # checks the file, changes nothing
  pnpm restore ./backups/creatoros-<timestamp>.dump --yes    # replaces the live database; takes a safety copy first
  ```

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

The agent is one small Go binary that reads your media folders and reports to Creator OS. It never modifies, moves or deletes a file. Install one on **every machine that holds media** (Windows PCs, Ubuntu/Linux machines, and the server itself if it holds media). It does not matter which machine hosts Creator OS.

### Before you start (all machines)

1. **Server address.** Use an address the media machine can reach. Examples used below: LAN `http://192.168.1.151:8080`, Tailscale `http://100.108.120.8:8080`. If the agent runs on the same machine as the server, `http://localhost:8080` works. Replace them with yours.
2. **Pairing code.** In the app: _Storage & Devices → Pair a device_ shows a one-time code (valid 30 minutes, usable once). Make a new code for each machine.
3. **The binary.** Build it where Go is installed (the Windows PC has it), then copy the right file to each machine:

   ```powershell
   pnpm agent:build -- --all      # run in the repo root; files land in apps\scanner-agent\dist\
   ```

   | Machine                    | File                                |
   | -------------------------- | ----------------------------------- |
   | Windows                    | `creatoros-agent-windows-amd64.exe` |
   | Ubuntu / Linux (Intel/AMD) | `creatoros-agent-linux-amd64`       |
   | Linux on ARM (Pi etc.)     | `creatoros-agent-linux-arm64`       |
   | Mac (Apple silicon)        | `creatoros-agent-darwin-arm64`      |

   Copy to Ubuntu with, for example: `scp apps\scanner-agent\dist\creatoros-agent-linux-amd64 you@192.168.1.151:~/`. (Ubuntu's own `apt` Go is too old for this project, so it is easier to build on Windows than on the server.)

4. **ffmpeg (recommended).** Without it files are still indexed and hashed, but durations, codecs and thumbnails are skipped. Windows: install ffmpeg and add it to PATH. Ubuntu: `sudo apt install -y ffmpeg`.
5. **Network.** The server must be able to reach the agent on **TCP 7755** (to stream previews). The Windows install command opens that rule itself (local subnet and Tailscale only). On Ubuntu you open it yourself (see below).

### If you are installing on Windows

Run in PowerShell, in the folder holding the `.exe`:

```powershell
# 1. Pair (normal PowerShell, no Administrator needed)
.\creatoros-agent-windows-amd64.exe pair --server http://192.168.1.151:8080 --code ABCD-EFGH --label "GPU-24GB"

# 2. Try it in the foreground first (Ctrl+C stops it)
.\creatoros-agent-windows-amd64.exe run

# 3. Install as a service that starts at boot (PowerShell as Administrator)
.\creatoros-agent-windows-amd64.exe install
.\creatoros-agent-windows-amd64.exe status
```

Notes:

- Data and credentials live in `C:\ProgramData\CreatorOS\agent` (logs in `agent.log` there). Keep the `.exe` somewhere permanent (for example `C:\CreatorOS\`) before running `install`, because the service points at that path.
- A service runs as LocalSystem by default, which usually **cannot see network shares or mapped drives**. For SMB/NAS folders install it under an account that can open them: `install --account ".\youruser" --password "..."` (the password goes to Windows' service manager, not to Creator OS).
- The label is what you see in the app (for example `GPU-12GB`, `GPU-24GB`). Pairing the same machine again keeps its identity, so its files and folders carry over.

### If you are installing on Ubuntu / Linux

Run in a terminal on that machine:

```bash
# 1. Put the binary in a permanent place and make it executable
sudo install -m 0755 ~/creatoros-agent-linux-amd64 /usr/local/bin/creatoros-agent

# 2. Pair as your normal user (not root). Credentials go to ~/.config/creatoros-agent
creatoros-agent pair --server http://192.168.1.151:8080 --code ABCD-EFGH --label "ubuntu-nas"

# 3. Try it in the foreground first (Ctrl+C stops it)
creatoros-agent run

# 4. Run it at boot as a systemd service under your user
creatoros-agent systemd-unit | sed "s/^\[Service\]/[Service]\nUser=$USER/" | sudo tee /etc/systemd/system/creatoros-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now creatoros-agent
systemctl status creatoros-agent --no-pager

# 5. Let the server reach the agent (only if ufw is on)
sudo ufw allow from 192.168.1.0/24 to any port 7755 proto tcp     # your LAN range
sudo ufw allow in on tailscale0 to any port 7755 proto tcp         # if you use Tailscale
```

Notes:

- `creatoros-agent status`, `install`, `start` and `stop` are Windows-only; on Linux use `systemctl`.
- The user in step 4 needs read access to the media folders. The unit sets `ProtectSystem=strict`, so the agent can only write its own data folder.
- Logs: `journalctl -u creatoros-agent -f`, or `~/.config/creatoros-agent/agent.log`.
- If the agent runs on the **same Ubuntu machine as the Docker server**, the API container reaches it through the Docker host. Set `AGENT_LOOPBACK_HOST=172.17.0.1` in `.env` (Linux has no `host.docker.internal` by default) and run `docker compose up -d`.
- The Linux/systemd steps have not been run end to end on a real Ubuntu machine yet. If a step differs on your machine, check `journalctl` first.

### Connecting more machines (Windows, Ubuntu, other Linux)

Repeat the same recipe for each machine, with a **new pairing code each time** and a clear `--label`. You can mix any number of Windows and Linux machines. Then, in the app: _Storage & Devices → Add folder_ on each device, and press _Scan now_. A machine that is off shows as **Offline**; its files stay in the library as "temporarily unavailable", never as missing.

If the server's address changes (for example you move it to another machine), pair again with the new `--server`; run `uninstall` or stop the service first.

### Stopping and removing an agent

**Windows (PowerShell as Administrator for the service commands):**

```powershell
.\creatoros-agent-windows-amd64.exe stop         # stop the service
.\creatoros-agent-windows-amd64.exe start        # start it again
.\creatoros-agent-windows-amd64.exe uninstall    # remove the service (files and credentials stay)

# A foreground run: press Ctrl+C in its window. If you cannot find the window:
Get-Process | Where-Object Name -like "creatoros-agent*" | Stop-Process
# (or: taskkill /IM creatoros-agent-windows-amd64.exe /F)

# See what holds port 7755
Get-NetTCPConnection -LocalPort 7755 | Select-Object State, OwningProcess
```

**Ubuntu / Linux:**

```bash
sudo systemctl stop creatoros-agent                      # stop the service
sudo systemctl restart creatoros-agent                   # restart it
sudo systemctl disable --now creatoros-agent             # stop it and do not start at boot
sudo rm /etc/systemd/system/creatoros-agent.service && sudo systemctl daemon-reload   # remove the service

# A foreground run: Ctrl+C in its terminal. If you cannot find it:
pkill -f "creatoros-agent run"
# See what holds port 7755
sudo ss -ltnp | grep 7755
```

Stopping an agent is safe. It only means that machine goes **Offline** in the app after about three minutes; nothing is deleted from the library. To forget a machine completely, revoke it in _Storage & Devices_ (non-destructive: your files are untouched), then delete `C:\ProgramData\CreatorOS\agent` (Windows) or `~/.config/creatoros-agent` (Linux) on that machine. `creatoros-agent reset-state` (with the service stopped) only clears the local scan cache, so the next scan re-hashes everything.

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

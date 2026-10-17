# Moving Creator OS to an Ubuntu machine

Why: the stack is light (about 225 MB of RAM across all containers), but on Windows it runs inside the WSL2 virtual machine, which holds memory your ComfyUI workflows need. On Ubuntu, Docker runs natively and the Windows PCs keep their RAM for generation.

Status: the stack has been built, tested and run on Windows only. Nothing in it is Windows-specific (Linux images, Postgres, Redis, Caddy), so a straightforward move is expected, but it has not been run on Ubuntu yet. Follow [Verify](#5-verify) and report anything that differs.

## Prerequisites

On the **Ubuntu machine** (the new server):

| Need                                                     | Notes                                                                                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ubuntu 22.04 or newer, 64-bit, always on                 | Disable suspend: `sudo systemctl mask sleep.target suspend.target hibernate.target`.                                                                                                    |
| Docker Engine with the Compose v2 plugin                 | You already have Docker. Check `docker compose version` works (note the space) and that your user can run `docker` without sudo (`sudo usermod -aG docker $USER`, then log out and in). |
| Git                                                      | `sudo apt install git`.                                                                                                                                                                 |
| Node.js 22 or newer and pnpm 12                          | Only for the helper scripts (`pnpm backup`, `pnpm restore`, `pnpm diagnostics`, `pnpm tailscale`). Install Node 22 (nodesource or nvm), then `corepack enable`.                         |
| About 5 GB free disk, plus room for backups and previews | Previews are capped by `MEDIA_PREVIEW_MAX_GB` (default 20). Your media is not copied here.                                                                                              |
| 2 GB RAM free for Creator OS                             | More than enough.                                                                                                                                                                       |
| Tailscale (optional)                                     | Only if you want HTTPS: `curl -fsSL https://tailscale.com/install.sh \| sh`, then `sudo tailscale up`. Enable HTTPS certificates once in the Tailscale admin console (DNS).             |
| Firewall rule (if `ufw` is on)                           | `sudo ufw allow from 192.168.0.0/16 to any port 8080 proto tcp` (adjust to your LAN range). Do not open it to the internet.                                                             |

On the **Windows PCs** that hold media:

- They must be able to reach the Ubuntu server's port 8080 (to report) and the Ubuntu server must be able to reach each PC's agent port **7755** (to stream previews). Allow TCP 7755 in Windows Firewall on the **Private** profile.
- Give the Ubuntu machine a fixed LAN address (a DHCP reservation on your router) so agents and phones keep finding it. Its Tailscale name also works.

From the **old Windows install** (only if you want to keep your data):

- The latest backup files from `backups\` (made with `pnpm backup`).
- Your `.env` file, or at minimum the values of `ENCRYPTION_KEY`, `AGENT_PAIRING_SECRET`, `WORKFLOW_WEBHOOK_SECRET` and `POSTGRES_PASSWORD`. Without `ENCRYPTION_KEY`, restored Gmail/YouTube tokens and two-factor secrets cannot be read (you would reconnect and re-enrol them).

## 1. Make a final backup on Windows

Stop changing data first (or accept that later edits are lost), then in the repo folder:

```powershell
pnpm backup
```

This writes `backups\creatoros-<timestamp>.dump`, a `.manifest.json` next to it, and an attachments archive. Copy **all of the files with that timestamp** to the Ubuntu machine (USB, `scp`, or a shared folder). Also copy `.env` through a private channel. It holds secrets: never email it or commit it.

## 2. Get the code onto Ubuntu

```bash
git clone <your repository url> ~/creatoros     # or copy the folder without node_modules
cd ~/creatoros
corepack enable
pnpm install
```

Put the copied backup files in `~/creatoros/backups/` (create the folder if needed).

## 3. Configure

**Keep your data:** copy your old `.env` to `~/creatoros/.env`, then edit these lines:

```
APP_BASE_URL=http://<ubuntu-lan-ip>:8080
ALLOWED_ORIGINS=http://<ubuntu-lan-ip>:8080
```

If you will use Tailscale HTTPS, use that https address instead (see step 6). `ALLOWED_ORIGINS` may list several addresses separated by commas. Leave `DATA_DIR=./.data` as it is.

**Fresh start instead:** run `node infra/scripts/init-env.mjs`, then set the same two lines.

`AGENT_LOOPBACK_HOST=host.docker.internal` only matters for an agent running on the same machine as Docker. Linux does not resolve that name by default; you do not need it unless you install an agent on the Ubuntu box itself (then use `AGENT_LOOPBACK_HOST=172.17.0.1`, the Docker bridge address).

## 4. Start and restore

```bash
docker compose up -d --build
docker compose ps                       # wait until everything is healthy
```

Only if you are bringing data across:

```bash
pnpm restore backups/creatoros-<timestamp>.dump           # dry run: checks the checksum, changes nothing
pnpm restore backups/creatoros-<timestamp>.dump --yes     # replaces the empty database (takes a safety backup first)
docker compose restart api worker
```

Without a restore, the first visit to `http://<ubuntu-lan-ip>:8080` opens the setup wizard to create the owner account.

## 5. Verify

```bash
curl -s http://localhost:8080/api/v1/health/ready      # {"data":{"status":"ready"} ...
pnpm diagnostics                                       # db and redis must say "not published to the network"
pnpm restart-test                                      # optional: proves data and jobs survive a full restart
```

In the browser: sign in with your existing owner account (after a restore), open _Settings → System_ (worker alive), _Settings → Backups_ and press **Run restore test**.

Containers restart by themselves after a reboot (`restart: unless-stopped`) as long as the Docker service starts at boot, which it does by default: `sudo systemctl enable docker`.

## 6. HTTPS over Tailscale (optional)

```bash
pnpm tailscale status          # shows what you already serve; changes nothing
pnpm tailscale enable          # https://<machine>.<tailnet>.ts.net:8443 -> http://127.0.0.1:8080
```

Put the two lines it prints into `.env` and run `docker compose up -d`. The script may need `sudo` if `tailscale` was set up without operator rights (`sudo tailscale set --operator=$USER` once avoids that).

## 7. Re-point the scanner agents

Full install, update and stop/kill commands for Windows and Ubuntu agents are in [OPERATIONS.md](OPERATIONS.md#install-the-scanner-agent). The short version for an already-installed Windows agent follows.

Each agent was paired with the old server. Pick one:

- **Keep the restored data and device records:** on each Windows PC, stop the agent service (`creatoros-agent-windows-amd64.exe uninstall`, as Administrator), then pair again with a new code and the new address:
  1. In the new app: _Storage & Devices → Pair a device_.
  2. On the PC: `.\creatoros-agent-windows-amd64.exe pair --server http://<ubuntu-lan-ip>:8080 --code ABCD-EFGH --label "<same label>"`
  3. `.\creatoros-agent-windows-amd64.exe install` (Administrator).
- Because device identity is the agent's own id, a restored database recognises the same machine and keeps its folders and files. If the app lists it as a new device instead, remove the old one in _Storage & Devices_ after the new one finishes its first scan.
- The first scan after re-pairing reports everything again; exact copies and history are recognised by file identity and hash, so counts do not inflate.

## 8. Shut down the Windows copy

Once the Ubuntu install works and the agents report in:

```powershell
docker compose down          # stops it; data volumes are kept
```

Keep the Windows backup files until you have made and restored at least one backup on Ubuntu. Use `docker compose down -v` only if you are sure you want to delete the Windows database.

## Day-to-day on Ubuntu

Same commands as [OPERATIONS.md](OPERATIONS.md), run in the repo folder: `docker compose ps`, `docker compose logs -f api`, `git pull && docker compose up -d --build`, `pnpm backup`. Copy `backups/` to another disk regularly: a backup on the same disk does not protect against disk failure, and the nightly backups only exist where the worker writes them.

## Troubleshooting

- **`permission denied` talking to Docker:** your user is not in the `docker` group (see prerequisites).
- **Phone or PC cannot open the page:** check the address in `ALLOWED_ORIGINS`, `sudo ufw status`, and that both are on the same network.
- **Devices show Offline after the move:** the agent still points at the old address. Re-pair (step 7).
- **Files will not play (503):** the Ubuntu server cannot reach the PC on port 7755. Test from Ubuntu: `curl -m 3 http://<pc-ip>:7755/v1/health`.
- **Restore fails on checksum:** the `.dump` and `.manifest.json` must be copied together and unmodified.

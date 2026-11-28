# Hermes Agent starter for Kemokem

Hermes is an **optional, isolated** agent runtime for experimenting with researching and planning media production. It is not wired to Kemokem's production API, Docker network, GPUs, or live publishing. The existing Kemokem stack and `kemokem.com` Cloudflare Tunnel are unchanged.

Official references:
- https://hermes-agent.nousresearch.com/docs/user-guide/docker
- https://hermes-agent.nousresearch.com/docs/getting-started/quickstart
- https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard

## Prerequisites and isolation

- Run on Ubuntu `guardobox` as your normal login user, using SSH (not as root).
- Docker/Compose are already installed for Kemokem.
- Allow up to 3 GB RAM and two CPU cores; no GPU is passed through to this service.
- `~/.hermes` stores model credentials, skills, conversations, and memory. It is private application data; **never commit or share it**.
- The dashboard is published **only on Ubuntu loopback** (`127.0.0.1:9119`), not to LAN, public DNS, Cloudflare Tunnel, or Tailscale Funnel.
- Do not bind the Docker socket or Kemokem repository/secrets into the Hermes container.
- The official Docker image `latest` is used for initial compatibility; pin a tested digest before production use.

## Step 1 — Merge/pull this PR, then prepare local data

```sh
cd ~/workspace/creatoros
git pull origin main

umask 077
mkdir -p ~/.hermes
chmod 700 ~/.hermes
export HERMES_UID="$(id -u)" HERMES_GID="$(id -g)"
docker pull nousresearch/hermes-agent:latest
```

Do not run `docker compose up` on Kemokem's root Compose file just to start Hermes. Hermes has a **separate** Compose project in `infra/hermes/compose.yml`.

## Step 2 — Choose a cloud model and configure Hermes interactively

Run the official setup wizard with persistent storage and matching host UID/GID:

```sh
docker run --rm -it \
  -e HERMES_UID="$(id -u)" -e HERMES_GID="$(id -g)" \
  -v "$HOME/.hermes:/opt/data" \
  nousresearch/hermes-agent:latest setup
```

Follow the provider prompts. **For the cheapest initial test**, the current Hermes model selector supports *ChatGPT or Codex Subscription* device-code login, which can use an eligible existing subscription but is subject to plan limits; it is not a guarantee of unlimited automated usage. Alternatively, choose *Google AI Studio* or *OpenRouter* using a separately billed API key for measurable per-video production costs. Do not use a local inference endpoint; we are reserving the GPUs for video generation.

If setup does not ask you to pick a model, run the picker:

```sh
docker run --rm -it \
  -e HERMES_UID="$(id -u)" -e HERMES_GID="$(id -g)" \
  -v "$HOME/.hermes:/opt/data" \
  nousresearch/hermes-agent:latest model
```

Never paste model provider keys or subscription authentication codes in a GitHub issue or chat.

## Step 3 — Configure dashboard credentials BEFORE starting the service

The dashboard is a privileged management UI: it can read agent configuration and invoke tools. Give it a strong, unique password, using Hermes' interactive command which stores a hash:

```sh
docker run --rm -it \
  -e HERMES_UID="$(id -u)" -e HERMES_GID="$(id -g)" \
  -v "$HOME/.hermes:/opt/data" \
  nousresearch/hermes-agent:latest dashboard password --username admin
```

Check the command's feedback. You should be prompted for a password, and Hermes should store the hash and a stable signing secret under the mounted data directory. **Do not start the dashboard** if password setup fails.

## Step 4 — Validate and start only Hermes

```sh
cd ~/workspace/creatoros
export HERMES_UID="$(id -u)" HERMES_GID="$(id -g)"

docker compose -f infra/hermes/compose.yml config --quiet
docker compose -f infra/hermes/compose.yml up -d
docker compose -f infra/hermes/compose.yml ps
docker compose -f infra/hermes/compose.yml logs --tail=80 hermes
```

Validate on the Ubuntu host:

```sh
curl -fsS http://127.0.0.1:9119/api/status
docker inspect kemokem-hermes --format '{{json .NetworkSettings.Networks}}'
```

The dashboard should require authentication and report the `basic` provider; check for `"auth_required": true`. If it does not, **stop the service** with `docker compose -f infra/hermes/compose.yml down` and correct the credentials before continuing.

## Step 5 — Open dashboard from your Mac via SSH port forwarding

From a **separate terminal on your Mac** (replace SSH host with the Ubuntu hostname / Tailscale address you actually use):

```sh
ssh -N -L 9119:127.0.0.1:9119 vipul@guardobox
```

Open **http://127.0.0.1:9119** on your Mac, and sign in with the username and password from Step 3. Keep the SSH command open while using the dashboard. Do not add a publicly routable subdomain yet.

Or use an interactive CLI directly on guardobox:

```sh
docker exec -it kemokem-hermes hermes
```

## Step 6 — Run the first harmless agent test

Ask in the Hermes chat:

> Research three viable faceless YouTube Shorts topics. Return one low-cost video idea, a 30-second script, required visual assets, and an estimated media-generation budget. Do not call Kemokem, create projects, submit any H3 jobs, or publish anything.

Success criteria: the model responds, the session is saved, and the agent performs only explicitly permitted research/planning. Track provider usage before building scheduled tasks.

## What is deliberately NOT included

- No MCP credentials or Kemokem AI Gateway connection.
- No write access to projects, media, API, or publishing.
- No cron-driven content creation until budgets, duplicate suppression, quality checks, and a dry-run path are tested.
- No public dashboard and no SSH/Docker host control.

After the isolated test, separately add read-only / approval-gated Kemokem integration and verify a complete *READY*, not *PUBLISHED*, media workflow.

## Shutdown / rollback

```sh
docker compose -f infra/hermes/compose.yml down
```

This stops/removes only the Hermes service and its Compose-managed network. It does not remove `~/.hermes` or change Kemokem.

Recheck resource use with `docker stats kemokem-hermes`. This separate service can be upgraded or removed independently of the main production stack.

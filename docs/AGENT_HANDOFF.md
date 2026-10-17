# Creator OS - agent handoff (read this first)

One-file briefing for a new AI agent (or a new human) picking up this repository, especially on the Ubuntu host.
It summarises what exists, where it lives, how it is deployed, what is verified, what is not, and the traps seen.
Deeper detail: `AGENTS.md` (rules), `docs/PRODUCT_SPEC.md` (intent), `docs/ARCHITECTURE.md` (structure),
`docs/DECISIONS.md` (why), `docs/IMPLEMENTATION_PROGRESS.md` (ledger), `docs/OPERATIONS.md` (run/backup/restart),
`docs/EXTERNAL_PREREQUISITES.md` (owner steps), `docs/TEST_MATRIX.md` (T01-T35 mapping), `FEATURES.md` (capability matrix).

## 1. What the product is

Creator OS is a private, self-hosted operating system for one owner who runs a virtual singer brand ("Mehak") and future
brands. It answers: what have I created, on which machine, where is each version posted, what messages/payments need a
reply, and what should I do next. It must work with zero third-party credentials. Single owner today; the data model is
org-scoped and role-ready (VIEWER < EDITOR < OWNER).

Modules: multi-machine file inventory (scanner agents), logical assets/versions/duplicates, ideas and production
projects (scenes, checklists, generation jobs), publishing matrix and calendar, CRM (inquiries, deals, deliverables,
invoices, payments), internal action queue plus Todo integration, notifications, analytics/goals, integrations
(Google/YouTube/Gmail, Postiz, Todo), backups, audit log, PWA.

## 2. Non-negotiable rules (also in AGENTS.md)

1. Never modify, move or delete the owner's original media. The agent is read-only.
2. Nothing is sent, posted or paid without owner confirmation.
3. No fake data. Unconfigured integrations say `NOT_CONFIGURED` / `BLOCKED_EXTERNAL` with the next step. Demo data is labelled DEMO.
4. Postgres/Redis never published beyond loopback. No default password. Secrets only in `.env`.
5. Counts come from their own tables, never from multiplying joins.
6. "Missing" only after complete scans plus grace. Offline is not missing.
7. Report honestly what was run and what was not.

## 3. Repository map

```
apps/api            Fastify REST /api/v1, auth, CSRF, idempotency, agent ingest + stream, OpenAPI
apps/worker         BullMQ consumers, scheduler, sync jobs, backups, restore test
apps/web            Next.js 16 PWA (standalone build). Pages in src/app/(app)/*
apps/scanner-agent  Go read-only scanner (Windows service / Linux systemd)
packages/domain     Pure rules, enums, Zod, priority/count logic
packages/db         Drizzle schema (77 tables), SQL migrations (0000 + custom 0001 extras)
packages/services   ALL business logic (API, worker and tests call it)
packages/connectors Google/YouTube/Gmail, Postiz, Todo adapters, behind typed interfaces
packages/ui         shared components
packages/config     shared lint/TS config
infra/docker        Dockerfiles, Caddyfile
infra/scripts       dev, build-agent, backup, restore, diagnostics, restart-test, tailscale-serve, init-env, go
tests/integration   Vitest against real Postgres in Docker (T01-T35 etc.)
tests/e2e           Playwright, desktop + 360px
docs/               documentation   openapi/ generated spec   .cursor/rules/ master spec rule
```

Where things go: business logic in `packages/services`; routes in `apps/api/src/routes/*` using `makeRouter`
(`apps/api/src/http.ts`; viewer-private GET paths are listed there); responses are `{data, meta, error}`; jobs in
`apps/worker/src/jobs.ts` and `main.ts`; UI in `apps/web/src/app/(app)/*`. Every new route/behaviour needs an
integration test (`tests/integration/test`) and, for UI, an e2e spec (`tests/e2e/specs`).

## 4. Stack and runtime

- pnpm 12 workspaces, TypeScript 5.9 ESM strict, Node >= 22. Postgres 17, Redis 7, Caddy 2, Go 1.27 for the agent, ffmpeg/ffprobe.
- Compose services: `db`, `redis`, `migrate`, `api`, `worker`, `web`, `caddy` (published on host port 8080). Memory limits:
  api 768m, worker 768m, web 512m, db 1g, redis 384m, caddy 128m. Profile `dev` adds loopback-only db-proxy/redis-proxy.
- Next bakes `rewrites()` at build time, so `API_INTERNAL_URL` must be set when building the web image.
- `AGENT_LOOPBACK_HOST` rewrites 127.0.0.1/localhost agent URLs so the API container can reach an agent on the Docker host
  (default `host.docker.internal`; on Linux use the Docker bridge address, usually `172.17.0.1`).
- Auth: session cookie, Argon2id, CSRF, login throttling, optional TOTP. No public sign-up: the first-run wizard creates the
  owner; further users are created by the owner under Settings.

## 5. Commands

```bash
pnpm install --frozen-lockfile
pnpm check               # format, lint, typecheck, unit
pnpm test:integration    # real Postgres in Docker (starts its own container)
pnpm test:agent          # Go tests
pnpm test:e2e            # Playwright (its pretest builds web against the test API)
pnpm build
docker compose up -d --build
docker compose ps
pnpm backup | pnpm restore | pnpm diagnostics | pnpm restart-test
pnpm tailscale enable    # Tailscale Serve https :8443 -> Caddy :8080
pnpm agent:build -- --all   # cross-compile scanner agent
```

Restart rules (full text in `docs/OPERATIONS.md`): after editing `.env` run `docker compose up -d` (recreates changed
containers); after code changes run `docker compose up -d --build`. `docker compose restart` does NOT re-read `.env`.

## 6. Scanner agent essentials

- Commands: `pair | run | install | uninstall | start | stop | status | reset-state | systemd-unit`. Service commands are
  Windows-only; Linux uses a systemd unit (`systemd-unit` prints it).
- Default dirs: `C:\ProgramData\CreatorOS\agent`, `~/.config/creatoros-agent`, or `/var/lib/creatoros-agent` (root).
- Listens on 7755. Device identity = UUID in `agent.json`, not hostname or IP.
- Pairing: one-time expiring code from the UI. Requests signed: `Authorization: Bearer`, `x-agent-timestamp`,
  `x-agent-signature = HMAC-SHA256(key, ts + "." + sha256hex(body))`.
- Stream contract (API -> agent): `GET {listenUrl}/v1/stream?root=&path=&exp=&sig=` with Range; the agent re-checks the path is inside the root.
- Ingest contract: a COMPLETE scan must report every present file; unreported files become missing candidates (2 complete
  scans + grace before CONFIRMED_MISSING). An empty "complete" scan of a populated root is treated as UNREACHABLE.
- Never kill-and-forget: stop via `creatoros-agent stop` / `systemctl stop`; see OPERATIONS.md for process killing.

## 7. Deployment facts (current)

- Dev machine: Windows 11, `D:\creatoros`, PowerShell. Source of truth in git on branch `main`.
- Remote: https://github.com/goyalvipul/creatoros.git. The Windows PC could not push (no stored credentials); the owner pushes
  manually with `git push -u origin main`. Check `git log origin/main..main` before assuming the Ubuntu copy is current.
- Production host: Ubuntu machine "guardobox" (LAN 192.168.1.151, Tailscale 100.108.120.8, 2 cores, 3.8 GB RAM, no GPU),
  checkout at `~/workspace/creatoros`, app on port 8080 via Caddy. The stack used about 330 MB RAM there.
  (The other Ubuntu box, "intelnuc", runs Nextcloud AIO on 8080 and was rejected.)
- GPU Windows PCs with data and scanner agents: 12 GB at 100.113.189.17, 24 GB at 100.85.189.23 (Tailscale IPs).
- Tailscale HTTPS: on Ubuntu `sudo tailscale set --operator=$USER` once, then `pnpm tailscale enable` gives
  `https://<machine>.<tailnet>.ts.net:8443`. HTTPS Certificates must be enabled in the Tailscale admin console (DNS).
- Google OAuth redirect URI must be `<APP_BASE_URL>/api/v1/integrations/oauth/callback`, exactly the same in `.env`
  (`GOOGLE_REDIRECT_URI`) and in Google Cloud. Google rejects raw IPs and plain-http (except localhost), so use the
  `.ts.net` https name, your own domain, or `http://localhost:8080` with an SSH tunnel for a one-time connect.
  When using https also set `APP_BASE_URL` and `ALLOWED_ORIGINS` to that same origin.
- Secrets live only in `.env` (never commit; `.env.example` documents each key). Key variables: `APP_BASE_URL`,
  `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `AGENT_PAIRING_SECRET`,
  `MEDIA_PREVIEW_CACHE_DIR`, `MEDIA_PREVIEW_MAX_GB`, `GOOGLE_*`, `TODO_*`, `POSTIZ_*`. Losing
  `CREDENTIAL_ENCRYPTION_KEY` makes stored OAuth tokens unreadable. Back it up separately from DB backups.
- Accounts: the test owner `owner@creator.test` was created by the previous agent during testing and its password was
  reset to a temporary one. The owner should create a real owner and change/retire that account.

## 8. Behaviours worth knowing

- Notifications: quiet hours (default 22:00-07:00, America/Vancouver) hold non-critical notices via `snoozed_until`;
  CRITICAL ones bypass. Tests must read the `notifications` table, not the visible list.
- Todo adapter policy `TODO_OWNS_DUE_AND_COMPLETION`; stable idempotency keys; pending sync shown as pending, never "synced".
- Soft-delete: partial unique indexes on `deleted_at is null`, so names/handles can be reused after archive.
- Delete UX: brands/channels/social accounts are archived (OWNER only; brand archive cascades transactionally).
  `deleteRoot` only works on RETIRED roots, refuses with 409 while files are linked to assets, and never touches files on disk.
- Counts: distinct physical instances vs exact media objects vs logical assets vs publications are separate numbers on purpose.
- Backups: `pnpm backup` writes a checksummed pg_dump plus manifest into `backups/`; on-demand restore test exists
  (RESTORED_TEST, failure creates a CRITICAL `backup.restore_test.failed` notification). Originals are not backed up.

## 9. Verified vs not verified

Verified on the Windows dev PC (2026-10-18): frozen install, build, format/lint/typecheck, 60 unit, 80 integration,
Go vet+test, compose rebuild healthy, backup + restore dry run, restart-test 10/10, Playwright 33/33 (desktop + 360px).
Later commits added edit/delete of brands/channels/accounts and removal of retired folders (service + API tested; the
Remove-folder button has no browser test).

Not verified / known gaps:
- Linux systemd agent steps and the Ubuntu install have not been fully tested by an agent; the owner ran the stack there.
- The newest code (edit/delete, restart docs) reaches Ubuntu only after pull/copy and `docker compose up -d --build`.
- Agent memory use not measured.
- Real Google, Gmail, YouTube, Postiz, Meta, TikTok connections are BLOCKED_EXTERNAL until the owner supplies credentials
  or approvals (`docs/EXTERNAL_PREREQUISITES.md`). Mocked tests do not prove live integrations.
- No live Windows service install test beyond what is in the ledger; Tailscale HTTPS needs the one-time admin setup above.

## 10. Environment traps

Windows/PowerShell (dev PC):
- Agent shells need `. .\infra\scripts\docker-env.ps1` before docker; dot-sourcing can change cwd, so `cd` afterwards.
- Unset `TEST_DATABASE_URL` before integration tests so the harness starts its own container.
- `Set-Content -Encoding UTF8` writes a BOM; use editor tools or `[IO.File]::WriteAllText(path, text, (New-Object Text.UTF8Encoding $false))`.
- `cd` into `(app)` / `[id]` folders fails; use `-LiteralPath` or file tools.
- Docker Desktop must be running for integration tests; if not, vitest reports "No test files found / Collect Error undefined".
- Run browser tests only with `pnpm test:e2e` (bare `playwright` uses a bundle built for another API address).
- Do not chain `git commit` with other commands; auto-review sometimes blocks git/docker commands.

Ubuntu (production host): Docker is installed; 2 cores and 3.8 GB RAM, so avoid running the full test suites there
(integration and e2e build images and use a lot of RAM). Develop and test on the Windows PC or a bigger machine, deploy by pull
+ `docker compose up -d --build`. Use `docker compose logs -f api` for diagnosis and `pnpm diagnostics` for a bundle.

## 11. Working agreement with the owner

- Owner is technically capable but wants short, direct answers and concrete commands. Explain-only requests (`/explain`)
  mean no file changes.
- Commit when work is done (simple `git commit`, do not chain). The owner runs `git push`.
- Update `docs/IMPLEMENTATION_PROGRESS.md` and `FEATURES.md` when something changes; do not claim completion without test evidence.

## 12. Suggested first steps for a new agent

1. `git status` and `git log --oneline -10`; compare with `origin/main`.
2. `docker compose ps` and `curl -s localhost:8080/api/v1/health/ready` on the host.
3. Read `AGENTS.md`, then `docs/IMPLEMENTATION_PROGRESS.md`; ask the owner for the task.
4. For any change: implement in `packages/services` first, add the route, add tests, then UI; run `pnpm check` and the relevant test set.

# Creator OS

A private, self-hosted workspace for a creator: media library across your PCs, production, publishing records, collaborations and invoices, and a daily action queue. It runs on one always-on Windows PC with Docker Desktop and is used from a browser or phone (installable PWA).

- What works and what does not: [FEATURES.md](FEATURES.md)
- What to install and what accounts to provide: [docs/EXTERNAL_PREREQUISITES.md](docs/EXTERNAL_PREREQUISITES.md)
- Running it day to day, backups, HTTPS, scanner agent, troubleshooting: [docs/OPERATIONS.md](docs/OPERATIONS.md)
- How it fits together (system and ER diagrams): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Connecting your Todo app: [docs/TODO_ADAPTER_CONTRACT.md](docs/TODO_ADAPTER_CONTRACT.md)
- Test evidence per spec scenario: [docs/TEST_MATRIX.md](docs/TEST_MATRIX.md); design choices: [docs/DECISIONS.md](docs/DECISIONS.md)
- Build ledger and resume point: [docs/IMPLEMENTATION_PROGRESS.md](docs/IMPLEMENTATION_PROGRESS.md); original specification: [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md)

## Quick start (the PC that will host it)

Prerequisites: Windows 11 with WSL2 and Docker Desktop (Compose v2), started and signed in. Node 22+ with pnpm 12 (`corepack enable`) is needed only for the helper scripts below.

```powershell
pnpm install
node infra/scripts/init-env.mjs     # writes .env with fresh random secrets; never overwrites an existing one
docker compose up -d --build        # db, redis, migrate (once), api, worker, web, caddy
docker compose ps                   # everything healthy
```

Open <http://localhost:8080>. The first visit opens the setup wizard where you create the owner account. There is no default password.

Then: add `http://<pc-lan-ip>:8080` to `ALLOWED_ORIGINS` in `.env` to use it from your phone (`docker compose up -d` to apply), and [install the scanner agent](docs/OPERATIONS.md#install-the-scanner-agent) on each machine that holds media. _Settings → Demo data_ loads clearly labelled sample records if you want to look around first.

## Development

| Task                                    | Command                                                                                                      | Run from  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------- |
| Install                                 | `pnpm install`                                                                                               | repo root |
| Dev servers (API, worker, web)          | `pnpm dev` (starts Postgres and Redis in Docker on 127.0.0.1, then runs API, worker and web with hot reload) | repo root |
| Build everything                        | `pnpm build`                                                                                                 | repo root |
| Lint, format check, typecheck           | `pnpm lint`, `pnpm format:check`, `pnpm typecheck` (or `pnpm check`)                                         | repo root |
| Unit tests                              | `pnpm test:unit`                                                                                             | repo root |
| Integration tests (disposable Postgres) | `pnpm test:integration` (Docker required)                                                                    | repo root |
| Go agent tests                          | `pnpm test:agent`                                                                                            | repo root |
| Browser tests, desktop and 360px        | `pnpm test:e2e`                                                                                              | repo root |
| Migrations / demo data                  | `pnpm db:migrate`, `pnpm db:seed:demo`                                                                       | repo root |
| Build scanner agent                     | `pnpm agent:build` (`-- --all` for Linux and macOS)                                                          | repo root |
| Backup, restore, diagnostics            | `pnpm backup`, `pnpm restore <file> [--yes]`, `pnpm diagnostics`                                             | repo root |
| Restart safety check on the live stack  | `pnpm restart-test`                                                                                          | repo root |
| HTTPS over Tailscale                    | `pnpm tailscale status\|enable\|disable`                                                                     | repo root |

Versions: Node 22 or newer, pnpm 12, TypeScript 5.9, Go 1.27, PostgreSQL 17, Redis 7. API docs while the stack is running: <http://localhost:8080/api/docs>.

Layout: `apps/web` (Next.js PWA), `apps/api` (Fastify, `/api/v1`), `apps/worker` (BullMQ scheduler and jobs), `apps/scanner-agent` (Go), `packages/domain` (pure rules), `packages/db` (Drizzle schema and migrations), `packages/services` (all business logic), `packages/connectors` (Gmail, YouTube, Todo, Postiz, Meta, TikTok), `infra` (Compose helpers, Caddy, scripts), `tests`.

Configuration lives in `.env` (see [.env.example](.env.example) for every variable and its safe default). Secrets are never committed.

## Safety rules the app keeps

- Your original media files are never modified, moved or deleted.
- Nothing is sent, posted or paid without you pressing the button.
- Postgres and Redis are not published to your network.
- Unconfigured integrations say so and show the exact next step; they never show made-up data.

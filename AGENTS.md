# Notes for AI coding agents

Creator OS is a pnpm monorepo (TypeScript ESM, strict) plus a Go scanner agent. Read [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) for intent, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for structure, [docs/DECISIONS.md](docs/DECISIONS.md) before changing a rule, and [docs/IMPLEMENTATION_PROGRESS.md](docs/IMPLEMENTATION_PROGRESS.md) for current state. Update the ledger when you finish something.

## Non-negotiable rules

1. Never modify, move or delete a user's original media. The agent is read-only.
2. Nothing is sent, posted or paid without owner confirmation.
3. No fake data. Unconfigured integrations report `NOT_CONFIGURED` / `BLOCKED_EXTERNAL` with the next step. Demo data is labelled DEMO and removable.
4. Never publish Postgres or Redis ports beyond loopback. No default password. Secrets go in `.env`, never in code, logs, chat or git.
5. Counts come from their own tables, never from multiplying joins (file instances x publications x deliverables).
6. A file is "missing" only after complete scans plus grace. Offline is not missing.
7. Be honest in reports: say what you ran and what you did not.

## Where things go

- Business logic: `packages/services` (API, worker and tests all call it). Pure rules: `packages/domain`. Schema and migrations: `packages/db`. Connectors: `packages/connectors`.
- HTTP routes: `apps/api/src/routes/*` using `makeRouter` in `apps/api/src/http.ts`; roles VIEWER < EDITOR < OWNER; viewer-private GET paths are listed there. Responses use `{data, meta, error}`.
- Jobs: `apps/worker/src/jobs.ts` and `main.ts`.
- UI: `apps/web/src/app/(app)/*`. Keep 360px usable, keyboard accessible, and show honest states (empty, offline, error).
- Every new API route or behaviour needs a test: integration in `tests/integration/test`, browser flow in `tests/e2e/specs`.

## Commands

```powershell
pnpm check                 # format, lint, typecheck, unit
pnpm test:integration      # real Postgres in Docker
pnpm test:agent            # Go
pnpm test:e2e              # Playwright (desktop + 360px)
docker compose up -d --build
```

## Windows / PowerShell traps seen here

- Agent shells need `. .\infra\scripts\docker-env.ps1` before `docker` commands. If tests are started with `TEST_DATABASE_URL` set, unset it first so the harness starts its own container.
- PowerShell 5.1 `Set-Content -Encoding UTF8` adds a BOM; write files with the editor tools or `[IO.File]::WriteAllText(path, text, (New-Object Text.UTF8Encoding $false))`.
- `cd` into folders named `(app)` or `[id]` fails in PowerShell; use `-LiteralPath` or the file tools.
- Keep commands simple. Do not chain `git commit` with other inspection.
- Tests that count notifications must not depend on the clock (quiet hours): read the table, not the visible list.
- Next.js bakes `rewrites()` at build time, so `API_INTERNAL_URL` must be set when building the web image.

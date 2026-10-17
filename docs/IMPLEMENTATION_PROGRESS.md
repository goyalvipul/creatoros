# Creator OS - Implementation Progress Ledger

> Resume rule: read this file, `docs/PRODUCT_SPEC.md`, `FEATURES.md`. Continue at the first item that is not `DONE`.
> Statuses: `TODO` / `IN_PROGRESS` / `DONE` (code written + builds) / `VERIFIED` (test evidence recorded) / `BLOCKED_EXTERNAL`.
> Per owner request there are no delivery phases: everything is built in one pass; full validation happens at the end.

## Environment (checked 2026-10-16)

| Tool                | State                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 24 / pnpm 12   | present                                                                                                                                                 |
| Go 1.27             | installed by agent via winget (`C:\Program Files\Go\bin\go.exe`)                                                                                        |
| Docker Desktop 29.8 | present. Agent shells need `. .\infra\scripts\docker-env.ps1` first (credential-helper workaround). Cached: postgres:17-alpine, redis:7-alpine, caddy:2-alpine, node:22-bookworm-slim |
| ffmpeg / ffprobe 9  | present                                                                                                                                                 |
| Tailscale 1.102     | present                                                                                                                                                 |
| git                 | repo on `main`, commit regularly                                                                                                                        |

Typecheck a package: `cd packages/services; npx tsc -p tsconfig.json 2>&1 | Select-String "error TS"` (empty = clean).
Run integration tests: `. .\infra\scripts\docker-env.ps1; pnpm --filter @creatoros/tests-integration exec vitest run`.

## Work items

| #   | Item                                                                                              | Status                                                  |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 0   | Repo skeleton, root config, spec copied to docs/ and .cursor/rules                                | DONE                                                    |
| 1   | packages/domain                                                                                   | DONE (unit tests TODO)                                  |
| 2   | packages/db (Drizzle schema 0000 + custom 0001 extras)                                            | DONE, verified on PG17                                  |
| 3   | packages/connectors                                                                               | DONE (unit tests TODO)                                  |
| 4   | packages/services (types, crypto, audit, setup, devices, roots, ingest, library, assets, projects, publishing, crm, actions, integrations, notifications, todo, insights, ops, auth, catalog, demo, settings, config) | DONE; integration-tested: ingest, auth, demo; rest exercised through API tests |
| 5   | apps/api (Fastify, /api/v1, auth, CSRF, idempotency, agent + stream endpoints, OpenAPI)           | DONE; 13 HTTP integration tests passing                  |
| 6   | apps/scanner-agent (Go)                                                                           | DONE; Go unit tests + real-binary E2E (agent-e2e.test.ts, 5 tests) passing |
| 7   | apps/worker (BullMQ, scheduler, sync jobs, backups)                                               | DONE; 7 ops tests (backup/restore verified on real pg_dump) |
| 8   | apps/web (Next.js PWA, all sections)                                                              | TODO                                                    |
| 9   | infra (compose, Caddy, Dockerfiles, scripts, backup/restore)                                      | TODO                                                    |
| 10  | tests (unit, integration T01-T35, Playwright, Go)                                                 | IN_PROGRESS: 33 integration tests passing (schema, ingest, auth/demo, api) |
| 11  | docs (README, FEATURES, architecture, ops, EXTERNAL_PREREQUISITES, ER + system diagrams)          | TODO                                                    |
| 12  | Final validation run + evidence                                                                   | TODO                                                    |

## Blockers / notes

- None currently.
- Ingest contract: on a COMPLETE scan the agent must report EVERY present file; anything unreported is a missing candidate
  (needs 2 complete scans + grace period before CONFIRMED_MISSING). An empty "complete" scan of a populated root is treated as UNREACHABLE.
- Agent file-stream contract (API -> agent): `GET {listenUrl}/v1/stream?root=<rootId>&path=<displayPath>&exp=<unix>&sig=<hex>` with Range support;
  `sig = HMAC_SHA256(deviceSigningKey, "fetch|rootId|path|exp")` (`signAgentFetch`). Agent must also verify the path is inside the root.
- Agent request signing: `Authorization: Bearer <token>`, `x-agent-timestamp`, `x-agent-signature = HMAC(key, ts + "." + sha256hex(body))` (empty body for GET).
- Env var `AGENT_LOOPBACK_HOST` (optional) rewrites 127.0.0.1/localhost agent URLs so the API container can reach an agent on the Docker host.

## Log

- 2026-10-16: repo initialised, tooling verified, skeleton created.
- 2026-10-16: domain, db, connectors, services (types...ingest) written; integration tests (schema + ingest) pass on Postgres 17.
- 2026-10-16: remaining services written (library..settings/config), auth + demo tests, API app and routes with HTTP tests (33 tests green).

# Creator OS - Implementation Progress Ledger

> Resume rule: read this file, `docs/PRODUCT_SPEC.md`, `FEATURES.md`. Continue at the first item that is not `DONE`.
> Statuses: `TODO` / `IN_PROGRESS` / `DONE` (code written + builds) / `VERIFIED` (test evidence recorded) / `BLOCKED_EXTERNAL`.
> Per owner request there are no delivery phases: everything is built in one pass; full validation happens at the end.

## Environment (checked 2026-10-16)

| Tool                | State                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 24 / pnpm 12   | present                                                                                                                                                                               |
| Go 1.27             | installed by agent via winget (`C:\Program Files\Go\bin\go.exe`)                                                                                                                      |
| Docker Desktop 29.8 | present. Agent shells need `. .\infra\scripts\docker-env.ps1` first (credential-helper workaround). Cached: postgres:17-alpine, redis:7-alpine, caddy:2-alpine, node:22-bookworm-slim |
| ffmpeg / ffprobe 9  | present                                                                                                                                                                               |
| Tailscale 1.102     | present                                                                                                                                                                               |
| git                 | repo on `main`, commit regularly                                                                                                                                                      |

Typecheck a package: `cd packages/services; npx tsc -p tsconfig.json 2>&1 | Select-String "error TS"` (empty = clean).
Run integration tests: `Remove-Item Env:TEST_DATABASE_URL; . .\infra\scripts\docker-env.ps1; pnpm test:integration`.

## Work items

| #   | Item                                                                                                                                                                                                                  | Status                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | Repo skeleton, root config, spec copied to docs/ and .cursor/rules                                                                                                                                                    | DONE                                                                                                                                                                                             |
| 1   | packages/domain                                                                                                                                                                                                       | DONE; unit tests passing                                                                                                                                                                         |
| 2   | packages/db (Drizzle schema 0000 + custom 0001 extras)                                                                                                                                                                | DONE, verified on PG17                                                                                                                                                                           |
| 3   | packages/connectors                                                                                                                                                                                                   | DONE; unit tests passing                                                                                                                                                                         |
| 4   | packages/services (types, crypto, audit, setup, devices, roots, ingest, library, assets, projects, publishing, crm, actions, integrations, notifications, todo, insights, ops, auth, catalog, demo, settings, config) | DONE; integration-tested: ingest, auth, demo; rest exercised through API tests                                                                                                                   |
| 5   | apps/api (Fastify, /api/v1, auth, CSRF, idempotency, agent + stream endpoints, OpenAPI)                                                                                                                               | DONE; 13 HTTP integration tests passing                                                                                                                                                          |
| 6   | apps/scanner-agent (Go)                                                                                                                                                                                               | DONE; Go unit tests + real-binary E2E (agent-e2e.test.ts, 5 tests) passing                                                                                                                       |
| 7   | apps/worker (BullMQ, scheduler, sync jobs, backups)                                                                                                                                                                   | DONE; 7 ops tests (backup/restore verified on real pg_dump)                                                                                                                                      |
| 8   | apps/web (Next.js PWA, all sections)                                                                                                                                                                                  | DONE; 33 Playwright specs passing (desktop + 360px), incl. T33 journey                                                                                                                           |
| 9   | infra (compose, Caddy, Dockerfiles, scripts, backup/restore)                                                                                                                                                          | DONE: stack verified healthy via Caddy :8080; backup, restore, diagnostics, restart-test, tailscale, init-env, agent build scripts exist; `pnpm restart-test` passed on the live stack           |
| 10  | tests (unit, integration T01-T35, Playwright, Go)                                                                                                                                                                     | DONE: 80 integration tests (+ opt-in capacity), 33 Playwright specs, Go unit tests, CI workflow; mapping in docs/TEST_MATRIX.md                                                                  |
| 11  | docs (README, FEATURES, architecture, ops, EXTERNAL_PREREQUISITES, DECISIONS, TEST_MATRIX, ER + system diagrams)                                                                                                      | DONE                                                                                                                                                                                             |
| 12  | Final validation run + evidence                                                                                                                                                                                       | VERIFIED 2026-10-18: frozen install, build, format/lint/typecheck, 60 unit, 80 integration, Go vet+test, compose rebuild healthy, backup + restore dry run, restart-test 10/10, Playwright 33/33 |

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
- 2026-10-17: web app complete; Playwright E2E harness (isolated API :4100 + web :3100, fresh Postgres) green. Fixed: idea->project redirect, default checklist template, 360px header overflow, near-duplicate SQL (INSERT..RETURNING..LIMIT), Linux native-build approvals, worker argon2 external.
- 2026-10-18: viewer privacy (API/nav/search), spec tests T02-T08/T10/T14-T17/T19-T26/T29/T32/T34/T35, backup relationship fingerprint. Deliverable<->post linking (API + deal UI), honest 'Send to Todo' on Today, T33 Playwright journey (33/33 e2e green).
- 2026-10-18: fixtures + CI, Tailscale helper, restart test, password recovery, on-demand restore test with failure alert, capacity test (20k: 1779 files/s ingest, library page 32 ms; 100k: 1731 files/s, 68 ms), all docs written. Notification tests made independent of time of day.
- 2026-10-18: final validation run passed (see item 12). Remaining work is only the external steps in docs/EXTERNAL_PREREQUISITES.md.
- 2026-10-17: Meta phase 1 (see docs/META_SETUP.md): Instagram API with Instagram Login (OAuth, account discovery, multi-account, token renewal job, disconnect, import via existing sync), migration 0002 (providers instagram/facebook/threads + provider_webhook_events), signed webhook intake + restricted Caddy gateway :8081, Integrations UI card. Tests: 9 connector unit + 9 DB integration (fake Meta API); full integration suite 84 pass. NOT done: Instagram publishing, Facebook Pages, Messenger, Threads, webhook event processing, public media delivery. Not run against live Meta.
- 2026-10-17: fixed Integrations page treating ACTIVE connections as not connected; Google redirect URI in .env needed the /api/v1/integrations/oauth/callback path; Google consent now forces the account chooser.

## Socials + Workflows slice (V2 prompt)

- Built and tested against fakes (integration: `socials-workflows.test.ts`, unit: `workflow.test.ts`): identity-locked multi-account Instagram inbox, DM/comment-reply sending with idempotent request ids and UNCERTAIN state, workflow engine (draft/approval/automatic), approvals, simulation, versioning/rollback, kill switch, templates, migration 0003, `social-events` worker job, Socials and Workflows pages.
- Status: implemented, locally verified against fake HTTP only. **No live Meta call has been made**; endpoints/versions are unverified (see `docs/socials/PROVIDER_CAPABILITIES.md`).
- Not built: Facebook Pages/Messenger, YouTube comment replies, Threads, TikTok, publishing + temporary public media, AI nodes, delay nodes, drag-and-drop canvas, Playwright specs for the new pages.
- Public ingress (Tailscale Funnel) remains disabled; needs owner authorization.

### Socials module completion pass

- Added: Socials sub-navigation, overview dashboard, platform pages with an honest capability catalogue, comments / leads / scheduled pages, accounts settings (nickname, tone, signature, language), inbox saved views, local star/archive/notes, follow-up/task/collaboration actions (idempotent), message notifications, migration 0004. Tests in `socials-workflows.test.ts`.
- Not built: Facebook/Messenger, YouTube comments, Threads, TikTok connectors; AI reply assist; media/post context; mentions; saved-view persistence; keyboard shortcuts; comment moderation; per-account notification preferences; Playwright specs.

## Instagram live sync, diagnostics and channel identity (2026-10-17)

- Diagnostics (`runInstagramDiagnostics`), paged incremental sync (media, comments, conversations), media context in the inbox.
- Identity mapping (`packages/services/src/identity.ts`): a connection is tied to a Channels account through `social_accounts.provider_connection_id`.
  Auto-link happens only on a verified provider id (`external_account_id`). A username match is offered as a candidate and needs
  one owner confirmation (Integrations > "Connect existing channel"); a missing account can be created under an existing channel only.
  Links survive reconnect, token refresh and restart. Guards: one account per connection, no cross-connection steal, id mismatch refused.
- Applied live: @mehakviking account `064daec5...` linked to its connection (verified id stored), 64 posts imported, repeat import is a no-op.
- Tests: `tests/integration/test/identity-link.test.ts` (mock Instagram). Live evidence is the CLI run above (`instagram-link.js`).
- Still blocked externally: comments and DMs return 0 records (likely Meta app access level / App Review); no webhook POST received yet.

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

## Facebook Pages (Messenger + Page comments)

- Implemented: Facebook Login connect (one connection per Page, encrypted Page token), webhook subscription, historical sync (posts, comments, Messenger), signed Page webhook (`/api/v1/integrations/meta/facebook/webhook`, parent app secret), reply to DMs and comments through the shared outbound pipeline (identity lock, idempotent, owner-confirmed).
- Evidence: `tests/integration/test/facebook.test.ts` with a fake Graph API (mock only). `pnpm test:integration` passed (116 passed).
- STATUS: BLOCKED_EXTERNAL for live use until `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET` are in `.env` and the redirect URI and Page webhook are configured in the Meta dashboard. See `docs/socials/FACEBOOK_SETUP.md`.
- Not live-verified: OAuth, Page subscription, real webhook delivery, real sends.

## YouTube comments (Socials)

- Implemented: `youtube.force-ssl` opt-in ("Enable comments"), channel id resolution and verified auto-link, polled import of comment threads and your replies into the shared inbox (`source=YOUTUBE`, migration `0006_youtube_comments`), reply to top-level comments through the shared outbound pipeline (identity lock, owner-confirmed, idempotent, never retried).
- Evidence: `tests/integration/test/youtube-comments.test.ts` with a fake YouTube API (mock only); full integration suite passed (119).
- Not live-verified: Google consent, real comment listing, real replies. No DMs (not in the YouTube API). Moderation not built.
- Also corrected the stale Facebook entry in the Socials platform catalog.

## Email inbox organisation, reply and invoices (Collaborations)

- Implemented: mailbox picker named by Gmail address (`GET /mail/accounts`, per-mailbox tab counts); Collaborations Inbox now lists email and pasted threads only (social threads stay in Socials); tabs Inbox / Starred / Follow-up / In pipeline / Archived (one SQL definition shared by list and counts); move between tabs (`POST /threads/:id/move`; pipeline creates the opportunity once; archive/star are Creator OS-only); Gmail STARRED label captured at sync (sync only ever adds stars; also reads `labelAdded` history); task and follow-up from an email (one open action each, deep link `/collaborations/threads/:id`); reply from the app via opt-in `gmail.send` ("Enable sending" in Integrations, needs a reconnect), threaded with `threadId` + `In-Reply-To`, idempotent on `requestId`, never retried, `FAILED`/`UNCERTAIN` states; invoice suggestions from email text (migration `0008_invoice_suggestions`, `scanEmailInvoices` runs after each Gmail sync and on demand), accept as invoice or expense, or dismiss; invoice edit (`PATCH /invoices/:id`) and delete (`DELETE /invoices/:id`, refused when payments exist, use void).
- Evidence: `packages/domain/src/invoice-extract.test.ts`, `tests/integration/test/mail.test.ts` (fake Gmail; mock only). Full `pnpm test:integration` passed (128).
- Limits: invoice spotting reads email text only, not PDF attachments; suggestions are rule-based and always need confirmation. Un-starring in Gmail is not mirrored (sync never removes a star). Star/archive do not change Gmail (no `gmail.modify`). Not live-verified: Gmail send and real mail.

### Gmail stars and invoice search fix

- Cause: the normal Gmail sync only fetches the last 90 days, skips promotions, stores metadata plus a ~200 character snippet (no body, no attachment names) and never read existing stars. So the Starred tab stayed empty and invoice amounts could not be read.
- Fix: `syncGmailStars` asks Gmail for `is:starred` (ids only) every sync and marks/imports those threads; `syncGmailInvoices` searches Gmail (2 years, all categories, `invoice`/`amount due`/`filename:invoice`), fetches matches in full, replaces the snippet with the full text, records suggestions, and stores invoice-only threads already archived. "Scan email now" runs both deeply. Invoice-named attachment alone now yields a suggestion (amount left for you to fill in). PDF contents are still not read.
- Evidence: `tests/integration/test/mail.test.ts` (fake Gmail); suite passed (129).

### Email reading, per-message reply, sorting, live CAD values

- Show full email: the sync keeps only a snippet, so "Show full email" loads the complete text from Gmail once (`POST /threads/:id/messages/:mid/full`, read-only) and stores it encrypted. HTML entities (`&#39;`) are decoded; HTML paragraphs keep line breaks.
- Reply / Reply all on each message; the panel opens in the right column with To, Cc and subject prefilled from Gmail's live headers (`GET .../reply-info`). The reply carries `In-Reply-To` of that exact message. Your own address is always removed.
- Sorting: thread list by latest activity of either direction; messages newest first.
- Live CAD: `ensureLiveRates` (Frankfurter, fallback open.er-api; refreshed at most hourly when the Invoices tab or finance summary is read) writes `fx_rates`; each invoice shows its value in the base currency and the rate used; Received/Outstanding/Overdue/Expenses are combined in base currency. If both providers fail the last rate is kept (or totals fall back to per-currency); nothing is invented.
- Evidence: `tests/integration/test/mail.test.ts` (fake providers; the live rate endpoints themselves were not called in tests). Suite passed (132).

## Publishing: attach files and publish them

- Implemented: migration `0010_publish_items` (`publish_items`, `publish_drafts`, `publication_records.file_instance_id`). A title can link library videos. Publish is explicit, one request id, worker attempts 1, claimed from `QUEUED` so a retry does not upload twice. States `QUEUED` / `UPLOADING` / `PUBLISHED` / `FAILED` / `UNCERTAIN` (uncertain only after bytes may have been sent). The worker streams the file from the online agent; the original is not changed. Offline agent marks the draft `FAILED`.
- Platforms: Instagram Reel resumable upload, YouTube resumable `videos.insert` behind opt-in `youtube.upload` ("Enable uploads"), Facebook Page video behind opt-in `pages_manage_posts` ("Enable Page videos", not added to the normal Page login). TikTok stays disabled (audit required). "Add a live post" is unchanged.
- Plan matrix: brand filter `GET /publishing/matrix?brandId=` (brands come from Channels; accounts are that brand's channels). Title links to `/publishing/[variantId]`. Cells show `published/attached` from two separate counts when files are attached. `DELETE /variants/:id` removes a plan row; files and posts that already went out stay. Migration `0011_variant_brand` stores `distribution_variants.brand_id` and backfills it from the asset or project when those already have a brand.
- Library list includes each file's tags. The Library page must not call `.some` on a missing tag list (that crashed the page). `GET /library?assetId=` returns only files linked to that asset. Link a file on a title uses it, so the picker stays inside the folder chosen when the variant was created.
- Evidence file written, not executed (owner will restart containers): `tests/integration/test/publishing-upload.test.ts`. Not live-verified against YouTube, Instagram or Facebook.

## Content ideas: edit, status, and project copy

- Ideas can be edited with the capture form prefilled, moved New → Researching → Approved / Rejected / Archived, restored from archive (`archived_from`) or from Rejected back to New, and soft-deleted (`deleted_at`). Delete does not remove a project already created from the idea.
- New fields on the idea and copied onto the project at conversion: song title, optional library audio file, detailed concept (sanitized HTML), audience, competitor, hook, narrative, distribution plan. The project page can edit its own copy. Migration `0012_idea_brief`. Not executed here.
- The idea form is a page (`/content/new`, `/content/[id]`). Detailed concept replaces the pitch box and sits at the top, with browser speech-to-text. Unsaved writing is kept in this browser's localStorage and restored on return.

## Invoice documents

- New and edit invoices are pages (`/collaborations/invoices/new`, `/collaborations/invoices/[id]`). Fields match a paper invoice: date, due, number, currency, from, to, line items (description, quantity, unit price, tax percent), and bank details at the end. Line amount, subtotal, tax, and amount due are calculated. The stored invoice total is that amount due. An older invoice with no lines opens as one line at its existing amount. Migration `0013_invoice_document`. Not executed here.

## ComfyUI LTX (2026-10-25)

- Implemented: owner page `/comfy` with an LTX tab and a MiniMax H3 tab that does not run. Machines are saved by private URL (`0018_comfy_ltx`). The API prompt is posted to the selected ComfyUI. The editor graph is not. Validate is local. Check reads stats and model names.
- Evidence: `packages/domain/src/ltx.test.ts` against the API file. Both ComfyUI addresses answered `/system_stats` from this server (3060 12GB, 3090 24GB). A full render was not started from here.
- 2026-10-25: the ComfyUI page threw when `preset` was null because `.dockerignore` dropped `docs/` and the API file never reached the image. The form now renders without it, and the file is also stored at `packages/services/ltx/`. Offline creates go into a phone queue (`apps/web/src/lib/outbox.ts`) and replay with the same Idempotency-Key. Not browser-verified on a phone.

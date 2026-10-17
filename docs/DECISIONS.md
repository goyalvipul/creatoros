# Design decisions

Short records of choices a future maintainer might question. Newest decisions are not special; the list is grouped by theme.

## Product rules

- **Truthful publication evidence.** A post is `VERIFIED_PLATFORM` only when a connector returned it. A pasted link is `USER_ENTERED`. A later platform import upgrades the same record instead of adding another.
- **Nothing outward happens without the owner.** No e-mail is sent, nothing is posted or paid automatically. Gmail is read-only (drafts need a separate optional scope). Postiz is only ever reported on.
- **Counts never join-multiply.** Assets, file locations, publications and deliverables are counted from their own tables (see "Counting rules" in [ARCHITECTURE.md](ARCHITECTURE.md)). Tests T14/T35 guard this.
- **Missing is earned.** A file is marked missing only after complete scans (two) plus a grace period. Offline devices and unreachable roots are "temporarily unavailable". An empty "complete" scan of a populated root is treated as unreachable.
- **No guessing on moves.** Without a reliable file id, a moved file goes missing and the app _suggests_ a relink by content.
- **Deliverable links are one-to-one.** A post can fulfil only one deliverable (`409 ALREADY_LINKED`). Linking or unlinking never changes the deliverable's status; the owner does that.
- **AI is rules-based.** Priorities, screening and similarity are deterministic. A provider interface exists so a model can be added later, but no model is called and no data leaves the machine.

## Architecture

- **Single organisation per install.** Tables carry `org_id` (tests rely on it for isolation) but the product is one creator, several roles: Owner, Editor, Viewer.
- **Viewer-private areas.** Viewers never receive CRM, e-mail, finance, media, device or integration data, enforced in the API (route role defaults plus a private-GET pattern in `apps/api/src/http.ts`), in navigation and in search.
- **All logic in `packages/services`.** API routes, the worker and the tests call the same functions. `packages/domain` holds pure rules without a database.
- **The API rewrite is baked in at build time.** Next.js `rewrites()` are evaluated by `next build`, so `API_INTERNAL_URL` is a build argument, not a runtime variable.
- **Client-side auth gate.** The web app asks `/me` and redirects to `/login`; the API is the real enforcement. This keeps the standalone Next server stateless.
- **Redis is for jobs only.** BullMQ queues (`jobs` scheduler, `requests` on-demand) hold nothing that is not rebuildable from Postgres. `pnpm restart-test` proves jobs survive a restart.
- **Backups exclude originals and the encryption key.** Terabytes of media are not copied, and keeping `ENCRYPTION_KEY` out of the backup means a stolen backup cannot decrypt tokens.
- **Restore tests are real.** The worker restores the newest backup into a scratch database and compares row counts and nine relationship counts. A failure writes the error on the backup run and raises a CRITICAL notification.
- **Idempotency everywhere it matters.** Agent ingest (event ids), Todo sync (`creatoros:<org>:<action>` key), HTTP writes (`Idempotency-Key`), Gmail events (dedupe key).
- **Agent signing.** `Authorization: Bearer` plus `x-agent-timestamp` and an HMAC-SHA256 over timestamp and body hash. File streaming uses short-lived signed URLs and the agent re-checks the path is inside the root.
- **Symlinks skipped by default** so a link cannot leak files from outside the root.

## Integrations

- **Honest gating.** Every provider reports `ACTIVE`, `NOT_CONFIGURED`, `AUTH_EXPIRED` or `UNSUPPORTED` with the next step. There is no demo mode for them and no fake data.
- **Todo is generic.** The Todo PWA is connected later through an adapter contract (endpoints, field names and auth are configurable). Policy `TODO_OWNS_DUE_AND_COMPLETION`: Creator OS creates the task and owns its title/notes; the Todo app owns due date and completion. Concurrent edits become a visible `CONFLICT` for the owner to resolve.
- **Postiz is external.** It is not part of the Compose stack. Only its URL and API key are configured.
- **Meta, TikTok, Snapchat** need approved developer apps (or have no suitable API). They are built as explained, gated states; manual records cover the gap.

## Operations

- **HTTPS through Tailscale Serve, not Funnel.** Reachable only inside the tailnet. The helper uses its own port (8443) so it never replaces something already served on 443, and the LAN address keeps working over HTTP.
- **Compose binds PostgreSQL and Redis to nothing** (loopback only in the `dev` profile). `pnpm diagnostics` verifies it.
- **Password recovery without e-mail.** The app sends no e-mail, so another owner can set a password in Settings, or the sole owner runs a CLI on the host. Setting a password signs the person out everywhere and clears lockouts.
- **Windows shell notes.** Agent shells need `. .\infra\scripts\docker-env.ps1` (credential-helper workaround). PowerShell 5.1 `Set-Content -Encoding UTF8` writes a BOM; scripts use `[IO.File]::WriteAllText` with a no-BOM encoding.

## Testing

- **Time-of-day independence.** Quiet hours legitimately hold non-critical notifications back, so tests that count notifications read what was sent (including held ones) instead of what is visible right now. The timezone test derives its expectations from the platform's tz data: this machine's data has America/Vancouver on permanent daylight time from November 2026.
- **Real media in fixtures.** `tests/fixtures/generate.ts` creates short video, audio and image files with ffmpeg (so hashes, probes and re-encodes are real), plus hidden files, Unicode and spaced paths, a truncated file and a growing file.
- **The journey test simulates the agent** with correctly signed calls so the browser test stays deterministic; the real binary is covered in `agent-e2e.test.ts`.
- **Capacity numbers are measured, not claimed.** See [FEATURES.md](../FEATURES.md); the test is opt-in so the normal suite stays quick.

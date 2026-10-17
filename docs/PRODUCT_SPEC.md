---
description: "Creator OS full build contract: self-hosted multi-machine creative production, publishing, collaboration CRM, Gmail and Todo integration."
alwaysApply: true
---

# CURSOR AGENT MASTER RULE / BUILD PROMPT — CREATOR OS

This file is a VALID Cursor project rule. Save it as `.cursor/rules/creator-os-master.mdc` under the new Creator OS repository and launch Cursor Agent with the task: **"Implement the entire Creator OS product defined in the active project rule; execute milestones, tests and deployment; do not stop after scaffolding."** You may also paste the contents into Agent chat. When the initial implementation is finished, replace this very long always-applied build rule with smaller runtime rules under 500 lines; keep the full specification separately in `docs/PRODUCT_SPEC.md`. Do NOT prematurely truncate this rule during implementation.

## Cursor-specific execution mode

You are a full-stack coding agent. Do not give me a UI prototype or lengthy planning instead of source code. Review existing repository files first; preserve unrelated code. Build M0 through M7 as production-quality, tested, persistent, runnable code. Start actual implementation immediately, continuing through validated milestones. Use the terminal/Agent tools to edit files and execute checks. Use a persistent implementation ledger in `docs/IMPLEMENTATION_PROGRESS.md`, supported by real test runs and an accurate `FEATURES.md`; resume from the next failing test if context is compacted or a run is interrupted. If user OAuth, developer approvals or Windows service permissions cannot be supplied automatically, complete adapter + connect screen + documented manual setup, mark BLOCKED_EXTERNAL and continue other milestones. Do not generate fake connector success or screenshots representing live data.

**Important Cursor workflow:** Always write or update `docs/PRODUCT_SPEC.md` with the authoritative spec below, maintain project-level `AGENTS.md` as a short digest of unchanging rules, and create targeted `.cursor/rules/*.mdc` rules for backend, scanner, frontend and security once actual folders exist. Preserve this master spec. Do not add parallel incompatible stacks. For each milestone: implement → run test commands → fix → record exit codes/evidence → proceed. When unable to execute, record specific blocker and supplied recovery commands. Avoid waiting for nonessential human approval.

First action: inspect project, establish Docker/Node/Go availability, write ledger, scaffold M0, run it, then implement the multi-device scanner as the first major functional slice.

---

# CREATOR OS — AUTHORITATIVE END-TO-END PRODUCT AND IMPLEMENTATION SPECIFICATION
Version: 1.0 | Date: 2026-10-16 | Product: Creator OS | Deployment: private, self-hosted, multi-machine, installable PWA

## 0. BINDING RULES FOR THE IMPLEMENTING AGENT

This document is the full product contract. Do not deliver only plans, screens, scaffold files, pseudocode, a demo, a static mockup, or a partial CRUD application. Create a working repository with usable flows, durable data, tested services, secure integrations, migrations, realistic empty states, and repeatable Docker deployment. Keep working through the milestones in dependency order within the available execution window. Never declare an unsupported integration to be live, nor imply that a test using mocked platform responses proves a live external integration. Where an external API requires the owner's OAuth consent, developer credentials, approvals, webhook reachability, or paid capacity, build and test the connector plus connection wizard; mark it UNCONFIGURED and document the human step. No fabricated user data.

The implementation MUST prioritize accurate inventory, publishing evidence, collaboration follow-through, and a useful next-action queue. The app must provide practical value even with zero third-party credentials. Do not ask the owner to repeatedly restate requirements already specified here. Choose safe defaults; surface truly required secrets/paths only in setup UI and environment documentation. If code execution is blocked, report exact blocker and resume from checkpoint, not an ungrounded success claim.

Quality hierarchy: correct data model > data safety > working multi-device scanning > helpful UX > connectors > attractive animations > optional AI. All modules described as required must have actual DB-backed flows. Distinguish 'implemented', 'locally verified', 'requires credentials', 'requires platform approval', and 'not implemented' in all progress reports. Use a FEATURES.md capability matrix generated from test evidence.

## 1. USER, GOAL, WORK CONTEXT

The owner manages 'Mehak', a photorealistic virtual singer and multiple planned future brands/channels (travel, finance and additional brands). Work includes music/song ideation, Suno song versions, scripts, scene/image generation, ComfyUI + H3 videos, short-form edits, long-form music videos, thumbnails, promotions, publishing, paid brand partnerships, messages, invoicing, reporting and weekly goals. Two Windows GPU workstations generate files: a 12GB VRAM PC and a 24GB VRAM PC. More computers and a NAS may arrive. Storage may be on several local drives, SMB UNC shares, and NAS mounts. Windows machines, Docker Compose, and Tailscale already form the intended infrastructure. A separate Todoist-like self-hosted PWA already exists; integrate with its real API once inspected, rather than recreating a competing general-purpose Todo application.

Primary daily question: 'What have I created, on which machine; where has each version been posted; what collaboration messages or payments require my response; and what is the highest-value next action today?'

## 2. ACCEPTANCE CONTRACT / WHAT COUNTS AS DONE

A complete local installation must allow the owner, without connecting any social accounts, to: sign in; create an organization/brand and several channels/social accounts; pair Windows scanner agents; register any number of include/exclude folder roots per device; register network-mounted SMB roots; scan a mixed test library; view items with machine labels, original paths and accurate online/offline states; find duplicates without discarding their physical locations; sort and tag files; attach assets to song/video projects and campaigns; track multiple edits/versions and scene completion; create platform-specific publication records, statuses and URLs; create collaborations, conversations, deliverables, amounts, invoices and follow-up actions; view a unified calendar, daily priorities, workload and basic metrics; configure a generic Todo API integration or use the independent internal action queue; see jobs/errors/audit logs; create and restore database backups; restart containers with data preserved; install PWA on desktop/mobile via HTTPS; run tests from README instructions.

A complete integration build additionally supports real OAuth/credentials and honest graceful degradation for Google/Gmail/YouTube, optional Postiz, and adapters for additional providers subject to actual permissions. No dependency on a paid AI service for essential app functions. Do not mark platform-specific work DONE if the owner must still configure credentials or obtain review approval.

Success measurement: owner can locate any discovered file by device and full path; counts do not inflate by duplicate copies; no phantom 'published' statuses; unanswered inquiries and unpaid deals remain visible; actions link back to exact media/deals; two disconnected machines reconcile after reconnection.

## 3. NON-GOALS AND PRODUCT GUARDRAILS

- Do NOT build a new full video editor, video generator, social network scraper, unrestricted Instagram/TikTok DM crawler, competing Todo app, GPU scheduler, or cloud storage system in V1.
- Do NOT auto-delete, move, rename, overwrite, transcode or upload original files unless the user selects an explicit future operation with confirmation. Scanners are READ-ONLY for originals.
- Do NOT assume local files equate to published posts; an imported channel post without a verified asset match is its own record until matched.
- Do NOT send emails, DMs, agree to contracts, post content, or submit invoices without the owner's explicit confirmation. Defaults are read-only imports and draft creation.
- Do NOT fake integration status, metrics, completion percentages, source attribution, AI confidence, revenue, or data coming from an offline device.
- Do NOT make Tailscale a hard software dependency; private LAN must work. Do not expose Redis, Postgres, scanner ports, or unauthenticated dashboards to the public Internet.
- Keep core functions usable when an API is unavailable, a PC is powered off, or a subscription/API budget is exhausted.

## 4. PRODUCT INFORMATION ARCHITECTURE AND UX

Navigation (desktop sidebar, mobile bottom navigation + More drawer): Home / Inbox & Today / Content / Production / Library / Publishing / Calendar / Collaborations / Analytics / Channels / Storage & Devices / Integrations / Settings. Global search and a universal Quick Add (+ idea, song, video project, brand, deal, follow-up, publication, folder source). Navigational sections may be grouped intelligently for mobile but none hidden indefinitely.

Design language: modern professional creative-operations app; dark and light themes; clean typography; responsive 360px through large desktop; left desktop rail, searchable/filterable tables, card/grid alternatives, compact kanban, calendar month/week/list, accessible dialogs and forms, keyboard shortcuts, thoughtful icons and skeletons, optimistic updates with revert; reduced motion; WCAG 2.2 AA target (contrast, keyboard, focus, labels). No placeholder-only screens. Every page must show zero-state guidance and live counts from DB, loading/error/unauthorized/offline states, filter persistence, links to detail objects, undo for reversible changes, and confirmations for destructive changes. Default theme should look polished, not a generic dev admin panel.

### 4.1 Home / Daily briefing
- KPI tiles: idea backlog, in production, completed assets, ready-to-publish assets, unposted platform targets, scheduled posts, verified published, open brand inquiries, needing reply, awaiting approvals, pending/overdue invoices, blocked tasks.
- Every KPI has drilldown and an exact SQL-backed definition, configurable date/brand scope and freshness indicator.
- 'Top 3 today' calculated deterministically from deadlines, time overdue, potential deal impact, dependencies, completion readiness and manual pinning; show 'why prioritized'. User can snooze, assign due date, complete or open object. Never assert guaranteed virality.
- Activity timeline, upcoming releases, device scan warnings, last sync health, storage by device, recent creations, latest brand inquiries, and upcoming campaign deadlines.
- Cross-brand filter, quick capture and optional morning briefing view; do not require scheduling service for first use.

### 4.2 Content ideas and planning
- Idea Inbox with quick text/voice-file reference, link, notes, genre, content pillars, references, attachments, expected audience, language, channel, score, estimated effort, priority, draft storyboard/lyrics, content format, tags, status NEW/RESEARCHING/APPROVED/REJECTED/ARCHIVED.
- Convert idea to song/project without losing provenance. Content templates for music single, lyric video, performance Reel, Shorts, behind-the-scenes, product UGC, travel vlog, education; custom templates.
- Templates generate stage checklists, deliverables and channel-specific variants; user editable.
- Support planned content series and recurring production goals, creative briefs, versioned decisions, approved direction, scripts, hooks, release checklist, approval history.

### 4.3 Production and project workspaces
- Hierarchy: Brand > Creative Project (song, campaign, travel topic, etc.) > Production Plan > Scenes/Clips > Media Assets/Versions > Distribution Variants > Platform Publications.
- Each project displays stage, owner, tags, due dates, song/audio links, project brief and decision history, concept, shot list/timeline segments with start/end times, expected duration, per-clip prompt, attached segmented audio, generation attempts, reference images, generated versions, selected final, QA/approval notes, export status, blocking dependencies, estimated/actual completion.
- Stage states DRAFT, APPROVED, GENERATING, EDITING, QA, READY, DISTRIBUTING, ARCHIVED (not confused with post status). Clip states PLANNED/QUEUED/RUNNING/SUCCEEDED/FAILED/SELECTED/REJECTED. Define completion as explicit approved final or approved automation signal, not arbitrary MP4 existence.
- Batch record clips and multi-select assets; user can upload small project attachments or link existing indexed files; read-only original media.
- Future ComfyUI/H3 workflow event adapter: support optional ingest API for job_id, prompt_id, workflow metadata, output nodes, timecodes and designated folder; connect outputs to exact job IDs (not just filename guess). Provide documented manifest file schema + signed webhook/event ingestion. Do not require live ComfyUI connection in base operation.

### 4.4 Library and universal search
- Grid with fast thumbnails/proxy previews, list with customizable columns, search by name, full/partial path, filename, transcript/description where available, project, brand, tags, file type, duration, size, resolution, frame rate, date, device, disk, duplicate group, online/offline, ready/published, unassigned and source.
- Asset detail includes exact file instances (device display name + stable device id, drive/root, absolute OS path, optional SMB path, file size, content hash status, last seen, available state), associated project, variant/version tree, thumbnails, technical metadata, optional ComfyUI provenance, posts and collaboration deliverables.
- Definitions: *logical asset* is an intended piece of content; *media file instance* is an observed byte-file at a device/path; *asset version* is intentional revision/export; *publication* is a distinct posting to an account. Exact duplicate bytes across PCs must not double the distinct asset count. Near-duplicate encode variations are suggestions requiring confirmation, not automatically collapsed.
- Version naming, favorite/approved master, provenance, offline preview cache, show copy locations, reveal/open location only when supported by user's OS/helper and browser security; always have reliable Copy Path. Signed authenticated media streaming endpoint with range requests and no open arbitrary filepath query.
- Search all indexed resources globally (assets, projects, brands, campaigns, posts, contacts) with keyboard-open palette and grouped results.

### 4.5 Publishing manager
- Matrix of distribution variants versus connected social accounts; each cell NOT_PLANNED, PLANNED, READY, SCHEDULED, SUBMITTED, PROCESSING, PUBLISHED_VERIFIED, PUBLISHED_MANUAL, FAILED, UNKNOWN, REMOVED. Visual difference between verified and user-reported.
- Per-post metadata: platform, account, content file/version, title, description, hashtags, tagged products/sponsors, privacy, language, CTA, thumbnails, accessibility captions, planned time, actual time, post URL/external ID, evidence, sync timestamp, error/retry, stats, approval requirements, paid promotion/disclosure indicator.
- Platform-specific caption drafts editable independently; bulk copy from master with per-platform overrides; preview with validation warnings; UGC/sponsor disclosure checks. Manual publish checklist and paste link; imported posts not forced-matched to a file.
- For a selected asset show unposted target accounts and count separately from total asset count. If a brand/channel has no account on platform, show N/A rather than 'pending'.
- Publishing calendar merges scheduled publications, project deadlines and collaboration commitments; drag/drop reschedule with timezone correctness and collision warnings.
- YouTube authorized import of uploads via channels.uploads playlist and playlistItems/videos APIs, paginate, dedupe by platform+account+external id, retrieve own video stats subject to authorized scopes and API quota. Channel account linking wizard.
- Optional Postiz adapter for scheduled/published posts and statuses ONLY if installed and its current API supports those capabilities; handle hosted/self-hosted configuration. Never promise bypassing social-provider approval through Postiz.
- Additional provider adapters for Instagram professional accounts, Facebook Pages, TikTok display, etc. Feature capabilities must be probed/configuration-gated, not hard-coded as universal. TikTok direct public posting can require audit and appropriate scopes; app may only display 'manual / disabled / requires approval'. Do not scrape private DM webpages or use unauthorized login automation.

### 4.6 Collaboration CRM, messages and money
- Unified opportunity inbox and pipeline: NEW_INQUIRY, TRIAGE, QUALIFIED, NEGOTIATING, AGREED, CONTRACTING, IN_PRODUCTION, AWAITING_BRAND, REVISION_REQUESTED, APPROVED, PUBLISHED, REPORTING, AWAITING_PAYMENT, PAID_CLOSED, DECLINED, LOST, ON_HOLD. Allow overlapping facets (payment/deliverables) instead of wrongly treating every stage as exclusive truth.
- Brand/agency/contact directory; contacts linked to more than one deal, websites, social handles, email, notes, preferred communications, timezone, reply SLA.
- Inquiries capture source provider, account, sender, channel, external thread and message IDs, timestamps, unread/action state, thread history, attachments, conversation links, structured offer suggestions, confidence and source citation (message pointer). Read/triage/dismiss/merge and dedupe repeated messages. Never silently create a committed deal from speculative text.
- Deal fields: campaign, represented channel(s), pitch, compensation type (flat fee, gifted, affiliate, commission, mixed), agreed/prorated amount, currency, tax terms, usage rights, exclusivity, deadlines, territories, embargoes, licensing, deliverable quantities and specs, revision rounds, contract status, signing date, internal notes, priority, deal owner, expected payment terms, budget, cost, expected margin.
- Deliverable tracker individually links to asset/version, platform and publication; statuses PLANNED/IN_PROGRESS/SUBMITTED/CHANGES_REQUESTED/APPROVED/PUBLISHED/ACCEPTED. Brand approval must not be guessed from email wording without confirmation.
- Messages view shows last inbound/outbound and last answered time, actionable state NEED_REPLY/WAITING_FOR_BRAND/WAITING_FOR_USER/DONE, snooze-until, draft replies requiring user approval; never automatic outbound replies in V1.
- Reminder/follow-up rules: incoming unaddressed for configurable hours, approaching reply SLA, quote followup after N days, due deliverable, approval overdue, report due, invoice due/overdue, expected commission payout, post-campaign thank-you.
- Revenue: invoice records, partial payments, expense records, optional currency conversion as separately sourced FX rates with rate date (or manual rate), estimated vs contracted vs invoiced vs received amounts clearly separated, amount due, proof of payment, due dates, payment methods but no bank passwords. Show cash collected versus pipeline (never combine as earned).
- Kanban + sortable table + inbox + calendar + deal detail tabs Overview/Conversation/Deliverables/Tasks/Agreement/Payments/Activity. Confidentiality: least-privilege access; source email body not used to train external AI unless separately opted in.

### 4.7 Collaboration message connectors
- Gmail initial connector: OAuth authorization, narrowest practical scopes, initial sync pagination, stable Gmail message/thread IDs, incremental history.list; checkpoint cursor, idempotent upsert; fallback full resync when cursor expires. Implement configurable polling as default for local-only deployments. Optional Pub/Sub push only if cloud configuration is supplied, with renewal, verification, error handling. Distinguish sender's actual email versus display name. Filter candidates by heuristics and optional local AI; maintain 'possibly collaboration' queue with easy dismiss/confirm. Expose last sync, permission and sync errors.
- Manual intake for other sources: paste text, upload screenshot/document (no forced OCR), save DM/deal link, source platform, external sender, dates, images and structured notes. If OCR later added, use explicit user permission and clear provenance.
- Facebook/Instagram/TikTok connectors MUST be capability- and permission-gated. Define adapter contracts and connect panels; implement supported APIs only with verified permissions and authorization, no promised unrestricted Instagram/TikTok DM read. Show 'not supported by account/app permissions' when appropriate.
- AI assistant (optional) can classify inbound messages, extract deadline/offer, suggest response, estimate priority and detect missing terms. Human approves suggestions; fallback deterministic keyword/rule-based screening. PII redaction toggle, encrypted stored credentials, prompt injection protection (email text cannot issue tool commands).

### 4.8 Todo PWA integration and reminders
- The owner's existing Todo PWA is the preferred system of record for tasks/reminders; Creator OS remains source of truth for project/deal states, action provenance, and financial due dates. Do not replace/reinstall or alter Todo repo without permission; build an integration adapter based on actual discovered auth/API/schema. Provide GET/POST/PATCH webhook or polling adapter and an example OpenAPI contract; if endpoints differ, adapt using configuration. No direct write access to Todo DB.
- Task link entity maps Creator OS source_type/source_id/action_id -> todo provider + remote_task_id + sync revision/timestamps; stable idempotency key, distinct originating task, avoid loops and duplicate reminders. Owner can link existing Todo tasks or create one from an action.
- Map required fields: title, description with deep link, due local date/time, timezone, priority, project/list, status, reminder channels, completed_at, assigned owner, source tags. For edit conflicts: ownership matrix (Creator OS owns context/relationships/source record; Todo owns manually edited due time and completion unless specifically overridden); use ETags/revisions when available, configurable conflict resolution and visible log; never silently erase edits.
- Retry with exponential backoff, dead-letter and manual retry; reconcile scheduled syncs; if Todo offline, retain pending sync and keep a local read-only action queue. For unconfigured Todo, show Creator OS internal actions and optional in-app alerts (not pretend external push or TODO sync succeeded).
- Push notifications: PWA service worker can request notification permission via explicit user gesture, but iOS/Android browser support varies; implement in-app alerts as guaranteed fallback. Do not duplicate notifications if Todo app already delivered an action. Quiet hours and snooze; timezone America/Vancouver default, user-changeable.

### 4.9 Analytics, targets and reports
- Metrics by brand, account, platform, campaign, project, month/period: published count, views, watch time when available, engagements, follower growth where available, content-to-publish lead time, draft backlog, unused ready assets, campaign throughput, booked/collected revenue, overdue receivables, effective revenue per content output.
- Metric provenance/status: VERIFIED_PLATFORM, USER_ENTERED, ESTIMATED, UNKNOWN. Store snapshots by date and timezone; no extrapolated numbers presented as platform facts. Graphs, compare periods, filters and CSV export.
- Goals/targets: monthly release targets, weekly video output, watch-hour milestones, deal response SLA, revenue target, custom outcome vs activity metric; progress calculations and historical revisions. 'Viral likelihood' is not a truth metric.
- Daily/weekly briefing and configurable reminders (not mandatory background AI). Add export of report as CSV/printable view; no paid document dependency.

### 4.10 Account/organization/admin
- Setup wizard: create owner account, set home timezone/currency, optional brand/channel structure, create storage devices, pair agents, first scan, connect Todo and Google optionally. Allow skip, back, resume.
- User/roles model: OWNER, EDITOR, VIEWER initially owner-only deploy; permissions backend-enforced. Password reset/offline recovery documented; secure session logout, device sessions and TOTP optional.
- Settings: branding, theme, notification policy, scan exclusions, file type rules, duplicate strategy, integrations/connectivity, encryption key setup, retention, exports/backups, logs, and complete delete-account/data controls with confirmation.
- Consistent states: active, paused, disabled, auth expired, partial sync, unsupported, offline, error, not configured. Settings page with health checks for agents, mounts, DB, queue, media workers, disk free.

## 5. SYSTEM ARCHITECTURE, CHOICES AND REPOSITORY

Default stack (stay consistent unless strong reason documented): TypeScript strict-mode monorepo using pnpm workspaces and Turborepo; Next.js (current supported release, App Router) + React + Tailwind + shadcn/ui for frontend; Fastify REST API + Zod and OpenAPI 3.1 for server; PostgreSQL for authoritative state; Drizzle ORM + explicit SQL migrations; Redis + BullMQ for job scheduling and retries; Node worker for thumbnailing/FFprobe, queue and reconciliation; self-hosted reverse proxy (Caddy or Tailscale serve HTTPS); agent written in Go (static Windows binary) for low-overhead file watches, hash and metadata enumeration, and signed outbound agent communication; FFmpeg/FFprobe for previews/metadata. Use Playwright for browser E2E; Vitest for TS unit/integration; Go tests for scanner; Testcontainers or docker-compose-test for integration DB. Exact supported dependency versions must be pinned in lockfiles after compatibility check, not guessed from this spec.

Repository:
```
creator-os/
  apps/web/                      # responsive Next.js PWA
  apps/api/                      # Fastify HTTP/API auth/OpenAPI
  apps/worker/                   # queue consumers, media derivative jobs, sync jobs
  apps/scanner-agent/            # Go Windows/Linux read-only agent + installer
  packages/db/                   # Drizzle schemas, migrations, seed fixtures
  packages/domain/               # Zod, DTOs, business logic/enums
  packages/connectors/           # Google, platform, Postiz, Todo adapters
  packages/ui/                   # shared design system components
  packages/config/               # shared lint and TS config
  infra/docker/                  # compose, Caddy, environment templates
  infra/scripts/                 # migrate, backup, restore, diagnostics
  docs/                          # architecture, workflows, API, operations, security
  tests/e2e/; tests/fixtures/; tests/integration/
  .github/workflows/ci.yml
  README.md; .env.example; LICENSE; AGENTS.md; CLAUDE.md; FEATURES.md;
  docs/IMPLEMENTATION_PROGRESS.md; docs/DECISIONS.md; docs/EXTERNAL_PREREQUISITES.md
```

HTTP API is single source of authorization/business logic; UI does not bypass it. Keep provider-specific code behind typed interfaces. Persistent state in Postgres volume and derivative assets in dedicated Docker volume; raw media stays on original devices. A reverse proxy provides same-origin `/`, `/api`, `/media` and WSS to avoid fragile cross-origin PWA behavior. No Redis/DB exposed to LAN by default. Provide standard Docker Compose profiles `core`, `integrations`, `dev`; core works without Google/AI.

### 5.1 Storage scanning agents: MUST WORK ACROSS BOTH WINDOWS MACHINES

- Deploy an installable low-CPU scanner agent as signed/pairable Windows Service where feasible (Go + Windows SCM support), runnable in foreground for diagnostics; documented install/start/stop/uninstall PowerShell scripts. Package builds for win-amd64 and optionally linux-amd64. No administrator required for foreground scanning; service installation usually needs elevation.
- Agent pairs with one-time expiring code from UI, pins API endpoint/certificate validation, receives per-device scoped short-lived tokens with revocation/rotation. Owner provides device-friendly label (e.g. 'GPU-12GB', 'GPU-24GB'), stable agent/device UUID, hostname, OS and software agent version. Changing hostname doesn't change identity. Treat tailscale IP as mutable metadata, not primary key.
- Register unlimited scan roots per device: `D:\ComfyUI\output`, `E:\Mehak`, SMB mapped roots, and Linux paths. Root holds include/exclude globs, recursion, file extensions, scan schedule, read-only policy, access method, optional NAS share info, project/brand auto-tagging rules, agent binding, startup/backfill mode. Normalize Windows case-insensitive paths and UNC with SMB semantics; distinguish displayPath and canonicalKey. Avoid leaking credentials in logs.
- Network/NAS strategy: prefer scanning SMB shares from a selected agent with legitimate mounted access OR controlled SMB mounts inside container, not blindly calling `\\PC\share` from a Linux Docker container. UI must explain that Docker cannot automatically see all Windows UNC paths; provide mount wizard and explicit path mapping plus permissions check. A network share visible to multiple scanners must be de-duplicated as one physical share identity where known; otherwise preserve separate observations and allow admin merge.
- Inventory flow: asynchronous paged initial discovery; use periodic reconciliation as canonical truth, local filesystem watcher for fast hints only; fsnotify/Windows notifications can overflow/miss events, so reconcile at startup/daily/per configurable interval and after reconnect. Persist durable scan cursor/checkpoint per root. Do not traverse outside allowed roots through reparse points/junctions/symlinks; default do not follow them, with allowlist only when explicit; detect cycles and permissions errors.
- Agent observes path, root, mtime precision, size, stable fileId if available, quick fingerprint and metadata; server assigns idempotent observation key device/root/canonical path/file identifier. Wait until file stops changing for minimum 2 consecutive observations and configured settle interval (e.g. 30-120 seconds, configurable); ignore `.part`, temp frames or incomplete outputs by patterns; FFprobe only after stable; mark STILL_WRITING/PROBING/INDEXED/PROBE_FAILED. Never block generation or hold file locks longer than needed; throttle IO/CPU and max concurrency; pause scanning during high load per optional thresholds.
- Hash strategy: quick signature (size + bounded sampled chunks + timestamps as hint) for candidates, then full streaming SHA-256/BLAKE3 for final exact duplicate confirmation; cannot assert exact duplication using sample alone. Prefer background low-priority hashing, configurable max bandwidth. Hash inside local agent, send hashes/metadata; do not stream GB media to central API for hashing. Different codecs/bitrate are versions or suspected near duplicates, not exact copies.
- Metadata: MIME sniffing (not extension only), duration, fps, width/height, codec, audio stream, bitrate, rotation, file size, created/modified, optional media creation date and recognized workflow metadata; note Windows ctime creation vs POSIX change-time distinction. Thumbnail generation near data using agent where possible or secure bounded proxy preview requests; central derivatives isolated with safe file names. Audio waveform metadata optional.
- Reconciliation: `last_seen_at`, `last_successful_scan`, root heartbeat and per-file states AVAILABLE, MACHINE_OFFLINE, ROOT_UNREACHABLE, MISSING_CANDIDATE, CONFIRMED_MISSING, PERMISSION_DENIED, HASHING, INCOMPLETE. A machine failure NEVER mass-deletes records. Only confirm missing after a successful complete scan of that root, appropriate grace window and repeated checks. Allow manual archive and re-link. Moves/renames preserve history by stable fileId/hash if reliably correlated.
- Backpressure and offline: agent stores a durable bounded local queue (SQLite or append-only transactional journal), retry with jitter and backoff, sequence IDs, ACK/high-water-mark sync and resumable batching; no unbounded local data. Distinguish heartbeat from full scan. Send only metadata by default; media bytes are never globally uploaded.
- Central and device diagnostics: last scan, indexed count, new count, stale count, errors by root, permission failures, agent version, health, scan duration, last heartbeat, share free/total where permitted; user actions Scan Now/Pause/Resume/Reconcile/Remove Source (removal is non-destructive to original files; records retired deliberately).
- Security: agent token scoped to device/root, server validates requested path belongs to paired roots; no arbitrary file read HTTP APIs; preview streaming uses signed asset instance IDs, path canonicalization and allowlisted roots, rate-limits and CORS same-origin; audit cross-device fetch. Agents must reject remote command/shell execution and arbitrary deletions.

### 5.2 File identity and count rules

Distinct physical instances = count(file_instances with current inventory) including replicas. Distinct exact media objects = count(verified full-hash groups plus nonhashed provisional identities), not always equal to intended videos. Logical video assets = count(asset IDs with type video), independent of file copies and versions. Project clips = count(clips) and completed clips = explicit user/manifest-approved success, not filename matching. Ready to publish = approved export variant with at least one planned target not verified published. Published counts = publication records per social account+platform with real evidence and status. Dashboard must display labels and tooltips for different counts. Unscanned/no-hash items should remain provisional, not silently collapsed.

### 5.3 Media retrieval and previews

Mobile/desktop browser access via authenticated proxy/range streaming to owning online agent or configured SMB mount. If owner agent offline, show cached authorized thumbnail/proxy only, not pretend full media available. Max concurrent proxy requests, explicit timeouts, 206 Partial Content support for video seeking, disk quotas/LRU preview cache, thumbnails made for images/videos but never modify originals. Avoid uploading raw media to a remote service without permission. Optional 'copy path' returns exact remote Windows canonical path and SMB friendly path if available; browser cannot always open arbitrary local filesystem from PWA; make this clear in UI.

## 6. DOMAIN MODEL: IMPLEMENT ALL REQUIRED TABLES, FK, INDEXES, CONSTRAINTS

Use UUID primary keys, org_id scope on owned data, created_at/updated_at, optimistic version as needed, deleted_at for soft deletes where safe, UTC timestamptz and time zone ID for planned local events; money as integer minor units + ISO 4217 currency; decimal for FX rates and percentages; full-text search where practical. Define enums in domain package and SQL. Add unique constraints and partial indexes for idempotency. No giant unstructured JSON as substitute for essential relational entities. JSONB is appropriate for provider-specific opaque snapshots. Tables (name => critical columns/relationships):

Identity/workspace:
1. users => email, password_hash/identity, role, timezone, locale, status, last_login; no default insecure password.
2. organizations => name, owner_user_id, base_currency, timezone, settings.
3. organization_memberships => org_id, user_id, role, status.
4. brands => org_id, name, type, description, content_pillars, active.
5. channels => org_id, brand_id, name, purpose, language, goals, active.
6. social_accounts => channel_id, platform, handle, external_account_id, profile_url, account_type, verified_link, capability_flags.
7. provider_connections => org_id, provider, principal_hint, state, scopes, encrypted_token_ref, expiry, last_sync, error, config metadata.

Storage/media:
8. devices => org_id, uuid, display_name, hostname, os, hardware label, agent_version, last_seen, state, tailscale_hint (optional).
9. device_credentials => device_id, hashed token identifier, issued_at, expires_at, revoked_at, pairing audit.
10. storage_roots => org_id, assigned_device_id/mount_owner, physical_share_id nullable, display_path, canonical_path, mount_path, recursion, filters, config, scan_policy, state.
11. scan_runs => root_id, run_id, job_type, started/finished, status, scanned/new/changed/missing/error counts, complete_success.
12. scan_observations => root_id, agent_event_id, sequence, path, file identity, received_at, processing result; unique per agent event.
13. file_instances => root_id, device_id, canonical_path, display_path, file_id nullable, size, mtime, first_seen/last_seen, availability, quick_signature, full_hash nullable, media_object_id nullable, file_type, probe_state; unique(root, canonical_path) under active policy.
14. media_objects => org_id, exact_hash, hash_alg, size, MIME, kind, technical metadata, verification_state; unique verified(hash,size,algorithm) per org.
15. logical_assets => org_id, brand_id nullable, project_id nullable, kind, title, description, creative_state, selected_version_id nullable, source, is_archived, tags.
16. asset_versions => asset_id, label, number, media_object_id, variant_type, approval_state, parent_version_id, resolution, intended_use, created_by.
17. asset_file_links => asset_version_id, file_instance_id, link_reason/confidence, confirmed_by, primary_preference, unique pair.
18. derived_previews => file_instance/media_object, variant_key, relative_cache_path, generated_at, last_accessed, size, status.
19. duplicate_candidates => media A/B, method, score, state, reviewed_by; exact hash grouped automatically, near match reviewed.
20. media_tags + asset_tag_links => org-scoped tags and links.
21. asset_match_suggestions => source object, candidate logical asset, reasons/confidence, reviewed_by, outcome.

Creative production:
22. ideas => brand/channel, format, pitch, creative brief, priorities, status, notes, origin.
23. creative_projects => brand, source_idea_id, type, title, stage, due, approved_direction, parent_project_id, metadata.
24. project_memberships => project_id, user_id, role.
25. project_checklist_templates + project_checklist_items => template, ordering, required, completion evidence.
26. songs => project_id, title, language, genre, lyrics version pointers, audio master.
27. production_scenes => project_id, ordinal, timecode_start_ms/end_ms, narration/direction, shot_prompt, audio_segment asset link, status.
28. generation_jobs => project_id, scene_id, provider, external_job_id/prompt_id, started/end, status, settings, error.
29. generation_outputs => job_id, asset_version_id or file_instance_id, output_role, selection_state.
30. project_attachments => project_id/deal_id, asset/file, purpose, access controls.
31. project_status_events => project_id, from/to, timestamp, source actor, reason.

Publishing:
32. distribution_variants => logical_asset_id, asset_version_id, channel_id, format, target metadata, readiness, title master.
33. publication_targets => variant_id, social_account_id, desired, desired_at; unique combination.
34. publication_records => org_id, variant_id nullable, social_account_id, provider, external_post_id, canonical_url, title, caption, hashtags, state, state_evidence, planned/published_at, last_synced, failure_reason, attribution; unique(provider, account, external_post_id) when present.
35. publication_status_events => publication_id, event, source, evidence, at.
36. publication_metrics_snapshots => publication_id, snapshot_at, metrics fields with nullable unsupported values, provenance and provider metadata.
37. publishing_schedules => publication target, planned_at, timezone, status, connector_job_id, last_result.

CRM/messages/revenue:
38. organizations_external => brand/agency name, website, sector, handles, notes.
39. contacts => external_org_id, name, addresses/handles, timezone, consent/notes.
40. conversation_threads => provider_connection or manual, provider_thread_id, external_org/contact, brand, last inbound/outbound, state, snooze, last_check.
41. messages => thread_id, provider_msg_id, direction, received_at, from/to, subject/body preview and optionally encrypted body, read state, attachment refs, raw checksum, classification; unique(provider, principal, provider_msg_id).
42. opportunities => source_thread_id, brand/channel, external_org/contact, offer_type, stage, predicted_value_minor nullable, currency, notes, probability manually set.
43. deals => opportunity_id, company/brand, title, stage, contracted_value_minor nullable, currency, deliverables summary, rights/license/exclusivity, status dates, payment terms, approval rules.
44. deal_deliverables => deal_id, project_id/asset_version_id/publication_id nullable, format, platform, quantity, due_at, submitted_at, approved_at, status, revision_rounds.
45. deal_contracts => deal_id, document ref, effective/expires, rights, approval state, signatures state (no e-sign imitation).
46. invoices => deal_id, invoice_no unique per org, issued/due, currency, amount_minor, status, paid_total_minor, optional external file.
47. payments => invoice_id, amount_minor, currency, received_at, method, reference, verified/user-entered.
48. expenses => deal/project, amount, currency, category, incurred_at.
49. follow_up_rules => source_type, condition, duration, enabled, notification preference.
50. inbound_classifications => message_id, category, extracted fields, confidence, algorithm, review outcome and provenance.

Tasks/notifications/system:
51. internal_actions => org, source_type/id, title, due_at, priority, state, actionable reason, dismissed/snoozed, completion evidence.
52. task_integrations => provider_connection, sync_direction, conflicts, configured capabilities.
53. task_links => source_action_id, remote_task_id, revision, idempotency key, sync_state, last_sync, conflict field data.
54. notifications => owner, source, type, dedupe_key, read/snooze/delivered_at, severity.
55. notification_preferences => user, quiet hours, channels, rules.
56. goals => brand/channel, period, metric, value, unit, activity_or_outcome, provenance.
57. goal_observations => goal, period, actual, source, snapshot.
58. analytics_snapshots => period, org/brand/channel, metric fields, sources, timezone.
59. background_jobs => type, external job ID, source, status, attempts, fail reason, started/finished.
60. sync_cursors => connection, scope, opaque cursor/historyId, last success, restart_required.
61. oauth_states => ephemeral PKCE states, expiry, scope, session validation.
62. audit_events => actor, action, object, before/after redacted, time, correlation ID.
63. api_idempotency_keys => actor, endpoint, request hash, response, expiry.
64. settings_and_feature_flags => scoped config, enabled and last validated.
65. backup_runs => state, checksum, target, started, finished, restore test reference.
66. automation_rules => conditional triggers, frequency, actions and safe execution policy.

Ensure referential integrity: do not cascade-delete historical publication evidence on file changes; do not expose organization A data to organization B. Prevent many-to-many exploding counts. Define needed indexes on org/brand/status/date, normalized path, hash, external provider ID, due date, sync status and full text. Add migrations and real integration tests for constraints.

## 7. REQUIRED API AND EVENT CONTRACTS

All REST endpoints use `/api/v1`, JSON with Zod validation, pagination cursor/limit, safe sorting/filter whitelist, OAuth/CSRF/session protection, consistent `{data,meta,error}` and stable errors, typed OpenAPI published at authenticated `/api/docs`. GET never mutates. Idempotency-Key on side-effect creation endpoints. Validate org access and ownership per handler. Return explicit provenance with imported data.

Auth/organization: `/auth/login|logout|me|reset`, `/organizations`, `/brands`, `/channels`, `/social-accounts`, `/users`, `/settings`.
Ideas/projects: `/ideas`, `/ideas/:id/convert`, `/projects`, `/projects/:id`, `/projects/:id/scenes`, `/projects/:id/checklist`, `/projects/:id/generation-jobs`, `/projects/:id/status-events`, `/songs`.
Storage: `/devices`, `/devices/pairing-codes`, `/devices/:id/heartbeat`, `/devices/:id/revoke`, `/storage-roots`, `/storage-roots/:id/scan`, `/storage-roots/:id/reconcile`, `/scan-runs`, `/agents/ingest` (signed device auth), `/files`, `/files/:id`, `/files/:id/copy-path`, `/files/:id/preview`, `/files/:id/stream` (range, auth), `/media-objects`, `/assets`, `/assets/:id/versions`, `/assets/:id/file-locations`, `/duplicates`, `/duplicates/:id/review`, `/media-match-suggestions`.
Publishing: `/distribution-variants`, `/publication-targets`, `/publications`, `/publications/:id/verify`, `/publications/:id/status-events`, `/schedules`, `/platform-accounts/:id/sync`, `/publishing/matrix`, `/publishing/calendar`.
CRM: `/external-organizations`, `/contacts`, `/conversations`, `/conversations/:id/messages`, `/inbox/triage`, `/opportunities`, `/deals`, `/deals/:id/deliverables`, `/deals/:id/contracts`, `/invoices`, `/payments`, `/expenses`, `/follow-ups`, `/crm/pipeline`.
Todo/notification: `/actions`, `/actions/:id/link-task`, `/todo/connections`, `/todo/sync`, `/todo/conflicts`, `/notifications`, `/notifications/preferences`, `/briefing/today`.
Analytics/integrations/admin: `/search`, `/analytics`, `/analytics/snapshots`, `/goals`, `/integrations`, `/integrations/:provider/connect`, `/integrations/:provider/callback`, `/integrations/:provider/status`, `/integrations/:provider/sync`, `/jobs`, `/audit`, `/backup`, `/restore` (admin and explicit action only), `/health/live`, `/health/ready`.

Required webhooks/events (signed, timestamp checked and replay protected where external sender supports it): `media.file.discovered|updated|missing|restored`, `agent.connected|offline`, `project.scene.completed`, `publication.discovered|status.updated`, `deal.inquiry.detected|reply_required|approval_received`, `invoice.overdue|paid`, `action.created|completed`, `todo.task.updated`, `connector.sync.failed`. Define TypeScript/JSON schema and event version for all. Don't accept unauthenticated arbitrary webhooks.

## 8. CONNECTOR DESIGN AND PLATFORM REALITY

Every integration implements common interface: `getCapabilities`, `connect`, `disconnect`, `refreshCredentials`, `syncIncremental`, `syncFull`, `health`, `rateLimitBudget`, `normalize`, `getExternalRecord` with per-provider permissions and separate read/write capabilities. Capability flags drive UI buttons. Enforce API quotas, token refresh, backoff with jitter, rate limits, idempotency, cursor persistence, webhook replay controls, clock skew tolerance, structured error taxonomy and revoke behavior. A connector unavailable offline MUST not block local CRUD.

Google: OAuth 2.0 with PKCE, exact scopes documented, device/local HTTPS callback design; distinct Gmail and YouTube permissions if needed; safely encrypted refresh tokens and account identifiers, no secrets in git/logs. YouTube import via official Data API; cannot know a local MP4 is the exact uploaded file simply from video title. Reconciliation should suggest matches based on title/date/duration/campaign and require confirmation for uncertain matches. Gmail full & incremental history sync; 404 expired history => full resync. Local polling default; Pub/Sub push optional setup, with acknowledged public-reachability/Google Cloud prerequisites.

Instagram/Meta: real supported professional account/page features depend on developer app/scopes/review; do not promise unrestricted inbox/publishing. TikTok: video.list may list authorized public posts; direct posting requires approved scopes and may be private-only until audit. Snapchat: capability-gated/manual by default. Postiz: optional adapter and read-only sync first, do not override its own scheduling without clear ownership. Todo: generic adapter, inspect actual service for available endpoints before selecting schema. If any connector is unsupported, build manual record/link flows and show truthful status.

Supported manual pathways are first-class functionality, not second-class placeholders: paste post URL, choose account, enter status/date/title; paste collaboration thread or forward content manually; record payment and approval with evidence. All manual records carry USER_ENTERED provenance and an edit trail.

## 9. ACTION ENGINE, REMINDERS, ALERTS, NOTIFICATIONS

Event-driven rule evaluation plus periodic scheduler; durable outcomes via queue, dedupe keys, suppression and quiet hours. Default rules should create actionable records for: incoming message not replied to, newly discovered deal untriaged, deliverable due within 7/3/1 days, brand response overdue by configurable SLA, invoice due/overdue, publication scheduled but unverified after grace, video approved but no publication plan, device offline > configured period, scan errors, Todo sync failures. No notification storms: one event per rule/source/window, escalation with sensible cadence. Snooze, dismiss, complete, due date edit, ownership and priority. AI only suggests priority; deterministic stable baseline always works. Scheduler survives server restart; set timezone per user and use DST-safe semantics.

## 10. SECURITY, PRIVACY, RELIABILITY AND OPERATIONS

- Single-user-first, future multi-user safe: authorization on every row/resource; secure session cookies HttpOnly Secure SameSite, CSRF mitigation and rate limiting on auth and mutation; strong password hashing (Argon2id), login throttling. All production traffic via HTTPS (Tailscale Serve / trusted reverse proxy); local HTTP only for explicit development. Trusted proxies configured, secure WebSocket auth.
- Encrypt OAuth refresh tokens, credentials and sensitive messages at rest with managed app encryption key via env/volume external to DB and never committed. No logging secrets, full email bodies, raw tokens, private video paths outside privileged logs. Prepared SQL/ORM, secure header/CSP, MIME validation, bounded uploads and zip-bomb/path traversal protection, private media access signed and expires.
- Agent pairing scoped and revocable; least-privilege read-only filesystem ACL for scanner accounts; mount NAS read-only. Beware Windows services running under LocalSystem may lack network share access; provide documented service account or credential procedure without persisting plain SMB passwords in app database.
- DB migrations automatic via explicit migration job with safety backup before destructive schema upgrades; no destructive startup reset. Transactions for state changes and outbox for emitted integration events; background job retry and dead-letter view. UTC storage plus user IANA timezone.
- Secure installation: Docker Compose with named volumes, healthchecks, restart policies, resource limits, log rotation, explicit ports bound to loopback where appropriate. A backup job exports compressed, checksum-verified PostgreSQL dump and configuration/reference manifest (NOT multi-TB originals by default); documented off-machine copy/retention, restore dry run and actual recovery. Note original media remains on PCs and needs separate storage backup strategy—RAID alone is not a backup.
- Health page includes DB, Redis, workers, scanner agents, mount status, queue backlog, OAuth expiration, last sync and backups. Observability: structured JSON logs/correlation IDs, alerts not swallowed. Avoid personally identifying details in logs; user can export diagnostics.
- Offline PWA: service worker precaches shell, safe previously viewed metadata; clear offline banners, queued offline mutations only when safe and designed idempotently, no false confirmation of syncing; installable over HTTPS and manifest/icons, touch friendly mobile UI. No assumption that mobile PWA can scan phone filesystem.

## 11. EXACT TEST STRATEGY / ACCEPTANCE SCENARIOS

Create automated tests plus manual acceptance checklist. CI runs lint, formatter check, TS compile, Go build/test, DB migrations, unit, integration, Playwright smoke, dependency vulnerability/basic secrets scan, Docker Compose config check. Use fixture library containing a short generated test video, audio, image, hidden files, duplicates with distinct paths, filename collisions, corrupted/truncated file, late-written growing file, path with spaces/Unicode, same content different filenames, similar re-encode different bytes, symlink/junction case where test environment supports it. Synthetic fixture data labeled DEMO and removable; do not claim fixture counts are user's actual content.

Critical cases:
T01 First-run wizard works from clean database and blank storage.
T02 Add 3+ scan roots across 2 simulated or actual device IDs and NAS test root; recursive browse and filters work.
T03 Device A and device B report distinct files; accurate displayPath and OS-specific paths retained.
T04 Exact hash match across machines yields one verified media object and two physical file locations.
T05 Two different files with same name remain distinct.
T06 Fast sampled hash match without full hash does NOT assert exact duplicate.
T07 Partially written file is delayed until stable; generated output becomes indexed after settle.
T08 Offline device remains in inventory with last-seen; isn't marked missing/deleted.
T09 Complete successful rescan can mark missing after grace; unavailable root cannot.
T10 Rename/move with reliable identity preserves logical history; otherwise suggests relink, never corrupts data.
T11 Agent reconnect transmits queued observations exactly once logically; replay idempotent.
T12 Unauthorized agent cannot index roots outside grant or stream arbitrary server files.
T13 Media preview supports seeking/range; offline thumbnail fallback clearly labeled.
T14 One logical video with four social publications counts 1 asset and 4 publications.
T15 Pasted social link creates USER_ENTERED record, not VERIFIED_PLATFORM.
T16 YouTube imported post with no confirmed local match remains unattached pending review.
T17 Multiple social accounts across Mehak and travel channel remain logically separate.
T18 Idea converts to production plan; clip states and selected final update project progress.
T19 New opportunity from manual/Gmail fixture produces triage item; unrelated email can be dismissed.
T20 Duplicate Gmail/thread event produces no duplicate opportunity/message.
T21 Deal with three deliverables tracks partial approvals and publication independently.
T22 Unanswered inbound message generates one follow-up action with snooze and due date.
T23 Invoice partially paid still shows correct outstanding balance.
T24 Creator action produces Todo sync request using stable idempotency key; retries don't duplicate remote task.
T25 Todo completion reconciles correctly without overwriting unrelated Creator OS fields.
T26 When Todo offline, task sync is pending and locally visible; never displays 'synced'.
T27 Unauthorized viewer cannot access private CRM/email/media/agent tokens.
T28 Mobile 360px PWA displays usable actions, forms, modals and filters; install/offline state verified.
T29 DST/timezone due dates and publications render correctly in America/Vancouver.
T30 Backup then restore in disposable test environment preserves project/deal/asset/post relationships.
T31 Restart all containers => same data; queue jobs recover.
T32 Provider connector disabled/no tokens => core app remains operational; setup instructions accurate.
T33 Browser E2E journey: import sample files -> associate song -> approve clip -> publish manually to 2 platforms -> link deal deliverable -> invoice -> todo followup -> see dashboard.
T34 Failure injection: a root permissions issue, API 429, Redis restart and stale Gmail cursor produce recoverable, visible states.
T35 Count SQL prevents multiplying outputs by joining file_instances x publication_records x deliverables.

## 12. IMPLEMENTATION SEQUENCE — BUILD, RUN, VERIFY, THEN ADVANCE

Milestone M0 Foundation: inspect repo (if existing do not erase), choose versions with compatibility, create monorepo, config, lint/prettier, typed API/auth, DB/migrations, Docker Compose, dev/test scripts, healthy landing/setup wizard. Prove `docker compose up -d --build` starts with persistence and login.
M1 Multi-machine storage CORE: agent enrollment, multi-root configs, first scan, scan-run progress, file identity/hash/metadata, instance location UI, offline semantics, dedupe, preview and search. Prove T02-T13 and T35 before proceeding.
M2 Content + production: brands/channels/social accounts, ideas/projects/scenes, versions/selected finals, checklists, dashboard + daily priorities and search. Prove T14/T17/T18.
M3 Publishing + calendar: platform matrix, manual post links, per-account captions, scheduled dates, readiness and statuses, dashboard holes; import YouTube via connector with mock tests and real connect wizard. Prove T14-16.
M4 Collaboration + message intake: CRM contacts/opportunities/deals/deliverables, conversations/manual import, invoice/payment, inbox & reminders. Gmail connector with setup wizard and mock tests; prove T19-T23.
M5 Todo synchronization + notifications: adapter interface, config, task links, idempotency/retries/reconciliation, default action queue, notifications; prove T24-T26 and T29.
M6 Social connectors + optional Postiz + deeper reports: implement only supported capabilities based on current developer documentation; show blockers/approval prerequisites clearly; real analytics snapshot where credentials permit; comprehensive settings.
M7 Hardening: access control, backup/restore, security, mobile/PWA usability, install docs, CI, Playwright journeys, diagnostics, performance benchmarks, final checklist and proof.

Do NOT postpone critical scanners, CRM or manual publishing until after optional AI. Every milestone ends with executable tests, screenshots or test artifacts if supported, and an updated implementation ledger. If a tool session ends, commit the working changes and leave precise next commands/checkpoint for resumption. Avoid perpetual refactoring instead of delivering end-to-end flows.

## 13. DEVELOPER EXPERIENCE, DOCUMENTS, OPERATIONS CHECKLIST

Required scripts: `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm db:migrate`, `pnpm db:seed:demo`, `pnpm check`; Go `go test ./...`, cross-compile, service installer; `docker compose up -d --build`, `docker compose ps`, migration, backup, restore and health diagnostics. Commands can be mapped via root scripts and documented exact working directories. Document Node/Go version and Windows Docker Desktop/WSL2 prerequisites. Include `.env.example` with explanation and safe defaults; never commit secrets. `README.md` must enable setup by a technically capable owner without guessing.

Deliver: (a) functioning app and compiled/publishable scanner binary or source+reproducible build scripts, (b) OpenAPI/Swagger docs, (c) ER diagram in Mermaid, (d) system diagram in Mermaid, (e) example `docker-compose.yml`, (f) example scanner root/path configuration for the 12GB and 24GB Windows PCs and an SMB/NAS path mapping, (g) Todo adapter contract and integration setup, (h) Gmail/YouTube setup with scopes and OAuth callback, (i) backup/restore operations, (j) troubleshooting FAQ for Windows shares/Tailscale/Docker mounts, (k) fixtures/tests/evidence, (l) FEATURES.md with enabled/limited/unavailable, (m) `docs/IMPLEMENTATION_PROGRESS.md` and `docs/EXTERNAL_PREREQUISITES.md` with exact pending real-world steps.

Example environment vars (adapt to chosen technology, ensure documented): `APP_BASE_URL`, `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `AGENT_PAIRING_SECRET`, `MEDIA_PREVIEW_CACHE_DIR`, `MEDIA_PREVIEW_MAX_GB`, `LOG_LEVEL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (if confidential-app flow appropriate), `GOOGLE_REDIRECT_URI`, `TODO_BASE_URL`, `TODO_API_TOKEN`, `POSTIZ_BASE_URL`, `POSTIZ_API_KEY`. Never paste actual credentials into generated files; OAuth flow implementation must match the selected Google client type and registered URLs. Default timezone America/Vancouver, display currency CAD, optional deal currency USD etc.

State and performance budgets: 10,000-100,000 indexed file instances, 2+ Windows agents + future NAS, paginated tables/search, asynchronous scans with bounded CPU/IO, preview LRU cache, no DB N+1 on library, API list endpoints target responsive performance with indexes, chunking of large ingests, graceful stop/resume. Provide capacity testing scripts; do not claim benchmark results without running.

## 14. FINISH-LINE VALIDATION AND REPORT FORMAT

Before concluding the implementation, actually execute and capture exit code of: installation, build, typecheck, lint, migrations, unit and integration tests, Go agent tests/build, Docker Compose up and health, at least the critical Playwright flows, backup/restore test. If host cannot run Docker/browser/Windows Service, say 'not executed on this environment', provide the command and expected output, and do not mark it passed. Prefer fix failures over citing them. In final report give: working URL(s)/ports in deployment instructions, exact features implemented, what was live-tested, what's connection-ready but needs OAuth/review, unsupported items and why, known bugs, health checks, setup sequence for owner, agent installation on both PCs, backup location/restore procedure, evidence of no deletion of originals, and short next action for owner. A checklist checked solely from code inspection is insufficient evidence.

## 15. PROVIDER DOCUMENTATION TO VERIFY WHEN IMPLEMENTING

Up-to-date primary docs; recheck latest on execution date and gate behavior by granted capabilities:
- Claude project instructions: https://code.claude.com/docs/en/memory
- Cursor project rules: https://cursor.com/docs/rules
- YouTube channel uploads and playlist items: https://developers.google.com/youtube/v3/docs/playlistItems/list
- Gmail incremental sync: https://developers.google.com/workspace/gmail/api/guides/sync
- Gmail push prerequisites: https://developers.google.com/workspace/gmail/api/guides/push
- TikTok Display API list: https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list
- TikTok direct post approval/audit: https://developers.tiktok.com/docs/en/content-posting-api-get-started
- Official Meta / Instagram docs for the particular authorized account type; do not assume unrestricted DMs.
- Postiz documentation for the actually installed version before writing an adapter.

## 16. PRIORITY PRINCIPLE FOR THE WHOLE BUILD

Build an accurate, robust private operating system that eliminates manual memory burden. A user must be able to open Creator OS and answer: What assets are ready? How many exact originals/copies exist? Which PC has this MP4? Which video has not been published to Instagram? Which brand inquiry needs a reply today? What deliverable is due? Which invoice is unpaid? What should I work on next? If any of these core questions cannot be answered from working screens backed by tested data, the product is not finished.


## CURSOR RESUME AND RELEASE INSTRUCTION
Before any new Agent session, read `docs/PRODUCT_SPEC.md`, `docs/IMPLEMENTATION_PROGRESS.md`, `FEATURES.md`, and project rules. Continue the first unfinished acceptance test. Do not interpret a visually polished dashboard as completion. The release requires verified CRUD, multi-device index, publishing matrix, CRM, Todo adapter, honest connector gates, migrations, backup/restore and user onboarding.

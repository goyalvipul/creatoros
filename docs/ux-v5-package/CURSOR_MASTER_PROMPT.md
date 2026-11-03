# CREATOROS v5 — CURSOR MASTER IMPLEMENTATION DIRECTIVE

**Status:** Approved UX direction; **implementation is gated by discovery and feature-parity approval**.  
**Revision:** 2026-11-03  
**Working project:** Existing CreatorOS monorepo; do not create a new application.  
**Preferred reference:** `creatoros-preview.html` (a stand-alone, illustrative v5 interaction prototype, NOT production code).  
**Primary objective:** Deliver the CreatorOS v5 experience while preserving every existing **visible, nested, external, background, security, data, file, and PWA capability**.

> **READ THIS ENTIRE DOCUMENT BEFORE DOING ANYTHING.**
>
> **Do not assume the mockup is the specification of functionality. The deployed source code, data contracts, existing tests, and observed behavior are the source of truth.**
>
> No feature may be silently dropped because it is hard to redesign, absent from a screenshot, not yet connected to a provider, rarely used, or hidden in a modal or background job.
>
> This is an **interface and navigation modernization**. It is not authorization to rewrite backends, migrate schemas, change permissions, change account connections, change worker/job payloads, modify publishing/sending behavior, or install a new technology stack.

## A. HOW TO OPERATE AS CURSOR

You are the lead product UX engineer, senior frontend architect, accessibility lead, test engineer, and release-safety reviewer working in the **existing** CreatorOS repository. Work with strong evidence, no invented APIs, no unverified claims, and no mock-only pages in production.

**Execution policy:**

1. Start with **Phase 0: read-only discovery**. Inspect code, configs, tests, docs, and current routes. Writing *audit documentation under `docs/ux-v5/` only* is permitted; no app changes in Phase 0.
2. Produce a **complete inventory, behavior map, risk register, and migration plan** with direct source-file references, call chains and test evidence.
3. **STOP for my approval** of the Phase 0 report and the final navigation / screen-to-feature mapping. Do not begin app implementation until I explicitly say **`APPROVE V5 IMPLEMENTATION PHASE 1`**.
4. Once approved, implement **one small phase at a time** behind an opt-in feature flag. Run tests after each phase. Stop at every defined gate and report the measured results before asking for the next phase.
5. **Do not deploy to my live domain or restart production services** until I separately and explicitly authorize it. Local/staging verification is expected; never point destructive or externally sending tests at live accounts.
6. If you cannot prove preservation of a function, **retain its original UI path and component** and list the gap. It is better to ship a partly modernized but fully functioning UI than a gorgeous broken application.
7. Do not erase my working-tree changes. Inspect `git status` first. If the tree is dirty, report it, create a non-destructive snapshot/patch as appropriate, and ask before operations that might overwrite or stash changes. Never use `git reset --hard`, `git clean -fd`, force push, or delete state without explicit approval.
8. **Never reveal credentials**. Do not print `.env`, token values, API keys, session cookies, email content, private media paths, or finance records in status reports or test logs. Inspect configuration structure without leaking secret values.
9. Do not claim any test passed unless it was actually run; show command, result and limits. Distinguish **code present**, **mock-tested**, **integration-tested**, **user-confirmed operational**, and **currently verified on a live-safe path**.
10. Favor the repository's existing frameworks and components over introducing new UI libraries. Any dependency addition needs reason, bundle/capability impact, compatibility review, and approval.

### What I have already confirmed

- Existing CreatorOS has a **pnpm monorepo** with a custom development launcher: `pnpm dev` calls `node infra/scripts/dev.mjs`; package scripts include `build`, `lint`, `typecheck`, unit/integration/e2e test commands, diagnostics and backup commands. **Verify the actual current repo**; this description came from an earlier snapshot.
- **LTX has been tested and is currently running in the user's real system.** Preserve the known-good LTX execution path exactly. Do not characterize it as an unimplemented demo based on older written notes. Confirm current behavior safely; no unnecessary generation test that spends GPU resources or changes files without permission.
- Current application includes the existing 16 top-level destinations `/`, `/today`, `/content`, `/production`, `/comfy`, `/library`, `/publishing`, `/calendar`, `/collaborations`, `/socials`, `/workflows`, `/analytics`, `/channels`, `/storage`, `/integrations`, `/settings`; **verify routes in source** and preserve deep links.
- Existing PWA is installable with offline draft behavior and its own update/cache lifecycle. Treat it as a real deployed client, not a responsive afterthought.
- Uploaded documents describing functionality and background jobs (if provided in the Cursor workspace) are baseline coverage leads. **Code wins when documentation is stale, but surface discrepancies rather than silently resolving them.**

## B. THE V5 DESIGN WE ARE BUILDING

**Design principle: Work-centered, context-preserving, full-workspace navigation.** A main sidebar destination always opens a dedicated workspace. Use drawers only for genuinely quick, limited-scope actions—not for Publishing, Collaborations, Studio, Library, Workflows, or any other major application feature.

**Visual treatment:** warm ivory / stone management canvas; readable high-contrast surfaces; evergreen/graphite accents; restrained terracotta/coral primary action; charcoal media Studio; minimal status colors. No purple-heavy dashboard reskin. Design tokens, contrast and interaction consistency are more important than exact color hex values.

**Primary workspaces:**

- **Today:** actionable priorities, unfinished work, upcoming publishing, decisions, payment follow-ups, worker alerts. Links land directly on source records.
- **Inbox & Tasks:** To do / Snoozed / Recently done; notifications and Todo conflict resolution; distinct from notifications history.
- **Content:** independent, flexible, somewhat messy brainstorming workbench with ideas/notes/links/tags/templates. **Never auto-convert an idea into a project**; an explicit user conversion keeps the backlink.
- **Production:** visual Kanban plus list view; projects, stage gates, scenes, versions, final approval, deliverables, decisions, and attached media.
- **Create Studio:** full-screen professional LTX, MiniMax H3 and Audio/Qwen experience, with History, Settings and advanced ComfyUI access. Preserve manual Generate, exact existing payloads and worker-specific uploads.
- **Library:** Assets / Files / Duplicates as distinct first-class views; visual grid and table; preview, copy path, link, upload/download, device/location/availability states, safety-confirmed operations.
- **Publishing:** dedicated, fully navigable workspace: Compose, Matrix/Plan, Queue, Calendar, Published, Imported/Unmatched, platform variations and status. NOT a narrow side drawer.
- **Calendar:** month/week/agenda where supported, project and business dates, platform scheduling, drag/reschedule collision handling.
- **Collaborations / Business:** full workspace: mailbox inbox, lead triage, pipeline, deals, partners, deliverables, invoices, partial payments, expenses, personal taxes, receipts and exchange-rate visibility.
- **Socials / Community:** unified inbox, comments, DMs according to approved APIs, account-specific views, leads, trends, scheduled content, reply drafting/approvals.
- **Workflows / Automations:** rules, editor, templates, test/simulation, per-account opt-ins, approval queue, kill switch, execution history; no changed sending semantics.
- **Analytics:** actual available metrics, goals, manual-vs-verified provenance, time-range/account/brand filters, CSV export; no fabricated series or performance numbers.
- **Channels, Storage & Devices, Integrations, Settings/System:** organized but fully reachable; every existing control and status remains available.
- **Notifications / Activity:** full-page attention center, with concise bell preview, distinguishes critical vs actionable vs FYI vs background logs. If the current backend does not expose a desired notification action, label it **new enhancement** and gate it.

**Navigation requirements:**

- Sidebar has predictable full-page links, grouped if needed, persistent active state, visible frequently used tools, pinning or favorites if implementation is feasible. Avoid burying essential capabilities inside `More` on desktop.
- Compact, safe quick-add menu supports current actions; it is not a replacement for full workspaces.
- Project context can persist across Production → Studio → Library → Publishing by explicit URL state / stable IDs / existing data relationships. No repeated project/file lookup where it can be carried forward.
- Global operations remain global: publish a file without creating a project; handle an email without inventing a deal; add a task without a project; browse/download independently of production.
- Do not merge Content, Production, or Collaboration into one indistinct module.
- Use distinct UX for busy dense tables (payments, statuses, publishing matrix) and media-rich screens (Library, Studio); do not turn everything into oversized cards.
- Preserve keyboard command palette and deep links. Browser back/forward should work, filters/shareable route state where appropriate, unsaved changes guarded.
- All destructive, outward, financial, sensitive, or worker-execution operations have explicit, accessible confirmation only where currently required; never weaken safeguards.

### Reference prototype and limitations

The provided `creatoros-preview.html` or `CreatorOS_Flow_v5_Interactive_Experience.html` represents the approved **interaction direction**, not a drop-in UI or a complete list of capabilities. **Do not copy its invented data, simulated results, assumptions or self-contained JS into the production app.** Adapt layout and motion to the current components and state architecture. The prototype does not authorize new API behavior.

## C. PHASE 0 — DISCOVERY WITHOUT TOUCHING RUNNING FUNCTIONALITY

### C1. Inventory sources

Read at minimum:

- Repo orientation: `README.md`, `FEATURES.md`, `AGENTS.md`, `CLAUDE.md`, `docs/`, including `docs/TEST_MATRIX.md` if present, previous UX proposals and feature specs.
- Monorepo: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `apps/`, `packages/`, `infra/`, Docker Compose and deployment descriptions.
- Every frontend route/component, navigation/menu, hidden tab, dialog, input, validation, keyboard shortcut, notification/toast, upload/download link and status badge.
- Every backend controller/endpoint, OpenAPI spec, middleware, permission gate, DB model/relation, worker queue/scheduler, webhook, service, scanner agent, retry/compensation process and external API connector.
- PWA manifest, icon references, service-worker registration, cache strategies, offline local drafts and sync/recovery logic.
- Current tests: unit, integration, E2E, agent/worker tests. Identify missing tests.
- Git changes and deployment topology, but **do not display secrets or start production-altering processes**.

Do **not** run live migrations, send mail, post content, disconnect accounts, trigger live automation, regenerate GPU clips, revoke access, delete files, run destructive restore, or launch an aggressive scanner as part of Phase 0. Read-only code/static analysis and safe status checks only.

### C2. Trace **every function** end to end

For EVERY action in EVERY route, nested tab, modal, dropdown, context menu, keyboard shortcut, mobile-only action and notification link, identify:

`feature_id | module | current route | nested view | exact control label | role | UI component/file:line | state/store | handler/file:line | API endpoint | permission/scope | request validation | database changes | worker/queue/agent side effects | notification behavior | success/error/loading/offline state | known limitations | existing tests | verification class | v5 destination | regression test | risk owner`

Don't settle for "the page exists". An Upload button and an original-file Download button are **separate features** even if they share a card. The same feature in five contexts (e.g., Download from History, Library file list, file detail, asset detail, Publishing) needs **five entry-point checks**.

Inventory external capabilities, hidden asynchronous behavior, internal operations and user-facing controls. Follow API call graphs and worker consumers. Search references for each route, operation and model. Verify feature flags, environment-dependent behavior, provider-specific code paths, user role switches and authorization checks. Provide source pointers, not guesses.

### C3. Assign truth and risk labels

- `WORKING_USER_CONFIRMED` — reported operational by the owner (e.g. LTX; verify without spending GPU unexpectedly).
- `LIVE_SAFE_VERIFIED` — verified in a safe, non-destructive environment or via read-only checks.
- `INTEGRATION_TESTED` — tests run against controlled integration/staging.
- `MOCK_TESTED` — emulated provider/API only.
- `IMPLEMENTED_UNVERIFIED` — source exists, result not validated.
- `REQUIRES_EXTERNAL_SETUP` — correct UI should show missing credentials/permissions, not fake availability.
- `DOCUMENTED_ONLY` — mentioned but no implementation found.
- `PROPOSED_ENHANCEMENT` — not part of existing functionality.

If docs, source and runtime disagree, capture **all three statements** and give a resolution recommendation. Never downgrade the user's confirmed LTX capability based on an older document.

### C4. Functional preservation matrix must be exhaustive

Require mapping at these levels:

- route → nested tab → subview → component → action → side effect → permissions → notifications → PWA counterpart;
- background job → trigger/cadence → inputs → output/status → idempotency → retries → UI surfaces → health/alert view;
- data entity → relationships → create/update/delete/archive rules → linked media, tasks and approvals;
- connector → capability/permission → sync/status → token expiry → failure/reconnect → user-visible limits;
- file operation → source/target worker/transport → original bytes vs preview → online/offline restrictions → confirmation/recovery.

**Completeness criterion:** 100% of discovered existing controls and behaviors must have a documented destination (new v5 route, preserved legacy route/component, or shared accessible action). No "probably unused" omissions.

### C5. Discover all UI states

Test/design each of: populated, empty, 1-item, dense/large dataset, loading, unavailable provider, expired OAuth, offline agent, file missing-but-not-deleted, partial operation failure, duplicate detection hint, insufficient role, async pending, job cancelled/failed, draft unsynced, unsaved edits, retry and archived/voided record.

### C6. Baseline evidence & test blueprint

- Baseline screenshots and accessibility snapshot for representative desktop and mobile/PWA sizes, from safe data or sanitized fixtures.
- Compile navigation table, data contract list, backend API call graph, background-schedule map and role matrix.
- Record current test commands **without mutating live data**; create deterministic fixtures/mocks for outward actions.
- Identify integration safety boundaries and rollback/backup preconditions; verify backup strategy covers database and small attachments, and note media and encryption key are separate.
- Provide current route list and backward-compatible URL strategy.
- Document performance baselines if measurable and the exact environment.

### C7. Required Phase 0 deliverables

Create documentation only, in `docs/ux-v5/`:

1. `00_EXECUTIVE_AUDIT.md` — architecture, what is working, user-reported status, external dependencies, missing verification, stop risks.
2. `01_ALL_FEATURES_AND_ENTRYPOINTS.csv` — one row per interactive action or entry point, not one per screen; source pointers required.
3. `02_BACKGROUND_JOBS_AND_EVENTS.md` — schedules, webhook, polling, idempotency, failures, recovery, outbound risk.
4. `03_DATA_API_AND_PERMISSION_CONTRACTS.md` — API handlers, entities, roles, credential boundaries, statuses and integrity rules.
5. `04_CURRENT_TO_V5_ROUTE_MAPPING.md` — **every existing route, tab, modal, menu and action** mapped to exact v5 place.
6. `05_PWA_AND_OFFLINE_BASELINE.md` — manifest, service worker, caching, offline drafts, installed app, notification/navigation, mobile file behaviors.
7. `06_ACCEPTANCE_AND_REGRESSION_MATRIX.md` — executable tests and safe fixtures for every sensitive behavior.
8. `07_DESIGN_SYSTEM_AND_INTERACTION_SPEC.md` — desktop/mobile composition, colors/tokens, focus, typography, components, navigation and all states.
9. `08_RISK_REGISTER_AND_ROLLBACK.md` — feature flag, backup, no-downtime considerations, service-worker rollback, production gate.
10. `09_PHASED_IMPLEMENTATION_PLAN.md` — small file-by-file tasks, dependency order, verification, owner approval points.
11. `10_DISCREPANCIES_AND_PROPOSED_ENHANCEMENTS.md` — separate old-doc discrepancies from new requested features.

**Phase 0 stop message:** Show a summary table of audited routes / tabs / action counts / scheduler counts / covered tests, list unknowns and blockers, show proposed nav, and **STOP**. Do not write application UI code until I reply with the exact implementation approval phrase.

---
## D. REQUIRED FEATURE COVERAGE — DO NOT REDUCE THIS TO A SCREENSHOT INVENTORY

The following is a **minimum** checklist derived from prior CreatorOS capability documentation and actual screenshots. It is not exhaustive: **discover every additional real function in source**. Number individual capabilities in the CSV and assign acceptance tests. Never confuse the mockup's simulated behavior with a production feature.

### D1. Home / Today / global navigation

- Personalized overview, brand filter, daily priorities and **why each is prioritized**; top-three actions and source record links.
- Counts for ideas, production, ready assets, unposted targets, upcoming/scheduled/published posts, open inquiries, replies needed, invoice balances and blockers.
- Recently active projects, upcoming releases, recent indexed files, campaign deadlines, scan/storage warnings and device availability.
- Quick add for idea, song, project, brand, deal, follow-up/action, publication and folder (verify actual offered items, handlers, permissions).
- Global command-palette search (`Ctrl`/`Cmd+K`) across assets/projects/brands/posts/contacts; preserve search semantics, keyboard focus and deep links.
- Inbox/Today **To do**, **Snoozed**, **Recently done**; snooze, complete, due date, pin, dismiss as available; internal action queue and Todo linked-task state.
- Todo sync pending, synced, conflict, failed, dead-letter, retry/resolve. Do not show pending items as synced or override the Todo source of truth silently.
- Distinguish *notification*, *actionable task*, *approval*, *job execution log*, *finance follow-up*, and *critical system failure*. Bell preview + complete Notifications/Activity view.
- Quiet hours and exception behavior for critical backup/restore failures. Notice source, timestamp, affected entity, safe next action, status and direct link.
- Preserve all role restrictions and alert redaction; do not expose private CRM/email/finance/media to unauthorized roles via search, previews or notifications.

### D2. Content — intentionally independent creativity space

- Idea capture quick-add and full editor; unsaved writing restoration, existing rich text, formatting, dictation if available, draft persistence.
- Freeform messy ideas, notes, partial lyrics, links, hooks, observations, brainstorm fragments; no required project structure during exploration.
- Existing fields: format, genre, content pillar, audience, language, channel, score, effort, priority, tags, status, brand, title, concept, link; verify actual schema and validations.
- Idea inbox/list, full search, status and brand filters, sorting, template support and favorites if existing; do not invent persisted board columns without approval.
- Templates for song/music single, lyric video, Short/Reel, behind-the-scenes and others, associated editable checklists.
- **Explicit** Convert to Project action preserves idea ID, backlink, selected template and existing attributes; original content still retrievable.
- Conversion preview/confirmation and prevention of accidental duplicate conversion; determine current semantics from code.
- Embedded assets or reference material if existing must remain accessible, including upload/download/copy path where applicable.
- PWA offline-started drafts and unsynced indicators must survive refresh/foreground/reconnect.

### D3. Production / project lifecycle

- Brand hierarchy, project types (song, campaign, travel and other), owner, dates, brief, notes, decisions, shot list and history.
- Kanban stages and **drag-to-change stage**; also accessible keyboard alternative. Preserve exact stage IDs/transitions, any archived stage and stage gating.
- Required checklists block `Ready` / `Published` where existing; an explicit override records who/when/why. Never weaken the gate.
- Scenes, clips, scene statuses, generated versions, selected/approved final; file existence alone is **not** final approval.
- Attach indexed files/assets, provenance, multiple files per asset, multiple post variants per asset; retain one-to-many relationships and no duplicate inflation.
- Project links to Content idea, collaboration email thread, deal/deliverables, Todo item, generation job, asset and publication where current backend supports it.
- Preserve file original location and worker availability; no automatic moving originals into central storage.
- One prominent `Continue work` action should resume the appropriate existing activity, not open an arbitrary generic project page.
- Desktop: strong project overview with contextual tabs; mobile: readable full project screen; existing advanced project details remain one easy action away.

### D4. Create Studio / ComfyUI / GPU / LTX / H3 / audio

- Existing **working LTX** flow: selected project, worker (24GB RTX 3090 / 12GB RTX 3060), library starting image or upload to selected PC, song/audio, trim start, duration, resolution chart, width, height, FPS, LoRA file/strength, upscale settings and any other actual workflow inputs.
- Existing **MiniMax H3** flow: segment timelines (up to 8 documented), images/audio/prompts/durations/timing and ordering; preserve serialization, per-segment validation and output handling.
- Audio/Qwen voice clone: referenced audio, text or other workflow inputs currently supported, library file reuse, audio job history, output placement; do not claim voice files automatically join publishing if that is not the behavior.
- `LTX`, `Audio`, `MiniMax H3`, `History`, `Settings` subviews remain accessible even if presented as attractive studio tabs. Preserve model-specific advanced fields.
- **Manual Generate only**. No implicit GPU runs when user selects an asset, changes a field, enters a project or opens a page.
- Worker discovery, availability dot, busy/free state, device-specific inputs, permission and online/offline restrictions, validation before submit, job queue, progress, failure/retry, history, logs, cancel if existing.
- Input upload places the file in the **correct selected PC's ComfyUI input folder**; do not substitute a general library upload or store bytes elsewhere without explicit authorization.
- Existing workflow JSON/payload, node mapping, media references, file paths, model/LoRA resolution, auth, output naming, target worker, queue protocol, and job IDs **must remain byte/semantics compatible**.
- Generation output automatically links to the correct Production project and relevant publishing list according to existing job-type rules; audio may have different behavior.
- History playback, original download, resend prior LTX clip into form, link output to project, inspect job metadata and error history.
- Access to PC addresses, named Windows scheduled task status/restart functions *only as the existing constrained operation allows*. **Do not introduce general remote shell capability**.
- Preview-first desktop Studio can have an input panel, media preview, history/timeline and asset inspector; but advanced controls remain accessible without scrolling an unbounded page.
- Mobile Studio can restructure to steps/tabs, but must retain current eligible controls/permissions; offline generation must remain unavailable/unqueued.
- No speculative rerun of LTX to verify a cosmetic change. Test payload equivalence with fixtures/mocks and use a separately authorized worker smoke test only if truly required.

### D5. Library, indexed media, devices and file handling

- Preserve **Assets / Files / Duplicates** as separate meaningful views. Grid/list presentation is optional UI enhancement, not a replacement for the file table.
- Search/filter by name/path/kind/device/availability/project/tags/duplicate groups, sorting/pagination and large-result performance; retain exact result semantics.
- One media object may have several physical locations; duplicate match requires appropriate evidence. Same name different bytes remains distinct.
- Quick signatures are not exact SHA-256 duplicates; near duplicates are **suggestions**, never merged without confirmation.
- Index fields: paths, file size/time/type, duration/resolution/codec/thumbnail where ffmpeg/ffprobe available, file fingerprints, probe-failed indicators.
- Agent read-only scan, multiple machines/folders, SMB/NAS/server path mapping, include/exclude, symlink/junction rules, per-folder scan cadence, stable-file checks, resumable scans, scan progress/history.
- Offline worker and unreachable drive show temporary unavailable + last seen; `missing` only after existing complete-scan/grace semantics. Maintain recent scan and heartbeat context.
- Agent one-time signed pairing; rename/revoke/rotate, folder pause/scan/remove metadata, scanner registration and storage health; never destroy physical media while merely unindexing a folder.
- **Original-file Download** in every current place: Library File list, File page, Asset Files, Publishing linked video and ComfyUI History; preserve bytes, filename, authorization and Range streaming. Host PC must be online.
- **Upload video from Mac/phone** to an online selected PC/scanned folder without recompression or overwriting existing name, if supported by installed scanner build. Show exact target/device, progress, errors, retries; on startup an interrupted `uploading` becomes failed, not silently resumed.
- Additional Studio input upload, new asset creation and link/unlink are distinct flows with distinct destinations and permissions.
- Play/seek browser streamed original via agent; gracefully show offline availability and cached preview if available; do not fabricate working playback.
- Copy local / SMB / server path without leaking in restricted roles.
- Safe, individually confirmed rename/move/delete **one file** only with existing contract; scan itself never moves/deletes. Avoid adding bulk destructive actions unasked.
- Mark file `I uploaded it` manually, link to asset, publishing title, project; preserve source-of-truth and provenance labels.
- PWA Download opens via browser per documented existing behavior; do not break installation context or assume browser/file APIs work identically on all OSs.

### D6. Publishing — full workspace with real feature parity

- Direct sidebar opens **Publishing as full page**, never a right drawer; retain existing `/publishing` and matrix as primary capability.
- Current one-title-per-project structure, media linked to publishing title, variants and account matrix, account columns and per-cell state.
- Media actions: select indexed video, upload from Mac/phone to chosen online worker/scanned folder, link, play, download original, unlink, inspect availability, preview and recover from failure.
- Per-platform/per-account fields: title, captions/descriptions, tags, hashtags, language, type (including video vs Short where applicable), privacy, schedule timezone/time, post URL, approval and required platform-specific fields. **Inspect existing forms to enumerate all fields**.
- Full status progression: not planned, planned, ready, scheduled, submitted, published verified, user-entered, failed, removed, plus any additional actual statuses. Never merge `USER_ENTERED` with `VERIFIED`.
- Scheduling from matrix cell and composer, schedule updates, published history, manual live-post entry/paste URL, matching imported YouTube posts to specific local files and `To match` backlog.
- Provider capabilities accurately shown: YouTube, Instagram, Facebook Pages where authorized and working; Threads/TikTok/API limitations; Postiz optional. Do not imply direct TikTok/Threads publishing without approval.
- Scheduled upload jobs may submit only under **existing confirmed authorization** and host-PC availability; no new background auto-publishing behavior.
- Explicit user confirmation and clear actual-state feedback. Do not create a decorative `Schedule` control that doesn't call the existing handler.
- Project-first pathway can pre-select project/title/file, while global Publish must work on an existing file or manually created post with no project required where current source supports it.
- Views: Compose | Matrix | Queue/Scheduled | Calendar | Published | Imports/To Match, with list/data table where density matters. If a proposed view has no backing read API, retain prior controls and log as enhancement rather than fake it.
- Responsive PWA: full screen compose, file picker and linked downloads, account-specific settings and final confirmation; no side drawer replacing full workspace.

### D7. Calendar

- Project deadlines, collaboration obligations and scheduled/published content in the configured timezone (`America/Vancouver` default) including DST.
- Month and selected-day details; drag-to-reschedule where existing, collision warnings and source-status preservation.
- Additional week/agenda proposed views require source data and must not silently change write semantics.
- Filters by account/brand/platform, direct link to full Publishing or deal/project detail; schedule vs merely planned vs published verified labeling.

### D8. Collaborations, CRM, email, invoices, money and taxes

- Gmail account/mailbox selection; Inbox, Starred, Follow-up, In pipeline, Archived; local star/archive should **not** change Gmail unless explicit existing behavior says otherwise.
- Incoming messages with sender/thread/metadata, local notes, manual pasted thread/link, search, screening and unrelated-mail dismissal.
- Classification of a clear commercial email: high confidence (documented 0.8 threshold; verify current code) can create pipeline opportunity and **exactly one linked Draft Production project per thread**; subsequent email updates existing thread, does not duplicate project.
- Weaker brand mention stays for review. Auto detection **does not create a negotiated deal**, send a reply or approve obligations.
- New deal creation is manual/authorized; opportunity → deal linking, company/contacts, owner, pipeline stages, amount/currency/rights/deliverables/deadlines/approvals/replies.
- Deal delivery status is independent from linked post status; link a post to deliverable once according to current constraints; closing blocked by unpaid invoices where existing.
- Follow-ups for unanswered message/reply SLA, quote pending, deliverable due, approval overdue, reporting due, commission expected, campaign thank-you; one action per source while condition exists.
- Invoices from email text **only, not PDFs** unless actual repository has proven newly added capability; suggestion → human review → confirm; unconfirmed suggestion not a posted invoice.
- Invoice create/edit/delete or void, partial payments, amount paid/received, outstanding, due/overdue, split invoice across deals, no deletion of paid invoice where existing restrictions apply.
- Paid vs confirmed vs draft vs voided distinctions; marking paid uses documented full amount, partial payment uses only recorded amount. Avoid accidental double-counting.
- Business expenses, receipts/image attachment, expense tracking; financial totals paid invoices minus business expenses; **personal taxes excluded** from business earnings.
- Multiple currencies, CAD reporting, explicit FX rate/date/source and missing-rate warnings; **never guess an exchange rate**.
- Email reply only with approved send permission, explicit user Send, no retry after outward send if current contract forbids, correct Gmail identity. Automatic email campaigns/emailers and broader internal-data workflow creation: **discover whether implemented**; otherwise mark as enhancement rather than pretending v5 supports it.
- Full workspace tabs with consistent location and clear hierarchy: Inbox | Pipeline | Deals | Invoices & Money | Expenses | Personal Taxes | Partners. Do not hide money or agreements behind an obscure small drawer.

### D9. Socials / community management

- Unified inbox plus Instagram/Facebook/YouTube/TikTok/Threads-specific statuses and available views; connected accounts remain distinct and permissions honest.
- Instagram DMs/comments/replies, Facebook Pages Messenger/comments, YouTube comments according to live API permissions, sync polling, import freshness.
- Identity-locked replying: send from the **exact account that received** the message, with explicit consent or existing tested approved automation rule; no cross-account accidents.
- `Needs reply`, unread, lead recognition, conversation history, mention status, scheduled content, and `Collaboration leads` views where present.
- Social trends based on already stored messages, `Analyse` trigger, grouped comments and optional creation of **inactive** workflow template; no external replies from merely opening a trend.
- Unavailable APIs such as unapproved TikTok/Threads inbox/posting must show `Not configured` / `Unsupported` / permission limitation, not blank success UI.
- Preserve provider sync intervals, authorization, stale-data indicators and rate-limit/error conditions.

### D10. Workflow automation, approvals and event engine

- Create/import templates, edit rule, ordered canvas, draft-only / approval-required / automatic reply modes, activation, account targeting and status.
- Match types: contains, whole word, exact message, emoji; preserve current matching, precedence, escaping and serialization.
- Simulation/pass-test gate, per-account opt-in, emergency stop, daily cap, per-contact cooldown, failed-run pause, activation/version/audit, approval queue with editable reply before Send.
- User-facing ability to inspect actual workflow runs, why a message matched, whether sent/queued/paused/retried; do not invent execution status if not recorded.
- Automatically received social events may enter webhook/event processing even with no page open; replies still require existing conditions.
- Workflow use cases for internal data creation, emailers, social comments and DM replies: **inventory each supported mechanism separately**. Do not equate social reply rule support with general-purpose automation or mass-email support; design placeholders only as labeled proposed enhancements if unimplemented.
- Emergency stop stays permanently visible/discoverable in Workflows and appropriate attention area; never place it behind a nested hidden modal.

### D11. Analytics, goals, brands and channels

- Actual post and engagement metrics, publication counts, available account and brand breakdowns, trend calculations and time-range filters.
- Clearly distinguish `platform confirmed` / `USER_ENTERED` / `UNKNOWN_SOURCE`; never upgrade provenance or invent figures.
- Goal tracking, top posts, manual figures, exports including CSV; preserve export schema and safe download.
- Brand → channel → account hierarchy, separate account identity, edit/deactivate/archive/reuse names with historical referential integrity; owner-only destructive choices guarded.

### D12. Integrations & credentials

- Gmail multi-account consent/read/write scope separation; YouTube uploads/comments, IG and Facebook Page messages/comments, Todo adapter, Postiz, Threads, TikTok and other current providers.
- Connector states `ACTIVE`, `NOT_CONFIGURED`, `AUTH_EXPIRED`, `UNSUPPORTED` or actual code states; actionable reconnect/consent instructions. Do not claim unavailable features operate.
- Test/sync now/pause/disconnect/enable sending/enable comments as current UI allows, with correct permissions and full error reporting.
- Token renewal, refresh failures and notification linkage; one provider failing must not stop unrelated providers.
- No OAuth scope changes, access-token rotation, rewiring callback URLs or new reauthorization prompts for a cosmetic redesign without explicit approval.

### D13. Storage, scanners and operations

- Worker/agent pairing code, rename/revoke/rotate, supported OS, heartbeat, worker/GPU status, folders, path mapping, scan cadence and history.
- Upload status/retry, scanner pending jobs, online/offline devices, missing media grace period, folder remove safety and worker-specific scheduled task name.
- Health of API, database, queue, workers, scanners, backups, restore tests, failed/dead-letter jobs and diagnostics bundle.
- Nightly backups and restore tests remain operational; settings for alerts, retention and restore status accessible to authorized roles.
- Admin/system actions include security-sensitive controls; exact authorization and audit behavior must be preserved.

### D14. Settings, roles, search, security, PWA

- Workspace name, timezone and currency; Team, Reminders, Security, Backups, Demo data, System and every nested setting.
- Owner / Editor / Viewer role capabilities and redacted data; verify actual access and server-side enforcement. Never rely only on hidden buttons.
- Password policies, lockout, 2FA, session revocation, permitted owner/CLI password reset, CSRF, signed webhook/API contracts and existing audit logs.
- Demo data load/remove only with clear labels, permissions and confirmation; never conflate with real data.
- PWA light/dark preference, installability, offline shell, locally saved draft/unsynced banner and reconnect sync.
- Existing PWA restrictions: generate, publish, pay and destructive file operations **do not queue offline**. Offline draft remains on device until sync confirms it; do not misrepresent it as server saved.
- Mobile bottom navigation can be redesigned, but **every existing screen and function remains reachable** without desktop-only hover or buried controls.

### D15. Outside-facing APIs and less visible capabilities

- Keep `/api/v1`, API docs, signed webhooks, external connector callbacks, scanner/agent protocol, jobs, retry/dead-letter processes and integration contracts unchanged.
- Preserve long-running job behavior when no browser is open, restart idempotency, connection recovery, secret boundaries, error semantics and audit metadata.
- Track transitive dependencies where a UI field drives a worker-side operation: a visual label change must never alter the submitted field name or serialization.
- Preserve keyboard navigation and accessibility for screen readers; consider automated UI traversals, custom hotkeys, browser back/forward and old bookmarked links as interfaces too.
- Use the next section as the exhaustive *initial background inventory*, then discover anything new from source.

---
## E. BACKGROUND / HIDDEN FUNCTIONALITY — NON-NEGOTIABLE CONTRACT

**No UI phase may change scheduler cadence, service ownership, event idempotency, outbound conditions, agent protocol or side effects.** Verify the actual current numbers and behavior against source. The cadence below comes from the user's latest capability document and may differ from previous notes.

| Documented cadence / trigger | Capability to preserve | Required audit question |
|---|---|---|
| Every ~10s | Apply already-received Instagram/Facebook webhook events; potentially evaluate relevant rule | Are receipts deduplicated, source identity preserved, and old imports prevented from firing new workflows? |
| Every ~15s | Submit queued LTX/Audio/MiniMax jobs, poll running jobs, flush signed event outbox | Is job ID stable, exactly-once effect / idempotency preserved, worker status reported, and output correctly linked? |
| 120s without agent heartbeat | Mark scanner offline, **not its files missing** | Does v5 display the distinction and last-seen? |
| Every ~30s | Worker heartbeat | Does the system health UI show stale/active accurately? |
| Every minute | Create/clear follow-up actions, refresh invoice-overdue status, attach finished generation, process confirmed due publishing jobs (documented max 5/pass) | Are user approval and state transitions unchanged? Are follow-ups unique per source? |
| Every ~5min | Gmail sync/classify/triage/auto opportunity/Draft project; Todo push/pull | Is classifier threshold preserved, project deduplicated by thread, and Todo conflict not called synced? |
| Every ~15min | Connected IG, Facebook, YouTube comment imports | Are account isolation, consent, stale records and workflow non-triggering on historic imports preserved? |
| Every ~30min | Upload/stats/provider imports including YouTube and optional Postiz; near-expiry Instagram token renewal | Are token permissions, unlinked imports and verified provenance preserved? |
| Every hour | Preview-cache / expired sign-in / old webhook receipt / old job-row cleanup; analytics snapshot; near-duplicate hints | Are retention and expiry rules unchanged, hints still suggestions? |
| Daily 03:15 America/Vancouver | DB + small attachment backup, checksum, skip if recent valid backup (20h documented) | Are timezone/DST, encryption key exclusion, original-media exclusion and alarms unchanged? |
| Sunday 03:45 America/Vancouver | Restore newest backup to disposable DB and validate | Is failure raised as critical alert, and production DB untouched? |
| Scanner agent ~10s work poll / ~30s heartbeat | Per-PC signed work, default per-folder ~6h scans + Scan now | Are scanner permissions, path rules, stable-file wait, no destructive scanning preserved? |
| Worker startup | Incomplete `uploading` record becomes failed / retryable, not automatically resumed | Does v5 show Retry and correct failure state? |
| Workflow send evaluation | Tested rule + account opt-in + emergency stop off + daily cap + per-contact cooldown; otherwise approval; failure streak pauses workflow | Can v5 never accidentally bypass a gate? |
| On generation completion | One notification with jump to ComfyUI History; project/publishing association where appropriate | Does deep link resolve and avoid duplicate alert? |
| On new collaboration email | Classification, weak-lead review, high-confidence pipeline opportunity + linked Draft project, idempotent by thread | No auto deal, reply, publication or duplicate draft? |
| On invoice email | Text-only suggestion, awaiting explicit confirmation | No PDF magic, no assumed payment or automatic posted invoice? |

Audit all queues, scheduled jobs, webhook consumers, service startup hooks, agents and cron/systemd tasks actually present, even if not listed here. Build a trigger-to-UI diagram and a separate test for each outbound/financial/irreversible effect.

### Follow-up sources that must remain actionable

Unanswered collaboration mail, approaching/failed reply SLA, quote lacking follow-up, deliverable due, approval overdue, report due, invoice due/overdue, expected commission payout, campaign thank-you and scheduled publication still unverified after its grace period. These appear in the current action queue; do not simply replace them with passive bell notifications. Preserve quiet-hours behavior where relevant.

### Outbound safety is more important than visual consistency

Never make an email, social reply, video post, payment, workflow activation, delete, revoke, remote execution or stage-gate override happen automatically just because a redesigned UI collapses steps. Idempotency, duplicate prevention, approval tracking and source identity must hold. No irreversible actions when offline; no tests against live outward accounts without explicit written permission.

## F. EXACT FRONTEND EXPERIENCE SPECIFICATION

### F1. Shared shell and context

- **Desktop:** left navigation rail with clear grouped full-page destinations; search / command palette; persistent contextual breadcrumbs; notifications with unread count; account/brand switch; Quick Add. Keep common `Today`, `Content`, `Production`, `Create Studio`, `Library`, `Publishing`, `Calendar`, `Collaborations`, `Socials`, `Workflows`, `Analytics` reachable with low friction. System/admin tools remain clearly discoverable.
- **Mobile PWA:** 4–5 useful bottom destinations selected based on actual task frequency; full-screen accessible `All Workspaces` hub for overflow. Preserve existing phone quick-access behavior until new mapping is verified. `Publishing` must have a direct, visible mobile path. Avoid a miniature side hamburger for major jobs.
- **Navigation is stable:** a sidebar link always opens a destination; one click does not unpredictably open a drawer. Search results and notifications deep-link to record and preserve back behavior.
- **Navigation context:** project ID, brand, selected asset, selected publish variant can persist through routes using existing IDs/query parameters/route state without reselecting. Protect unsaved drafts and prevent stale entity references.
- **Quick add:** small popover/modal for one short record. A large form follows a direct full-page link (`Open full editor`). Do not create giant scrollable dialogs for Publishing or CRM.
- **Visuals:** professional UI, not template decoration; no invented thumbnails for user's real media. Render real indexed thumbnail when present, safe fallback when unavailable; respect dark/light theme and accessibility.

### F2. Workspaces—critical navigation and continuity tests

**Content → Production:** Stay messy in Content. Select an idea. Review and intentionally convert into Production project. Preserve idea notes and backlink. Project has checklist and stage-gated management.

**Production → Studio:** Choose/Create Studio from project; project is preselected and editable. Keep the worker, reference/media, exact LTX/H3/Audio inputs and manual Generate. After job finishes, offer original/preview, History and Review without losing production context.

**Studio/Library → Publishing:** Clicking `Prepare post` on an authorized output opens **full `/publishing`** with correct video/project/title/account context, visible Upload/Link/Play/Download/Unlink as applicable, account-specific fields and explicit scheduling confirmation. Return to project/asset without losing draft changes.

**Inbox → Collaborations → Draft project → Deal / Invoice:** Open relevant email, show classification, any linked auto-Draft production project, pipeline opportunity and approval limitations. Deal manually created/managed, with linked deliverables, invoice suggestions, partial payment, expenses and follow-ups.

**Today → Task source:** Click urgent item, navigate to exact invoice, conversation, project, job or integration, not a generic page. After action, source-linked task resolves according to current rules.

**Bell → Notifications:** Quick bell preview, `View all` opens full-page attention center with filters (`Needs action`, `Messages & Opportunities`, `Production`, `Systems`, `History`). Existing event records and read states remain correct; proposed notifications require backend evidence.

**Social → Workflows:** Open a comment/DM with the correct account, create draft reply or approved workflow according to permission; test rule, opt in, activate with existing safeguards; keep emergency stop easily available. Do not send on navigation.

### F3. Designs by workspace (interactions, not just visuals)

**Today:** Two-level hierarchy: `Needs decision today` (source records), `Resume work` (projects/jobs), `Ready to publish`, `Business follow-ups`, and minimal health summary. Avoid dozens of KPI boxes. Let user customize section order/visibility only if straightforward and backed by durable preference storage; otherwise document as enhancement.

**Inbox & Tasks:** dense, keyboard-friendly triage list; actions inline with controlled confirmation; source inspector optional; tabs To do/Snoozed/Recently done; filters by urgency and source. Todo sync conflicts visible, not lost in decorative alerts.

**Content:** idea capture-first. Use masonry or list/board based on preference, unrestricted notebook, searchable tags, concept editor. Strong `Convert to Project` action with clear success and backlink; templates are helpful but optional, not forced.

**Production:** Kanban + list option, compact image cards only when actual media exists; stage and checklist progress, due status, owner, latest output, block reasons, safe drag-and-drop and keyboard transition. Project detail has `Overview / Scenes & versions / Assets / Tasks & checklists / Activity / Publish` contextual tabs, with existing controls preserved.

**Studio:** project + input controls in one panel, large preview/output panel, history/timeline panel. Main controls surfaced; expert settings expandable in stable accordion or dedicated Advanced tab. H3 multisegment inputs are persistent; no hidden field loss. Device selection and job status prominent. File upload and original download are named affordances, not generic unbound buttons.

**Library:** media-oriented grid/list switch; file availability, scanner/source machine, filter bar, file detail inspector, original Download + preview distinction. Assets, Files, Duplicates remain first-class top tabs, not collapsed together. Unsafe file operations use existing confirmation.

**Publishing:** Compose/Matrix/Queue/Calendar/Published/To Match in full width. Media selection left, per-platform fields center, true preview right on wide desktop; responsive stacking on mobile. Matrix retains all row/column statuses and actions. Linked video has Play/Download/Unlink. Import/manual link/verified origin unambiguous. Action bar: Save Draft, Schedule/Confirm, Actual Status; respect permissions, online host and service capability. Do not auto-publish when preview changes.

**Calendar:** readable month and day; show dates/contexts rather than huge blank days; a distinct calendar destination remains. No lost drag/reschedule or timezone rules.

**Collaborations:** nested Inbox/Pipeline/Deals/Invoices & Money/Expenses/Personal taxes/Partners all visible in a stable subnav. Inbox may use 3-pane reading layout at desktop because it is contextual message reading, not a global drawer. Pipeline supports stage navigation and blocks. Money uses tables, real totals and uncertainty labeling. Auto-detected opportunities and linked draft projects are explicit.

**Socials:** inbox and channel-specific views, comments, leads, trends, statuses, scheduled list. Correct sender identity visible next to each reply. Do not falsely promise unavailable connector features.

**Workflows:** list, builder/canvas, test/simulation, approvals, audit/history and emergency stop. Keep editor safe and audit trail. Warn clearly before any account-level activation.

**Analytics:** readable verified/manual separated charts, table drilldowns, goals, CSV; show `No data` rather than invented trendline. Make date and account source explicit.

**Channels/Integrations/Devices/Settings:** use progressive disclosure but retain each destructive/configuration control, diagnostics, pairing, sync history, version, backup, permission and state. More compact density, clearer next steps, no hidden system risks.

### F4. UI component contract

Reusable accessible primitives: AppShell, NavGroup, GlobalSearch, CommandPalette, NotificationsCenter, StatusPill, EntityBreadcrumbs, PageToolbar, DataTable, VirtualizedList (only if needed), MediaCard, MediaViewer, FileActions, UploadProgress, ActivityFeed, TaskTriageRow, MultiAccountSelector, PublishingMatrix, PlatformVariantEditor, JobStatus, WorkerPicker, WorkflowRuleEditor, ApprovalDialog, ConfirmationDialog, ErrorBoundary, EmptyState, ConnectionHealthCard, OfflineDraftIndicator, RoleGate, FormErrorSummary, DateTimeWithZone.

Components must call **existing** controllers/services; never duplicate backend logic in the browser. Use shared source-of-truth state and stable typed payloads. Keep error/loading states, keyboard focus restoration, toasts with real outcomes and `aria-live` as appropriate. One main action per screen, other actions nearby—not hidden for beauty.

### F5. Design tokens and accessibility

Define CSS variables / existing theme tokens (do not hardcode across components): warm canvas, surface, elevated surface, borders, primary text, muted text, evergreen/nav, terracotta action, success/warning/danger and dark Studio surfaces. Provide WCAG AA text contrast, minimum sensible hit targets (44 CSS px for mobile primary controls), visible keyboard focus, logical tab order, semantic labeling, no color-only status, reduced-motion support and screen-reader announcements. No horizontal overflow on 360px phones. Support browser zoom at 200% and responsive widths with important actions accessible without hover.

If the current app supports dark theme, preserve it everywhere; warm light management mode is a default, not deletion of dark theme. Respect current stored theme preferences across desktop/PWA.

## G. PWA PROTECTION AND MOBILE ACCEPTANCE

Audit first, then preserve:

1. **Manifest identity and installation:** existing `id`, `scope`, `start_url`, display behavior, icons, name and install route. Never change install identity casually. Verify cached open vs ordinary browser open.
2. **Service worker:** registration, scope, versioning, precache/runtime cache, cache cleanup, update prompt and fallback; do not ship a broken stale-shell loop. Avoid aggressive `skipWaiting` that discards pending edits.
3. **Offline shell and draft:** a previously opened phone can create/continue eligible drafts offline; show on-device-only banner, prevent data loss on refresh/reopen, sync when online with conflict-safe reconciliation and true synced confirmation.
4. **Explicitly blocked offline operations:** Generate, Publish, Payments, destructive file actions are not queued; show an explanatory disabled state and safe retry after connectivity returns rather than submitting later silently.
5. **File operations:** mobile picker/uploads via existing server/PC target, original downloads open browser outside PWA as currently documented, no forced new storage mechanism or transcoding.
6. **Authentication:** installed app session, redirects, OAuth callbacks, CSRF, role permissions, sign-in and session revocation work after navigation change.
7. **Notifications:** bell/in-app notices, read state, source deep links; do not claim push notification support unless the source confirms it.
8. **Device tests:** 360px and 390px, iPhone PWA installed, Android if available, portrait/landscape, on-screen keyboard, safe areas, file access, network lost/returned, background/foreground, app update, login expiry and browser/installed routing.
9. **Mobile navigation:** fixed bottom bar for most used destinations, full-screen `All workspaces` hub for everything else, direct route to Publishing; major screens remain full pages; avoid many nested hamburger panels. Feature-access parity applies even if layout differs.
10. **Rollback:** old service-worker cached clients and new app must remain compatible during flag toggles and phased rollout. Use reversible app shell and stable API contracts.

**PWA gate:** The desktop redesign cannot be called complete until installed-app tests are verified. A responsive browser screenshot is not PWA parity.

## H. SAFETY, TESTS AND REGRESSION SUITE

### H1. Test types

- Existing unit/typing/lint/build/test suites (`pnpm` scripts only after verifying package manager and safe environment).
- Automated route/accessibility tests for every current URL and every nested view; verify no broken deep links and correct roles.
- UI smoke tests with real handlers connected to controlled fixtures, not decorative mock actions.
- API contract snapshots / golden payload fixtures for publishing and ComfyUI LTX/H3/Audio requests.
- Background job characterization tests for schedule, idempotency, retry, duplicate prevention, account scoping and side-effect gating.
- Visual regression of v5 screens at desktop/mobile, light/dark, loading/empty/error/large-data states.
- Installed PWA smoke tests for offline drafts and cache updates.
- Security & data-provenance tests for tokens, role redaction, manual vs verified metrics and accurate money totals.

### H2. Executable critical user journeys (create a test ID per sub-action)

1. Capture Content idea offline on an installed phone → see pending local banner → reconnect → verified server sync → convert intentionally into project, preserved backlink.
2. Create a project from Content template → stage checklist → drag to Ready blocked while mandatory checklist incomplete → explicit override logged only if allowed.
3. Open current Production project → launch working LTX with project preselected → inspect exact worker/input payload via mocks → view output History → download original from worker, no duplicated job.
4. H3 8-segment inputs persist across tab switches, reordering and validation; no segment lost, no automatic generation.
5. Audio/Qwen reference selection and output history work; no accidental video-publishing linkage.
6. Upload image input to **selected** Windows GPU PC; verify correct input path and exact original bytes with safe fixture.
7. Upload from Mac/phone into chosen online scanned folder without overwrite/recompression → index → link → preview → download original.
8. Download original from each of five documented entry points; compare hash/bytes in safe fixture, offline PC reports unavailability without deleting record.
9. Scanner offline→online, missing grace period, stable-file detection, duplicate quick signature vs exact SHA-256; no automatic merges or file modification on scan.
10. Production output → Publishing full route preselected → configure separate YouTube/Instagram/Facebook variants → retain metadata and statuses → schedule with explicit confirmation.
11. Linked publishing video Play/Download/Unlink; imported YouTube unmatched until confirmed match; manual pasted URL remains USER_ENTERED.
12. Unsupported TikTok/Threads connector displays honest limitations and never triggers unauthorized publishing.
13. Calendar reschedule across DST/timezone and collision warning; preserve schedule after reloading and mobile view.
14. Gmail connected email high confidence (safe fixture) → one opportunity + exactly one linked Draft project → new email on same thread does not duplicate → no deal, no reply.
15. Weak collaboration mention stays for review, unrelated newsletter dismissed appropriately, no automatic agreement.
16. Invoice suggestion extracted from email text → review → confirm only on owner action; no PDF processing claims; payment not implied.
17. Invoice partial payment, split, amount due, paid/void guard, missing FX warning, business expenses and personal taxes excluded from earnings.
18. Deal deliverable linked to a post, but deliverable completion and publication status remain independent; unpaid invoice prevents closing where existing.
19. Social reply originates only from receiving account; approval queue edits content before Send; no live side effect in tests.
20. Workflow automatic reply blocked when any of test pass, opt-in, kill switch, daily cap, cooldown conditions fail; a failure streak pauses workflow.
21. Todo sync offline/conflict state stays pending/failed; no false synced status; verify safe retry and source ownership of due date.
22. Background jobs continue correctly with browser closed; worker restart does not duplicate scheduled jobs, webhooks or projects.
23. Operational alert for expired connector, backup restore failure and new generation reaches correct deep-link and required visibility; quiet hours protect only noncritical notices.
24. Owner/Editor/Viewer permissions enforced server-side; private finance/email/media/device details absent from unauthorized UI and global search.
25. Existing legacy routes and bookmarks still load corresponding capabilities (including `/comfy`, `/publishing`, `/collaborations`, `/storage`).
26. Desktop browser back/forward, deep link refresh, unsaved draft guard and navigation context work.
27. PWA first install and existing-install update: same manifest identity, functional offline drafts, no hidden destructive queue, original download opens expected browser context.
28. Demo-data fixture stays clearly labelled, never mixed with live records. No fabricated chart values or fake successful operations.
29. Existing backup/restore verification jobs continue; UI only reads and surfaces status; no backup triggers merely by rendering UI.
30. Rollback flag restores old UI with original functionality and without data/URL migrations or PWA service-worker breakage.

Include high-volume data tests: thousands of assets, large inbox (tens of thousands messages/comments), busy publishing matrix, slow worker, API timeout, disconnected provider, very long idea text, large file uploads and long labels. Optimize through appropriate pagination / virtualization but keep data behavior unchanged.

### H3. No-live-side-effect test rule

**NEVER** test real Email Send, social reply, video publishing, financial payout, account disconnect, file delete/move, revoke, high-volume scan, worker task restart, or actual ComfyUI generation against production as part of the redesign. Use safe mocks/test accounts/sandbox or explicit separate authorization. Mark integration coverage limitations honestly. Synthetic fixtures are allowed in tests; never show them as real in the production UI.

### H4. Parity acceptance rubric

**All must pass before retiring any legacy entry point:**

- `A`: 100% inventory entries mapped to new or intentionally preserved original location.
- `B`: Every mapped action has same permissions, validations, side effects, error/loading/offline behavior and source-of-truth records, or deviation explicitly approved.
- `C`: No broken pre-existing route, bookmark, workflow, connector, background schedule, download, mobile/PWA capability or API contract.
- `D`: Existing automated tests pass; new characterization and UI tests pass; failing/untested critical scenarios remain blockers.
- `E`: Key workflows have fewer unnecessary context switches without weakening safeguards.
- `F`: Mobile and keyboard accessibility checks pass.
- `G`: Old UI can be reenabled rapidly without rollback migration or data loss.
- `H`: Production deployment separately approved after staging validation and verified backup/rollback.

A 100% written mapping alone **does not prove** zero defects. It is an approval gate paired with tests and staged observation.

## I. IMPLEMENTATION PHASES — AFTER APPROVAL ONLY

### Phase 1 — Safe design foundation & compatibility shell

- On a feature branch, implement shared design tokens, accessible primitives, responsive navigation and full-workspace routing behind `CREATOROS_UX_V5` (or naming compatible with current feature-flag system).
- Legacy UI remains fully available and default. Keep all URLs; use route-level fallback to old components, not cloned logic.
- No backend, data schema, PWA manifest, service worker or queue modification.
- Validate navigation/permissions/keyboard/mobile. Report touched files and tests. STOP for approval.

### Phase 2 — Today / Inbox & Tasks / Notifications

- New work-centered Today and clear Notifications/Activity. Reuse real current task/feed/alert APIs; no new fake notification records.
- Existing Todo state and source links intact. Preserve original Today subviews. No changes to schedulers.
- Mark missing event API as enhancement and retain legacy screen; do not fabricate event history. Validate with safe fixtures. STOP.

### Phase 3 — Content brainstorm and Production

- Content independent, messy, flexible, with restored writing and explicit convert-to-project; production project workspace, stages, checklists, scenes/versions, assets and history.
- Feature flag keeps original Content and Production available. Test conversion idempotency, stage gates, offline draft recovery, role checks. STOP.

### Phase 4 — Library and file operations

- Asset/File/Duplicates views, data table and preview gallery, worker status and file action discoverability. Reuse original Download/Upload/Play/Copy Path/Rename/Move/Delete/Link/Unlink operations, not new transports.
- Confirm original-byte integrity and remote PC target; offline and availability behavior; PWA download. STOP.

### Phase 5 — Create Studio [HIGH RISK]

- Redesign LTX, MiniMax H3, Audio/Qwen controls and History around existing payload builders, handlers, worker selection and job queue.
- DO NOT alter workflows, generation models, input/output paths or GPU job semantics. User-confirmed LTX is the baseline. Use golden payload fixture comparisons. Restore old `/comfy` immediately via flag if mismatch. STOP.

### Phase 6 — Publishing [HIGH RISK]

- Full dedicated workspace and matrix; media upload/link/preview/download/unlink, account-specific forms, schedules, imports/to-match and source provenance.
- All old write handlers and manual confirmation controls preserved. Do not send live posts during QA. Test with mocks and safe state machine fixtures; verify date/time and provider constraints. STOP.

### Phase 7 — Collaborations & money [HIGH RISK]

- Full-page inbox, pipeline/deals/deliverables, invoices, partial payments, expenses/receipts, taxes, partners, email suggestions.
- Do not change classifier, auto-Draft project creation, invoice detection, currency accounting or financial status transitions. Validate safe fixtures for one-per-thread, manual deal, invoices, revenue, taxes and rights. STOP.

### Phase 8 — Socials & Workflows [HIGH RISK]

- Improve communication inbox and visual workflow editor, tests/approval queue, kill switch, account-specific controls. Preserve existing Send/activation behavior; no live replies in testing.
- Verify all account roles, scopes, mock-tested vs live features and graceful unsupported connectors. STOP.

### Phase 9 — Analytics, Channels, Storage, Integrations, Settings

- Modernize dense operational pages with real data, permission checks, status next actions, sources, exports, pairing/settings and diagnostics.
- Preserve every nested tab and system control; test data provenance and roles. STOP.

### Phase 10 — Installed PWA & release verification

- Complete responsive behaviors per workspace without changing manifest/service-worker identity. Test offline drafting and nonqueued operations, installed-app updates, file picker/download, session and deep links.
- Full regression suite, performance/accessibility checks, production backup/rollback proof and change log. **Do not deploy without a final explicit go-ahead.**

**During every implementation phase:** maintain `docs/ux-v5/PARITY_PROGRESS.md` per feature ID with old route/control, new route/control, test evidence and status. Only declare a page migrated after all its actions reach parity. Legacy routes remain until later separately approved retirement, if ever.

## J. DEPLOYMENT, FEATURE FLAG, ROLLBACK AND STOP CONDITIONS

- Work on an isolated Git branch (e.g. `feature/creatoros-ux-v5`) **without discarding existing changes**. Record baseline commit and patch status.
- Before any production deployment, verify database+attachment backup and restore-test health; media originals and encryption key require their separate existing recovery procedures. Do not run a destructive restore or expose secret material.
- Feature flag scoped per user/session or route where feasible. Old UI remains accessible; avoid dual writers and duplicate background jobs.
- No data migration for UI layout preference unless essential and separately approved. Preserve endpoint/DB contracts and backward-compatible status values.
- Stage with representative sanitized data and working test/stub connectors; do not hit real financial/outbound services for tests.
- Verify current PWA cached clients can coexist with new frontend during rollback and cache update; service worker changes require separate review.
- Review startup/health after each phase; development launcher may fail without a listener—capture logs rather than rerunning migrations or clearing dependencies blindly.
- Publish changes only in an authorized release window with tested rollback and a monitoring plan covering app errors, background job rates, external API errors, auth refresh, worker queues, pending uploads, task sync and PWA errors.

**STOP IMMEDIATELY if any of these occur:**

1. Missing/unmapped feature, tab, action, permission, status, backend handler or PWA behavior.
2. ComfyUI LTX payload/worker behavior differs from baseline; job starts without manual Generate.
3. Publishing/email/social response triggers unexpectedly or provider identity changes.
4. Duplicate collaboration projects, duplicate messages/replies, double invoice/payment counting or altered consent rules.
5. File originals altered/merged/recompressed/lost, download bytes differ, offline/missing semantics changed.
6. PWA offline drafts lost, installed app identity changes, app trapped on stale shell or unauthorized offline operation queues.
7. Production service, DB migration or connector credentials affected by UI-only code.
8. Test failures at critical security/finance/publishing/worker boundaries or no viable rollback.
9. Private info displayed to an unauthorized role, on global search or notification preview.
10. Any request to hide a missing feature merely for a cleaner interface.

When stopping, present: **symptom, reproduction steps, source evidence, severity, proposed minimal reversible resolution, affected features, and which tests must pass**. Do not conceal, reframe, or silently "fix" by removing UI.

## K. FINAL RESPONSE FORMAT FOR CURSOR

At the end of **Phase 0**, return exactly these sections:

1. **Architecture actually discovered** (frameworks, packages, routes, API, DB, worker, PWA and deployment; no guesses).
2. **Coverage metrics**: number of routes, nested tabs, unique controls/entry points, background jobs, connector capabilities, mobile-only controls, roles, tests inventoried; show what was not auditable.
3. **Critical preservation inventory** with source references and verification status, including user-confirmed LTX.
4. **Existing → v5 map** showing precisely where each feature lives, including Content independence and full-page Publishing.
5. **15 riskiest regressions** and how the design prevents them.
6. **Demonstrable main user journeys**: idea to project to generation to publishing, auto collaboration + Draft project + manual deal, invoice/partial-payment, original file upload/download, Todo + notifications, workflow approval and PWA offline draft.
7. **Concrete file-by-file Phase 1 proposal** and data/API/component reuse plan.
8. **Test baseline and unresolved verification** with exact commands/results where actually run.
9. **Approval checklist**: which decisions or access are required, and what will not be touched.
10. **STOP: Await `APPROVE V5 IMPLEMENTATION PHASE 1`.**

At the end of **each implementation phase**, show: files changed, surfaces migrated, full parity progress, tests executed, issues, screenshots, remaining risks, rollback method, and the next requested approval. Never say "all existing features preserved" without inventory + tests.

---

## L. START HERE — THE ONLY PERMITTED FIRST ACTION

Read this entire directive. Read the actual CreatorOS repository and supplied capability/background documents. Read the v5 prototype as visual/interaction inspiration only. Carry out **Phase 0 only**; create the documentation under `docs/ux-v5/` and show the complete audit and migration map. **Do not implement any UI, change dependencies, touch background services or deploy**. Stop for approval after the audit.

**Success means a beautiful, clearly organized and dramatically more intuitive CreatorOS, with the full original set of internal, external, hidden, background and PWA capabilities still working—confirmed by a complete mapping and evidence, not by appearance.**

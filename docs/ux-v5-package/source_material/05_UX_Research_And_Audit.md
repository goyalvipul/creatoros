# CreatorOS v5 — UX research, recommended architecture, and Cursor audit contract

Date: 2026-11-03  
Status: **Design proposal / interactive prototype only. No production changes authorized.**

## Executive verdict

**TEST FIRST** — Select an elegant, neutral workspace that uses **direct full-screen destinations** for major tasks; a separate, flexible Content space for ideas; visible cross-cutting actions for notifications and tasks; project context carried between Studio, Library, and Publishing; and a purpose-built mobile PWA layout.

Do **not** approve a purple SaaS reskin, a project-only operating model, or an interface where major workspaces open in a side drawer. Nor should Cursor copy a static concept verbatim. **The actual repository is the functional source of truth**. Only a measured, feature-by-feature UI migration can preserve every function.

The attached `CreatorOS_Flow_v5_Interactive_Experience.html` is a visually functional **offline demonstration**, not production source. It uses generated demo content and does not connect to your CreatorOS server, PCs, social accounts, financial system, or PWA installation.

## Evidence / design research

- **Linear – My Issues**: prioritize urgent, blocked, in-progress, triage and backlog items in a personal work view. Source: https://linear.app/docs/my-issues
- **Front – Snoozed conversations**: snooze a conversation from its original context; follow-up reopens predictably. Source: https://help.front.com/en/articles/2088
- **Frame.io V4**: media-first panels, grid/list presentation, prominent upload progress, review and asset metadata. Source: https://frame.io/v4 and https://help.frame.io/en/articles/9101037-project-layout-overview
- **Planable – Approvals**: approvals should be intentional and visible in a publishing workflow. **Do not adopt a feature that changes CreatorOS's current owner-confirmation model.** Source: https://help.planable.io/hc/en-us/articles/21715462785180-Approvals-and-Approval-Workflows
- **Responsive navigation guidance**: desktop sidebar/navigation rail; compact mobile bottom navigation with an accessible full-screen hub when destinations exceed available space. Source: https://developer.android.com/develop/ui/views/layout/build-responsive-navigation

These products support design patterns; they are **not** authoritative evidence about what your application can do.

## Core interaction architecture

1. **Today:** actionable decisions, current tasks, recent productions, publishing queue, financial attention, worker status. Not a wall of KPIs.
2. **Notifications (full page):** operational alerts, classifications, sync errors, file discoveries, completed generation, invoice suggestions. Separate action-required from FYI activity and from historical job logs. Compact bell only previews.
3. **Inbox & Tasks:** To do, Snoozed, Recently done, Todo sync state/conflicts. Same source links; no automatic messages.
4. **Content:** **separate**, open-ended, messy idea board, notes, fragments, links, genre/pillar/audience/language/score/effort/tags/status, explicit project conversion preserving backlink.
5. **Production:** projects, Kanban stage transitions, owner, due dates, scenes, versions, selected final, shot lists, checklists, history, overrides; related tasks, linked assets, publishing actions.
6. **Create Studio:** LTX, MiniMax H3 (up to 8 segments), Audio/Qwen, History, Settings; model/workflow inputs, chosen PC, input upload/library selection, resolution/LoRA, prompts, logs, output and manual Generate. **User confirms LTX already works end-to-end**; preserve existing payload and execution behavior.
7. **Library:** distinct Assets, Files, Duplicates views; grid/list; preview, original-file download, PC availability, path, hash, copy path, link/unlink, safe confirmed file operations, scan management kept separate.
8. **Publishing:** **full workspace**, direct sidebar entry. Compose, matrix, queue, calendar, imported/unmatched. Upload to online PC or link indexed file, play/seek/download/unlink, per-account metadata, privacy/type/language/tags, schedule and explicit confirmation, verification labeling. No drawer for publishing.
9. **Calendar:** month/week/agenda, posts/project dates/collaboration dates, drag-to-reschedule with collisions and timezone.
10. **Collaborations:** full workspace containing inbox, pipeline, deals, invoices & partial payments, expenses with receipts, personal taxes, partners, deliverables, follow-ups, rights, currency rates. Auto-qualified email may create an opportunity and one linked Draft project, **not a deal**; no auto-replies. Invoice suggestion from email text (not PDF) requires confirmation.
11. **Socials:** unified inbox, comments, leads, planned content, trends, per-platform views and settings. Identity-locked replies, draft/manual/approved actions, account-level gates and accurate connector statuses.
12. **Workflows:** rules, approval queue, run history, safety controls, templates. Keep matching on contains/whole word/exact/emoji; passing tests, per-account opt-in, daily cap/cooldown, failure pause, emergency stop; approvals can edit proposed replies.
13. **Analytics:** brand/channel/account/period performance, verified vs manually entered separated, goals, CSV export, financial facts.
14. **Channels:** brands, channels, separate social identities, editing/archiving with history preserved.
15. **Storage & Devices:** agent pairing, revoke/rotate, folders, include/exclude rules, schedules, scan, last-seen, PC online/offline, media transfers, named Windows task control (not shell access).
16. **Integrations:** Gmail, YouTube, Instagram, Facebook, Todo, Postiz, Threads, TikTok, statuses, exact next steps, token/permission health.
17. **Settings:** workspace/currency/timezone, team roles, reminders, 2FA/session, backups/restore tests, demo data, system health/failed jobs/diagnostics/audit log.

Existing original URL paths should remain reachable, even if navigation labels are reorganized. Do not infer that the new Notifications page already has a dedicated route or corresponding backend; confirm first.

## Never lose these background contracts

From the current capability documentation:

- Every 10 seconds: apply already received Instagram/Facebook webhooks.
- Every 15 seconds: enqueue/poll LTX/Audio/H3 jobs; signed event outbox; agent heartbeat expiry behavior.
- Every 30 seconds: worker heartbeat.
- Every minute: follow-up actions, overdue invoice checks, finished generation linking and scheduled publishing claims.
- Every 5 minutes: Gmail sync and classification; Todo push/pull.
- Every 15 minutes: connected social comments/messages sync.
- Every 30 minutes: uploads/connectors and Instagram token renewal as applicable.
- Hourly: cache/receipt cleanup, analytics snapshots, duplicate hints.
- Nightly 03:15 America/Vancouver: database/attachment backup & checksum.
- Weekly Sunday 03:45: throwaway restore test; critical failure alert.
- Scanner agent loops, stable-file waiting, signed requests, revocable pairing, and protected original-file semantics.
- Restart idempotency, retry/dead-letter behavior and correct account isolation.

**These are requirements to verify from source code, not instructions to reimplement jobs.** The attached docs include detailed behavior; read them directly from the actual repository as well.

## Desktop design and visual treatment

- Warm white / pale stone background, white content panels, dark evergreen hierarchy and coral for the primary action. Dark charcoal surfaces *only* for Studio and media operations where focus benefits.
- Prominent page titles and clear right-side primary controls. One destination = one full workspace, predictable every time.
- Use contextual inspectors only where they reduce navigation, never as a substitute for dedicated Publishing/Collaborations/etc.
- Dense views (invoices, scanning, matrix) use real tables; media-rich views use switchable thumbnails/list.
- Keep keyboard search, current account/brand context, alert indicator and global quick capture persistent.
- No invented analytics data in production. Empty state, loading/error/retry states, accessibility and localization/timezones are mandatory.

## Mobile PWA

- Mobile bottom bar for Today, Content, Production, Publishing, More. The “More” entry opens a **full-screen hub**, not a small side drawer. Preserve all existing reachable features and consider configurable/pinnable destinations after usability testing.
- Main Publishing is a full mobile screen with accessible sections and explicit confirmation; all upload/download operations must use the existing mobile behavior.
- Preserve exact existing PWA manifest **id**, scope, start URL, icons, display/install behavior unless separately approved. Do not silently replace service-worker caching/updates.
- Preserve offline drafts started on the device, local-pending banners, sync/reconciliation, and the non-queued status of generate, publish, payments and destructive file operations.
- Test already-installed PWA on iOS/Android, background/foreground, network loss/recovery, file picker, open/download, login sessions, permissions, landscape/small viewport, cache update.

## Cursor: mandatory audit-first execution

> Inspect and document first. **No application code changes, package upgrades, migrations, deployment, or service restarts in Phase 0.**

1. Read repository guides: `AGENTS.md`, `CLAUDE.md`, `FEATURES.md`, `README.md`, `docs/TEST_MATRIX.md`, application packages, OpenAPI/handlers, database models, background services, scanner/worker agent, UI source, test suites, PWA manifest and service worker.
2. Trace every route, nested tab, modal, field, button and keyboard operation to its handler, API, persistence, permissions, side effects, worker and notifications; don't rely on screenshots or docs alone.
3. Build `docs/ux-v5/FEATURE_PARITY_MATRIX.md` with one row **per action**, not just per page. Columns: current route + UI control; actual handler; API; persistence; triggering side effects; entitlement; tested runtime status; proposed destination; regression test; risk; implementation state.
4. Build `docs/ux-v5/BACKGROUND_PARITY_MATRIX.md` for schedules, event consumers, classification, auto-project draft creation, invoice suggestion, scanner sync, ComfyUI job polling, notifications, backups, retries and PWA offline drafts. Include source line paths and tests.
5. Reconcile documentation against **actual working behavior**. Specifically treat LTX as working per owner confirmation and verify the current workflow under a read-only inspection rather than changing it.
6. Build `docs/ux-v5/USER_JOURNEYS.md` describing baseline steps and target steps for: idea→manual project conversion; ComfyUI→file→original download→Publishing; new Gmail collaboration→opportunity+Draft→deal/invoice; invoice suggestion→confirmation→partial payment; new post from indexed/uploaded file; Todo conflicts; workflow test→approval; PWA offline draft→sync; integration expiry→notification→repair.
7. Build high-fidelity prototypes against real information architecture and data contracts, isolated in `docs/ux-v5/prototype/`, **with no live authenticated operations**. Compare against the supplied v5 standalone HTML as concept only.
8. Test prototype keyboard, touch, overflow, accessibility, narrow viewport, full-page Publishing, close/reopen context, focus restoration, no-trap navigation; create an issue log.
9. Stop for design review. No existing screen may be replaced until every underlying action is mapped and the regression baseline passes.
10. Once approved, implement a theme/layout layer behind a feature flag; preserve old UI as fallback; migrate page-by-page; test backend and existing PWA; release incrementally with rollback.

## Stop conditions

- Existing action cannot be located or mapped.
- Required fields/permissions/validation are omitted from proposed UI.
- New UI would alter sending, posting, payment, project auto-creation, classification thresholds or worker behavior.
- Regression tests fail or cannot run.
- PWA manifest or service worker behavior changes unexpectedly.
- A file deletion/rename/move/download or generation action could target a different machine or file.

Stop that migration, report the issue, preserve the old UX and request approval. Zero lost functionality is an objective verified by tests—not a guarantee produced by a design prompt.

## What the prototype demonstrates versus what it does not

**Demonstrates:** full direct workspace navigation, independent Content ideation, project detail tabs, dark Studio controls, matrix/publishing, original-file action placements, notification action center, CRM inbox/finance views, automation safety view, basic keyboard search, temporary local note/task capture, responsive mobile layout and More hub.

**Does not implement:** real server/file scanning, remote uploads, original media downloads, GPU inference, emails, social publishing, real invoices/payments, real OAuth, service-worker/PWA installation, database persistence, or every field from every nested production tab. Such production functionality must be preserved and wired from the existing app, not fabricated from a standalone HTML demo.

## Decision criteria before approval

- User can prepare an indexed local video for Publishing and retain selected file/project/account without repeated search.
- Content remains unstructured until user manually converts the idea.
- A brand email can be reviewed in a full Collaboration workspace with correctly linked auto-created Draft project and separate deal creation.
- Invoice suggestion, split/partial payment, expense receipt, currencies, and taxes have explicit destinations and original rules.
- User can identify pending tasks, missed syncs, integration expiry, critical backups and generated files from Today or Notifications.
- All major workspaces open full-size, and no non-trivial action is hidden behind a mystery hamburger.
- PWA retains every desktop-accessible entitlement with mobile-adapted layouts, without breaking offline behavior or existing installed clients.
- Feature parity matrix is complete and verified with runtime regression tests.

**Final verdict: TEST FIRST — adopt this interaction architecture as the basis for v5 exploration, not as authorization for implementation.**

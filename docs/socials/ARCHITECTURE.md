# Socials architecture

Reuses the existing CRM message pipeline instead of adding a parallel one.

- Accounts: `provider_connections` (provider `instagram`), one row per connected account. Per-account settings live in `config.social` (auto-send opt-in, daily cap, cooldown, nickname, signature, tone, saved replies).
- Intake: Meta webhook (`/integrations/meta/instagram/webhook`, signed, deduped in `provider_webhook_events`) -> worker job `social-events` (every 10 s) -> `processMetaWebhookEvents` -> `processSocialEvent` -> `ingestMessage` (idempotent, unique per provider/principal/message id) -> workflows. Backfill (`Sync now`) stores history but is flagged not live and never triggers a workflow.
- Conversations: `conversation_threads` gained `participant_id`, `participant_name`, `kind` (DM/COMMENT), `labels`, `priority`, `opted_out`. A thread is bound to the connection that received it.
- Sending: `social_outbound_messages` (states DRAFT, SENDING, SENT, FAILED, UNCERTAIN). Unique `(org_id, request_id)` gives idempotency. DRAFT -> SENDING is an atomic claim, so two requests cannot both send.
- Identity lock: the API rejects (409 `IDENTITY_MISMATCH`) a reply whose `connectionId` differs from the thread's. `sendOutbound` re-checks connection, provider account id, org and recipient before any network call. A timeout or unknown failure is `UNCERTAIN` and is never retried automatically.
- Routes: `apps/api/src/routes/socials.ts`. UI: `/socials`, `/socials/inbox`, `/workflows`, `/workflows/approvals`, `/workflows/[id]`.

Not built: Facebook Pages/Messenger, YouTube comment replies, Threads, TikTok, publishing and temporary public media delivery, AI drafting.

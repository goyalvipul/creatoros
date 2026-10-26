# Workflows

Code: pure rules in `packages/domain/src/workflow.ts` (+ `workflow-templates.ts`), engine in `packages/services/src/workflows.ts`, tables in `packages/db/src/schema/social.ts`, migration `0003_socials_workflows.sql`.

## Model

`workflows` -> immutable `workflow_versions` -> `workflow_executions` (+ `workflow_approvals`). Definition: `{schemaVersion:1, trigger:{event}, steps[]}`, max 20 steps, steps run in order.

## Triggers

`MESSAGE_RECEIVED`, `COMMENT_RECEIVED`. Other triggers (schedules, delays, publishing events, token expiry) are not built.

## Conditions (all must pass)

`keyword_any` (contains, or whole word when `exact` is true), `keyword_none`, `text_equals` (the whole message, ignoring case and surrounding spaces), `emoji` (`any`, `none`, or `includes` a chosen list), `regex` (rejected unless judged safe: no nested quantifiers, length bounded), `has_media`, `is_new_conversation`, `within_hours` (time zone aware), `sender_in`, `category_is` (rule-based classifier, with min confidence).

## Actions

`draft_reply`, `queue_approval`, `send_reply` (AUTOMATIC mode only), `create_task`, `notify`, `create_lead`, `mark_human_review`, `add_label`, `set_priority`, `stop`.
Variables: `{{sender.display_name}}`, `{{account.username}}`, `{{platform.name}}`, `{{message.text}}`, `{{conversation.id}}`, `{{received_at}}`. No other variable is allowed, so tokens and secrets cannot be templated.

## Modes

- **Draft only** (default): saves a draft, never sends.
- **Approval required**: puts a proposed reply in the approval queue; approval re-checks every guard and sends once.
- **Fully automatic**: requires (1) a clean simulation of the current version, (2) per-account `autoSendEnabled`, (3) owner activation, (4) the global emergency stop off.

## Safety guards (checked at send time)

Kill switch (`Settings -> pause all` on the Workflows page), identity lock, opt-out (STOP etc.), 24 h window (unverified), per-contact cooldown, daily cap per account, sensitive topics (money, contract, legal, refund, threats, account security) are downgraded to human review, loop guard (outbound/echo messages never trigger), historical messages never trigger, execution dedupe per `(workflow, event)`, version pinning (an event runs on the version published when it arrived), auto-pause after 3 consecutive failures.

## Testing

Dry run (`POST /workflows/:id/simulate`) never sends or writes outbound rows. Automated coverage: `packages/domain/src/workflow.test.ts`, `tests/integration/test/socials-workflows.test.ts`.

## Templates

Starters in `workflow-templates.ts`, including streaming links, sound permission, bookings, press, merch, credits, emoji comments, an exact campaign word, a first-DM welcome and shoutouts. Import creates an inactive draft with no accounts. The automatic one still needs test, opt-in and activation. The list page can also create a blank draft.

## Operations

Worker job `social-events` runs every 10 s; failures leave rows retryable. Pause everything: Workflows page button or `PUT /api/v1/workflows/settings/pause-all {"paused":true}`. Logs: `docker compose logs -f worker api`.

## Not built

Delay/schedule nodes, branching, AI draft/classify nodes, brand voice profiles beyond account tone/signature fields, YouTube/Facebook/Threads/TikTok triggers, retention jobs for execution history. The editor is an ordered canvas (drag, or Move up / Move down) because steps run in a straight line.

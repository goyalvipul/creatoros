# Test results

**No live Meta, Google or TikTok call has been made for the Socials/Workflows features.** All automated tests use fake HTTP responses (`tests/integration/test/socials-workflows.test.ts`, `meta-instagram.test.ts`), which prove our logic, not Meta behaviour.

Manual checklist for the owner (Instagram test account, after Meta app setup in `docs/META_SETUP.md`):

1. Connect the account in Integrations with messages and comments enabled; confirm both permissions show as granted.
2. Send a DM to the account from another profile; confirm it appears in Socials > Inbox within a minute (requires the public webhook, otherwise use Sync now).
3. Reply from the inbox; confirm it arrives from the right account.
4. Create a Draft Only workflow, send a matching DM, confirm a draft appears and nothing is sent.
5. Try an Approval workflow; approve and confirm the send.
6. Only then consider an Automatic workflow on a test account, with a low daily cap.
7. Record the date, API version and result of each step here.

| Step | Date    | Result  |
| ---- | ------- | ------- |
| 1-7  | not run | not run |

## Automated results (fake HTTP only)

`pnpm test:integration`: `socials-workflows.test.ts` (14 tests: identity lock, idempotent sends, UNCERTAIN, duplicate webhooks, workflows, approvals, local archive/star, one task / follow-up / collaboration per conversation). Per-provider status:

| Provider             | Mock tests | Real authorization | Live read | Live reply | Live publish |
| -------------------- | ---------- | ------------------ | --------- | ---------- | ------------ |
| Instagram            | passed     | not done           | not done  | not done   | not built    |
| Facebook / Messenger | not built  | not built          | not built | not built  | not built    |
| YouTube comments     | not built  | n/a                | not built | not built  | not built    |
| TikTok               | not built  | not built          | not built | not built  | not built    |
| Threads              | not built  | not built          | not built | not built  | not built    |

Not yet written: Playwright specs for the Socials pages, a restart-recovery test, a token-expiry UI test.

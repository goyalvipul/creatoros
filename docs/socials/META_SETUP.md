# Meta (Instagram) setup

The full, current walkthrough is in [../META_SETUP.md](../META_SETUP.md): create a Meta app with the **Instagram API with Instagram Login** product (no Facebook Page link required), add `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI` and `META_WEBHOOK_VERIFY_TOKEN` to `.env`, register the redirect URI exactly, and subscribe webhooks to messages and comments.

Then connect each account in Integrations (use **Connect another** for more than one). Reconnecting an account updates the existing connection; it never creates a duplicate.

Facebook Pages / Messenger use a different login and Page access tokens. That connector is **not built**; do not follow Facebook Login instructions for Instagram.

Webhooks need a public HTTPS URL. Only the signed webhook path is served on the loopback gateway `127.0.0.1:8081`; exposing it (Tailscale Funnel) is your decision and is described in `../META_SETUP.md`.

## Why comments, DMs and webhooks are empty, and the exact fix (measured 2026-10-17)

Evidence for @mehakviking (token scopes: basic, manage_messages, manage_comments, content_publish, manage_insights, all granted):
posts report 104 / 142 / 102 comments, yet `GET /{media-id}/comments` returned 0 records on every page to the end (3 to 8 empty pages per post);
`GET /me/conversations?platform=instagram` returned 0 records over 48 pages. Every call was HTTP 200 and the token is the linked account's.
Permissions are not the problem; Meta's **access level** is: while the Meta app is in Development mode (or without Advanced Access) Instagram
only returns comments/messages, and only delivers webhooks, for Instagram accounts that have a **role on the app**. Your own posts' comments from
ordinary followers are filtered out. No webhook POST has ever arrived (only Meta's one verification GET).

Meta dashboard settings to change (Meta for Developers > your app):
1. Instagram > API setup with Instagram login > "Configure webhooks": Callback URL `https://os.goyalfamily.ca/api/v1/integrations/meta/instagram/webhook`,
   Verify token = `META_WEBHOOK_VERIFY_TOKEN` from `.env`, "Verify and save". Switch ON the `comments` and `messages` fields.
2. App roles > Roles > add the second Instagram account as **Instagram Tester**; accept inside Instagram (Settings > Website permissions / Apps and websites > Tester invitations).
3. For real followers: App Review > request Advanced Access for `instagram_business_manage_comments` and `instagram_business_manage_messages`, complete
   Business Verification, and switch the app to **Live**.

Controlled live test (nothing is sent by CreatorOS):
1. From the tester account, write one comment on a Mehak post. Wait 1 minute.
2. Direct API check: `docker compose exec api node apps/api/dist/cli/instagram-probe.js @mehakviking` (look at `comments-follow` records).
3. Webhook: Integrations > Instagram diagnostics shows "Webhook delivery verified" once a signed POST for the account is stored.
   The dashboard's per-field "Test" button proves the path (signed sample POST) but is shown as "Received, other account".
4. Send one DM from the tester account to @mehakviking; repeat steps 2 and 3 (`conversations-follow`), then open Socials > Inbox.
5. Sync now: `docker compose exec api node apps/api/dist/cli/instagram-link.js @mehakviking --import` (empty pages are followed; reported-but-empty posts are re-read, never marked synced).

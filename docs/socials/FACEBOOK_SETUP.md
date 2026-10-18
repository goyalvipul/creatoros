# Facebook Page setup (Messenger + Page comments)

Creator OS can read and reply to Messenger messages and comments on posts of a Facebook Page you manage. It uses
Facebook Login and the Page access token. Replies are sent only when you press send.

Status: implemented and mock-tested (`tests/integration/test/facebook.test.ts`). Not live-verified until the steps
below are done in your Meta app.

## 1. Credentials (`.env`, never commit)

These are the **parent Meta app** values (App settings > Basic), not the Instagram app id/secret.

```
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
# optional, default: <APP_BASE_URL>/api/v1/integrations/meta/facebook/callback
FACEBOOK_REDIRECT_URI=
```

`META_WEBHOOK_VERIFY_TOKEN` is shared with Instagram. Then `docker compose up -d --build` and `docker compose restart caddy`.

## 2. Meta dashboard

1. Add the **Facebook Login for Business / Facebook Login** use case. Valid OAuth redirect URI:
   `https://os.goyalfamily.ca/api/v1/integrations/meta/facebook/callback`
2. Webhooks > object **Page** > callback URL
   `https://os.goyalfamily.ca/api/v1/integrations/meta/facebook/webhook`, same verify token. Subscribe `messages` and `feed`.
   (Creator OS also subscribes each Page itself when you connect or press "Subscribe webhooks".)
3. Permissions requested: `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`,
   `pages_read_user_content`, `pages_manage_engagement`.

## 3. Connect

Integrations > Facebook Pages > Connect Facebook Page. Tick the Page tied to Mehak in the Facebook dialog and grant all
permissions. One connection is created per Page; the Page token is stored encrypted and never shown. Then press
**Sync now**. The Page appears under Socials (accounts, inbox, comments). Confirm the link to the Mehak channel account
if offered (auto-link happens only when the Page id matches).

## Limits you cannot change

- **Standard Access**: works for people with a role on the app (you). Other Page admins or public use needs App Review
  for `pages_messaging`, `pages_read_user_content`, `pages_manage_engagement` (Advanced Access).
- **24-hour window**: Messenger replies (`RESPONSE`) are allowed only within 24h of the person's last message. Creator
  OS blocks the send otherwise. Comments can be replied to any time.
- Page webhooks require the app to be published (live mode), which it already is.
- The Facebook user connecting must have a full or task-level role on the Page (MESSAGING for DMs).

## Safety

Sync and webhooks only read. Historical imports never trigger workflows. A send checks the Page identity (409
`IDENTITY_MISMATCH`), is idempotent on `requestId`, and is never retried automatically. Webhook query strings are
redacted in logs.

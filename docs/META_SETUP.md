# Meta integrations (Instagram Login, Facebook Pages, Messenger, Threads)

Status of each piece. "Tested" means automated tests with a faked Meta API; nothing here has been run against live Meta yet.

| Piece                                       | Status                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| Instagram API with Instagram Login          | Implemented + tested (OAuth, discovery, token renewal, disconnect, import)   |
| Instagram publishing                        | NOT implemented                                                              |
| Instagram comments/messages processing      | Webhook intake only (signed, deduplicated, stored as PENDING); not processed |
| Facebook Pages (Facebook Login)             | NOT implemented (gated placeholder)                                          |
| Messenger                                   | NOT implemented                                                              |
| Threads                                     | NOT implemented (gated placeholder)                                          |
| Legacy `meta` (pasted Facebook-Graph token) | Unchanged, still works                                                       |

The Meta documentation site was not reachable while this was written, so endpoints, scope names and the default Graph
version (`META_GRAPH_VERSION=v23.0`) come from prior knowledge and must be checked against current Meta docs.

## Instagram Login setup

1. Meta developer app: add the **Instagram** product, choose **API setup with Instagram login**.
2. Add your professional Instagram account as an **Instagram tester** (App roles) and accept the invite in the Instagram app.
3. Copy the **Instagram app ID / secret** (not the Facebook app ID) into `.env`: `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`.
4. In _Business login settings_ add the redirect URI
   `<APP_BASE_URL>/api/v1/integrations/meta/instagram/callback` and set the same value in `INSTAGRAM_REDIRECT_URI`.
   The OAuth redirect is followed by **your own browser**, so the private Tailscale URL works for it.
5. `docker compose up -d`, then Integrations -> Instagram -> Connect.

Scopes requested (and nothing else): `instagram_business_basic`, `instagram_business_content_publish`,
`instagram_business_manage_comments`, `instagram_business_manage_messages`. Without App Review these work for your own
tester accounts only.

Tokens: the 60 day long-lived token is stored encrypted. The worker renews tokens that expire within 10 days (Meta
allows renewal only after 24h); expired tokens show `AUTH_EXPIRED` and need **Reconnect**. Instagram offers no
revocation call, so Disconnect deletes the token locally; remove the app in Instagram settings to revoke it at Meta.

## Webhooks (needs a public HTTPS URL)

Meta's servers call the webhook, so it must be publicly reachable. Your dashboard at `:8443` is a private
Tailscale Serve (tailnet only) and must stay that way. Caddy exposes a **restricted gateway** on
`127.0.0.1:8081` that serves only `/api/v1/integrations/meta/instagram/webhook` (everything else is 404, body max 256 KB).

To make only that gateway public with Tailscale Funnel (needs Funnel enabled for your tailnet):

```bash
tailscale funnel --bg --https=10000 http://127.0.0.1:8081
# webhook URL: https://<machine>.<tailnet>.ts.net:10000/api/v1/integrations/meta/instagram/webhook
```

Set `META_WEBHOOK_VERIFY_TOKEN` (any long random string) and enter the same token plus the URL in the Meta app's webhook
settings. Deliveries are verified with HMAC-SHA256 (`X-Hub-Signature-256`) using `INSTAGRAM_APP_SECRET`, limited to
256 KB, and stored once per entry hash in `provider_webhook_events`.

## Media for publishing (not built yet)

Instagram fetches media from a public HTTPS URL. Meta cannot reach LAN/Tailscale-only files, so publishing will need
short-lived signed media URLs served through the same restricted gateway. Not implemented.

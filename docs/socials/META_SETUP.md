# Meta (Instagram) setup

The full, current walkthrough is in [../META_SETUP.md](../META_SETUP.md): create a Meta app with the **Instagram API with Instagram Login** product (no Facebook Page link required), add `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI` and `META_WEBHOOK_VERIFY_TOKEN` to `.env`, register the redirect URI exactly, and subscribe webhooks to messages and comments.

Then connect each account in Integrations (use **Connect another** for more than one). Reconnecting an account updates the existing connection; it never creates a duplicate.

Facebook Pages / Messenger use a different login and Page access tokens. That connector is **not built**; do not follow Facebook Login instructions for Instagram.

Webhooks need a public HTTPS URL. Only the signed webhook path is served on the loopback gateway `127.0.0.1:8081`; exposing it (Tailscale Funnel) is your decision and is described in `../META_SETUP.md`.

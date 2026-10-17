# Account security

- Tokens are encrypted at rest (`encryptedTokenRef`) and never returned by the API or logged.
- Webhook bodies are verified with HMAC-SHA256 (`X-Hub-Signature-256`) over the raw body, limited to 256 KB, and deduplicated.
- The only route exposed through the optional public gateway (`127.0.0.1:8081`, Caddy) is the webhook path. Public ingress (Tailscale Funnel) is **not enabled**. Enabling it exposes that one signed endpoint to the Internet; it needs your explicit decision (see `docs/META_SETUP.md`).
- Replies are bound to the receiving account (see architecture). The composer shows "Reply as / Reply to" and the server enforces it.
- Viewers cannot read `/socials` or `/workflows`. Activating a workflow, changing account automation settings and the emergency stop are OWNER only.
- Message text is data, never instructions: workflows only run the actions the owner configured; no AI is involved yet.
- Retention: message bodies follow the existing CRM encryption/retention. Execution traces store short outcomes, not tokens.

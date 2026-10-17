# Provider capabilities

Status words: **built** (code + tests against fakes), **unverified** (no live call has been made), **not built**.
Meta developer documentation could not be fetched while implementing (HTTP 403), so every endpoint, field, scope name and the `v23.0` default are **unverified**. `META_GRAPH_VERSION` is configurable. Re-check the current docs before the first live test.

| Capability                 | Instagram (Instagram Login)                                   | Facebook Pages | YouTube                       | Threads   | TikTok    |
| -------------------------- | ------------------------------------------------------------- | -------------- | ----------------------------- | --------- | --------- |
| OAuth connect              | built, unverified                                             | not built      | built (Gmail/YouTube)         | not built | not built |
| Profile / token refresh    | built, unverified                                             | not built      | built                         | not built | not built |
| Receive DMs (webhook)      | built, unverified                                             | not built      | n/a                           | not built | not built |
| Receive comments (webhook) | built, unverified                                             | not built      | not built                     | not built | not built |
| Send DM                    | built, unverified, needs `instagram_business_manage_messages` | not built      | n/a                           | not built | not built |
| Reply to comment           | built, unverified, needs `instagram_business_manage_comments` | not built      | not built (`comments.insert`) | not built | not built |
| Publishing                 | not built                                                     | not built      | not built                     | not built | not built |
| Insights                   | read-only profile counts only                                 | not built      | partial (existing import)     | not built | not built |

Scopes requested for Instagram: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_messages`. Advanced access / app review may be required for use outside test users: unverified.
The 24-hour DM reply window (`DM_WINDOW_HOURS`) is an assumption from memory and is unverified.
Each account card in Socials shows its own state per capability: Available, Missing permission, Needs reconnect, Not implemented, Not configured.

The same matrix is served live at `GET /api/v1/socials/platforms` and shown on each platform page in Socials.

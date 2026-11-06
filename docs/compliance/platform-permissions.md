# Platform permissions

Scopes below are what the code requests. A scope in the developer console does nothing until the operator approves it on a reconnect.

| Platform | Code | Requested on connect | Opt-in, not on the default connect |
| --- | --- | --- | --- |
| Instagram | `INSTAGRAM_SCOPES` | basic, content publish, comments, messages, insights | none |
| Facebook Page | `FACEBOOK_SCOPES` | pages_show_list, pages_messaging, pages_manage_metadata, pages_read_engagement, read_insights, pages_read_user_content, pages_manage_engagement | `pages_manage_posts` (Enable Page videos) |
| YouTube | `GOOGLE_SCOPES` | youtube.readonly, yt-analytics.readonly | youtube.force-ssl (comments), youtube.upload |
| Gmail | same Google client or its own | openid, email, gmail.readonly | gmail.compose, gmail.send |
| TikTok | `TikTokConnector` | user.info.basic, video.list when the app keys exist | video publish is not requested |

Callbacks, from environment defaults:

- Google and YouTube: `{APP_BASE_URL}/api/v1/integrations/oauth/callback`
- Instagram: `{APP_BASE_URL}/api/v1/integrations/meta/instagram/callback`
- Facebook: `{APP_BASE_URL}/api/v1/integrations/meta/facebook/callback`
- Instagram webhook: `{APP_BASE_URL}/api/v1/integrations/meta/instagram/webhook`
- Facebook webhook: `{APP_BASE_URL}/api/v1/integrations/meta/facebook/webhook`

`APP_BASE_URL` in production is `https://os.goyalfamily.ca`. Do not point these at kemokem.com until that host is serving the app.

Legal URLs for developer consoles:

- Terms: `https://os.goyalfamily.ca/terms`
- Privacy: `https://os.goyalfamily.ca/privacy`
- Data deletion instructions: `https://os.goyalfamily.ca/legal/data-deletion`

There is no Facebook data-deletion callback. Adding one that deletes rows from an unverified user id would not match how Page tokens are stored (`principal_hint` is the Page id).

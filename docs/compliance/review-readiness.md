# Review readiness

Eligibility below is from the code and from the public TikTok review pages as of this writing. It is not an approval.

| Platform | Implemented | Permissions the code asks for | Ready for review? | Blockers |
| --- | --- | --- | --- | --- |
| Instagram | Login, media import, comments, messages, insights, confirmed Reel upload | instagram_business_basic, content_publish, manage_comments, manage_messages, manage_insights | Not claimed | App Review and Business Verification are outside this repo. Webhook delivery was previously empty. Deletion is an instruction page, not a callback. |
| Facebook | Page login, posts, comments, messages, insights when read_insights is on the saved login, video upload only with pages_manage_posts | Page scopes in platform-permissions.md | Not claimed | Same Meta app review. No data-deletion callback. `read_insights` is requested on reconnect. |
| Google OAuth | Gmail read, YouTube connect | openid, email, gmail.readonly, youtube scopes | Not claimed | Consent screen, brand verification, and restricted-scope review are in Google Cloud, not in git. |
| YouTube API | List uploads, analytics, comments when force-ssl is on, upload when youtube.upload is on | youtube.readonly, yt-analytics.readonly, plus the two opt-ins | Not claimed | API compliance audit is separate from OAuth verification. Seven-day deletion after revoke is not implemented. Upload quota and unverified-app limits still apply. |
| TikTok | Connector can list the operator's videos if keys exist. Posting and DMs are off | user.info.basic, video.list | No | Guidelines updated 4 August 2026 say apps must not be for private or personal use, and the website URL cannot be a login page or only a landing page. `/about` is a public description with Terms and Privacy linked in the page. The product is still invitation-only, so this does not make it eligible. Sandbox mode can target users the developer adds. |

## Recording checklist

Record only what the production app does that day.

1. Open `https://os.goyalfamily.ca/terms`, `/privacy`, and `/legal/data-deletion` signed out.
2. Sign in.
3. Open Integrations and show the connected account and the scopes already granted. Do not click Reconnect unless the recording is meant to show the platform's own consent screen.
4. Open Analytics and show the last sync time. If a metric says missing permission, leave that on screen.
5. Open Library and play one file that is online.
6. Open a publishing draft and stop before Send.
7. If showing disconnect, use a test connection, not the live @mehakviking token.

Do not show a mocked success for a platform that is `NOT_CONFIGURED`.

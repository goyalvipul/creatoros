# YouTube setup (uploads import + comments in Socials)

Status: uploads import (Publishing) and comment read/reply (Socials) are implemented and mock-tested
(`tests/integration/test/youtube-comments.test.ts`). Not live-verified against Google until you connect.

YouTube has **no direct-message API**, so there is no DM inbox. Comments only.

## Setup

1. Google Cloud project with the Google client already used for Gmail (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_REDIRECT_URI` = `<APP_BASE_URL>/api/v1/integrations/oauth/callback`). Enable **YouTube Data API v3**.
2. Integrations > YouTube > Connect (uploads: `youtube.readonly`). Sign in with the Google account that owns the channel.
3. Press **Enable comments**: reconnects with `youtube.force-ssl` (read and reply to comments). The row shows
   "Comments: read and reply enabled" when granted.
4. Press **Sync comments**. The channel id is resolved and stored, and the connection auto-links to the Channels account
   whose external id is that channel id; otherwise confirm the link once. Comments appear under Socials (inbox, comments, YouTube).
5. If the consent screen is in Testing mode, add your Google account as a test user. Test-mode refresh tokens expire after 7 days.

## Separate Google client for YouTube

Gmail and YouTube can use different Google accounts and Google Cloud projects. Set these in `.env` for YouTube only:

```
YOUTUBE_GOOGLE_CLIENT_ID=
YOUTUBE_GOOGLE_CLIENT_SECRET=
YOUTUBE_GOOGLE_REDIRECT_URI=   # optional, defaults to GOOGLE_REDIRECT_URI
```

Gmail keeps using `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`. If `YOUTUBE_GOOGLE_CLIENT_ID` is empty,
YouTube shares the Gmail client. The YouTube client needs the same redirect URI (`<APP_BASE_URL>/api/v1/integrations/oauth/callback`)
and the YouTube Data API enabled in its own project. A YouTube connection made with the old client stops refreshing
after you switch clients: press Disconnect and Connect again.

## Behaviour and limits

- **Polling**, no webhooks. The worker's social sync re-reads the newest 3 pages (300 threads) per run; the first sync reads up to 10 pages (1,000 threads). Replies to very old threads may be missed until a Sync now finds them.
- **Quota**: 10,000 units/day. Reading costs 1 unit per page; a reply costs **50 units**. Syncs stop reading when the quota is hit.
- **Replies** go to the top-level comment only (YouTube does not allow replying to replies). Sent only when you press send; never retried; idempotent on `requestId`; blocked if the connection does not match the channel.
- Sync and import never post anything. Imported history never triggers automation.
- Moderation (hold, spam, delete) is not built.

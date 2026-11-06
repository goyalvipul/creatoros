# Data-flow inventory

Source of truth is the code cited here. Live Meta, Google, and TikTok responses were not re-checked on 5 November 2026.

## Sign-in

Collected: email, password hash (Argon2id, `packages/services/src/auth.ts`), role, timezone, session token hash, optional TOTP. Purpose: authentication. Stored in Postgres. Password is not reversible. Session cookie is HttpOnly. Not sent to a social platform.

## Instagram

Code: `packages/connectors/src/meta/instagram.ts`, `packages/services/src/analytics-sync.ts`. Login scopes: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_messages`, `instagram_business_manage_insights`. Stored when approved: account id, username, media, comments, messages, insight numbers, demographic slices in `account_metric_snapshots.detail`. Token encrypted via `encryptJson` (`packages/services/src/integrations.ts`). Sent to `graph.instagram.com` on sync and on a confirmed or scheduled publish. Disconnect (`disconnect()` on the connector) does not call Meta. `integrations.disconnect` deletes the encrypted token and sync cursors. Imported rows stay.

## Facebook

Code: `packages/connectors/src/meta/facebook.ts`, `packages/services/src/facebook.ts`. Page login includes `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `read_insights`, `pages_read_user_content`, `pages_manage_engagement`. `pages_manage_posts` is opt-in for video upload. Stored: Page id, posts, comments, messages, reaction counts, insight numbers when `read_insights` is on the saved login. Page token encrypted. Calls go to `graph.facebook.com`. No data-deletion callback is implemented. Disconnect deletes the token in Kemokem. It does not call Meta to revoke it.

## YouTube and Google

Code: `packages/connectors/src/google/oauth.ts`, `packages/connectors/src/google/youtube.ts`. Connect requests `youtube.readonly` and `yt-analytics.readonly`. Comments need `youtube.force-ssl`. Uploads need `youtube.upload`. Gmail read, draft, and send scopes are separate opt-ins. Stored: channel and video metadata, statistics, comments, analytics rows. Token encrypted. Disconnect calls `https://oauth2.googleapis.com/revoke` and then clears the token. Imported rows stay. YouTube's seven-day deletion rule is not implemented. See deletion-and-retention.md.

## TikTok

Code: `packages/connectors/src/social.ts` (`TikTokConnector`). Scopes used by the client: `user.info.basic`, `video.list`. `write` is false. Direct messages are not requested. Direct posting is blocked in `packages/services/src/publish-run.ts`. Stored only after a real connect: account info and the video list the API returns. The install may have no TikTok app configured. That state is `NOT_CONFIGURED`, not a live connection.

## Library and generation

Scanners are read-only. Originals stay on the Windows PCs. The server stores paths, hashes, and previews. Trim and upload create a new file only after the operator confirms. ComfyUI jobs run on the operator's machines when he starts them. No OpenAI or Gemini client exists in `packages/`.

## Mail and money

Gmail bodies used for the inbox stay in Postgres. Invoices and contacts are operator-entered. Nothing is paid without confirmation.

## Backups

`infra/scripts` dumps Postgres. A dump includes tokens in their encrypted form and the imported social rows. The app does not delete old dump files.

## Unverified

Whether Meta, Google, or TikTok have approved the production app for every scope is not visible from this repository. Webhook delivery from Meta was empty in earlier diagnostics (`docs/socials/META_SETUP.md`). That document is historical. It was not re-run for this note.

# YouTube setup

Status: Gmail/YouTube OAuth and the upload import in Publishing exist. **Comment reading and replying in Socials is not built.**

The YouTube Data API has no direct-message inbox, so none is offered. When comments are built they need the `youtube.force-ssl` scope (read and reply), which can require Google OAuth verification for non-test users, and they must be fetched incrementally because of the daily quota.

Setup for what exists: `docs/EXTERNAL_PREREQUISITES.md` (Google client id, redirect URI `.../api/v1/integrations/oauth/callback`). YouTube and Gmail can use different Google accounts.

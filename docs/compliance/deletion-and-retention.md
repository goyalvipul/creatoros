# Deletion and retention

## What the code does

`disconnect` in `packages/services/src/integrations.ts` clears `encrypted_token_ref`, sets the connection to `NOT_CONFIGURED`, and deletes `sync_cursors`. The comment in that function is accurate: imported records stay. Google and YouTube also call the revoke endpoint first. Instagram `disconnect()` is empty. Facebook has no revoke call in this path.

A scheduled publish row that is already `SCHEDULED` is not cancelled by disconnect. The worker in `publish-run.ts` sends it when `scheduled_at` arrives if the token is still usable. After the token is cleared, that send fails and the row shows the error.

Deleting another member (`DELETE` member in Settings) removes their sign-in. Files and posts they worked on stay. The confirm text on the Settings page says that.

There is no organization-wipe endpoint and no Meta signed-request deletion callback.

Originals on the Windows PCs are not deleted by a library delete. A confirmed trim or replace is a separate file operation.

## Retention

No job expires posts, comments, messages, analytics snapshots, or previews after a fixed number of days. Backups are operator-managed files with no expiry in the app.

## YouTube seven-day rule

YouTube API Services developer policies require deletion of YouTube API data within seven calendar days after revocation. This app revokes the token and keeps the imported rows. Closing that gap means a deliberate delete of API-sourced YouTube rows on disconnect, which would remove the operator's imported catalogue. That change was not made, because it deletes production data.

## How a person asks

The public instructions are `/legal/data-deletion`. The working contact is a direct message to Instagram @mehakviking. The operator deletes the named account's imported rows by hand. There is no status tracker for that request.

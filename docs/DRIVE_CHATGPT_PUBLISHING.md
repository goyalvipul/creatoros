# Kemokem → Google Drive → ChatGPT → Publishing

## Setup

1. In Google Cloud, enable the **Google Drive API** for the same project as the Kemokem Google OAuth web client.
2. Ensure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (when required by the web client) and `GOOGLE_REDIRECT_URI` are configured in Kemokem. The redirect is usually `https://YOUR_KEMOKEM_DOMAIN/api/v1/integrations/oauth/callback`; register its exact value in Google Cloud.
3. Rebuild and migrate: `docker compose up -d --build --force-recreate migrate api worker web`.
4. Open Production → project → Assets → **Connect Drive** and approve the separate `drive.file` grant. Kemokem saves encrypted credentials in a dedicated `google` provider connection, without changing Gmail or YouTube scopes.
5. In ChatGPT, connect **Google Drive** separately. Connecting Drive in Kemokem alone does not give ChatGPT access.

The `drive.file` scope is intentionally narrow: Kemokem can access files it creates, including project media, the manifest and JSON placeholders. To have ChatGPT write metadata that Kemokem can subsequently read, **edit the existing placeholder files**, rather than replacing them with newly created files. If your ChatGPT Drive connector cannot update arbitrary JSON, ask ChatGPT to generate individual JSON files and use **Upload analysis JSON** on Kemokem's Assets page. Kemokem writes their validated content into its own Drive placeholders.

## Drive Sync

- Open Production → project → Assets, select zero or more linked videos. With nothing checked, all linked publishable videos in this project are synced.
- Click **Drive Sync**. The browser shows QUEUED/RUNNING and uploads completed, polled from a persistent database job.
- The worker finds the project folder by its immutable Kemokem project ID (renaming the folder does not create a duplicate); creates a folder named after the project on first use.
- It streams each linked video from the owning scanner-agent into Google Drive using a resumable upload session, avoiding memory buffering and preserving the original local video.
- Subsequent syncs skip already-linked Drive files. `kemokem-manifest.json` is refreshed; existing `meta__*.json` analysis files are never overwritten.
- If the worker reports FAILED, fix the cause and start a new sync. Project progress is saved in the database.

Only published-linked video assets appear in this version. Raw audio, source images and arbitrary Library attachments are not synced by this first implementation.

## Analysis contract

Inside the Drive project folder:

- `kemokem-manifest.json`: video filenames, stable `publishItemId` and `fileInstanceId`, and each supported social account's metadata filename.
- `meta__<publishItemId>__<socialAccountId>.json`: one editable JSON template for each video/social account.

Every JSON template contains:

```json
{
  "schemaVersion": 1,
  "projectId": "real UUID from template",
  "publishItemId": "real UUID from template",
  "fileInstanceId": "real UUID from template",
  "fileName": "original-file.mp4",
  "socialAccountId": "real UUID from template",
  "platform": "youtube",
  "ready": false,
  "title": "",
  "caption": "",
  "hashtags": [],
  "privacy": "PRIVATE",
  "contentForm": "SHORT",
  "playlistIds": [],
  "aiUse": "YES"
}
```

Do not change any identity fields, schema version, account/platform or filename. Fill title, caption, tags and other appropriate fields; switch `ready` to `true` **only when the content was actually analyzed**. Keep the JSON valid and do not invent events, dialogue, brands or lyrics that are absent from the media. Use truthful AI-content disclosures; the template defaults `aiUse` to `YES` for this virtual-artist workflow.

### Suggested ChatGPT instruction

> Read the project folder and its `kemokem-manifest.json`. For every video, inspect the available media, lyrics, title, audio and other reference files. Produce platform-specific, engaging but accurate metadata in each existing `meta__*.json` file. Preserve the identity fields exactly. Use the platform's supported title length, caption, hashtag count, disclosure and privacy choices. Do not assume facts you cannot verify from the files. Set `ready=true` only after analysis. If you cannot edit these JSON files directly in Google Drive, provide one downloadable JSON file using each existing template filename, so I can use Kemokem's Upload analysis JSON button.

## Prefill socials

Press **Prefill socials** after ChatGPT updates the JSON files. Kemokem checks the exact project, publish-item, underlying file, connected social account, filename, platform and JSON schema. `ready=false` entries are skipped. Existing scheduled, uploading, uncertain or published posts are never replaced.

The importer writes to Kemokem's existing `publish_drafts` table, so the ordinary Production → Publishing per-platform forms open with titles, captions, tags, privacy, format, playlists and AI-use values already filled.

## Scheduling

**Schedule videos** shows video thumbnails and each prepared social account. By default the first video is tomorrow at 10:00 AM in the workspace timezone, then one additional day per video. All accounts for one video share its initial date. You can edit individual dates/times and **must explicitly check each destination account** (none is selected by default). Click **Confirm schedule** to invoke Kemokem's existing `/publishing/schedule` endpoint for each checked account.

Scheduling is not publication: the existing worker publishes at the due time. Platform authentication, account capabilities and API validation can still reject a schedule, and the UI reports those per-target failures. Partial success is possible; already-scheduled entries will not be silently re-scheduled. Review drafts, policy claims, music rights and AI disclosure before confirming.

## Operational notes

- Videos require the scanner-agent's source device to remain online while uploading.
- Large uploads depend on Drive limits and stable network links; the worker can remain busy for an extended time.
- Drive OAuth permission is distinct from the ChatGPT Drive connection. These are independently revocable.
- This integration does **not** automatically invoke ChatGPT or analyze the videos in the background. The owner returns to ChatGPT and explicitly requests analysis.
- Google Drive's `drive.file` grants access only to app-created files, which is why pre-created placeholders and stable IDs are important.
- Do not put refresh tokens or Google secrets in project metadata.

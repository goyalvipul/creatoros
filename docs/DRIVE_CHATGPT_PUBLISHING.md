# Kemokem → Google Drive → ChatGPT → Publishing

## Setup

1. In Google Cloud, enable the **Google Drive API** for the same project as the Kemokem Google OAuth web client.
2. Create a **separate OAuth Web application client for Drive Sync**. Configure `DRIVE_GOOGLE_CLIENT_ID`, `DRIVE_GOOGLE_CLIENT_SECRET` and `DRIVE_GOOGLE_REDIRECT_URI` in Kemokem. Example for this deployment: `DRIVE_GOOGLE_REDIRECT_URI=https://os.goyalfamily.ca/api/v1/integrations/oauth/callback`. Add this **exact URI** to the new client's authorized redirect URIs. **Do not change** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` or any `YOUTUBE_GOOGLE_*` variables. The callback endpoint may be the same route because the OAuth state identifies which provider/client to use.
3. Rebuild and migrate: `docker compose up -d --build --force-recreate migrate api worker web`.
4. Open Integrations → **Google Drive · Drive Sync** → **Connect** and choose the different Google account you want to use. Approve the separate `drive.file` grant. The account will appear independently of Gmail and YouTube. Production → project → Assets → **Connect Drive** uses this same dedicated connection. Kemokem saves encrypted credentials in a dedicated `google` provider connection, without changing Gmail or YouTube scopes.
5. In ChatGPT, connect **Google Drive** separately. Connecting Drive in Kemokem alone does not give ChatGPT access.

The `drive.file` scope is intentionally narrow: Kemokem can access files it creates, including project media, the manifest and JSON placeholders. To have ChatGPT write metadata that Kemokem can subsequently read, **edit the existing placeholder files**, rather than replacing them with newly created files. If your ChatGPT Drive connector cannot update arbitrary JSON, ask ChatGPT to generate individual JSON files and use **Upload analysis JSON** on Kemokem's Assets page. Kemokem writes their validated content into its own Drive placeholders.

## Drive Sync

- Open Production → project → Assets, select zero or more project files. With nothing checked, all linked publishing videos, linked logical-asset files (including audio/images/documents), the project song file, and files in project-assigned storage roots are synced. This may be many large files: select specific files if you want only finished exports.
- Click **Drive Sync**. The browser shows QUEUED/RUNNING and uploads completed, polled from a persistent database job.
- The worker finds the project folder by its immutable Kemokem project ID (renaming the folder does not create a duplicate); creates a folder named after the project on first use.
- It reads each file from the owning scanner-agent, sends it in independent 8-MiB chunks through a resumable Drive upload session, and verifies the uploaded Drive file's size and source ID before counting the file complete. The original media stays on its PC. A failed job can be requeued; already verified files are skipped.
- Subsequent syncs skip already-linked Drive files. `kemokem-manifest.json` is refreshed; existing `meta__*.json` analysis files are never overwritten.
- If the worker reports FAILED, fix the cause and start a new sync. Project progress is saved in the database.

Only assets explicitly associated with this project (publishing files, logical-asset links, project song and project-assigned storage roots) are synced. Unlinked, unrelated Library files are intentionally excluded. Drive Sync may fail while an owning Windows machine is offline, and the UI will display the specific failure.

## Analysis contract

Inside the Drive project folder:

- `kemokem-manifest.json`: an `assets` list of all selected files; a `videos` list of files attached to publishing titles, their stable `publishItemId` and `fileInstanceId`; and each supported social account's metadata filename.
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

## Customized thumbnails for each social account

After Prefill socials, open **Schedule videos**, and click **Design cover** beside any platform/account.
- The designer extracts a real frame from that video, builds the platform-specific size, and lets you edit the big headline, supporting text, style (cinematic, bold, minimal), framing and frame timestamp. You may instead upload your own JPEG/PNG/WebP (under 2 MB).
- Each design is saved **per publish item and social account**. A YouTube cover cannot overwrite the Instagram cover for that video.
- ChatGPT can suggest different thumbnail headlines/subheadlines/styles for every video/social using the optional `thumbnail` object in each `meta__*.json`. The designer loads this when the metadata file is ready.
- YouTube (including supported Shorts), Facebook and Instagram publishing use the account-specific cover if saved, falling back to the existing shared video cover. Platform APIs may not allow an arbitrary cover in TikTok and Threads; their customized design remains downloadable and is not falsely reported as published. Verify the actual cover on the destination platform.
- For YouTube, optimize a 16:9 hook-first thumbnail with Mehak's authentic face clearly visible, concise high-contrast text and no false claims. Shorts custom thumbnail support and eligibility may differ from long-form videos, and YouTube may require video processing to complete before a custom cover is applied.

### Validation

Do not merge based solely on TypeScript/unit-test CI. For a project with media across both RTX 3090 and 3060, run an all-assets sync with both scanner agents online. Confirm every manifest asset has a matching Drive file and size, retry an interrupted transfer, import JSON, save two different social covers for the same video, and schedule a test post without publishing immediately.

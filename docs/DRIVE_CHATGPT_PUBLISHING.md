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
- ChatGPT can suggest different thumbnail headlines, subheadlines, four placement options, three available fonts, hook type and creative framing notes using the optional `thumbnail` object in each `meta__*.json`. The designer loads these when the metadata file is ready. This is a design brief, not an automatic claim that a thumbnail has been researched or that it will outperform alternatives.
- YouTube (including supported Shorts), Facebook and Instagram publishing use the account-specific cover if saved, falling back to the existing shared video cover. Platform APIs may not allow an arbitrary cover in TikTok and Threads; their customized design remains downloadable and is not falsely reported as published. Verify the actual cover on the destination platform.
- For YouTube Shorts, use a 9:16 (1080×1920) portrait cover; for standard YouTube videos, use 16:9 (1280×720). Keep Mehak's recognizable face clearly visible, use concise high-contrast copy, and avoid misleading claims. Shorts custom thumbnail support and eligibility can differ from long-form videos.

### Validation

Do not merge based solely on TypeScript/unit-test CI. For a project with media across both RTX 3090 and 3060, run an all-assets sync with both scanner agents online. Confirm every manifest asset has a matching Drive file and size, retry an interrupted transfer, import JSON, save two different social covers for the same video, and schedule a test post without publishing immediately.

## Folder analysis and thumbnail policy — reusable master rules

When analyzing a Drive project folder for Kemokem:
1. Read `kemokem-manifest.json` first and preserve every `projectId`, `publishItemId`, `fileInstanceId`, `socialAccountId`, `platform` and existing JSON filename exactly. Never fabricate missing media or identifiers.
2. Inspect each accessible source video and any lyrics/transcripts/audio that are actually available. Clearly report anything that cannot be verified. Never invent lyrics, reactions, events or endorsements.
3. Create distinct, truthful titles, captions, hashtags and content settings for every existing supported social-account template. Keep already-published items protected and set `ready=true` only on fully verified, schema-valid content.
4. Produce a clip-specific thumbnail brief: `headline`, `subheadline`, `style`, `focalX`, `aspect`, `placement`, `fontStyle`, `hookType` and `notes`. Research current official platform constraints and successful comparable creator designs before choosing positioning; describe research vs inference separately.
5. Keep public titles and thumbnail text about the MUSIC and PERFORMANCE. Never include production-process descriptors such as "AI-generated", "AI model", "virtual artist" or "synthetic media" in those fields. Maintain truthful platform-required synthetic-media disclosure independently in `aiUse`. Do not misrepresent an actual live event or singing performance as documented fact when the clip is staged.
6. Prefer one face/emotion, one clear focal point and a 2–5 word bold high-contrast headline. Avoid covering eyes, mouth or the microphone; consider mobile UI overlays, safe margins and cropped surfaces. Use `impact`, `geometric`, or `condensed` fonts actually supported by the editor.
7. Use YouTube Shorts 9:16 and standard YouTube 16:9. Consider the distinct framing of Instagram/TikTok 9:16, Threads 4:5, and Facebook 1.91:1. A saved cover does not guarantee that the platform will display it on every surface.
8. Suggest at least two thumbnail hooks for user review when research is ambiguous; prefer a small, measurable A/B test to unsupported certainty of viral or click-through performance.
9. Report actual successful updates, protected skips, incomplete assets, analysis limitations and import errors separately. Only red-label actual failures. Keep scheduled/publication actions behind owner review.
10. Do not upload, schedule or publish immediately when the user only requested analysis. Update only the matching app-owned metadata JSON files and verify the imported results.

Suggested design reading: vidIQ's 2026 500-breakout-thumbnail study (https://vidiq.com/research/youtube-thumbnail-study/) found that faces, short text and strong contrast are common among breakout thumbnails. This is descriptive evidence, **not** proof that a specific design will improve CTR. Verify current YouTube custom-thumbnail upload rules at https://support.google.com/youtube/answer/72431.

## Drive-based custom thumbnail import (no broad Drive scope)

Kemokem can now import actual custom thumbnails when the user presses **Prefill socials**. A thumbnail for one publishing item + social account is named `thumb__<publishItemId>__<socialAccountId>.jpg` and appears in the project Drive folder for visual review.

**Important Google OAuth detail:** Kemokem deliberately uses `drive.file`, which does not automatically grant it access to independently created JPGs, even inside an app-created folder. For this reason the corresponding **existing app-owned** `meta__*.json` file may include `thumbnail.imageFile` and the verified JPG's base64 bytes in `thumbnail.imageBase64`. The metadata importer validates that both refer to the exact project video/account. This avoids changing to a broad Google Drive scope or requiring a new OAuth connection. The JSON file is capped at 650 KB and the stored cover itself at 2 MB.

On Prefill:
- Existing scheduled, queued and published posts are protected; nothing is re-published.
- Imported or updated draft records receive their normal title/caption/tags/AI disclosure.
- If the matching draft has no manually saved social cover, the validated embedded JPG is saved into Kemokem's shared per-account social cover directory.
- If the user already created their own custom cover, it is **preserved** rather than overwritten.
- The result reports how many thumbnails were imported and how many existing covers were preserved.
- The JPG files are downloadable review copies; Kemokem imports from the matching app-owned JSON. Future automatic folder analyses should update the **existing** templates in place rather than create replacements.
- Do not click Prefill on an **older deployed Kemokem build** after embedding images in the JSON: the older importer rejects files over 100 KB. Deploy this branch's importer first.

## Prefill result display

Show a concise green imported-count row, amber skipped/protected-count row and red error-count row **only when errors occur**. Provide expandable per-file detail. An already published item is a protected skip, not a failure. Opening project Publishing afterwards should show refreshed draft fields.

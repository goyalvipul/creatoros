# Agent memory

Map of Creator OS as of 2026-11-01. Read this before opening source. Update it in the same change when behavior, routes, or rebuild steps change. Longer briefing: `docs/AGENT_HANDOFF.md`. Intent: `docs/PRODUCT_SPEC.md`. Owner-facing capability list: `docs/CAPABILITIES.md`. Do not walk the repo to rediscover a line that is already here.

## Working rules

- Owner rebuilds. Give the command. Do not run `docker compose` unless asked. Do not commit or push unless asked. Do not press Generate or start an LTX, Qwen, or MiniMax job.
- Scanners are read-only. Nothing is posted, sent, or paid without confirmation. No fake integration success. Postgres and Redis stay on loopback.
- Counts come from their own tables. A file is missing only after a complete scan plus grace. Offline is not missing.
- Do not retarget Ayi Ayi. Do not delete burst backups. Do not re-pair a scanner when replacing its exe.
- Timezone America/Vancouver. Currency CAD. Site `https://os.goyalfamily.ca`.
- PCs: RTX 3090 `http://100.85.189.23:8188` (24GB), RTX 3060 `http://100.113.189.17:8188` (12GB). Labels `24GB (3090)` and `12GB (3060)`.

## Where to edit

| Task | Open |
| --- | --- |
| Library page | `apps/web/src/app/(app)/library/page.tsx` |
| Library sync now | `POST /library/sync` → `requestLibrarySync` in `packages/services/src/roots.ts` |
| Comfy page (LTX, Audio, MiniMax, History, Settings) | `apps/web/src/app/(app)/comfy/page.tsx` |
| Comfy HTTP | `apps/api/src/routes/comfy.ts` |
| LTX, publishing attach, worker queue | `packages/services/src/comfy.ts` |
| MiniMax graph and jobs | `packages/services/src/h3.ts` and `packages/services/src/h3.test.ts` |
| Voice clone | `packages/services/src/qwen.ts` |
| Comfy tables | `packages/db/src/schema/comfy.ts` |
| Windows task agent | `apps/scanner-agent/internal/tasksched/tasksched.go`, `apps/scanner-agent/internal/agent/tasks.go` |
| Workflows and reference wavs | `docs/comfy/` |
| New SQL | next file in `packages/db/drizzle/` plus one journal entry in `packages/db/drizzle/meta/_journal.json` |

Business logic stays in `packages/services`. Routes use `makeRouter`. UI calls `/api/v1`. Worker loops live in `apps/worker/src/jobs.ts` (`ltx` every 15s also runs Qwen and MiniMax).

## Mail

- A new inbound email classified as a collaboration notifies once (`mail.possible`). That is the inbox review queue.
- A clear one (confidence at least 0.8, several commercial terms, not a newsletter) is confirmed into the pipeline and a Production project is created in Draft. Notification `mail.pipeline` opens that project. One casual mention of a brand or a video stays in the inbox. Manual intake is unchanged. The rule is `isClearCollaboration` in `packages/domain/src/classify.ts`.

## Invoices and expenses

- Status **Paid** counts the full invoice amount in Received (`financeSummary` and the deal total). The invoices table has no Paid column. A partial payment still counts only what was recorded, and the status stays Partially paid.
- Collaborations tabs **Expenses** and **Personal taxes**. `POST /expenses` logs a business or personal row and `PATCH /expenses/:id` edits it, with an optional receipt photo stored under the attachments volume (`expenses.receipt_path`). Business expenses use `scope = BUSINESS` and reduce earnings: Paid (invoices marked Paid) minus those expenses. Personal rows (`scope = PERSONAL`) are year-end tax entries and stay out of that total. Migration `0029_expense_scope`. UI: `apps/web/src/app/(app)/collaborations/money-log.tsx`.

## Library

- **Sync now** on the Library header asks every ACTIVE scan root to scan on the agent’s next poll, then runs `syncFolderAssets` and `linkRecentGeneratedOutputs` so files already indexed are grouped and a finished video is added to its publishing list without waiting for the worker.
- A saved trim is cut by the worker with ffmpeg and uploaded back to the same folder. The editor can set the file name. **Replace the original file** removes the source after the new clip is on that PC; the same name is swapped onto the original path (the scanner still cannot overwrite in one write). Otherwise the original stays. Play from is a scrubber. Accurate rebuilds to the In and Out times. Fast keyframe copies and can start at the previous keyframe. This editor does not join two videos. `POST /files/:id/trims` with `fileName` and `replaceOriginal`. Migration `0032_video_trim_replace`. Rebuild `docker compose up -d --build --force-recreate migrate api worker` and the preview web.

## Comfy

- A finished LTX, MiniMax, or Audio job adds one in-app notification (`comfy.ready`, deduped by job id). It opens ComfyUI on History (`/comfy#history`).
- Tabs: LTX, Audio, MiniMax H3, History, Settings. Last worker is remembered in `cos-ltx-worker`, `cos-qwen-worker`, `cos-h3-worker`.
- Green or red dot is Comfy `/queue` plus our QUEUED/RUNNING jobs (`machineQueue`). Generate paints the dot busy immediately. Ready or Failed returns it to free on the next poll.
- **Project** is on LTX, MiniMax, and Audio. The control is `ProjectPick` in the Comfy page. **New project…** posts `POST /projects` with `{ title, type: 'OTHER' }`. Empty project creates no Production or Publishing rows.
- **Download** on a library file, an asset file, a linked publishing video, and a Comfy history clip saves the original bytes (`/files/:id/stream?download=1`, or `/comfy/jobs/:id/video?download=1` before the scan has a library row). The tile image is still a preview. In the installed phone app the file opens in the browser, so the app stays on the page. A same-window download leaves a black player with no way back.
- **YouTube form:** Playlists load from the connected channel (`GET /social-accounts/:id/youtube/playlists`). Create adds the playlist on YouTube immediately (`POST` the same path) and needs `youtube.force-ssl` (Integrations → Enable comments). Checked playlists receive the video only when it is sent. AI use Yes/No is `publish_drafts.ai_use` and is sent as `status.containsSyntheticMedia`. Migration `0031_youtube_playlist_ai`. Rebuild `docker compose up -d --build --force-recreate migrate api`. The preview form also needs `cd /home/vipul/workspace/creatoros-ux && docker compose -f compose.preview.yml up -d --build`.
- **Publishing title:** the file name plays the original. **Upload** copies the chosen video, unchanged, into an ACTIVE scanned folder on a PC that is on, then links it. `POST /variants/:id/upload`. The scanner must include `/v1/upload` (rebuild with `pnpm agent:build`, copy the exe, restart the service, do not re-pair). An older agent reports that it needs the update. A name that already exists is left untouched.
- One publishing row per project. `attachLtxVariantToProject` in `comfy.ts` uses the oldest `distribution_variants` row for that project (a Comfy-made row first). Later LTX, MiniMax, and voice files link onto that same asset version. The first clip creates the asset, version, and variant. A finished video is also inserted into `publish_items` (`linkPublishVideo`) so the publishing page can upload it. Voice files stay off that list. Voice jobs call `attachJobToProject` when they succeed. `linkRecentGeneratedOutputs` retries LTX, MiniMax, and `comfyui-qwen-tts` for 14 days, including a video that was scanned after the job finished.
- Audio draft project column is migration `0028_qwen_project.sql`.

### LTX

- Workflow stays as saved. Form can clear number boxes. History **Use in the form** restores an LTX clip only.

### Audio (Qwen)

- Workflow `docs/comfy/Mehak_Qwen3_External_VoiceClone-2API.json`. Provider `comfyui-qwen-tts`.
- Reference dropdown: `mehakdeepvoice.wav` (workflow text), `MehakDeep.wav`, `MehakNormal.wav` (texts in `QWEN_CLIPS` / `CLIP_TEXT` in `qwen.ts`). Or a library/upload file.
- Playback `GET /api/v1/comfy/jobs/:id/audio`. `toPlayableAudio` rewrites float or 24-bit WAV to 16-bit PCM. `sliceAudioRange` answers phone byte ranges with 206. Installed PWA needs that. The PC that rendered the voice must be on.

### MiniMax H3

- Workflow `docs/comfy/MINIMAX H3 Motion Context FINAL API.json`. Provider `comfyui-h3`. Max 8 segments, 8 images, 20 seconds each. FPS 24. Length is `MM:SS:FF` (`00:08:00` = 8 seconds). Payload sends seconds.
- No audio file: track stays unlocked and MiniMax makes the sound. Lock applies only when every segment has a file.
- Node 25 `easy saveVideo` must get `input_mode.video` from node 17 output 0. Nodes 37 and 38 (song trim) are removed before POST.
- First segment continuity is `shot`. R2V is task mode `ref`. Swap Context is `context_swap`. Size is `ref_image_size` `max` or `match`.
- Image tiles use `/api/v1/files/:id/preview`, then `/stream`. Uploads reopen through `GET /api/v1/comfy/workers/:id/input`.
- Aspect and megapixels set the frame. Models, LoRAs, 8 steps, and 1.5 upscale stay in the JSON.

### Settings

- PCs are added here. Windows tasks: owner saves a Task Scheduler name. Agent only queries that name, or `schtasks /End` then `/Run` on Restart. No general shell. Docker does not update the agent. Build `pnpm agent:build` where Go is installed (this Linux host has no Go), copy `apps/scanner-agent/dist/creatoros-agent-windows-amd64.exe` onto both PCs, restart the service, do not re-pair. Credentials stay in `C:\ProgramData\CreatorOS\agent`.

## UX preview

The live site stays this folder on `main`: `https://os.goyalfamily.ca`. UX edits go in the worktree `/home/vipul/workspace/creatoros-ux` on branch `ux`. That checkout runs only a second web container on port 8082 (`compose.preview.yml`). It uses the live API, database, and worker. Do not run `docker-compose.yml` from the worktree. Do not migrate on `ux`. Preview writes are real. Sign-in there is a separate cookie. `APP_BASE_URL` stays the public site.

```bash
cd /home/vipul/workspace/creatoros-ux
docker compose -f compose.preview.yml up -d --build
```

Publishing live preview is one social frame (handle, title, caption on a Shorts or Reel; title under a widescreen YouTube video). The picture fills the frame with no player bar and no file name. The header theme toggle sets `cos-theme`. Dark mode on the preview is warm charcoal; notes and publishing stickies stay paper-colored. Create Studio follows that theme, with a draggable split between the form and the preview. That width is stored in `cos-studio-split` and restored on refresh for every studio tab. LTX has a Run on list for the PC that executes the job. The LTX form is kept in the browser (`cos-ltx-studio`) so image, audio, and trim remain after leaving Create Studio. The studio tab bar does not choose a PC. Frame size and upscale size are dropdowns; Custom opens width and height. The LTX audio card plays the chosen file from its icon through the same-origin file stream, and the trim sets the start and length sent with generation. Video playback uses one stream. When a file has no saved thumbnail, the list takes one still from that file, one file at a time. Fullscreen on the studio preview shows a close button at the top right. The LTX and MiniMax preview sits in a phone frame with a thin edge and shows the whole picture. Recent-result cards under that preview use a hand cursor. A later clip on a busy PC says Waiting in the queue. Edit video saves a new clip beside the original once the live API is rebuilt. MiniMax Length, Join, Size, and Mode stay in a grid so the menus do not stretch apart. Type and brand on a production card open as wrapped pills, the same way an invoice status does. The Collaborations inbox keeps mailbox, reply state, and search on one row. Open `https://gaurdo-box.tail4c4d02.ts.net:8444` (Tailscale Serve to port 8082). Plain `http://100.108.120.8:8082` stalls ComfyUI because History starts every video at once over HTTP. Stop the preview with `docker compose -f compose.preview.yml stop` from that folder. Remove only the preview address with `tailscale serve --https=8444 off`. That leaves the live site on 8443.

## Rebuild

Download, playback on a title, publishing upload, and video trim: `docker compose up -d --build --force-recreate api worker`

The upload also needs a new scanner on each Windows PC: `pnpm agent:build`, copy `apps/scanner-agent/dist/creatoros-agent-windows-amd64.exe`, restart the service, do not re-pair.

Voice playback only: `docker compose up -d --build --force-recreate api`

Project picker and voice-to-publishing (migration `0028`): `docker compose up -d --build --force-recreate migrate api worker web`

Web image must be built with `API_INTERNAL_URL` set. `pnpm test:e2e` builds the web app against the test API. Do not run bare Playwright after a normal `pnpm build`.

## Migrations already added for Comfy

`0024` H3 editor, `0025` H3 project, `0026` Windows tasks, `0027` Qwen clips, `0028` Qwen project. Journal idx matches the number. Next migration is `0033`. `0030` is video trims. `0031` is YouTube playlists and AI use. `0032` is trim replace.

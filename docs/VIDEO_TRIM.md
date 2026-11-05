# Video trim

Edit video opens from a library video, a finished LTX or MiniMax file that is already in the library, and a publishing preview. Nothing is encoded until **Save as New Clip**.

The new file is an mp4 in the same folder as the source, on the PC that already holds it. The worker reads the original through the scanner, cuts it with ffmpeg, and uploads only the new file. The original path is only read. One trim runs at a time. A trim that stops reporting for 20 minutes is marked failed and the original is left as it was.

Accurate mode re-encodes from the exact in and out points. Fast mode copies from the nearest earlier keyframe. The worker checks the new duration before the clip is added to the library. When it is added, it keeps the source file’s project and publishing links, and any project or publishing title chosen in the editor.

The picture size and length in the editor come from the video the browser already loaded when the last scan did not store them.

Rebuild the API and worker (the worker image installs ffmpeg):

```bash
docker compose up -d --build --force-recreate api worker
```

A trim that already failed because ffmpeg was not next to the scanner is picked up again after that restart. The PC that holds the file has to be on. No new scanner exe is required for the cut.

## Verification on 2026-11-04

Domain tests for the path plan, the range checks, and the ffmpeg argument order passed (`pnpm --filter @creatoros/domain test`, 87 tests). API and services typecheck passed. This host has no Go and no ffmpeg, so the scanner tests were not compiled here.

The same accurate and fast ffmpeg arguments were run in a Debian container:

- Landscape 320×180 with audio, cut 0.700s–2.100s, accurate: output 1.500s, video and audio kept, source byte size unchanged.
- Same file, fast copy: output 2.292s, which is the earlier keyframe. Audio kept.
- Portrait 180×320 with no audio, cut 0.200s–0.900s, accurate: output 0.767s, still portrait, no audio track.

Files on the two Windows PCs were not trimmed in that check. A later save uses the worker’s ffmpeg and the scanner’s existing upload, so those PCs do not need ffmpeg installed.


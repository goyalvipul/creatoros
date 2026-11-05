# Video trim

Edit video opens from a library video, a finished LTX or MiniMax file that is already in the library, and a publishing preview. Nothing is encoded until **Save as New Clip**.

The new file is an mp4 in the same folder as the source, on the PC that already holds it. The scanner runs ffmpeg there. The original path is only read. A second trim on that PC waits until the first one finishes or stops reporting (20 minutes).

Accurate mode re-encodes from the exact in and out points. Fast mode copies from the nearest earlier keyframe. The server and the scanner both check the new duration before the clip is added to the library. When it is added, it keeps the source file’s project and publishing links, and any project or publishing title chosen in the editor.

Rebuild:

```bash
docker compose up -d --build --force-recreate migrate api worker web
```

The Windows scanner also has to be replaced (`pnpm agent:build`, copy `apps/scanner-agent/dist/creatoros-agent-windows-amd64.exe`, restart the service, do not re-pair). Until then a saved trim stays queued.

## Verification on 2026-11-04

Domain tests for the path plan, the range checks, and the ffmpeg argument order passed (`pnpm --filter @creatoros/domain test`, 87 tests). API and services typecheck passed. This host has no Go and no ffmpeg, so the scanner tests were not compiled here.

The same accurate and fast ffmpeg arguments were run in a Debian container:

- Landscape 320×180 with audio, cut 0.700s–2.100s, accurate: output 1.500s, video and audio kept, source byte size unchanged.
- Same file, fast copy: output 2.292s, which is the earlier keyframe. Audio kept.
- Portrait 180×320 with no audio, cut 0.200s–0.900s, accurate: output 0.767s, still portrait, no audio track.

Files on the two Windows PCs were not trimmed. That needs the new scanner on each PC and a save from the editor.


# Cursor Agent implementation prompt — Kemokem Audio Sync + Motion References

**Repo:** `goyalvipul/creatoros` (Kemokem). Use the attached `KEMOKEM_AUDIO_SYNC_AND_MOTION_ARCHITECTURE_v3.md` as the detailed source of requirements.

Act as a senior TypeScript/Next.js/Node/FFmpeg architect, backend engineer, test engineer and MiniMax H3 workflow integration engineer. **Implement this feature end-to-end; do not stop after writing a design.** Do not push to production or merge to main. Create a feature branch (suggested: `feature/kemokem-motion-reference-sync`) after checking for uncommitted work. Preserve existing unrelated work. Investigate actual source code and configuration before editing.

## Desired UX
I upload the final song **once** and optionally a long dance-reference video **once** to a Kemokem long-video project. I import a Mehak JSON plan with prompts, scene images, exact song ranges, and optional motion-video mappings. Kemokem attaches the correct audio excerpt and correct trimmed video-reference excerpt to each H3 generation. If I change a scene length, that time moves between adjacent scenes **in both song and linked motion**, and if a next scene is entirely consumed, that next scene disappears with Undo available. No desynchronization, gaps or repeated lyrics. Story-only clips continue unchanged.

## Investigate FIRST — current bug, not assumptions
Focus on:
- `packages/domain/src/long-video.ts`: `parseClipPlan`, `spansFromClipSeconds`, `resizeSceneSpan`, `generationSeconds`.
- `packages/services/src/long-videos.ts`: `importLongVideoPlan`, `resizeLongVideoScene`, `syncQueuedSong`, `queueLongVideoGroup`, reference storage and export.
- `packages/services/src/h3.ts`: `cutAudio`, `audioTrim`, `audioStartSec`, `audioUseSec`, `buildH3Prompt`, audio track fields, video track fields, `audio_locked`.
- `packages/db/src/schema/long-video.ts`, API routes, UI `apps/web/src/app/(app)/comfy/long-videos.tsx`, actual MiniMax H3 workflow/worker format.

Known code smell in publicly inspected branch: JSON `clip_duration` is accumulated into scene song boundaries, even though user JSON's `song_details` contains independent exact song ranges and `clip_duration` includes generation handles. This plausibly causes the exact user symptom: Kemokem preview scene audio differs from audio attached to H3. **Reproduce, confirm, and fix rather than assuming this is the sole cause.** Also verify that FFmpeg source audio slice matches the DB and waveform, and check grouped multitrack H3 frame offsets.

## Work in four deliverable phases
### P0 — Fix audio NOW
1. Make master-song scene start/end the single authoritative timeline for import, UI, preview, FFmpeg trim, H3 job and final export.
2. Parse `song_start_ms` / `song_end_ms` from JSON v2. For legacy v1, parse existing `song_details` `Song time: X-Y seconds` where unambiguous; validate contiguous coverage. Do **not** build song boundaries from `clip_duration` when exact ranges exist. Handle legacy files with no exact ranges conservatively: only accept duration-inferred ranges if they reconcile with song duration, otherwise show an actionable error.
3. Treat `clip_duration` solely as **requested H3 footage duration**, with video handles. Keep audio excerpt exactly `[scene.startMs, scene.endMs)`; never borrow from another scene to fill extra video. Keep master song untouched in final edit.
4. Add per-scene diagnostics of saved range, submitted H3 `audioStartSec/audioUseSec`, actual trimmed source duration/hash, requested render length. Ensure pre-H3 audio preview is exactly what goes to H3.
5. Add fixture tests using prior Zaya Lo JSON (149.232s song time vs 164.068s source footage) and fractional-boundary/lyric examples. Avoid embedding private music in tests; synthetic audio signals can verify exact offsets.
6. Validate `context` mapping from existing JSON to scene continuity; fix only if it is actually dropped and regression-test it.

**Acceptance:** legacy real JSON imports with no song-time drift; H3 receives audio matching the visual segment's intended audio for multiple adjacent clips; queued job and UI agree; final export uses the full master once.

### P1 — Exact resizing rules
Implement transactional, tested boundary edits:
- Start `[0,10)`, `[10,20)`, `[20,30)`.
- Grow first 10→12: `[0,12)`, `[12,20)`, `[20,30)`.
- Shrink first 10→7: `[0,7)`, `[7,20)`, `[20,30)`.
- Grow first 10→20: `[0,20)`, REMOVE/archive fully consumed second; third stays `[20,30)`.
- Grow first 10→24: `[0,24)`, consume second and take 4 from third → `[24,30)` remaining third; flag scene for content/motion review as appropriate.
- Reject edits exceeding total available song time, maintain continuous exact coverage, stable clip IDs, immutable song duration and Undo for removed scene metadata/takes.
- A scene >15s is valid as a **song segment** but must be divided into permissible H3 generation shots or generation blocked with a useful split message, never silently truncated.
- Mark impacted generated takes stale. Prevent race conditions with queued/running jobs; revalidate before dispatch. If the last clip is edited, preserve established trade-with-previous semantics only with explicit UI feedback or prohibit it with clear explanation.

### P2 — Motion Reference Engine
1. Add authenticated project motion-video upload once; persist immutable source metadata, secure stored ID, duration and checksum; reuse across clips, preserve across JSON re-import.
2. Add **backward-compatible JSON v2** parsing while retaining original Mehak/Zaya Lo JSON keys/types. New root: `schema_version`, `motion_sources`, `motion_tracks` with anchor pairs. New optional clip: `clip_id`, `song_start_ms`, `song_end_ms`, `motion_ref`. See attached architecture.
3. For linked motion mapping, compute video range from **absolute song-time-to-video-time anchors**, with piecewise-linear interpolation. Never equate audio and motion seconds when different songs/BPM are involved. After a resize, recalculate affected trims from original anchors (not by repeatedly adding offsets). If ranges exceed approved track, flag Needs review.
4. FFmpeg-trim the needed source video (silent, accurate times, seek/PTS normalization), cache outputs, verify durations and H3 limits. Do not modify original source. `images_attached` contains images only.
5. Inspect the **actual installed H3 multitrack workflow** and connect the reference MP4 to the correct H3 video-reference input for each segment. Current inspected `buildH3Prompt` clears the video track: implement a real track/input connection, not just text `<Video 1>` or a fake placeholder. Preserve canonical Picture 1 and per-scene image order. Do not automatically include motion-reference audio as song audio.
6. For a boundary resize affecting compatible linked tracks, update both song ownership and derived motion ranges. For incompatible source/track/wardrobe/lyric changes, keep the automatic **audio** edit but show Needs motion remap / Needs content review and block generation until resolved.
7. Add project source list, per-scene motion selector, frame-accurate source trim preview, derived in/out display, warning statuses and Undo.

### P3 — Tests, safety, documentation and delivery
- Unit tests for v1/v2 imports, exact continuous song coverage, source/time anchor mapping, user resizing cases including complete deletion and multi-scene cascading, source validity, no-motion scenes, 15s limits, re-import idempotence, stale-render handling.
- Integration test / test harness that confirms the *actual H3 worker graph* contains the distinct correct motion source trim AND the intended audio for two consecutive dance clips. If an installed graph doesn't expose video reference, document the blocker and do not claim completion.
- Security: authenticated media endpoints, upload type/probe and size validation, safe filenames/paths, tenant isolation, no dangerous FFmpeg argument interpolation, no untrusted remote URLs, no leftover temporary media, resource limits, logs without secrets.
- Preserve existing STORY and HYBRID behavior. Existing v1 JSON files remain supported. Build should pass typechecking, lint, unit and selected integration tests.
- Update relevant docs/UI help. Deliver files changed, schema migration steps, tests/run output, screen walkthrough, exact manual validation steps, remaining risks and deployment/rollback instructions. **Do not deploy or merge automatically.**

## Hard requirements
- Master song audio = single source of truth; never substitute total `clip_duration` for real song time.
- Correct audio reaches H3: don't confuse correct final export audio with correct per-segment **input** audio.
- User can change scene length; next scene automatically gives/takes time; fully consumed next scene is removed and recoverable.
- Correct video reference is assigned per segment from one uploaded long video; changing scene length updates the motion trim when compatible.
- Keep existing `prompt`, `images_attached`, `image_details`, `song_details`, `clip_duration`, `vocal`, `context` semantics and output structure; additive v2 only.
- If a motion change makes choreography/scene references incoherent, flag it and block generation rather than producing an incorrect clip.
- Do not replace actual implementation with instructions for the user to pretrim videos manually.

## Implementation reporting
At the end of each phase, report: cause found, code changes, automated test evidence, exact manual test to run, and blockers. **Proceed through all feasible phases; do not stop at a proposal.** If authentic H3 video-track schema cannot be verified, complete P0/P1 and v2 media plumbing, clearly document P2's remaining integration limitation, and do not claim video references are being sent.

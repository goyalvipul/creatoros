# Kemokem: Audio Timeline Repair + Motion Reference Engine
**Architecture & acceptance specification v3 — 2026-11-17**
**Status:** proposed implementation; no source edits or deployment performed.

## 1. Decision
Make **one authoritative song timeline**; keep H3 generation duration and reference-video source time separate. Let users upload each full dance motion video once to Kemokem. Every scene optionally selects a motion track, and Kemokem derives the correct 2–15s silent source excerpt at generation time, based on exact song-time boundaries. Resizing a scene updates adjacent song ownership and linked motion ranges together.

**Sequence of delivery:** P0 fix wrong song-to-scene alignment; P1 implement boundary resizing including exact-consumption removal; P2 implement motion-video references and H3 handoff; P3 preview, regression tests, observability. Deploy/test P0 independently before P2 if possible.

## 2. Observed code, and what is / is not yet proven
Checked accessible default branch of `github.com/goyalvipul/creatoros`, 2026-11-17. Deployment may differ:

- `packages/domain/src/long-video.ts`: `parseClipPlan` accepts legacy clip keys (`clip_name`, `images_attached`, `clip_duration`, `vocal`, `prompt`, `song_details`, `image_details`) but not typed song ranges or motion assignments. `spansFromClipSeconds()` constructs contiguous song ranges **from `clip_duration`**, not the song ranges in `song_details`.
- `packages/services/src/long-videos.ts`: `importLongVideoPlan()` uses that duration accumulation; `queueLongVideoGroup()` sends `audioStartSec=scene.startMs/1000`, `audioUseSec=(scene.endMs-scene.startMs)/1000`, and independently computes `generationSeconds()`.
- `packages/services/src/h3.ts`: `cutAudio` uses FFmpeg on a selected range and uploads the result to a worker; the H3 multitrack builder generates audio track entries, but currently sets each task's `media_type: 'none'` and clears its video track. Thus adding a JSON video filename alone is insufficient; actual video-reference track integration is unimplemented in the inspected path.
- `packages/domain/src/long-video.ts` `resizeSceneSpan()` currently rejects reducing a neighboring scene below 1 second. It cannot *fully consume and remove* the next scene.
- `packages/services/src/long-videos.ts` `syncQueuedSong()` only updates queued audio start/use and duration, not motion bindings (yet).
- `packages/db/src/schema/long-video.ts` `longVideoRefs` have `kind`, but `addLongVideoRef()` accepts images only. Project-level original motion media need durable storage/ID independent of image import.

**Bug hypothesis, not proven deployed root cause:** source JSON may correctly say `Song time: 45.000–53.000s` but importer may place it using accumulated 8.5-second *generation* durations. The audio clip heard in H3 can therefore be different from the intended song section. Verify the deployed revision and trace actual FFmpeg output before claiming complete fix.

## 3. Timeline invariants (highest priority)
- Master audio duration `D` is authoritative. Every scene owns one half-open song interval `[songStartMs, songEndMs)`.
- `songStartMs`/`songEndMs` are independent of `clip_duration` / H3 requested footage duration.
- Timeline coverage must be exact: first start `0`, every `end(i)=start(i+1)`, final end `D` (allow only documented millisecond/sample rounding tolerance). No overlaps or gaps, no audio duplicated or stolen silently.
- One project timeline service/function is the **only** authority for importing, editing, audio trimming, motion mapping, preview, job queue, and export.
- Each generation request logs its **resolved** song range, trimmed-audio hash and duration, motion source ID + derived source range, H3 requested video duration, selected references, model/workflow version, scene version.
- H3 can request extra video handles. They must never shift the audio slice, reassign lyrics, repeat the song, or extend into the next scene. Final export uses the original master soundtrack.
- Maintain frame/sample rounding consistently: integer milliseconds for user state, probe-verified accurate trim and <= one output frame tolerance for video placement, not 500ms–2s cumulative drift.

## 4. JSON schema v2 (additive; legacy v1 preserved)
Keep all existing root properties: `project_name`, `song_title`, `reference_assets`, `timeline_note`, `clips`. Keep existing clip properties and value types: `clip_name`, `images_attached`, `clip_duration` (number, **H3 generation seconds**), `vocal` (`yes`/`no`), `context` (boolean), `prompt`, `song_details`, `image_details` (strings).

New optional root fields:
- `schema_version`: `2`.
- `motion_sources`: `[{"id":"dance_master_01","filename":"dance_full.mp4"}]` — name resolves to an uploaded, validated, private project asset ID; no filesystem paths in imported JSON.
- `motion_tracks`: `[{"id":"chorus_01","source_id":"dance_master_01","song_start_ms":42000,"song_end_ms":58000,"anchors":[{"song_ms":42000,"video_ms":12000},{"song_ms":58000,"video_ms":28000}]}]`.

New optional clip fields:
- `clip_id`: persistent stable semantic ID, e.g. `clip_007`, never use index as a permanent identity.
- `song_start_ms` and `song_end_ms`: exact absolute source-song range.
- `motion_ref`: `{"track_id":"chorus_01","sync_mode":"linked"}`; absent for narrative/no-dance segments. Future `fixed` mode must have explicit source in/out with no automatic extension.

**Legacy v1 migration/compatibility:** If `song_start_ms/end_ms` absent, parse narrow, unambiguous `Song time: <number>-<number> seconds` inside `song_details` when present; verify complete contiguous coverage and total duration. If absent or ambiguous, use sequential durations **only when the sum reconciles with exact master song duration within a small, documented tolerance**; otherwise show blocking validation with remedies. Never silently replace verified timestamps with cumulative generation handles or permit a 15-second discrepancy as a legitimate audio plan. Preserve `context` semantics on import if supported by current rendering; inspect and correct mismatches.

Validation: numeric finite safe integers, bounds, no duplicate IDs, source ID exists, uploaded media fingerprint verified, monotonic track anchors within motion source duration, all track mappings valid, JSON size / count limits, controlled MIME, legacy backward compatibility. Unknown v2 keys should not be silently ignored in a v1 importer; require explicit version support.

## 5. Full motion source upload and time mapping
- Upload 1+ originals (MP4/MOV as supported) once per project via authenticated API. Store immutable original + content hash + ffprobe metadata + duration. Media references survive plan reimports and scene deletion. Reject unsafe paths, oversized/unrecognized/malformed files and user-to-user access.
- For a linked motion track, anchors map *absolute song milliseconds* to *absolute source-video milliseconds*. Between adjacent anchors `(sa,va)` and `(sb,vb)`:
  `v(t)=va+(t-sa)*(vb-va)/(sb-sa)`. Interpolate piecewise when there are >2 anchors.
- For scene `[S,E)`, derive `[v(S),v(E))` **from stable original anchors** after every edit; do not accumulate trim offsets through repeated resizes. If a mapping crosses outside approved source track, becomes non-monotonic, exceeds model limits, or retiming is implausible, set **Needs review / Block generation** rather than silently using unrelated dance.
- Trim silent video on demand with FFmpeg (`-an`, accurate seek, normalize timestamps/fps/pixel format), cache by source hash + trim parameters, and validate exact duration. The original remains untouched.
- Send video in the **actual H3 video-reference field/track** supported by the installed `MiniMax H3 Motion Context FINAL API.json` and selected mode. Do not assume the video's position in a task prompt is enough. Inspect the actual workflow graph and run a single live integration test. Protect image reference order and existing H3 song-audio path. `images_attached` remains images only.
- H3 reference-video limits must be enforced by selected model/implementation (research indicates up to 15 sec combined references and each reference >=2 sec). A longer song scene may require multiple H3 generation units. Never truncate user-owned song time.
- Motion-video audio is NOT the song master; strip motion audio unless approved for an explicitly different purpose. Continue allowing H3 audio track from the *correct* song slice if current workflow needs it; use the full master song for final edit.

## 6. Resize semantics — required, including complete consumption
For song scenes `A=[0,10)`, `B=[10,20)`, `C=[20,30)`:
1. **Increase A to 12s:** `A=[0,12)`, `B=[12,20)`, `C=[20,30)`. Audio for B loses the first 2s; linked motion for both A and B derives from their new song ranges.
2. **Decrease A to 7s:** `A=[0,7)`, `B=[7,20)`, C unchanged. The returned 3s become the beginning of B's audio; linked video mapping updates appropriately. Check B's H3 15s limit; split generation as needed.
3. **Increase A to 20s:** `A=[0,20)`; B has **zero** remaining and is automatically **removed/archived**, not left as a 1s stub; `C=[20,30)` remains. Preserve B's prompt/images/takes in undo/history; mark affected clips stale.
4. **Increase A to 24s:** consume B completely and take 4s from C: `A=[0,24)`, `C=[24,30)`. This is forward cascading consumption. Require review if C has different story, look or motion track.
5. **Decrease A from 10 to 7:** B gets the 3 seconds; no gap, no negative lengths.
6. If only the last scene exists, it must remain the song duration. If editing the last scene's length, either explicitly preserve established trade-with-previous behavior with clear UI, or block with explanation; **never** silently change whole song duration.
7. A scene cannot have zero or negative duration after normalization. Remove fully consumed rows atomically and renumber positions without breaking stable IDs. Provide undo before destroying media references/takes. If song time crosses a narrative/choreography boundary, flag the surviving scene for prompt and reference review before render.
8. If a scene becomes > H3's 15-second output cap, keep its song segment but **split the render into multiple generation units** or block render with actionable split guidance; do not auto-cap and lose audio. When using split units, expose them as distinct production shots, not extra song time.
9. Concurrent edits while queued/running: reject or use atomic invalidation/cancellation protocol; never leave a queued H3 job using stale audio/reference ranges. Generated takes from older source ranges become `outdated`, but remain accessible.
10. `undo` or edit history restores segments, saved metadata, and reference bindings safely.

**Important distinction:** *Song time* is redistributed automatically. *Motion video time* is redistributed automatically **only** when both affected scenes are covered by an approved compatible linked synchronization track. Otherwise mark **Needs motion remap**; do not invent choreography.

## 7. Audio desynchronization investigation and repair (P0)
Audit and trace at least:
1. JSON values (`song_details`, v2 numeric ranges, `clip_duration`), parser output and saved DB `startMs/endMs`.
2. Scene preview/waveform vs submitted H3 task: source master name/hash; `audioStartSec`, `audioUseSec`, requested `durationSec`, queued/resumed job snapshots and current scene revision.
3. FFmpeg `cutAudio` start/use and its actual output; decode into sample-accurate correlation against the master (not only duration or file names). Include a manual waveform/audio side-by-side test.
4. H3 `buildH3Prompt` audio track `start_frame/end_frame`, audio asset path, `audio_locked`, work-flow graph, 24fps frames, and how extra generated video handles interact with shorter audio.
5. Export path: output videos trimmed to actual song scene length and final master audio used exactly once.

Fix verified root cause(s), including `importLongVideoPlan` using `clip_duration` as song time. Fail fast on mismatched import time map. Add a visible **Song range vs H3 input audio range vs H3 requested video duration** diagnostic row for each scene, plus copyable debug export. Make preview play the exact audio range which H3 receives (before model changes), with an audio fingerprint comparison after rendering/upload where possible.

### P0 tests
- Legacy Zaya Lo example has ~149.232s song timeline but ~164.068s generation footage. Import must produce the **exact 149.232s song timeline**, not accumulate 164.068s as audio; audio trims must follow `song_details` time ranges.
- Run at least three cases with fractional seconds, repeated lyric lines and nonzero generation handles; verify intended lyric for clip N reaches H3, without shifted pickup or overlap.
- Resize boundary then queue, edit/queue interactions and replay/preview must all agree on audio location.
- Final song output length must not be affected by extra H3 footage.

## 8. UI and acceptance
- Keep current editing workflow. Add project `Motion videos` upload/list (duration, thumbnail, source ID); a per-scene `Motion reference` selector, source trim preview, chosen track ID, and status.
- Timeline shows separate `song_start / song_end / song duration` and `H3 render duration`. Display audio preview that is derived from the same timestamp range sent to H3.
- When resizing, instant preview shows updated song + video ranges and any warnings. Collapse fully consumed scenes with undo.
- Show clear states: No motion, Ready, Missing source, Needs sync anchors, Outside approved track, Reference too short/long, Re-render required, Generation running.
- Do not regress legacy STORY mode: v1 JSON must still import, non-dance scenes require no video, usual image reference and GPU assignment remain functional.

## 9. Build/test files likely affected
- `packages/domain/src/long-video.ts` + unit tests: import ranges, contiguous timeline, cascading resize, anchor mapping.
- `packages/services/src/long-videos.ts`: plan import, DB persistence, edit transaction, stale flags, audio/movie trim, H3 dispatch.
- `packages/services/src/h3.ts`: actual video track/mode wiring and audio timeline tests.
- `packages/db/src/schema/long-video.ts` + migration: original sources and motion-track anchors, clip binding, stable IDs/revision.
- `apps/api/src/routes/...`: authenticated upload, previews, asset metadata, validation.
- `apps/web/src/app/(app)/comfy/long-videos.tsx`: source uploader, motion binding UI, derived preview and resize semantics.
- Existing worker/media processing route; integration tests with actual installed H3 graph and FFmpeg.

## 10. Required acceptance demonstration
1. Import a legacy song JSON containing intentional generation handles; verify exact lyric ownership, contiguous full song and H3 trimmed audio matching preview (playback + signal test).
2. Import v2 with one uploaded 30+ second motion source and two linked scenes. Show correct distinct reference-video trims in H3 actual task graph and preview.
3. Resize boundary both directions: song and video change together for compatible track.
4. Consume 100% of next scene: automatically archive/remove it and demonstrate undo; no gaps/overlap.
5. Consume >100% across multiple scenes; ensure cascade, stable IDs, warnings for changed wardrobes/motion.
6. Split or warn on >15-second generation request, without dropping song time.
7. Re-import legacy JSON and storyboard STORY-only project: no regressions; existing tasks and media references stable.
8. Provide screenshot or test evidence for each plus typecheck/lint/unit/integration test results and explicit remaining limitations.

**Do not claim feature complete until the H3 worker receives the correct actual trimmed video and receives the correct actual song audio.**

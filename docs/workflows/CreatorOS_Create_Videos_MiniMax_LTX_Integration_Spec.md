# CreatorOS — Create Videos: MiniMax H3, LTX, GPU Workers & Publishing Integration

**Version:** 1.0 — 2026-10-22  
**Status:** Proposed implementation specification, anchored to the user's uploaded API workflow and Easy-Media documentation. Not a claim that any integration has been deployed or tested.  
**Companion to:** `CreatorOS_AI_Agent_System_Master_Specification.md`. This is a detailed **video-production module addendum** and takes precedence for video-specific requirements.  
**Goal:** Create a named video project in CreatorOS, edit a multi-track MiniMax H3 timeline with references, locked audio and per-segment prompts, choose an eligible RTX 3090/3060 workstation, run the *actual version-controlled ComfyUI API workflow*, preview/save/regenerate versions, approve outputs, and hand those exact assets and metadata to CreatorOS Publishing. Add LTX via its own validated workflow adapter.

---

## 0. Instructions for Claude Code/Cursor or any implementation AI

- Read this specification together with the CreatorOS master specification, and inspect the **actual** CreatorOS repository. Do not assume the project's stack or current features. Reuse existing auth, brands, assets, projects, scheduled posts, webhooks, DB, job queue, UI components and backups.
- Use the uploaded workflow file `MINIMAX H3 Motion Context FINAL (fixed) API.json` as the *source template*. Store a clean copy under a versioned workflow registry. Its input paths, project name, output history and example media are **not** reusable as-is. Never mutate the uploaded original.
- Before implementing a custom-node adapter, query each live worker's `/object_info` (including the classes below), `/system_stats` and `/features`, record node versions/models and validate the workflow on the target. Do not claim RTX 3060 support without an actual successful controlled generation.
- Deliver a native CreatorOS UI rather than merely an iframe to ComfyUI. It is fine to reuse code/libraries compatible with the Easy-Media track data schema when their licensing and APIs allow; **do not assume the Easy-Media node frontend can be embedded directly**.
- Build through testable stages and update `docs/ai-agent-system/IMPLEMENTATION_STATUS.md` after each stage. No live publishing or unapproved high-cost generation.

---

## 1. Intended user experience and navigation

Create a new **left sidebar item: `Create Videos`** with routes following the existing CreatorOS routing conventions. The left nav item opens a project library showing recently edited projects, status, brand, engine, thumbnail, aspect ratio, duration, modified time, target channels, selected worker and action buttons.

Top-level creation tabs: **MiniMax H3** and **LTX** (LTX is a distinct backend adapter and timeline mapping, not an assumption that the H3 pipeline works with LTX). Support future engines through a pluggable registry.

Within a selected project:

1. Persistent header: project name editable, internal ID, brand (Mehak default), engine, unsaved/saved indicator, scene count, total duration, status, last edit, Auto-save, Duplicate, Archive, Export workflow JSON.
2. Left or top media drawer: upload or choose existing **images, audio, video**, canonical Mehak references and other approved assets; upload status, thumbnail, metadata, hash and file source.
3. Central multi-track editor: task/shot track, video result track, audio track(s), optional subtitle/marker track. Waveform and time ruler, zoom, scrubbing, playhead, drag-drop and resize. Timeline uses **integer frame coordinates** internally and shows seconds/timecode in the UI. Respect frame rate and segment alignment constraints validated by the target engine.
4. Segment inspector: title, prompt, prompt reference map, negative/hard constraints, continuity mode, task mode, attached images with ordering, audio region, audio locked/muted, segment start/end, duration, workflow preset, seed/LoRAs/advanced settings, last run/approved version.
5. Hardware selector: `RTX 3090 (24 GB)` and `RTX 3060 (12 GB)` with **Online / Busy / Unsupported / Offline / Missing model** states. Unsupported workers cannot be selected for incompatible templates.
6. Generation controls: `Validate`, `Generate selected scene`, `Generate from selected scene`, `Generate all`, `Generate preview`, `Stop queued run`, `Cancel running run` (with ComfyUI limits). Display explicit warning about **dependent downstream Context scenes** requiring regeneration when an upstream scene changes.
7. Results: progress per scene / queue position / selected worker / errors / estimated resources / job log, original source previews, generated version gallery, side-by-side compare, video player, approve/reject/regenerate/download and `Assemble final`.
8. `Send to Publishing` attaches an **approved immutable asset/version**, campaign/project title, optional thumbnail, audio/video metadata, platform-specific draft fields and target social accounts to an existing CreatorOS Publishing draft. Do not publish merely by clicking `Send to Publishing`.

Mobile/PWA: responsive project list, media upload, project status, preview and approvals. The full draggable timeline may use an optimized tablet/desktop layout; on phone offer a functional scene-list editor rather than an unusable scaled desktop timeline.

---

## 2. Confirmed observations from the uploaded MiniMax API JSON

It is an **API-format graph** with 18 nodes, node ID → `{class_type, inputs, _meta}`:

| Node | Class | Role |
|---|---|---|
| `29` | `easy multiTrackEditor` | Stores editor settings and serialized `track_data` (string of JSON) |
| `15` | `easy multitrackProject` | Performs H3 project generation and segment loops using node 29 |
| `17` | `easy multitrackProjectVideoCombine` | Combines saved project clips; contains serialized `project_data` snapshot |
| `25` | `easy saveVideo` | Saves resulting combined video |
| `10` | `CLIPLoader` | Loads Qwen3-VL MiniMax H3 text/vision encoder model |
| `11` | `UNETLoader` | Loads MiniMax H3 Ref2V model |
| `1`, `2` | `VAELoader` | Audio VAE and video VAE |
| `16` | `easy modelLoaderPack` | Bundles model/CLIP/VAEs |
| `20`, `24` | `KSamplerSelect` | First and second pass samplers |
| `22` | `BasicScheduler` | Custom beta scheduler, 8 steps |
| `33` | `ManualSigmas` | Second-pass sigmas (irrelevant in single mode) |
| `27` | `MiniMaxH3MemoryEfficientSageAttentionPatch` | Memory-efficiency patch |
| `36` | `Power Lora Loader (rgthree)` | Two enabled LoRAs; third disabled |
| `21` | `ModelPreviewOverrideKJ` | Preview configuration |
| `37`, `38` | `LoadAudioUI`, `SaveAudioAdvanced` | **Separate audio-extraction/save branch**; not the locked audio segments in node 29 |

**Current node 29 track_data:** `frame_rate=24`, `total_length=405` frames = **16.875 seconds**, 9:16 portrait, current image editor output shows 768×1376.

- Task segment 0: `[0,213)` frames = **8.875s**, `task_mode=ref`, `continuity_mode=shot`, one image reference, ~3967-character custom prompt.
- Task segment 1: `[213,405)` frames = **8s**, `task_mode=ref`, `continuity_mode=context`, one shared reference, ~3967-character custom prompt.
- Video track exists but is initially empty.
- Audio track has two **locked** WAV segments with corresponding frame ranges and durations 8.88s and 8s; their old filename references exist in the JSON but do not imply those files exist on other GPU nodes.
- H3 project node 15: `project_name=longtake_demo`, `project_save=override`, `segment_start_number=1`, `segment_count=-1`, seed `605426809192638`, `sampling_plan=custom`, `sampling_mode=single`, `upscale_by=1.5`, `enabled_tiling=false` (as a string in this export).
- Model filename examples: `Minimax-h3_Singularity_ref2va_v1.3_int8.safetensors`; `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`; `minimax_h3_audio_vae_fp32.safetensors`; `minimax_h3_video_vae_int8_convrot.safetensors`; `minimax_h3_latent_upscaler_3d_fp16.safetensors`.
- Enabled LoRAs include `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors` at 1.0 and `h3-realism-people-t2v-i2v-r2v.safetensors` at 0.7. These exact filenames must exist on the selected worker and be compatible.
- Node 17's `project_data` references **existing historical output paths** such as `easy_media/projects/longtake_demo/video_0_1.mp4`. These must be treated as stale preview/cached state when cloning a project, not as valid output for a new run.
- Nodes 37/38 refer to a **separate** `Tika Tika Tum.mp3` input with selected 80–110s. Do not conflate this branch with the task timeline; identify whether needed, and disable/remove when not intended to execute.

**Risk warning:** Easy-Media's documented `project_save=override` and full regenerate settings can invalidate/delete saved later segments on the backend. Never blindly reuse `longtake_demo`, and never overwrite earlier project versions without clear user intent, safe snapshots and context handling.

---

## 3. Easy-Media interoperability and engine-specific semantics

Easy-Media v1.3.x documentation (verify actual installed version):

- The **MultiTrack Editor** emits `TRACKS_INFO` and can provide UI for multiple engines, but **MultiTrack Project** described here is a MiniMax H3 segment-generation pipeline, not a universal LTX processor.
- `shot` is independent generation; `context` inherits previous audio/video latent context; `context_drift` is specialized drift-controlled continuity. **Context cannot guarantee perfect identity or seamless visual join**.
- `audio_locked=true` means provided task audio constrains generation and is used in final media (subject to real workflow functionality); it is different from audio serving as a reference.
- Audio/video media are lazily loaded in newer Easy-Media; `TRACKS_INFO` contains data and media references. Do not require all media to be preloaded into a single large ComfyUI tensor.
- H3 project output includes segment files, context latents and project records under the GPU server's **ComfyUI output `easy_media/projects/<project_name>/`**. Persist the mapping to a CreatorOS project ID and assigned worker.
- MultiTrack Project combines/exports after generation; can select saved versions. Validate the actual `easy multitrackProjectVideoCombine` interface before automating version selection.
- H3 continuity semantics and frame/time quantization must be determined from the live node schema/version and tested against one/two-segment jobs.
- `sampling_mode=single` does **not** mean the `upscale_by=1.5` switch necessarily upscales the final output; Easy-Media documents upscaling as a dual-pass feature. Display actual effective resolution, not guessed resolution.
- Do not expose every raw ComfyUI parameter initially; keep the graph as a versioned validated preset and expose stable, typed controls.

**Source references:**
- https://github.com/yolain/ComfyUI-Easy-Media
- https://github.com/Comfy-Org/docs/blob/main/development/comfyui-server/comms_routes.mdx

---

## 4. Project persistence and immutability

Minimum logical entities (adapt existing schema; never create duplicates needlessly):

**VideoProject**: id, brand_id, owner_id, title, slug, description, engine, engine_template_version, version, aspect_ratio, width, height, frame_rate, status, default_worker_id, thumbnail_asset_id, final_asset_id, target_channels, publication_draft_ids, created_at, updated_at, archived_at.

**VideoProjectTimelineRevision**: id, project_id, revision, timeline_json, schema_version, hash, author_id, created_at, validation_results. Scene start/end in frames; references to CreatorOS media IDs; never embed untrusted local filesystem paths as canonical media identifiers.

**VideoTrack** / **VideoSegment** (either structured tables or versioned JSON, depending on existing DB): task/audio/video track type, order, segment index, start_frame, end_frame, mode (`shot`/`context`), task type (`ref`, etc.), prompts, image IDs, audio clip IDs/ranges, locks, mute/volume and prompt/reference versions.

**VideoGenerationRun**: id, project_id, timeline_revision_id, requested_scene_indices, dependency_range, workflow_template_hash, assigned_worker_id, ComfyUI_prompt_id, native_project_name, status, progress, started_at, finished_at, error, budget, source_snapshots, created_by.

**VideoSegmentVersion**: project_id, segment_id, generation_run_id, video_asset_id, thumbnail_asset_id, worker_output_ref, input_hash, continuity_lineage_id, qc_status, approved_at, created_at.

**GpuWorker**: id, label, private_endpoint_ref, gpu_name, vram_total, host_os, online, last_seen, queue_depth, node_schema_digest, model_inventory, workflow_compatibility, max_concurrency, maintenance_mode.

**CreatorOSAsset**: reuse existing entity; track SHA256, media file, MIME, duration, fps, resolution, target platforms, provenance, poster, transcoded variants, safe URL, approval version.

### Save behavior

- Auto-save UI edits as revisioned CreatorOS timeline state.
- Create a fresh **native ComfyUI project identifier** per CreatorOS project or generated version (e.g. generated UUID-based identifier); never reuse generic `longtake_demo` across projects.
- Keep source assets and rendered outputs immutable; never allow backend `override` to silently erase the only usable segment version.
- On scene regeneration, record a new output version. Distinguish generation from final combination.
- `Save Project`, `Duplicate Project`, `Rename`, `Archive`, `Restore` and `Export API workflow JSON` all preserve lineage.

---

## 5. ComfyUI worker registration, networking and compatibility

Workers: two configurable private endpoints, labels `RTX 3090` and `RTX 3060`. Store exact endpoint/port securely in CreatorOS settings rather than hardcoding IPs or Tailscale names. Expose ComfyUI only to trusted server/agent via Tailscale, reverse proxy authentication or firewall; by default its local HTTP API is not intended for public Internet.

Discovery/health on registration and periodically:

```text
GET /system_stats                 inspect GPU + VRAM / versions
GET /object_info                  discover installed node classes and required inputs
GET /object_info/{node_class}     verify Easy-Media/MiniMax node schema
GET /models/{folder}             discover configured model names if available
GET /queue                        local server queue status
GET /history/{prompt_id}         completed job + output references
GET /features                     server feature support
```

Compatibility gate: all referenced `class_type`s present, model files/LoRAs available, correct ComfyUI and Easy-Media revisions, workflow validates, enough memory/capacity shown by **actual generation tests**. Different image/VAEs/model paths and versions need per-worker mapping.

**Important:** RTX 3060 12 GB may be incompatible with this exact 32B encoder/H3 reference workflow or extremely slow under offload. No forced fallback; display `Unsupported for this preset` until a real test proves support. LTX/other lighter workflows may be available on 3060 where verified.

**Sticky worker:** a Context series must remain on the same worker (or explicitly migrate **all necessary project files, latents, outputs and lineage** to another worker with integrity checks). Never schedule consecutive Context segments on different workers without those dependencies.

Concurrency: configurable 1 expensive H3 generation per GPU by default; respect external ComfyUI work queues. The job runner is authoritative across CreatorOS, not browser-local state.

---

## 6. Executing the user's JSON workflow — server-side adapter contract

### 6.1 Preparation

1. Load an **immutable copy of the registered template** (18 nodes currently).
2. Deep clone for each submitted job; generate a unique ComfyUI project name and output prefix scoped to CreatorOS brand/project/run.
3. Resolve image/audio/video CreatorOS Asset IDs to uploaded/staged files on the **chosen GPU server**. Upload media via validated supported ComfyUI upload route or a private worker agent. For `track_data` `content.images[].file_path`, `content.file_path`, replace with the actual upload name/path convention validated against the worker's Easy-Media implementation. Keep filenames unique, do not overwrite shared inputs.
4. Serialize editable scenes into node `29.inputs.track_data` **as a JSON string** matching the installed Easy-Media schema. Maintain clip frame ranges, separate task/audio tracks, references, `audio_locked`, continuity modes, prompts and provenance. Adjust node 29 aspect ratio/megapixels and compatible format.
5. Set node `15.inputs.project_name`, revision-safe `project_save`, `segment_start_number`, `segment_count`, `seed`, sampling settings and validated model-dependent options.
6. Keep node `17.inputs.project_data` consistent with the chosen project/revision. **Never copy the old `longtake_demo` clip history into a new project.** The exact semantics of empty/fresh `project_data` must be verified against the installed node and tests.
7. Validate node 25 save settings and destination/output detection. Remove or deliberately opt in to separate audio branch nodes 37/38 when processing a video-only job.
8. Verify the entire graph against `/object_info` and server-side schema allowlist; reject unsupported combinations before spending GPU time.

### 6.2 Submission and progress

- Submit API graph to **`POST /prompt`** with `{"prompt": graph, "client_id": unique_id}`; retain returned `prompt_id` or validation errors and `node_errors`.
- Watch `GET /history/{prompt_id}` and/or `/ws` for queue state, progress and execution errors. Translate to CreatorOS job state: pending/running/succeeded/failed/cancelled. Poll fallback if WebSocket drops.
- **Do not confuse submitting a prompt with finishing a video.** Monitor actual completion, output existence and validity.
- Retrieve generated output via validated ComfyUI history/output metadata and supported `/view`/private file transfer routes; for custom Easy-Media project files, a narrowly scoped worker-side manifest/transfer helper may be required. Verify output path and SHA256.
- Copy approved segment and final outputs into authoritative CreatorOS asset storage, retain remote path/lineage metadata, create poster/metadata via FFprobe, serve a secure streaming endpoint or signed URL to the browser. Do not point the browser directly at an unauthenticated private GPU endpoint.
- Record exact input/assets, JSON graph hash, node versions, model checkpoint names, sampling controls and worker for reproducibility.

### 6.3 Regeneration and dependencies

- `Generate selected segment`: valid for a Shot segment. For Context segment, verify previous segment context exists and is consistent; if not, require regeneration of dependencies.
- `Generate from here`: regenerate selected segment and all dependent following Context segments, preserving preceding segments and snapshots. Confirm impact before destructive regeneration.
- `Generate all`: perform project run with versioned checkpointing; prevent concurrent jobs editing the same native project directory.
- `Regenerate alternative`: create new version and preserve old one. New alternative may need its own native project lineage; choose via explicit tested version strategy.
- `Assemble final`: select approved segment versions, validate ordering, join and audio; perform `VideoCombine`/FFmpeg as compatible, and generate a final publishable asset. Avoid accidentally rerunning expensive diffusion.

### 6.4 Cancellation / retries

- Cancel pending job by removing only the prompt owned by this project if supported by the running server.
- Interrupt running job **only when it is safe** (ComfyUI `/interrupt` is generally global to the current execution); never interrupt an unrelated job from another user/project.
- Recover on restart using `prompt_id` plus worker history. Never blindly resubmit an ambiguous completed job and create duplicates.
- Retry transient failures with backoff and bounded attempts. Surface missing models, invalid `track_data`, disk full, out-of-memory and custom node mismatch distinctly.

---

## 7. LTX engine support

LTX must be introduced as a **separate adapter** with its own imported validated ComfyUI **API-format** workflow JSON. Required fields: image/reference, optional audio when supported, prompt, negative prompt if supported, duration/frame count, fps, resolution, LoRA, seed and model-specific settings. Map the same CreatorOS UI entities into engine-specific schemas.

**Do not reuse H3 `easy multitrackProject` for LTX** without a proven LTX workflow. LTX supports varied text-to-video/image-to-video/control/edit workflows; discover the particular installed nodes, model versions and media compatibility before exposing controls.

Allow switching engine for a **new generation revision** while retaining source assets and scene intent. Do not promise the same continuity/locked audio behavior across engines until tests prove it. A project can mix engine outputs as independent shots in the final timeline, but generation states and presets must remain separate.

---

## 8. Publishing handoff, project title and assets

- The CreatorOS **project name/title** is a metadata field; use it to prefill Publishing post titles, but **allow per-platform changes**. Project name != public video title != output filename. Keep all three distinct.
- When the user approves a final asset, add it to the CreatorOS media library with `video_project_id`, campaign/brand, output version, thumbnail, aspect, duration, caption suggestions and descriptive tags.
- `Send to Publishing` creates or updates a **draft** with linked **asset IDs**; do not copy arbitrary GPU file paths into publishing. Keep asset IDs immutable and track transforms/cutdowns.
- Publishing validates each selected social account's real upload eligibility, codec/size/duration/aspect, OAuth scope, brand affiliation and target platform rules.
- Support platform-specific title, description/caption, hashtags, tags, thumbnail, scheduling, visibility, accessibility and branding disclosures. Preview before posting.
- Approval binds to specific immutable media bytes, account set, metadata version and schedule/spend. Changes invalidate approval.
- Confirm remote provider response before marking published; log platform post IDs and errors; avoid duplicate posting on retry.
- Retain link back from publishing record → video project → scene version → ComfyUI workflow and asset references.

**User-facing example**: Project `Mehak – October Thank You` → final `v3_approved.mp4` → Publishing draft for IG Reel, Facebook Reel, YouTube Short, TikTok, each with editable title/caption and optional platform-specific cutdown.

---

## 9. Suggested API endpoints — reconcile with actual code

```text
GET    /api/v1/video/projects
POST   /api/v1/video/projects
GET    /api/v1/video/projects/:projectId
PATCH  /api/v1/video/projects/:projectId
POST   /api/v1/video/projects/:projectId/duplicate
GET    /api/v1/video/projects/:projectId/timeline
PUT    /api/v1/video/projects/:projectId/timeline   (optimistic concurrency + revision)
POST   /api/v1/video/projects/:projectId/assets
GET    /api/v1/video/workflows
POST   /api/v1/video/projects/:projectId/validate
POST   /api/v1/video/projects/:projectId/generate
GET    /api/v1/video/generations/:runId
POST   /api/v1/video/generations/:runId/cancel
GET    /api/v1/video/projects/:projectId/versions
POST   /api/v1/video/projects/:projectId/segments/:id/approve
POST   /api/v1/video/projects/:projectId/assemble
POST   /api/v1/video/projects/:projectId/send-to-publishing
GET    /api/v1/video/workers
POST   /api/v1/video/workers/:id/test
```

Use SSE/WebSocket/polling according to current CreatorOS architecture. Every mutation requires authenticated brand permission, validated input, idempotency key and audit event. Separate read/preview permissions from high-cost generation rights.

---

## 10. Rollout plan and acceptance tests

**Phase A — Live compatibility proof before major UI build**

- On 3090, verify reachable authenticated/private ComfyUI API, all 18 class dependencies or safely optional branches, exact models and LoRAs.
- Upload an authorized test image and two short WAV segments to worker. Replace stale filenames/project name/`project_data`; generate one **short, inexpensive** H3 segment with exact API JSON template. Confirm `POST /prompt` acceptance, history, file retrieval and preview in CreatorOS development environment.
- Test the two-segment `Shot → Context` sequence end-to-end, preserving audio sync and verifying actual continuity behavior. Record GPU memory, runtime, failures and output folder structure.
- Test resume/regeneration without deleting approved outputs.
- On 3060, **capability-test an appropriate low-resource workflow**; do not claim exact H3 template runs on 12 GB until verified.

**Phase B — CreatorOS-native project and media lifecycle**

Implement projects, persistent metadata, asset upload, worker discovery, one-click template generation, job queue/state, preview and version history. No full timeline editor required yet.

**Phase C — Multitrack editor**

Build timeline that faithfully serializes `track_data` with multiple references, locked WAV regions, per-segment durations/prompts and context/shot selection. Test round-trip `UI → JSON → UI` without frame drift or missing media. Maintain revision history and undo/redo.

**Phase D — Versions, continuity, previews and final assembly**

Regenerate specific segments with dependency awareness; save alternatives; preview, approve; combine selected outputs with correct audio; preserve prior versions.

**Phase E — Publishing integration**

Send approved asset ID to existing CreatorOS draft, prepopulate metadata, validate platforms and schedule or publish only after explicit approval; verify provider responses and no duplicates.

**Phase F — LTX adapter**

Import separate supported LTX workflow, run compatibility tests on each GPU, expose the relevant engine-specific controls and outputs, keep shared project/asset/publishing UX.

### Required end-to-end acceptance checklist

- [ ] Sidebar `Create Videos` opens on desktop and mobile.
- [ ] New named project persists after reload/restart, correct brand isolation.
- [ ] MiniMax/LTX tabs map only to validated engine capabilities.
- [ ] Uploaded image/audio/video persists in CreatorOS asset storage.
- [ ] Timeline supports task/audio tracks, waveform, trim, prompt and reference-image ordering.
- [ ] Editor serialization to Easy-Media `track_data` survives round-trip exactly.
- [ ] FPS, frame indices, durations and audio segmentation remain aligned.
- [ ] Shot and Context sequence generates on a compatible GPU worker.
- [ ] Both GPU workers are discoverable with accurate health/capability statuses.
- [ ] Unsupported 3060 workflows are blocked, not quietly dispatched.
- [ ] One-click generation yields job status, errors, preview and permanent asset.
- [ ] Scene-specific regeneration never silently destroys an approved previous version.
- [ ] Context clips remain pinned to their native project/worker or are migrated safely.
- [ ] Cancel/restart/429/OOM/disk-full handling is visible and recoverable.
- [ ] Output is playable and downloadable inside authenticated CreatorOS UI.
- [ ] Final assembly has correct order/audio and actual measured duration.
- [ ] Approved final asset appears linked in the existing Publishing page.
- [ ] Per-platform titles/captions/scheduling remain editable.
- [ ] Publishing never occurs without required approval and provider confirmation.
- [ ] Tests prove no cross-brand access, invalid asset paths, duplicate posting or leaked secrets.

---

## 11. Important unresolved items (MUST verify, do not invent)

1. CreatorOS's current DB, frontend framework, media library, project records, scheduler, queue and publishing API.
2. ComfyUI endpoints/ports and version on each workstation, and whether each is reachable from Ubuntu over Tailscale.
3. Installed Easy-Media, MiniMax H3, custom node versions, checkpoints and LoRA files on both machines.
4. **Exact server-side semantics of `project_data`, `track_data` media file references and re-run `override` behavior** under installed Easy-Media version.
5. Whether the RTX 3060 supports any chosen H3 preset, or only LTX/lighter workloads.
6. Actual attached LTX API workflow JSON and its supported inputs/outputs (not provided in this turn).
7. Existing CreatorOS media path/storage/streaming and Windows-to-Ubuntu transfer mechanism.
8. Which social publishing integrations are production-verified and authorized.
9. Owner-approved generation quotas, storage retention, worker scheduling and approval policy.
10. Whether audio-lock precision on the installed H3 workflow matches the desired waveform segment editor in all cases.

**Final verdict:** Technically feasible and strongly aligned with CreatorOS. A **reliable** one-app workflow is an achievable engineering target; “flawless” video generation or universal compatibility across both GPUs is not a supportable guarantee. Validate the exact uploaded H3 workflow on RTX 3090 first, then build the native editor and publishing integration around proven behavior.

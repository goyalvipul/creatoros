# CURSOR MASTER DEVELOPMENT PROMPT — CREATOROS → CREATE VIDEOS → LTX 2.3

**Status:** Implementation instructions, not proof of live API compatibility.  
**Scope:** Implement a fully usable **Create Videos** area in the existing CreatorOS repository, with **LTX 2.3 Image + Audio → Video** as the first working generation flow. Build an extensible adapter architecture for H3 later, but **do not build H3 in this task**.  
**Deployment:** CreatorOS on GPU-less Ubuntu (`guardobox`), existing HTTPS app `https://os.goyalfamily.ca/`; GPU execution on Windows ComfyUI over private Tailscale. Primary RTX 3090 24 GB; optional, strictly compatibility-checked RTX 3060 12 GB.  
**Primary reference files:**
1. `CreatorOS_ComfyUI_Master_Spec.md` (architecture, queue/security/reliability/overall integration rules).
2. `LTX_IA2V_Production_Shorts-2.json` (REAL current 77-node ComfyUI **UI-format** workflow; its nodes, connections, modes, groups, embedded subgraphs, and model settings are the authoritative LTX preset).

If these two files are not yet in the repository, REQUEST them clearly or use whichever copies the owner places in `docs/ai-studio/reference/`. Do not pretend to have read nonexistent files. This prompt contains the critical node mappings, but the actual JSON is necessary for implementation and is not interchangeable with a generic LTX sample.

---

## 0. EXECUTION CONTRACT — READ FIRST

You are working in an **existing production CreatorOS**, not building a greenfield proof of concept.

1. **Start by inspecting the repository**: language/framework, package manager, APIs, auth, DB/ORM, migrations, queue/worker, Docker Compose, UI components, sidebar/router, projects, existing assets/uploads/storage, videos/preview, publishing and existing settings. Record findings in `docs/ai-studio/IMPLEMENTATION_STATUS.md`. Adapt all paths below to real conventions; examples are conceptual, not mandated paths.
2. Preserve CreatorOS data and currently deployed behavior. Take/describe an appropriate backup, migration rollback and baseline test plan. Avoid destructive commands, uncontrolled dependency upgrades, breaking route changes, replacement authentication systems or wholesale UI rewrites.
3. **Build working end-to-end functionality, not only frontend mockups**. Every control in the final UI must be connected to working backend code, or explicitly disabled with a truthful explanation. Do not fake GPU/queue/job success.
4. **Never automatically run generation** when a user edits a prompt, uploads a file, changes a slider, opens a page or loads a draft. Backend execution occurs **only after explicit Generate confirmation/press**. Validation and lightweight machine checks are permitted; never load Qwen/model or trigger ComfyUI inference for validation.
5. Respect source-workflow behavior; **patch the few supported input nodes, do not redesign/reconnect the graph**. Store the original unchanged and create an immutable per-run snapshot.
6. Distinguish **ComfyUI UI workflow JSON** from **executable API prompt JSON**. The supplied LTX file is UI-format (`nodes`, `links`, `groups`, `definitions.subgraphs`, etc.). **Do not POST this UI JSON to `/prompt`**. Obtain a matching API-format export using the owner's actual ComfyUI, verify virtual links, modes, custom subgraphs, bypasses, and dynamic nodes, then bind to API prompt `class_type` / `inputs` fields. Do not write a naïve node-ID copier that silently loses connections. If no executable export exists, implement UI/storage/validation/connection scaffolding and mark actual generation **BLOCKED: API export required**; never claim success.
7. Do not claim that RTX 3060 can run LTX 22B merely because it has ComfyUI. A machine must pass node/model compatibility checks and a tested operator-approved configuration. Prefer RTX 3090 by default.
8. Keep all ComfyUI interaction backend-to-backend over Tailscale. Do not expose raw ComfyUI 8188 publicly or put private IPs/tokens in frontend JS. Only expose an advanced editor through an authenticated, audited HTTP/WebSocket gateway when that gateway is implemented and verified; otherwise show a disabled advanced-editor action with an honest reason.
9. Make good engineering choices independently without repeatedly asking for styling approvals. Pause only for true credentials/network access/API export blockers, documented in implementation status. Never invent successful external tests.
10. Apply focused feature flags if needed, ensure existing tests/build remain passing, and don't deploy to production without the repository's established release process.

### Definition of Done
User signs in to CreatorOS → clicks **Create Videos** → selects **LTX 2.3** → chooses an existing CreatorOS project → uploads/selects a Mehak reference image and music/audio file → selects the actual song range → enters a prompt → selects compatible RTX 3090 → chooses 9:16, resolution, FPS, duration and optional advanced parameters → clicks **Validate** (no GPU inference) → clicks **Generate** exactly once → sees a durable queued/running job with truthful progress → receives playable original and optionally upscale outputs → can approve/reject and attach generated asset to the project → can click **Use in Publishing**, with media already selected and platform metadata editable. The page, browser and Ubuntu service can restart without losing the durable job record. No auto-publish.

---

## 1. PRODUCT UX — NATIVE CREATE VIDEOS PAGE

**Navigation:** add a clearly discoverable left sidebar item **Create Videos** (video/clapperboard icon). The resulting route should use the app's current routing convention; proposed path `/create-videos`. Do not hide this flow three levels deep. Make it responsive and consistent with CreatorOS PWA/mobile UI.

**Layout on desktop:**

- **Header:** `Create Videos` title, current project (or `Select project`), Save Draft, current machine status, link to recent jobs.
- **Workflow tabs:** `LTX 2.3` [enabled], `MiniMax H3` [coming later / disabled or link to existing implementation], `Other Workflows` [future], not fake working tabs. The architecture must allow future adapters without hardcoding UI to one graph forever.
- **Three-column desktop UI** if design system/breakpoints permit: left = Assets & Project; center = Generation Settings and Prompt; right = Render Queue & Preview. On mobile use a clear sequential wizard/stack with fixed-bottom Generate action when appropriate.
- **Project chooser:** existing CreatorOS projects, create new only through existing project mechanism. Every draft/job/output associates with selected project (or explicit unassigned draft if platform allows). Avoid constructing a second project data model.
- **Workflow preset card:** source workflow title, version/hash, execution verified/unverified, required model/node compatibility, preset change log.
- **Machine selector:** RTX 3090 (default), RTX 3060 (only if verified), health/VRAM/queue length/availability; show missing models/custom nodes or offline explicitly. User can choose Auto only if compatibility rules exist; auto never migrates active state silently.

### Input sections, in this order

**A. Reference image**
- Select from existing CreatorOS Asset Library or drag/drop/upload PNG/JPEG/WebP where supported by target `LoadImage` node.
- Show real thumbnail, name, dimensions, upload state and replace/remove button.
- Reference-to-video identity guidance in a small, collapsible tip: preserve Mehak's facial identity, hair/temple tattoo/neck tattoos/body proportions, don't imply built-in face locking that workflow cannot guarantee.
- Store original CreatorOS asset and stage a duplicate to the selected ComfyUI worker; never change original.

**B. Music / audio**
- Select existing asset or upload supported audio (MP3/WAV/etc. confirmed by installed `LoadAudio`).
- Real audio player and actual waveform if measured/decoded (client library or precomputed peaks), NOT a synthetic fake waveform.
- Editable **Start time** and **Clip duration** with timestamp labels; `End = start + duration`, source length enforced, optional in-app audition of chosen range. Make keyboard/numeric precision possible as well as drag handles. Unit conversions explicit.
- Show audio offset separately from video length. Do not infer clip length from stale node labels or stored previews.
- Source file remains unchanged. Server-side trim only when needed, with deterministic FFmpeg encoding/sample-rate rules and precise manifest; or use confirmed ComfyUI trim node if sufficient. The chosen plan must be documented and tested against workflow semantics.
- If the input is too short, block submission with precise message; do not silently loop, pad, or generate fake audio.

**C. Prompt**
- Multiline **Manual Prompt** input, default from the saved workflow, with project drafts, save prompt preset, character counter, copy, reset.
- Separate advanced negative-prompt field if supported (node 364); show previous value as default and avoid changing it unnecessarily.
- **AI Prompt mode is optional / not initially required**. The saved graph includes bypassed Qwen VL-related nodes. A switch is NOT considered working unless the executable API export actually verifies group-mode behavior; show `AI prompt mode: not configured` rather than launching Qwen behind the scenes. If implemented later, AI prompt generation must have its **own explicit Generate Prompt button**, no auto model load, machine and VRAM budget visible, and user approval before video Generate. Do NOT consume GPU by default.

**D. Video settings**
- Orientation presets 9:16, 16:9 and 1:1 only if valid after observing exact resolution/latents constraints on the installed workflow. Default **576 × 1024** (real saved values). Inputs Width, Height, FPS **30** (actual saved value), duration **20 seconds** (real saved default); validate bounds/multiples using node definitions and runtime model capabilities, not made-up hard limits.
- Advanced optional: seed (source graph seed), Mehak LoRA strength, output original/upscale policy *only if API paths are independently verified*. Default LoRA strength **0.8** (node 446 active); don't use bypassed node 449's strength 1.0.
- Resolution warnings, estimated GPU resource level if supported by measured machine profiles; never give invented render ETA. Display approximate target frame count calculated from duration × FPS as a **requested frame count**, and separately display actual algorithm-specific length once established. Do not silently assume LTX length must equal duration×FPS in every custom node.
- Expose a safe **Advanced Settings** disclosure for model name, negative prompt, seed, output format/preset, optional upscale; keep raw model file selectors administrator-only or not editable until compatibility is verified.

**E. Controls and review**
- Save Draft, Reset Unsaved Changes (confirmation), **Validate Configuration** (no generation), **Generate Video** (clear primary button) and optional Preview Last Result (saved file only).
- User must see exact selected project, image, song start/end, duration, machine and workflow version before submission. Optional low-friction confirm if estimated large resource burden; do not require multiple redundant confirmations.
- Validation errors inline, focusable and actionable. Loading indicators, keyboard navigation, accessible labels, dark/light mode support, reduced-motion preferences.

**F. Render queue / output preview**
- List jobs with queued / validating / submitting / running / collecting / completed / failed / cancelling / cancelled / unknown states; timestamps, source project, worker, workflow version, prompt excerpt and log/error details.
- Active progress from ComfyUI WebSocket node/step updates. Display `Step x/y for [node]` or `Stage: decoding`, **not fake end-to-end percent**, unless one can be measured precisely. Poll `/history/{prompt_id}` as completion source of truth. Provide reconnect indicator.
- Current preview only if the workflow actually emits one; never run a second expensive preview on opening the tab.
- Completed: built-in responsive video player, original/upscaled variant labels when each exists, download, metadata, **Approve**, **Reject/Keep as Draft**, **Create Variant**, **Use in Publishing**, and linking to original CreatorOS media. Reject means workflow decision, not necessarily delete; no destructive surprises.
- Existing outputs remain viewable while new jobs run. Browser refresh must not lose them.

### Project-level clip timeline (MVP-friendly)

Below the main generation form (or optional `Storyboard` sub-tab), show a **CreatorOS-level music-video timeline**, NOT a fake ComfyUI multitrack node. A song can produce sequential independent LTX clips:
- Whole song asset with real time ruler, play/pause and waveform; segments mark source ranges and resulting generated videos.
- Add clip row: image, audio range, prompt, settings, status, output ID; Generate This Clip / Regenerate (manual only).
- On completion allow slotting video in clip list, ordering and reordering clips, and per-clip preview. A future explicit **Assemble** action may concatenate approved clips with FFmpeg if compatible audio/video profiles; do not auto-concatenate or auto-generate clips on edit. If assembly is out of scope for MVP, keep a truthful deferred UI; don't present a fake exported movie.
- Shared reference image can be reused across clips by ID; independent LTX jobs **do not automatically preserve scene continuity** the way H3 context segments do.

---

## 2. VERIFIED MAPPINGS FROM THE UPLOADED 77-NODE LTX UI WORKFLOW

**IMPORTANT:** These are exact **UI graph IDs**, not yet verified keys in an API export. Resolve to actual executable `class_type` / `inputs` using an API-export snapshot. ID stability is per workflow version; graph changes demand binding revalidation.

| UI node ID | Node | Saved value/role | Required UI behavior |
| --- | --- | --- | --- |
| **269** | `LoadImage` | `Mehak Singing in a Blue Studio.png` | Reference image asset picker; stage to selected worker, patch `image` |
| **276** | `LoadAudio` | `AYI AYI.mp3` | Audio asset picker, stage using verified audio transport, patch `audio` |
| **9994** | `Textbox` | Current manual prompt | Bind text after verifying its path through prompt switch to active `CLIPTextEncode` |
| **607** | `Any Multi-Switch [RvTools]` | Manual prompt enters `input1` from 9994; auto/secondary path is `input2` | Preserve manual flow; validate bypass semantics |
| **358** | `CLIPTextEncode` | Positive conditioning from switch output | Do not patch this blindly if `text` input is linked; patch source at 9994 or actual API source |
| **364** | `CLIPTextEncode` | Negative prompt | Advanced negative prompt (optional) |
| **606** | `Fast Groups Bypasser (rgthree)` | `AUTO / MANUAL PROMPT SWITCH` | UI mode toggle is **not** a trustworthy ordinary API input; never guess |
| **602** | `aistudynow_QwenVL` | `mode:4` (bypassed) | No background Qwen loads; optional explicit future action only |
| **601**, **604** | `StringConcatenate`, `easy showAnything` | `mode:4` (bypassed) | Don't accidentally activate |
| **378** | `PrimitiveFloat` | `value:20` | Video target duration |
| **383** | `TrimAudioDuration` | `start_index:0`, `duration:25` stored but **duration input linked to node 378** | Expose source trim start separately; determine effective runtime trim length from link, not stale stored 25 |
| **368** | `PrimitiveInt` | `value:576` | Actual width; UI title `Width: 960` is stale |
| **382** | `PrimitiveInt` | `value:1024` | Actual height; UI title `Height: 540` is stale |
| **379** | `PrimitiveInt` | `value:30` | Actual FPS; UI title `FPS:24` is stale |
| **442** | `ComfyMathExpression` | expression `a * b`, duration × FPS | Used to calculate frame length; verify actual output and model constraints |
| **441** | `ComfyMathExpression` | expression `a` | Used for FPS/related connections; preserve |
| **446** | `LoraLoaderModelOnly` | `mehaklora-ltx.safetensors`, strength **0.8**, `mode:0` | Active Mehak LoRA strength control if compatible |
| **449** | `LoraLoaderModelOnly` | same LoRA, strength **1.0**, `mode:4` | **Bypassed** identity LoRA node; do not edit as active strength |
| **448** | `UnetLoaderGGUF` | `ltx-2.3-22b-distilled-1.1-Q5_K_M.gguf` | Default model dependency; validate exact name on target worker |
| **397** | `DualCLIPLoaderGGUF` | Gemma `gemma-3-12b-it-IQ4_XS.gguf` + LTX embeddings connector | Validate model dependencies; not user-editable by default |
| **399**, **370** | video/audio VAE loaders | `ltx-2.3-22b-distilled_video_vae.safetensors`, `ltx-2.3-22b-distilled_audio_vae.safetensors` | Validate availability and supported types |
| **400** | `VHS_VideoCombine`, `mode:0` | `Mehak_MusicVideo_Clip1`, main h264 MP4 | Collect **new** primary output for current `prompt_id` |
| **609** | `RTXVideoSuperResolution`, `mode:0` | saved target 1152 × 2048, quality ULTRA | Optional upscale branch when active and verified; costs more compute |
| **610** | `VHS_VideoCombine`, `mode:0` | `Upscale/RTX_SR`, h264 MP4 | Collect **new** upscaled output separately |
| **713** | `VHS_VideoCombine`, `mode:4` | `Mehak_AudioOFF`, NVENC h264 | Bypassed audio-off output; do not claim it's generated |
| **714** | `Fast Groups Bypasser (rgthree)` | `AUDIO ON / OFF SWITCH` | Audio mode needs verified group conversion; default to currently active path |
| **396** | `DiffusionModelLoaderKJ`, `mode:4` | Alternative FP8 loader | Bypassed; do not switch model unexpectedly |
| **700–712**, **730–739** | other LTX branches | Several nodes are `mode:4` | Do not blindly activate them |
| **413**, **443** | Embedded subgraph instance UUID-like classes | `definitions.subgraphs` required | Resolve via installed ComfyUI exporter, not naïve JSON graph patcher |

**Why this matters:**
- The graph contains **77 UI nodes**, embedded subgraphs, `Anything Everywhere`, GGUF, rgthree switches, VHS output nodes, and custom connections. An executable conversion must preserve semantics.
- The **audio node 383's saved widget duration (25)** may be **overridden by incoming link 816 from duration node 378 (20)**. Tests should prove the live execution value. Do not show contradictory 25s as an independent runtime override.
- Some saved `VHS_VideoCombine` preview metadata includes old filenames and Windows `fullpath` from earlier renders. **Never treat saved videopreview as new output**. Use current prompt history, output records and existence/size/hash verification.
- The UI graph shows 9994 manual prompt flowing into node 607 input1; node 602 Qwen path is bypassed. Preserve this state initially.
- If tests show currently active upscale path is expensive, add a separate versioned `without-upscale` preset compiled and tested from an actual API export, not by guessing group bypass codes.

### Workflow-binding compiler design

Store for each version:
- original UI export bytes + SHA-256;
- verified matching API prompt graph + SHA-256 and exact ComfyUI/custom-node environment fingerprint;
- human-facing binding schema (`field`, `node_id`, `input_key`, type, transform, validators, help text);
- adapter identifier `ltx23_ia2v_shorts_v1`, compatibility and verification status;
- model dependencies and output node mapping;
- immutable version/created time and test results.

At submission: deep-clone validated API prompt; map only user-modifiable inputs through verified node ID/input keys; validate all input types using `/object_info`; verify no unsupported/dangling references; compute hash of compiled graph; store it as the immutable run manifest and POST it. Do not patch global stored source graph. Preserve fixed LoRA/model/sampler/CLIP/VAE values by default. Make an audit log of changed bindings.

---

## 3. BACKEND DESIGN (ADAPT TO REAL CREATOROS STACK)

### Private ComfyUI worker connections

Connection objects managed by existing Admin/Settings:
- worker `gpu-3090`: label, private Tailscale host/IP, ComfyUI port (typically 8188), role primary, expected VRAM 24 GB, enabled, heartbeat, permitted workflows.
- worker `gpu-3060`: role secondary, expected VRAM 12 GB, disabled for this LTX preset until positively verified.
- Do not use the public proxy domain as a ComfyUI target. Never trust a user-supplied arbitrary URL: allowlist private admin-defined Tailscale peers; SSRF protections; no credential logging.
- Backend reads heartbeat `/system_stats` and `/object_info`, optionally `/models` etc., watches `/queue`, submits `/prompt`, listens to `/ws?clientId=...`, fetches `/history/{prompt_id}` and confirmed output via `/view` or validated custom output collector. Verify actual endpoints for installed version.
- Firewall should restrict port 8188 to the intended private network; an unqualified `--listen 0.0.0.0` makes ComfyUI listen on all interfaces and **must not** be treated as secure on its own.

### Media upload/staging

- CreatorOS accepts uploads via existing authenticated asset pipeline; use existing storage and permissions.
- Validate MIME by contents, size limits, dimensions, audio duration, storage quotas; sanitize basename, strip unsafe paths, preserve original; keep source checksum and metadata.
- Stage reference image through the installed ComfyUI `/upload/image` workflow if compatible. Audio via a **verified `LoadAudio`-compatible** upload/worker-agent route: do not assume image upload supports audio.
- Each staging result records `asset_id`, `worker_id`, `comfy_input_filename`, subfolder, checksum, expiry and resulting backend-relative safe path.
- For large files use streaming, limits and timeouts; avoid loading videos into RAM or copying whole model directories to Ubuntu.
- Never interpolate client filenames into arbitrary Windows paths or permit writes outside allowlisted ComfyUI input folders.

### Persistent job orchestration

Durable lifecycle: `draft -> validating -> queued -> submitting -> running -> collecting -> completed`, plus `validation_failed`, `failed`, `cancel_requested`, `cancelled`, `disconnected`, `reconciling`, `unknown`.
- Create idempotency key per Generate click; avoid duplicate GPU jobs from double tap/retries.
- Persist job, requested inputs, workflow version/hashes, compiled API snapshot, selected worker, staged inputs, ComfyUI `client_id`, `prompt_id`, all timestamps, progress and output results.
- Default max one heavy job actively executing per worker; account for ComfyUI's native queue and jobs launched outside CreatorOS; no unnecessary parallel model loads.
- Prefer queue service already in repo; otherwise implement minimal durable lease + DB transaction job claim with crash recovery. On network timeout during POST `/prompt`, **do not blindly resubmit**; reconcile queue/history first, mark unknown if uncertain.
- Subscribe to websocket before submission, match returned prompt_id, handle reconnect; current node-step progress vs overall completion must be distinguished; history/output fetch is source of truth.
- Worker stop/cancel actions must check job ownership; do not globally interrupt a user's unrelated ComfyUI job. Provide safe queued delete and careful active cancellation only with owner + prompt verification.
- On Ubuntu/worker restart: persisted state reconciles, no orphan silently called completed, no accidental rerender.
- Any file transfer/output collection failures have bounded retry/backoff and informative state.

### Output collection and approval

- Inspect the actual API prompt's nodes to identify active outputs. Do not rely on UI node mode alone without validating executable graph output types.
- Register current primary MP4 and current upscaled MP4 independently (if both actually created). Sources: history entries, VHS outputs, or allowlisted per-worker file collector/sidecar with verified path/size/checksum. No raw arbitrary file reads by client.
- Prefer output filename prefix containing CreatorOS job ID or route output to a constrained per-run folder if possible without changing node behavior; otherwise match prompt_id and output records robustly.
- Store thumbnail (derive lightweight FFmpeg screenshot after video exists), duration, video codec/FPS/dimensions, has_audio, filesize, checksum, source assets, exact workflow/version, prompt text and machine. Avoid lying about saved metadata.
- Video preview can stream from existing CreatorOS authenticated media endpoint (or signed URL as established by app), supports ranges for seek. Never publish a raw ComfyUI private address in HTML.
- Approve explicit asset selection, create correct project relationship, invoke existing Publishing composer with selected media and no auto-upload/post. Reuse per-platform metadata, thumbnails and privacy controls already in CreatorOS.

### Proposed logical entities (reuse existing schema where possible)

- `generation_workflow_version` (name, family, adapter key, source JSON/hash, executable API JSON/hash, bindings, compatibility, verification).
- `gpu_worker` (private endpoint config, display label, enabled, observed capabilities, heartbeat, last error).
- `video_generation_draft` (project, source assets, audio trim, prompt, settings, target worker, workflow version).
- `generation_job` (status, idempotency, submitted inputs snapshot, machine, Comfy prompt ID, retry and reconciliation state, stage/progress).
- `generation_output` (job, asset ID, variant original/upscaled, origin, metadata, checksum, review state).
- Optional `video_project_clip` (project, ordinal/timeline range, draft/job/output references) when current project video model cannot represent it.

Do **not** add these as tables just because they're listed: map them to the existing ORM/entities and introduce only required migrations and indexes/uniques. Respect tenancy/user ownership, app RBAC, project permissions, deletion/retention semantics.

### Example endpoint intentions (rename to match existing CreatorOS API conventions)

| Capability | Conceptual endpoint |
| --- | --- |
| list presets/versions | `GET /api/.../video/workflows` |
| discover compatible machines | `GET /api/.../video/workers` |
| list project assets / upload | reuse existing assets APIs |
| create/update draft | `POST/PATCH /api/.../video/drafts` |
| dry validate without generation | `POST /api/.../video/validate` |
| Generate (idempotent) | `POST /api/.../video/jobs` |
| job detail and history | `GET /api/.../video/jobs/:id` |
| live progress | authenticated SSE/WS using established stack |
| cancel, duplicate, regenerate | `POST /api/.../video/jobs/:id/...` |
| list job outputs | `GET /api/.../video/jobs/:id/outputs` |
| output review | `POST /api/.../video/outputs/:id/approve` |
| publishing handoff | reuse existing Publishing interface |

All endpoints require existing auth + ownership authorization + validation/rate limits. Mutating endpoints need CSRF/session protections as appropriate. Secrets and Tailscale IPs should not be returned to ordinary frontend users.

---

## 4. IMPLEMENTATION PLAN — COMPLETE IN ORDER, KEEP STATUS VISIBLE

### Phase 0 — audit, source verification and baseline
- Inspect repo and recorded baseline tests. Inspect reference files and compare hashes. Produce `docs/ai-studio/LTX_WORKFLOW_AUDIT.md` with all 77 source nodes, modes, active connections, groups, subgraphs, enabled outputs and unresolved API fields.
- Check expected source graph has `id`/`nodes`/`links`/`definitions`, ensure matching `.json` is checked in to an appropriate reference path without secrets/personal local paths leaking in deployment; sanitize stale preview metadata in shared public docs but keep original private reference intact.
- Obtain matching API export using the RTX 3090's ComfyUI `Save (API Format)` facility or ComfyUI-supported conversion. Confirm `class_type` for UUID-like nodes, virtual connections, `Anything Everywhere`, rgthree group bypass, VHS outputs, loaded audio and manual prompt. Validate against `/object_info` and run lightweight graph validation before any owner-approved render.
- Note unresolved blockers explicitly; do not fabricate this step.

### Phase 1 — backend bridge and safe first render
- Add/extend worker connectivity, health, model & custom-node compatibility checks, media staging for image **and audio**, versioned workflow registry, compiler with exact bindings and validation.
- Add persistent jobs, idempotency, polling/websocket progress, output collector and asset registration.
- Demonstrate: a manual authorized Generate of actual workflow on RTX 3090 produces one real MP4 retrieved into CreatorOS. Confirm duration, picture, audio and fingerprint of captured run. No fake jobs.

### Phase 2 — Create Videos UI, LTX tab and real controls
- Add left navigation and route, project/asset selectors, image/audio handling, real waveform and trim inputs, manual prompt editor, resolution/FPS/duration settings, verified LoRA binding, compatible machine selector and actual job history/preview.
- Every input round trips Draft → Validate → Generate → Job. Validate must not start GPU inference. Test mobile layout and dark mode.

### Phase 3 — outputs, publishing and basic song storyboard
- Project asset output variants, approval, video preview, attach-to-project, publishing composer handoff.
- Add simple per-song clip list with start/end, image/prompt and generated result, sequential independent jobs. Optionally implement explicit FFmpeg assembly if testable and scope permits; otherwise show roadmap without inert controls.

### Phase 4 — resilience, security and advanced-editor hook
- Simulate offline worker, bad workflow version, missing model/node, wrong audio type, unsupported aspect ratio, insufficient storage/VRAM, ComfyUI restart, Ubuntu restart, duplicate-click, submission timeouts and failed output transfer.
- Expose Advanced ComfyUI Editor link **only if** a dedicated authenticated gateway with working websocket and access controls exists; otherwise keep disabled and link to internal instructions for administrator.
- Add docs/admin runbook, diagnostics in Machine Settings, safe secrets, observability and regression tests.

### Phase 5 — QA, cleanup, final delivery
- Unit, integration, E2E UI (prefer Playwright if already in repo), mocks/fakes for offline CI and one explicitly approved RTX 3090 live-smoke script.
- Run project lint, typecheck, tests, build, migrations dry run, Docker compose config, deployed route smoke test. Fix regressions, note environmental blockers.
- Final user-facing report: summary of changed files, migration commands, ComfyUI Windows startup command(s) adjusted to actual portable folder, Ubuntu env/config placeholders, Tailscale firewall requirements, how to import actual API graph, how to upload audio, how to use UI, proofs/tests, remaining limitations. Keep source code and docs in repo.

---

## 5. TEST PLAN AND ACCEPTANCE CONDITIONS

### Source mapping and compiler tests

1. Source UI export has **77 nodes** (unless the actual reference changes and documented version changes). It is rejected as an executable prompt without conversion/export.
2. Compiler patches only verified input keys in API clone, not UI widget labels. A regression fixture proves stale `Width: 960`, `Height: 540`, and `FPS:24` titles do **not** alter actual defaults **576×1024, 30 FPS**.
3. LoRA control selects active **446 strength 0.8**, never bypassed 449 strength 1.0.
4. Audio `start_index` and clip duration binding respect the link from 378 to 383; no quiet mismatch between stored 25 and generated 20s.
5. Source prompt field drives manual node **9994**, through node 607 to conditioning **358**, tested on compiled prompt. AI/Qwen path remains bypassed unless explicitly verified.
6. Any generated output comes from same prompt ID/run or verified per-run worker artifact; stale VHS `videopreview.fullpath` cannot be registered as success.
7. Disabled audio-off output node 713 never shows as an output; original 400/upscale 610 only show when actually generated.
8. Embedded subgraphs must compile through confirmed exporter; test no dropped input/output edges.

### User flow and security tests

9. CreatorOS auth and project RBAC apply to all drafts/jobs/files, including SSE/WS. Cross-project file access denied.
10. Drag/drop image and audio from project library works; audio region bounds validated and playback start/end correctly displayed.
11. No execution from Save Draft, Validate, change worker, change settings or navigating. **Generate** triggers once. Double-click can't create two ComfyUI prompts.
12. RTX 3060 is not selectable as proven compatible without verified models/node support and explicit live test.
13. Browser refresh and Ubuntu restart retain job and reconcile; non-owned jobs aren't interrupted.
14. Failed/missing models and offline machines display specific errors before inference rather than crashing the UI.
15. Original/upscale variants are correctly labeled; video playback/seek from CreatorOS protected storage works; publishing opens prefilled media, and no platform post happens without separate confirmation.
16. `Create Videos` route works on desktop, narrow mobile screens and dark mode with accessible form labels.
17. CI tests use simulated ComfyUI. Live RTX 3090 render is a separate user-initiated smoke test, never scheduled automatically as part of every build.

### Deliverables checklist

- [ ] `Create Videos` sidebar navigation and responsive real LTX Studio screen
- [ ] Project selector and source asset integration
- [ ] Source-audio waveform + precise selection + audio/video validation
- [ ] Prompt editing, 9:16 default, dimensions/FPS/duration, verified LoRA controls
- [ ] Worker health/compatibility and selected GPU
- [ ] Immutable LTX preset registry, exact source/API binding audit
- [ ] Authenticated, versioned backend compiler, media staging, persistent queue
- [ ] Manual Generate, accurate progress/recovery, cancellation and logs
- [ ] MP4 original/upscale output retrieval, preview, metadata and review state
- [ ] Project clip list and Publishing handoff
- [ ] Tests, documentation, migration/rollback and operations runbook

---

## 6. CODING-AGENT OPERATING INSTRUCTIONS

Work phase-by-phase, applying code changes as you go; avoid returning just advice, plans, screenshots or hypothetical file trees. Before each significant edit verify the repository's actual patterns and existing test conventions. Maintain the implementation status file and run relevant tests after each phase. Prefer minimal changes to established CreatorOS services and shared UI, rather than introducing parallel subsystems. Commit logical units if existing workflow permits; never commit credentials or machine private addresses.

At the end of each phase, report precisely: **implemented**, **verified in tests**, **requires real Windows ComfyUI**, **blocked**, and **next work**. If a network endpoint, API export or model file isn't accessible, build everything testable without inventing evidence; leave a precise operator setup step that can be completed later. Continue to the next feasible phase without unnecessary user questions.

**Begin now with Phase 0. Inspect the project. Read the actual LTX workflow JSON and Master Spec. Then implement the real `Create Videos → LTX 2.3` flow with UI, backend and project/publishing integration.**

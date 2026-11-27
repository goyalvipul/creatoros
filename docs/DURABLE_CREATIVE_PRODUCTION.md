# Durable creative production (migration 0060)

Use the existing per-creator Vancouver-day production runs and H3 pipeline. A saved executable plan, not a ChatGPT conversation, is now the worker's source of truth. The plan is an owner-approved request; its approval authorizes bounded local asset generation, H3 attempts and billable Gemini quality review. It does not authorize external publishing, new workflow installation, arbitrary network requests, or changing credentials.

## Deployment and local workflow configuration

Deploy migration, API, worker and web together. Existing H3 and LTX manual paths remain available. Local images use the registered ComfyUI workers and the existing signed scanner import path. No new scanner protocol is required.

Export a working **API-format** still-image workflow from the actual ComfyUI installation. It must support image-conditioned identity references, prompt input, seed and explicit width/height inputs, and exactly one SaveImage node. Do not use an editor-format workflow or invent a model/checkpoint. Verify its identity and pose preservation manually once. A workflow with the correct node names but missing checkpoints/custom nodes will be rejected by ComfyUI.

Store an owner-managed JSON array in the persistent /data volume, for example /data/local-image-workflows.json, accessible to both API and worker. Set KEMOKEM_LOCAL_IMAGE_WORKFLOWS=/data/local-image-workflows.json in .env and recreate API/worker. This variable is passed through Docker Compose. Each array item has the following structure (node numbers/input names are illustrative, replace them with the real API graph mappings):

```json
{
  "id": "identity-portrait",
  "graph": { "...": "replace with the complete exported API graph" },
  "prompt": { "node": "6", "input": "text" },
  "references": [{ "node": "10", "input": "image" }],
  "seed": { "node": "3", "input": "seed" },
  "width": { "node": "5", "input": "width" },
  "height": { "node": "5", "input": "height" },
  "outputNode": "9"
}
```

The example is not a runnable graph. Put the complete real graph inside graph. Configure separate templates for different reference-slot counts. Creator profile references are ordered first, explicit additional references second, duplicates removed. The count must exactly match the configured slots; unused placeholders are not silently reused. The graph is pinned by SHA-256 at plan admission and checked again before submission. The client cannot submit arbitrary graphs or worker URLs. The image output is validated and imported to the selected active scanner root with a permanent file ID. Dimensions are multiples of eight and at most 2048 per side/4 MP. Daily local-image quota is 12 per workspace. Image output cap is 50 MiB. For actual deployment, confirm the scanner has a writable online root and the GPU has sufficient VRAM.

## Gateway contract

Existing scopes are reused. Writes below are **owner-reviewed**, not silently added to the creative-execution allowlist. The connector must refresh the deployed /tools catalogue and register these typed operations:

- generation.localImageCapabilities {} — generation.read, configured workflow IDs, hashes, number of references.
- generation.localImage {projectId,workerId,rootId,workflowId,prompt,referenceFileIds,width,height} — generation.submit, queues a local job.
- generation.localImageStatus {id} — generation.read, actual image job state, output, fileId once COMPLETE.
- generation.localImageCancel {id} — generation.cancel; only queued work can be cancelled.
- production.planSubmit {runId,form,sourceEvidence,brief,assets,qualityReferenceFileIds,requireAudio,requireLipSync,requirePhysicalAccuracy,maxRegenerations,acceptBillableQuality:true} — generation.submit.
- production.planStatus {id} — generation.read, plan state, saved payload, per-image state, render attempts and quality evidence.
- production.planRecover {id,action:resume|retry_inspection} — generation.submit, explicit guarded recovery.

form is the existing H3 form with permanent library IDs, explicit segment durations totaling at most 30 seconds, worker and project. assets contains up to four items, each {image:<local-image input>,segmentIndexes:[0,...]} referring to zero-based H3 segment indexes. Generated file IDs are appended to precisely those segments; use the correct reference order when writing the prompts. Each segment must resolve to one to eight images. A generated asset can be the only image on a segment. For a reused image, use its known library ID directly. Preserve source evidence, never claim motion has been observed if only metadata was available. For original concepts record that there is no external source footage. Provide one to four verified quality reference images, canonical identity first.

Start or reuse production.runStart for the current Vancouver date, register the executable plan once per project using a stable request ID. Request completion means the plan was saved, not that media was generated. The worker processes PREPARING -> WAIT_IMAGES -> QUEUE_VIDEO -> WAIT_VIDEO -> QUALITY -> PASSED; failures go to REVIEW or bounded REGENERATE. Both scheduled and interactive clients should use this identical operation once the connector exposes it. Existing legacy H3 generation is not silently converted into a plan.

## Quality and bounded regeneration

The worker downloads the exact indexed final video from its mapped GPU output root. No basename-only association for managed outputs. FFprobe verifies duration, dimensions and audio; FFmpeg decodes the full clip for black/frozen sections. Semantic inspection uses the configured Gemini video model and the actual rendered video plus creator reference images and source observations; it returns explicit PASS/FAIL/UNCERTAIN/NOT_APPLICABLE evidence for identity, motion, equipment, brief, continuity, audio, lip sync, artifacts and physical accuracy. This is model-assisted assessment, not proof of exact facial identity or safe exercise technique. Quality provider must be configured before accepting plans. Each semantic inspection is potentially billable within existing daily/monthly AI video quotas. No provider call occurs on deployment alone. The owner approves the plan, and existing billable post-processing authorization remains separate.

A confirmed quality failure can trigger zero to two additional H3 attempts, chosen in the approved plan. Corrections become bounded prompt data, not executable commands. For observed identity/equipment problems, the worker can regenerate one relevant generated reference before the corrected full-video attempt. Previous generation jobs, outputs and quality evidence are retained. Uncertain evidence requires review, never blind re-generation. A confirmed local image execution failure gets at most one extra attempt. Uncertain external submissions/imports are not replayed; an existing exact, linked indexed import can be reconciled. Interrupted quality calls require explicit owner recovery, with at most one inspection retry per render. Interrupted idempotent DB stages can resume. Offline/busy workers wait without cancelling existing work. The existing run pause/stop controls govern queued plan stages and local assets; an already running external call may finish.

Managed render outputs are indexed for inspection, but automatic asset approval/publishing variant attachment and publishing drafts are blocked until the quality gate passes. Rejected render outputs remain available in the library and run history. Project Ready still requires the existing successful indexing, analysis, SEO, covers and connected drafts. No automated scheduling/publishing. Human review remains necessary before release.

## Acceptance before production release

- Use a real configured local reference-image graph and correct GPU/root.
- Run migration 0060 on a clean and upgraded database; exercise deduplication and multi-tenant isolation.
- Verify Mehak personal-circle and both Ananya fitness plans, including an asset that does not yet exist.
- Restart worker during asset preparation, H3 queueing and quality analysis; verify no duplicate external write.
- Trigger actual wrong-duration, frozen-frame and reference-identity/equipment failures; verify bounded retry and retained originals.
- Verify missing/offline scanner, busy GPU, quota exhaustion, pause/resume/stop, source-reference mismatch, uncertain provider response and owner controls.
- Verify no failed/uncertain attempt has automatic publishing drafts and no project becomes Ready prematurely.
- Run full CI and live smoke tests before declaring production readiness.

Native ChatGPT image bytes and hosted MCP Site publication are separate runtime integrations. This implementation deliberately uses server-side local assets, so that plan execution does not depend on native ChatGPT file access. The hosted Site must register the final deployed catalogue. No automatic model downloads or setup on personal GPU machines.

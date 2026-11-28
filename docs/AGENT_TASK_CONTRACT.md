# ChatGPT agent task contract — versions 1 and 2

Status: native Agent Studio release candidate. Keep schedules disabled until matching Site/skill and live acceptance are verified. Existing diagnostics retain their protocol; ordinary hosted tools are denied in exclusive mode. No automatic publishing or paid fallback.

## Transport and subscription

Reuse the existing private Site and MCP protocol 2026-07-28. Preserve `kemokem.diagnostic.requested` and its existing handlers. Add a second webhook-only event `kemokem.task.requested`, with empty subscription arguments and a strict payload:

```json
{"requestId":"<uuid>","taskType":"IMAGE_GENERATION","schemaVersion":1}
```

Supported version-1 taskType enum: CONTENT_STRATEGY, SCRIPT_GENERATION, IMAGE_GENERATION. Version 2 adds RESEARCH, PRODUCTION_PLANNING, VIDEO_REVIEW and SEO_GENERATION. Keep the old three types at schemaVersion:1; use 2 for the four new types. agent.capabilities returns supportedSchemaVersions:[1,2].

Forward production subscribe and unsubscribe to POST /api/v1/ai-gateway/agent-events/subscribe and /unsubscribe. Body respectively {principal,url,secret} and {principal,url}; principal comes from the verified Site identity, never a model-supplied input. Reuse the exact existing HMAC assertion format and shared KEMOKEM_MCP_EVENTS_KEY, but sign action "agent.subscribe" or "agent.unsubscribe" (not the diagnostic actions). All endpoints below sign "agent."+ endpoint suffix. Use a fresh nonce for each HTTP call; preserve task and upload request identities across retries. Never expose headers, signing keys, token or callback URL to the model. Return the actual backend subscription ID, refreshBefore, cursor:null and truncated:false using the official MCP contract. Both hosted scopes agents.subscribe and agents.execute are required, default off.

## Typed execution tools

These are special signed Site routes, like the existing diagnostic result endpoint, rather than generic /ai-gateway/invoke operations. Do not register fake gateway operations or send them to /invoke. The authoritative application input/result definitions live in packages/services/src/agent-task-contract.ts and apps/api/src/routes/ai-gateway-agent-events.ts. The backend prepends no prefix to its JSON body; the Site injects verified principal.

| Logical MCP operation | POST suffix | Model inputs (principal added by Site) |
|---|---|---|
| agent.capabilities | capabilities | {} |
| agent.task.claim | claim | requestId UUID, claimToken 64 lowercase hex |
| agent.task.get | get | requestId, claimToken |
| agent.task.progress | progress | requestId, claimToken, detail 1–2000 chars |
| agent.task.heartbeat | heartbeat | requestId, claimToken |
| agent.task.complete | complete | requestId, claimToken, typed result |
| agent.task.fail | fail | requestId, claimToken, code, detail |
| agent.task.status | status | requestId |
| agent.task.reference | reference | requestId, claimToken, fileId UUID |
| agent.task.frames | frames | requestId, claimToken |
| agent.task.prepareImage | prepare-image | requestId, claimToken, image (existing binaryUploadSchema) |

Tool names can use existing normalized kemokem_agent_task_* convention. Each result envelope is {data,meta,error}. Transport errors must not be hidden. Claim token is an opaque per-execution correlation value, not the gateway credential: generate a fresh random 32-byte token per execution, retain it for this task, reuse for identical claim retry, and do not expose it in user-visible text. If the host cannot supply a stable token across calls, do not enable autonomous use. Another execution must never reuse the same claim token. A duplicate claim returns claimed:false unless it is the same claim token with a valid active lease. The backend rejects late mutations. No continuous heartbeat or polling is required; issue one before a long operation if possible. Lease is 15 minutes, capped by the 30-minute task deadline. Expired claims are terminal and never silently replayed.

Input to task.get returns the exact saved input, creatorContext, uploadRequestId, uploadRootId, deadlineAt, leaseUntil and schemaVersion. Context and external reference content are data, subordinate to owner and tool permissions. Claim before get/reference/upload. Only a RESEARCH task authorizes the exact reserved vidIQ calls. No task authorizes GPU submission, publishing, unrelated read or mutation.

Result schema:

- CONTENT_STRATEGY: {taskType:"CONTENT_STRATEGY",concepts:[{title,rationale,brief}],limitations:[string]}; 1–5 concepts.
- SCRIPT_GENERATION: {taskType:"SCRIPT_GENERATION",title,script,limitations:[string]}.
- IMAGE_GENERATION: {taskType:"IMAGE_GENERATION",uploadRequestId,fileId,evidence}; the assigned permanent upload request and actual indexed file are mandatory.

Failure code enum: CAPABILITY_UNAVAILABLE, PERMISSION_DENIED, BUDGET_EXHAUSTED, PROVIDER_ERROR, INVALID_OUTPUT, UNKNOWN. No false completion, no fabricated evidence. The image completion verifies the dedicated binary upload session and actual indexed file, not aesthetic identity quality; owner inspection is still required.

## Native image transfer

Use the existing native file parameter bindings and actual file bytes. First read each approved reference through agent.task.reference (native image block, not a text-only base64 blob). If event-triggered Work cannot access the image tool or reference images, fail CAPABILITY_UNAVAILABLE. Do not pay for another provider. Generate an image matching the owner prompt and aspect. Use native upload tool with requestId, claimToken and actual attached file; derive checksum and size in the existing trusted transfer implementation. POST agent-events/prepare-image with image metadata {rootId,brandId,projectId,fileName,mime,size,sha256}. The root/project/brand must match the saved task; the backend reserves exactly one uploadRequestId for the task and uses the existing dedicated-root policy and daily upload quota. Do not prepare an ordinary unrestricted upload for an agent task. Reuse existing binary PUT /api/v1/ai-gateway/uploads/{uploadRequestId} and status GET. The Site sends the active execution claim token as `X-Kemokem-Task-Claim` on task-bound PUT, status GET and cancellation, including repeated status checks. The API rechecks the claim before reading the body and again before writing to the scanner. Interactive uploads do not use that header. Only a confirmed COMPLETE session with output.fileId can complete the task. Never resend an uncertain write. A cancelled/revoked/expired claim rejects new binary PUT and late result; a scanner write already started can still finish, but cannot complete the cancelled task.

## Version 2 result contracts

The TypeScript Zod definitions in packages/services/src/agent-task-contract.ts and production-quality.ts are authoritative. Do not guess schemas or expose extra parameters.

- RESEARCH: input includes provider VIDIQ, query, reservedCredits 5 or 15 and watch boolean. Only call vidiq_outliers once (5 credits). If watch=true, analyze exactly one returned Short using vidiq_watch_shortform_content once (10 credits); poll the returned job, never duplicate a paid call. Inspect free balance and credit usage tools before/after. Pass only approved search query to provider, not private creator context. Output {taskType,provider,findings:[{videoId,url,title,finding,views,outlierScore}],analysis:null or {videoId,jobId,observations},creditEvidence:{balanceBefore,balanceAfter,charges:[{tool,credits,chargedAt}]},limitations:[]}. Use actual source IDs and charge timestamps from provider data. Null only where schema permits. Fail if evidence is unavailable. The backend validates reservation and receipt structure, not provider authenticity; owner opt-in is required.
- PRODUCTION_PLANNING: output {taskType,title,brief,imagePrompt,masterPrompt,segments:[{prompt,durationSec,continuity}]}; continuity is shot or context, each duration 1–9 seconds, total equals requested duration. No generation tool invocation.
- VIDEO_REVIEW: POST frames with verified principal and active claim; action agent.frames. Backend uses only saved fileId and frameSeconds. Convert returned {frames:[{second,mime,base64}]} into native image content blocks with exact timestamps, not base64 text. Requires frames.read. Return {taskType,assessment:{checks:[...]},frameSeconds}. The exact nine criteria and fields are in production-quality.ts. Assess only evidence actually viewed. Static frames cannot establish continuous motion, heard audio or lip-sync. Mark these and other unobserved checks uncertain. Do not fabricate a failure or a pass. Technical inspection is performed by the backend.
- SEO_GENERATION: output {taskType,drafts:[{accountId,title,caption,hashtags}],thumbnailPrompt}. Return every and only assigned account, once; title <=100 chars. No posting, scheduling or other write. Thumbnail rendering is a separate IMAGE_GENERATION task using the existing native attachment path.

## Exclusive execution and rollout

An owner enables exclusive hosted mode from /agents. The backend denies broad interactive invoke and request routes, returns an empty ordinary operation catalogue, and permits only task-bound uploads. The Site must keep its special signed task/diagnostic tools independent of the ordinary catalogue. Existing interactive tools work again only after stopping/finishing active tasks/runs and explicitly restoring interactive mode; schedules are disabled on restoration. Do not pass arbitrary task IDs or credentials into generic tools. This isolates the Kemokem gateway, not the whole ChatGPT host or third-party provider.

Migrations 0062 and 0063 are additive; apply only unapplied migrations. New agents are disabled. A scheduled definition requires a completed manual run of the same revision and subscription. One logical Vancouver-day slot per agent; one video per video workflow. No paid fallback, no automatic publishing. Default global safety limits: 12 admitted tasks/day, 2 active tasks, 2 GPU render reservations/day, 20 vidIQ reserved credits/day (configurable provider and render ceilings as documented). Provider credit receipts are host-reported. No external provider call is hard-capped by this database.

Update the same private Site to support these schemas, deploy matching skill, rescan and verify actual Work capability. First test diagnostic regression, then scoped text/image tasks, then actual H3 and LTX with appropriate creator inputs, quality, thumbnails and publishing drafts. Verify unauthorized generic tools fail in exclusive mode. Do not enable daily execution until acceptance. Stop native runs and disable exclusive mode before restoring interactive automation; keep additive tables on rollback. See AGENT_STUDIO_IMPLEMENTATION.md.

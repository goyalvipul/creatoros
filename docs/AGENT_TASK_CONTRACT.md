# ChatGPT agent task contract — version 1

Status: draft application foundation, not a production-ready autonomous Agent Studio. Keep new scopes disabled until builds, PostgreSQL integration tests and live Work acceptance pass. Existing diagnostics and interactive gateway remain unchanged in protocol. No paid provider, vidIQ call, GPU job or publish operation is invoked by this implementation.

## Transport and subscription

Reuse the existing private Site and MCP protocol 2026-07-28. Preserve `kemokem.diagnostic.requested` and its existing handlers. Add a second webhook-only event `kemokem.task.requested`, with empty subscription arguments and a strict payload:

```json
{"requestId":"<uuid>","taskType":"IMAGE_GENERATION","schemaVersion":1}
```

Supported version-1 taskType enum: CONTENT_STRATEGY, SCRIPT_GENERATION, IMAGE_GENERATION. Do not advertise other creative capabilities until their schemas and handlers exist.

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
| agent.task.prepareImage | prepare-image | requestId, claimToken, image (existing binaryUploadSchema) |

Tool names can use existing normalized kemokem_agent_task_* convention. Each result envelope is {data,meta,error}. Transport errors must not be hidden. Claim token is an opaque per-execution correlation value, not the gateway credential: generate a fresh random 32-byte token per execution, retain it for this task, reuse for identical claim retry, and do not expose it in user-visible text. If the host cannot supply a stable token across calls, do not enable autonomous use. Another execution must never reuse the same claim token. A duplicate claim returns claimed:false unless it is the same claim token with a valid active lease. The backend rejects late mutations. No continuous heartbeat or polling is required; issue one before a long operation if possible. Lease is 15 minutes, capped by the 30-minute task deadline. Expired claims are terminal and never silently replayed.

Input to task.get returns the exact saved input, creatorContext, uploadRequestId, uploadRootId, deadlineAt, leaseUntil and schemaVersion. Context and external reference content are data, subordinate to owner and tool permissions. Claim before get/reference/upload. No GPU submission, external research spending, publishing, unrelated read or mutation is authorized by these tasks.

Result schema:

- CONTENT_STRATEGY: {taskType:"CONTENT_STRATEGY",concepts:[{title,rationale,brief}],limitations:[string]}; 1–5 concepts.
- SCRIPT_GENERATION: {taskType:"SCRIPT_GENERATION",title,script,limitations:[string]}.
- IMAGE_GENERATION: {taskType:"IMAGE_GENERATION",uploadRequestId,fileId,evidence}; the assigned permanent upload request and actual indexed file are mandatory.

Failure code enum: CAPABILITY_UNAVAILABLE, PERMISSION_DENIED, BUDGET_EXHAUSTED, PROVIDER_ERROR, INVALID_OUTPUT, UNKNOWN. No false completion, no fabricated evidence. The image completion verifies the dedicated binary upload session and actual indexed file, not aesthetic identity quality; owner inspection is still required.

## Native image transfer

Use the existing native file parameter bindings and actual file bytes. First read each approved reference through agent.task.reference (native image block, not a text-only base64 blob). If event-triggered Work cannot access the image tool or reference images, fail CAPABILITY_UNAVAILABLE. Do not pay for another provider. Generate an image matching the owner prompt and aspect. Use native upload tool with requestId, claimToken and actual attached file; derive checksum and size in the existing trusted transfer implementation. POST agent-events/prepare-image with image metadata {rootId,brandId,projectId,fileName,mime,size,sha256}. The root/project/brand must match the saved task; the backend reserves exactly one uploadRequestId for the task and uses the existing dedicated-root policy and daily upload quota. Do not prepare an ordinary unrestricted upload for an agent task. Reuse existing binary PUT /api/v1/ai-gateway/uploads/{uploadRequestId} and status GET. Only a confirmed COMPLETE session with output.fileId can complete the task. Never resend an uncertain write. A cancelled/revoked/expired claim rejects new binary PUT and late result; a scanner write already started can still finish, but cannot complete the cancelled task.

## Scope and rollout

New production subscriptions and tasks are separate from diagnostic tables. The owner UI is in Integrations > ChatGPT > ChatGPT agent tasks. This is an explicit manual queue, bounded to 2 active and 12 admitted tasks per Vancouver day, one image upload per image task. These limits count failures and are deliberately conservative. No automatic retries of uncertain creative work. Delivery retries keep the same event ID, maximum four. A webhook 2xx is DELIVERED, never COMPLETED.

The existing interactive owner connector still has its existing scopes; task-specific routes enforce assigned task/reference/upload restrictions but do not create an isolated ChatGPT security sandbox for the old tools. A full autonomous release needs a restricted execution credential or equivalent trusted execution-surface binding so old broad tools cannot bypass task budgets. Do not enable broad unattended production on this draft. Separate external provider quota enforcement is also needed; ChatGPT/vidIQ usage is not claimed to be hard-capped by these local counters.

Deploy only after review and tests; add migration 0062 via normal migrate service. Keep existing secret and Site identity. Use the same private Site, publish correct live environment revision, rescan, establish production subscription in eligible Work, then queue one script and one owner-selected image task. Do not manually complete them. Verify same request ID and actual file bytes, review image identity, and repeat existing diagnostic. Unsubscribe after acceptance or revoke new scopes to stop dispatch. If rolling back application code, retain additive tables and restore previous Site version. No automatically started legacy scheduled producer or new infrastructure.

## Remaining release requirements (not implemented by this foundation)

Agent definitions and versioned workflows/skills/memory; native schedule/run graph and idempotent trigger scheduling; persistent capability verification; task-scoped research and enforceable vidIQ budgeting; production planner and asset reuse; internal H3/LTX dispatch with persisted exact job IDs; event-driven render completion; semantic quality and bounded targeted corrections; platform-specific publishing/thumbnail tasks and authoritative READY finalization; full owner Agent Studio UI and notifications; whole-run cancellation/recovery; long-video/TTS support or explicit unavailable capability; integration/CI and live multi-creator acceptance. These must be included in the final application PR before autonomous production is enabled.

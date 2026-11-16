# Comprehensive security review — source-code remediation pass

Date: 2026-11-16. Branch: `security_check_comprehensive` (based on `security_review`, not `main`). No production deployment, data modification or merge. Changes remain in a draft pull request.

## Scope and assurance

Reviewed security-sensitive sections across the Fastify API, session authentication, publishing and social OAuth/webhook adapters, signed media-streaming URLs, livestream pipeline, agent heartbeat/file serving, frontend PWA mutation paths, reverse-proxy configuration, Docker Compose, GitHub Actions, and existing tests. Reviewed existing security documentation and prior PR CI evidence.

**This is a broad static source audit and remediation, not a completed penetration test or proof of production security.** GitHub source alone cannot establish actual host firewall rules, Tailscale ACLs, secret hygiene on live hosts, network DNS/rebinding behavior, executable/agent permissions, production environment variables, or attack resistance. Those need runtime review.

## Verified remediations carried from `security_review`

1. Password validation previously documented 12 characters but accepted 6. New and reset passwords now require >=12; existing logins remain valid.
2. CSRF shared router previously trusted request supplied `Host`/`X-Forwarded-Host`; now only explicitly configured origins qualify.
3. Multipart livestream upload now enforces the shared origin policy.
4. Gitleaks CI needs complete git history for commit-range scanning; security job now uses `fetch-depth: 0`.

## Additional remediations in this branch

### S1 — Media token issuance did not verify file ownership (High)

`POST /files/:id/stream-token` previously minted valid tokens for arbitrary UUIDs without selecting the file by the caller's `org_id`. Token retrieval of `GET /files/:id/stream` bypassed the organization filter whenever a signed URL was used. Together, this created a potential cross-tenant media disclosure for a valid file UUID. The fixed code first checks file ownership and always filters streaming by organization, including signed-token requests.

### S2 — Media tokens were not tied to a tenant (High)

Legacy media tokens contained instance ID, user ID, and expiry but **no organization**. Signed tokens now use an explicit `v2` payload containing `instanceId`, `orgId`, `userId`, and expiration, with strict expiry validation and a 30-minute maximum. Calls producing provider and live-agent media URLs now include their organization. Old v1 URLs will stop working immediately upon deployment; notify external ingest consumers and avoid changing mid-publish.

### S3 — Livestream agent's file lookup was unscoped (High)

`jobFiles` looked up library file metadata by ID, with no `org_id` filter, and could build a signed URL for an otherwise inaccessible file. The lookup is now tenant-scoped and fails closed when an unknown file ID is requested. The streaming route now enforces the same tenant constraint.

### S4 — Direct API routes had inconsistent CSRF validation (Medium)

AI generation, long-video updates/uploads, ComfyUI uploads, and a direct content upload previously checked only a custom request header. Those routes now also reuse the shared configured-origin check while preserving their existing custom-header requirement. Existing browser origins must be configured.

### S5 — Fastify trusted arbitrary proxy header chains (Medium / deployment dependent)

`trustProxy: true` was changed to `trustProxy: 1` because the API is exposed behind Caddy in the Compose topology. This limits forwarded IP attribution to the immediate proxy hop, reducing rate-limit/audit spoofing opportunities. Validate the actual deployment topology, especially if the API is called directly outside Caddy.

### S6 — Internal agent requests followed redirects (Medium / defense in depth)

The API and workers previously used default `fetch` redirect-following behavior when calling agent file-stream and upload endpoints. These internal signed agent calls now use `redirect: 'error'` across the library streaming, publishing upload, livestream source, video-trim upload and file proxy paths. This prevents a compromised or incorrectly configured agent from sending the server through HTTP redirects to unrelated destinations. It **does not** eliminate SSRF from untrusted original agent-reported URLs; validate permitted destinations and network egress separately.

## Regression tests / CI

Added unit tests in `packages/services/src/crypto-media.test.ts` for tenant-binding, expiration, tampering, wrong secret, old token rejection and malformed tokens. Added integration coverage that an owner cannot mint a media URL for a non-existent file. The prior branch contains password and Host-header spoof tests. GitHub Actions now includes an independent `security-hardening` job to run `pnpm typecheck` and `pnpm test:unit` even when the existing formatting job stops early.

The prior branch's CI had security-audit and Docker passes but failed the formatting step (196 pre-existing style warnings), so downstream suite stages did not run. Do not claim green CI without inspecting the new PR jobs.

## Remaining material risks / limitations

- **Media URLs:** signed URLs in query parameters are bearer credentials; minimize exposure in application logs and referrers and retain short expiry. External social platforms need to fetch media publicly, making purely cookie-authenticated URLs unsuitable.
- **Agent network trust / SSRF:** authenticated agents report `listenUrls`; the API and background jobs request these endpoints. A malicious/compromised agent could provide unexpected destinations. Validate scheme, hostname/IP/CIDR policy, redirects, DNS resolution, and Tailscale topology before aggressive restrictions. Signed requests are not a substitute for egress filtering.
- **Trusted proxies:** verify the exact number of hops between internet ingress and API and ensure no bypass around Caddy; if topology differs, adjust the setting.
- **Upload and media processing:** test adversarial filenames, symlink races, archive/metadata payloads, multipart size enforcement, FFmpeg/ffprobe resource exhaustion and temporary-storage quotas.
- **OAuth/webhooks:** full provider permission review, replay window and callback validation, token revocation and connector-specific code paths need dynamic testing.
- **Device command privileges:** test agent file delete, replace, restart and trim paths using the least-privilege OS account and adversarial paths.
- **Dependency and image scanning:** Gitleaks and pnpm audit run in CI, but no comprehensive Go vulnerability scan or image CVE scan was executed here; verify image provenance, permissions, and pinning policy.
- **Live deployment:** verify Ubuntu OS patch level, container privileges, database backups and restore, network firewall, DNS/TLS, Tailscale ACLs, secret rotation, account 2FA, PWA cache behavior and public exposure.
- **CI formatting debt:** existing `pnpm format:check` reports many pre-existing violations. Do not bulk-format 196 files in this security PR without separate review.
- **Publication and external automation:** complete provider-by-provider retry/idempotency and duplicate-post testing remains a requirement before asserting reliability.

## Rollout plan

1. Review this draft PR and all CI job results, especially `security-hardening`, `security`, `compose`.
2. Confirm `.env` contains every legitimate site origin under `APP_BASE_URL`/`ALLOWED_ORIGINS`; confirm access through Caddy.
3. Test login/TOTP, ordinary browser mutations, upload and playback, Instagram/Threads public ingestion, and livestream job media locally/in staging.
4. Merge only after review, passing relevant tests, and testing with a known good backup/rollback.
5. Deploy in a controlled maintenance window; v1 media links will immediately expire by design, and re-issuing new links may be required.

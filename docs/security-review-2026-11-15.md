# Security review — 2026-11-15

Status: initial static review and targeted fixes; **not a completed comprehensive security assessment or penetration test**. Branch: `security_review`; no deployment or production changes.

## Verified findings fixed

1. **Password strength policy mismatch (Medium).** `packages/services/src/auth.ts` described a minimum of 12 characters but accepted six. New passwords (bootstrap, reset, change, member creation via shared validation) now require 12 characters. Existing passwords remain valid until changed. Regression test added.
2. **CSRF origin trust boundary (High, configuration dependent).** `apps/api/src/http.ts` previously accepted any `Origin` whose host matched request-supplied `Host` or `X-Forwarded-Host`, even if that origin was not configured. This can weaken the application origin boundary when an ingress forwards attacker-controlled host headers. The code now accepts only explicit configured application origins. Regression tests cover Host and X-Forwarded-Host spoofing.
3. **Direct livestream upload origin validation (Medium).** `apps/api/src/routes/live.ts` previously checked only `x-requested-with: creatoros` on the cookie-authenticated multipart upload. It now also checks the configured origin whenever an Origin header is present, using the shared CSRF validator.

## Positive controls seen in code

- Argon2id password hashing and hashed session tokens.
- Social webhook signatures, encrypted OAuth credential storage, audit/log redaction.
- DB and Redis are not directly published by default in Docker Compose.
- GitHub Actions already define production dependency audit, secret scan, Go tests, TypeScript checks, integration tests, browser E2E and Docker Compose validation.

These controls have **not** been independently validated at runtime.

## Open audit areas / recommended follow-up

- **Agent SSRF / network boundary:** device-reported `listenUrls` are contacted by backend functions such as `openAgentFile`. Validate who can update these URLs and constrain target schemes, IPs, redirects and hostnames to approved local/Tailscale ranges. Do not arbitrarily block legitimate multi-host media workflows without an integration test.
- **Trusted proxies:** Fastify uses `trustProxy: true`; scope it to actual ingress hops to prevent spoofed client IPs used by rate limiting and audit logs. Coordinate with Caddy/Tailscale/Cloudflare topology before changing.
- **All custom authenticated routes:** review agent, multipart, live streaming, OAuth and external webhooks individually for authentication, authorization, CSRF, replay and upload limits.
- **Media input handling:** evaluate archive, FFmpeg/ffprobe, scanner and path traversal protections with adversarial filenames and crafted multimedia input.
- **Supply chain & runtime:** review `pnpm audit --prod --audit-level high`, Go vulnerabilities, Docker base image pinning, secret scans, and security CI reports before release.
- **Publishing idempotency:** check duplicate-post prevention and behavior during partial failures to avoid accidental multiple public posts.
- **Public-facing controls:** verify rate limits, media kit disclosure, signed URLs, public inquiry spam protections and cache/CSP behavior.
- **Infrastructure:** verify public exposure, Tailscale ACLs, webhook funnel rules, backup encryption, disk permissions, least privilege and key rotation on the Ubuntu and Windows hosts.

## Validation before merge

Run `pnpm check`, `pnpm build`, `pnpm test:integration`, `pnpm test:agent`, `pnpm test:e2e` plus GitHub security CI. Inspect the draft PR checks. Verify intended web origins are explicitly included in `APP_BASE_URL` / `ALLOWED_ORIGINS` before deployment. No runtime test suite was executed in the connector-only environment. Do **not** merge without CI and review.

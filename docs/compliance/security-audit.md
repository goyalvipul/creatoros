# Security notes from this pass

This was a code read, not a penetration test. No production data was deleted and no token was revoked.

## Checked

- OAuth tokens are encrypted before insert (`encryptJson` in `packages/services/src/integrations.ts`). Google revoke uses the token server-side.
- Instagram and Facebook webhook routes verify the Meta signature. The access log redacts `hub.verify_token` (earlier fix, still in the API logger).
- Legal pages do not embed tokens, emails that are not confirmed, or `kemokem.com`.
- Session passwords use Argon2id. Cookies are HttpOnly in the auth service.
- Postgres and Redis are bound to loopback in Compose. Scanner ports are not published for public use.
- The public deletion page does not expose a destructive endpoint.

## Left as they are

- Disconnect does not delete imported social rows. See deletion-and-retention.md.
- Instagram and Facebook disconnect do not call the platform to revoke. The operator removes the app in that platform's settings.
- A scheduled post is not cancelled on disconnect.
- Backup files can retain encrypted tokens and imported rows until the operator deletes the file.
- ComfyUI on the Windows PCs is reached over the private network. This pass did not scan those hosts.
- No new organization-delete API was added. An unauthenticated delete would be the wrong fix.

## Not claimed

Absolute security, a completed Meta or Google review, or a working privacy mailbox.

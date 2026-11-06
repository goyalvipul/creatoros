# Future domain migration

Not started. Production stays `https://os.goyalfamily.ca`. `kemokem.com` is not a live site. Do not redirect, and do not put it in an OAuth callback.

`APP_BASE_URL` is already the single public origin (`packages/services/src/config.ts`, `docker-compose.yml`). Callbacks are derived from it. When the new host works, change that variable. Do not add a second one.

Order to follow later:

1. Confirm the domain is owned.
2. Point DNS at this server.
3. Add the host in Nginx Proxy Manager. Do not edit it before the certificate exists.
4. Issue the HTTPS certificate and open the host in a browser.
5. Set `APP_BASE_URL` and `ALLOWED_ORIGINS` to `https://kemokem.com` only after sign-in works there.
6. Add the new OAuth redirect URIs in Google, Meta, and TikTok before changing the env value those consoles must match.
7. Update webhook callback URLs the same way.
8. Change the canonical URLs in `apps/web/src/lib/legal.ts` (`LEGAL.site`).
9. Sign in, reconnect one platform on a test, and confirm a webhook verify still succeeds.
10. Redirect `os.goyalfamily.ca` only after that check. Until then both names must not point at different apps.

`privacy@kemokem.com` is the contact printed on the legal pages. Confirm the mailbox receives mail before relying on it for a platform review. Do not change production DNS as part of that check.

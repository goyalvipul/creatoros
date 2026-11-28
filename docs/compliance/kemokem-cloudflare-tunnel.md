# kemokem.com Cloudflare Tunnel (same Kemokem stack)

The public hostname `https://kemokem.com` resolves through the **existing** Cloudflare tunnel `kemokem-production` to `http://caddy:80`. The Caddy service is on the Compose default network (`creatoros_default`). The legacy `https://os.goyalfamily.ca` entry point remains independent and must not be changed by this deployment.

The optional `cloudflared` Compose service uses profile `tunnel`, to avoid requiring credentials for development/test deployments. It **does not publish ports** or start a second Kemokem app. The name `kemokem-cloudflared` is deliberately kept stable for migration from the existing standalone Docker container.

## One-time cutover on guardobox

1. Keep existing Caddy, API, web, worker, PostgreSQL, Redis, Cloudflare DNS, and `os.goyalfamily.ca` unchanged. Record the existing tunnel container's configuration:

   ```sh
   docker inspect kemokem-cloudflared --format 'Image={{.Config.Image}} Restart={{.HostConfig.RestartPolicy.Name}} Network={{.HostConfig.NetworkMode}}'
   docker compose ps caddy
   ```

2. Add the **existing** `kemokem-production` tunnel token as `CLOUDFLARE_TUNNEL_TOKEN` in `~/workspace/creatoros/.env` with restrictive permissions. Obtain it from the Cloudflare dashboard; do **not** paste it into chat, GitHub, logs or terminal command arguments. Do not create a new tunnel or use a token from another tunnel.

3. After merging and pulling this change, validate the optional profile locally (avoid dumping resolved environment values, which may include secrets):

   ```sh
   docker compose --profile tunnel config --quiet
   ```

4. There is already a standalone container called `kemokem-cloudflared`. Compose cannot adopt that container. **Only once the token is available and config validates**, stop and rename it, preserving an easy rollback:

   ```sh
   docker stop kemokem-cloudflared
   docker rename kemokem-cloudflared kemokem-cloudflared-backup
   docker compose --profile tunnel up -d --no-deps cloudflared
   ```

   This recreates **only** the tunnel connector, with a short expected interruption to `kemokem.com`. It does not recreate Caddy or any Kemokem service. New Compose services join the default `creatoros_default` network automatically, making `http://caddy:80` resolvable.

5. Verify:

   ```sh
   docker compose --profile tunnel ps cloudflared
   docker compose --profile tunnel logs --tail=50 cloudflared
   docker inspect kemokem-cloudflared --format '{{json .NetworkSettings.Networks}}'
   curl -IsS https://kemokem.com | head
   curl -IsS https://os.goyalfamily.ca | head
   ```

   Confirm the `creatoros_default` network exists on the new connector, the cloudflared connection is healthy and both public domains still work. Cloudflare published application route remains `kemokem.com` → `http://caddy:80`. No DNS updates are needed for this Docker-only cutover.

6. On failure, roll back the tunnel connector **only**:

   ```sh
   docker compose --profile tunnel stop cloudflared
   docker compose --profile tunnel rm -f cloudflared
   docker rename kemokem-cloudflared-backup kemokem-cloudflared
   docker start kemokem-cloudflared
   ```

   After successful verification, remove the backup when comfortable: `docker rm kemokem-cloudflared-backup`.

## Operational notes

- Ordinary `docker compose up -d` does not select the `tunnel` profile. To manage the tunnel explicitly, use `docker compose --profile tunnel up -d --no-deps cloudflared` (or include that profile in planned deployments). Existing running profiled services may be retained when other services are updated; verify before depending on that behavior.
- Keep `APP_BASE_URL=https://os.goyalfamily.ca` and existing provider callback URLs unchanged during the dual-domain transition. Add `https://kemokem.com` to `ALLOWED_ORIGINS` without dropping existing trusted origins, then test cookie-authenticated writes and logins on the new domain. That environment edit is separate from this PR.
- Cookies are isolated by browser origin. The two domains share the same Kemokem backend accounts and data but do not share a login cookie.
- A working tunnel does not by itself make the app eligible for TikTok Direct Post approval. Test public product pages and creator onboarding before submitting.
- Pin the tunnel image to a verified digest when an upgrade process is established; `latest` matches the existing manually launched connector for this initial migration.

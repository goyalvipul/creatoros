# Kemokem MCP Events diagnostic

The existing private Connector publishes one MCP 2026-07-28 event, `kemokem.diagnostic.requested`. Its payload contains only `requestId` and `message`. A Work chat must subscribe before Kemokem can send it a diagnostic. The resulting turn can call `kemokem_diagnostic_result` with that exact request ID. The callback HTTP response records delivery. Only the authenticated result call records acknowledgement and completes the diagnostic.

The Site authenticates the caller and signs its Site identity assertion separately from the existing gateway token. Kemokem verifies both and requires the two hosted diagnostic scopes, an active owner and the matching organization and credential. The assertion nonce is single-use. The PostgreSQL outbox uses the existing BullMQ jobs worker. Each retry sends the same event ID, up to four attempts. The result is idempotent even after the subscription expires, subject to continued authorization.

## Deployment

1. Record the current clean production revision and Site version. Take a verified backup using the existing operations process. Keep the production checkout's owner and existing configuration.
2. Configure a new random 32-byte secret encoded as 64 lowercase hex characters as `KEMOKEM_MCP_EVENTS_KEY` in guardobox's existing private `.env` and as a **secret** in the existing private Site. Generate and move it through your approved secret-management workflow. Keep it out of shell history, commit history, logs, and chat. Keep the existing gateway token and `ENCRYPTION_KEY`.
3. Fetch the tested application revision and deploy the existing Compose stack. The migrate service applies `0061_mcp_diagnostics`. Confirm the api, worker and web are healthy and that the migration succeeded.

   ```sh
   cd /home/vipul/workspace/creatoros
   git status --short --branch
   git rev-parse HEAD
   git fetch origin feat/mcp-diagnostic-events
   git switch --detach FETCH_HEAD
   docker compose up -d --build migrate api worker web
   docker compose ps -a migrate api worker web
   curl --fail --silent --show-error http://127.0.0.1:8080/api/v1/health/ready
   ```

4. Publish saved Site version **20** (connector commit `8f19660a1111b6b3e862f7698a9d2f2de5325def`) to the **existing owner-only Site**. Confirm the plugin ID and sharing match the existing installation. The catalogue should contain 74 tools, including `kemokem_diagnostic_result`, and one MCP event.
5. In Kemokem Integrations → ChatGPT, enable `diagnostics.subscribe` and `diagnostics.result` for Hosted mode. Preserve every existing scope. The two new permissions default to disabled.
6. In an eligible Work chat using the existing plugin, ask ChatGPT to subscribe to `kemokem.diagnostic.requested`. Tell it to acknowledge each received diagnostic using `kemokem_diagnostic_result` and the exact `requestId` in the event. Confirm a verified active subscription in Integrations.
7. Click **Send Diagnostic** once. Confirm that the request moves through dispatch and successful delivery, and that acknowledged and completed timestamps are present for the same request ID. An HTTP 2xx alone is insufficient. A delivered request without acknowledgement fails after 30 minutes. Confirm the history shows one execution for the request. Unsubscribe the diagnostic chat when validation is done.

## Rollback

Disable the two hosted diagnostic scopes to revoke subscriptions and stop new dispatches without affecting other connector permissions. Republish the previously recorded Site version using the owner-private deploy action. The baseline for the first roll-out is version **18** (connector commit `c4b0342b454944ef7fc6df45b968e4caa3e8feb2`). Restore the recorded application revision and rebuild only the existing API, worker and web services.

```sh
cd /home/vipul/workspace/creatoros
git switch --detach <recorded-previous-commit>
docker compose up -d --build api worker web
docker compose ps api worker web
curl --fail --silent --show-error http://127.0.0.1:8080/api/v1/health/ready
```

Migration 0061 adds diagnostic-only tables. Keep them during rollback to retain execution history. Once both sides are rolled back, remove the optional event assertion key through the existing secret-management workflow. To rotate only the callback signing secret, let ChatGPT refresh the subscription with the new secret. Kemokem verifies the callback with the new secret before replacing the encrypted value.

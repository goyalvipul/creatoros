/**
 * Disposable back end for the Playwright run: a real PostgreSQL (Docker, tmpfs), real migrations and the real API.
 * Redis/worker are not needed by the browser flows (on-demand queue jobs fail with a clear 503, which is also covered).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '@creatoros/api';
import { createDb } from '@creatoros/db';
import { runMigrations } from '@creatoros/db/migrate';
import { loadConfig } from '@creatoros/services';
import { startTestPg } from '../../integration/src/pg';

const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3100';

const pg = await startTestPg('creatoros_e2e');
if (pg.container) fs.writeFileSync(path.join(import.meta.dirname, '..', '.e2e-pg-container'), pg.container);

const handle = createDb(pg.url, { max: 6 });
await runMigrations(handle.db);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'creatoros-e2e-'));
const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: pg.url,
  ENCRYPTION_KEY: 'e2e-encryption-key-0123456789abcdef',
  AGENT_PAIRING_SECRET: 'e2e-pairing-secret-0123456789abcdef',
  WORKFLOW_WEBHOOK_SECRET: 'e2e-workflow-secret-0123456789abcdef',
  APP_BASE_URL: WEB_URL,
  ALLOWED_ORIGINS: WEB_URL,
  API_HOST: '127.0.0.1',
  API_PORT: String(API_PORT),
  LOG_LEVEL: 'warn',
  LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
  GLOBAL_RATE_LIMIT_PER_MINUTE: '1000000',
  DATA_DIR: dataDir,
});
const app = await buildApp({ db: handle.db, config });
await app.listen({ host: '127.0.0.1', port: API_PORT });
console.log(`E2E backend ready on :${API_PORT} (${pg.kind} postgres)`);

const stop = async () => {
  await app.close();
  await handle.close();
  await pg.stop();
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
setInterval(() => {}, 1 << 30);

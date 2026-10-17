// One-shot migration runner used by the `migrate` compose service (bundled to dist/migrate.js).
import { createDb } from '@creatoros/db';
import { runMigrations } from '@creatoros/db/migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(JSON.stringify({ level: 'fatal', msg: 'DATABASE_URL is required' }));
  process.exit(2);
}

// Wait for Postgres (compose already gates on its healthcheck; this covers bare-metal use).
const handle = createDb(url, { max: 2, applicationName: 'creatoros-migrate' });
try {
  let lastErr: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await runMigrations(handle.db, url);
      console.log(JSON.stringify({ level: 'info', msg: 'migrations applied', ...r }));
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (lastErr) throw lastErr;
} catch (err) {
  console.error(JSON.stringify({ level: 'fatal', msg: 'migration failed', err: String(err) }));
  process.exitCode = 1;
} finally {
  await handle.close();
}

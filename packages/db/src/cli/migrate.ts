import { createDb } from '../index';
import { runMigrations } from '../migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}

const h = createDb(url, { max: 2, applicationName: 'creatoros-migrate' });
try {
  const r = await runMigrations(h.db, url);
  console.log(JSON.stringify({ level: 'info', msg: 'migrations applied', ...r }));
} catch (err) {
  console.error(JSON.stringify({ level: 'error', msg: 'migration failed', err: String(err) }));
  process.exitCode = 1;
} finally {
  await h.close();
}

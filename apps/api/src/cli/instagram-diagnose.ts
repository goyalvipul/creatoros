// Read-only live probe of the Instagram API using the stored (encrypted) token. Prints sanitized results, never the token.
//   docker compose exec api node apps/api/dist/cli/instagram-diagnose.js [username]
import { createDb, sql } from '@creatoros/db';
import { loadConfig, runInstagramDiagnostics, systemCtx } from '@creatoros/services';

const want = process.argv[2]?.replace(/^@/, '');
const config = loadConfig();
const handle = createDb(config.databaseUrl, { max: 2, applicationName: 'creatoros-ig-diagnose' });
try {
  const res: any = await handle.db.execute(
    sql`select id, org_id, config->>'username' as username from provider_connections where provider = 'instagram' order by created_at`,
  );
  const rows = (Array.isArray(res) ? res : res.rows) as {
    id: string;
    org_id: string;
    username: string | null;
  }[];
  const targets = rows.filter((r) => !want || r.username === want);
  if (!targets.length) console.error('No matching Instagram connection.');
  for (const t of targets) {
    const out = await runInstagramDiagnostics(systemCtx({ db: handle.db, env: config.env }, t.org_id), t.id);
    console.log(JSON.stringify({ username: t.username, ...out }, null, 2));
  }
} finally {
  await handle.close();
}

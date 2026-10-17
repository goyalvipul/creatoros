// Owner-run repair: inspect how an Instagram connection maps to a Channels account, optionally confirm one link, then import.
//   docker compose exec api node apps/api/dist/cli/instagram-link.js @username                 (inspect only)
//   docker compose exec api node apps/api/dist/cli/instagram-link.js @username --link <accountId> --import
import { createDb, sql } from '@creatoros/db';
import {
  confirmAccountLink,
  getConnectionIdentity,
  loadConfig,
  runSync,
  syncInstagramAccount,
  systemCtx,
} from '@creatoros/services';

const args = process.argv.slice(2);
const want = args[0]?.replace(/^@/, '');
const flag = (n: string) => args.indexOf(n);
const linkId = flag('--link') >= 0 ? args[flag('--link') + 1] : undefined;
const config = loadConfig();
const handle = createDb(config.databaseUrl, { max: 2, applicationName: 'creatoros-ig-link' });
try {
  const res: any = await handle.db.execute(
    sql`select id, org_id from provider_connections where provider = 'instagram' and config->>'username' = ${want ?? ''}`,
  );
  const rows = (Array.isArray(res) ? res : res.rows) as { id: string; org_id: string }[];
  if (rows.length !== 1) throw new Error(`Expected exactly one connection for @${want}, found ${rows.length}`);
  const ctx = systemCtx({ db: handle.db, env: config.env }, rows[0]!.org_id);
  const id = rows[0]!.id;
  console.log('before', JSON.stringify((await getConnectionIdentity(ctx, id)).identity, null, 2));
  if (linkId) console.log('link', JSON.stringify(await confirmAccountLink(ctx, id, linkId), null, 2));
  if (flag('--import') >= 0) {
    console.log('runSync', JSON.stringify(await runSync(handle.db, config.env, id, {}), null, 2));
    console.log('social', JSON.stringify(await syncInstagramAccount(ctx, id), null, 2));
  }
} finally {
  await handle.close();
}

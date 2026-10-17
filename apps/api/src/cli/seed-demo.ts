// `pnpm db:seed:demo` : load the labelled DEMO data into an existing install (the owner must have run setup first).
// Same code path as Settings -> Demo data. Everything is labelled DEMO and can be removed from the same screen.
import { createDb, sql } from '@creatoros/db';
import { loadConfig, seedDemo, systemCtx } from '@creatoros/services';

const config = loadConfig();
const handle = createDb(config.databaseUrl, { max: 2, applicationName: 'creatoros-seed-demo' });
try {
  const res = await handle.db.execute(
    sql`select id as org_id, owner_user_id as id from organizations order by created_at asc limit 1`,
  );
  const row = (Array.isArray(res) ? res[0] : (res as any).rows?.[0]) as
    { id: string; org_id: string } | undefined;
  if (!row) {
    console.error(
      'No owner exists yet. Open the app and complete the setup wizard first (it also offers demo data).',
    );
    process.exitCode = 1;
  } else {
    const ctx = {
      ...systemCtx({ db: handle.db, env: config.env }, row.org_id),
      userId: row.id,
      actor: { type: 'user' as const, id: row.id },
    };
    console.log(JSON.stringify(await seedDemo(ctx)));
  }
} catch (e) {
  console.error(`Could not load demo data: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await handle.close();
}

import { createDb } from '@creatoros/db';
import { runMigrations } from '@creatoros/db/migrate';
import { startTestPg, type TestPg } from './pg';

let pg: TestPg | undefined;

export async function setup() {
  pg = await startTestPg();
  const h = createDb(pg.url, { max: 2 });
  await runMigrations(h.db);
  await h.close();
  process.env.TEST_DATABASE_URL = pg.url;
  process.env.TEST_PG_EMBEDDED = pg.kind;
}

export async function teardown() {
  await pg?.stop();
}

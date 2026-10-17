import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { Db } from './index';

export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(here, '../drizzle'),
    path.resolve(here, './drizzle'),
    path.resolve(process.cwd(), 'drizzle'),
    path.resolve(process.cwd(), 'packages/db/drizzle'),
  ].filter(Boolean) as string[];
  const found = candidates.find((c) => fs.existsSync(path.join(c, 'meta', '_journal.json')));
  if (!found) throw new Error(`Cannot find migrations folder (looked in ${candidates.join(', ')})`);
  return found;
}

/**
 * Applies pending migrations. Never resets data. When MIGRATE_BACKUP_DIR is set and the database
 * already contains tables, a pg_dump safety backup is written first (best effort, logged).
 */
export async function runMigrations(
  db: Db,
  databaseUrl?: string,
): Promise<{ folder: string; backup?: string }> {
  const folder = migrationsFolder();
  let backup: string | undefined;
  const backupDir = process.env.MIGRATE_BACKUP_DIR;
  if (backupDir && databaseUrl) {
    const existing = await db.execute(
      sql`select count(*)::int as n from information_schema.tables where table_schema='public' and table_name='users'`,
    );
    const n = (existing as unknown as { rows: { n: number }[] }).rows?.[0]?.n ?? 0;
    if (n > 0) {
      fs.mkdirSync(backupDir, { recursive: true });
      const file = path.join(
        backupDir,
        `pre-migrate-${new Date().toISOString().replace(/[:.]/g, '-')}.sql.gz.dump`,
      );
      const r = spawnSync('pg_dump', ['--format=custom', '--compress=6', `--file=${file}`, databaseUrl], {
        encoding: 'utf8',
      });
      if (r.status === 0) {
        backup = file;
        console.log(JSON.stringify({ level: 'info', msg: 'pre-migration backup written', file }));
      } else {
        console.warn(
          JSON.stringify({
            level: 'warn',
            msg: 'pre-migration backup skipped',
            err: r.stderr || r.error?.message,
          }),
        );
      }
    }
  }
  await migrate(db, { migrationsFolder: folder });
  return { folder, backup };
}

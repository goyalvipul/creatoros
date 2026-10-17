// Host-side restore:  pnpm restore <backups/creatoros-....dump> --yes
// DESTRUCTIVE: replaces the live database with the backup. Without --yes it only checks the file and explains.
// Steps: verify checksum -> take a safety backup of the current data -> stop app services -> recreate database ->
// pg_restore -> restore attachments -> start everything again.
import fs from 'node:fs';
import path from 'node:path';
import { compose, dbCreds, fileToCompose, parseArgs, root, sha256File } from './lib.mjs';
import { runBackup } from './backup.mjs';

const { flags, rest } = parseArgs(process.argv.slice(2));
const file = rest[0] ? path.resolve(root, rest[0]) : null;
if (!file || !fs.existsSync(file)) {
  console.error('Usage: pnpm restore <path-to-.dump> --yes\nBackups are written to ./backups by `pnpm backup`.');
  process.exit(2);
}

const manifestPath = `${file}.manifest.json`;
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
console.log('Checking the backup file...');
if (manifest) {
  const actual = await sha256File(file);
  if (actual !== manifest.checksumSha256) {
    console.error('Checksum mismatch: this backup is corrupted or was modified. Refusing to restore.');
    process.exit(1);
  }
  console.log(`Checksum OK (created ${manifest.createdAt}).`);
} else {
  console.warn('No manifest next to the file, so the checksum cannot be verified.');
}
const toc = await fileToCompose(file, ['exec', '-T', 'db', 'pg_restore', '--list']);
if (!/TABLE DATA/.test(toc)) {
  console.error('pg_restore cannot read any tables from this file. Refusing to restore.');
  process.exit(1);
}

if (!flags.yes) {
  console.log('\nThe file is valid. Nothing was changed.\nRe-run with --yes to REPLACE the current database with it (a safety backup is taken first).');
  process.exit(0);
}

const { user, db } = dbCreds();
try {
  console.log('Taking a safety backup of the current data first...');
  await runBackup('pre_restore');
} catch (e) {
  console.error(`Could not take the safety backup (${e.message}). Aborting so nothing is lost. Use --force-no-safety to skip (not recommended).`);
  if (!flags['force-no-safety']) process.exit(1);
}

console.log('Stopping app services...');
compose(['stop', 'caddy', 'web', 'api', 'worker'], { allowFail: true });
try {
  const psql = (sql, database = 'postgres') => compose(['exec', '-T', 'db', 'psql', '-U', user, '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  psql(`select pg_terminate_backend(pid) from pg_stat_activity where datname = '${db}' and pid <> pg_backend_pid()`);
  psql(`drop database if exists "${db}"`);
  psql(`create database "${db}"`);
  console.log('Restoring the database...');
  await fileToCompose(file, ['exec', '-T', 'db', 'pg_restore', '-U', user, '--no-owner', '--exit-on-error', '--dbname', db]);

  if (manifest?.attachmentsArchive) {
    const archive = path.join(path.dirname(file), manifest.attachmentsArchive);
    if (fs.existsSync(archive)) {
      console.log('Restoring attachments...');
      compose(['run', '--rm', '--no-deps', '-T', '--entrypoint', 'sh', 'api', '-c', 'mkdir -p /data/attachments'], { allowFail: true });
      await fileToCompose(archive, ['run', '--rm', '--no-deps', '-T', '--entrypoint', 'tar', 'api', '-xzf', '-', '-C', '/data/attachments']);
    } else console.warn(`Attachments archive ${manifest.attachmentsArchive} not found next to the dump; skipped.`);
  }
} catch (e) {
  console.error(`Restore failed: ${e.message}\nThe safety backup in ./backups holds your previous data. Restart services with: docker compose up -d`);
  process.exit(1);
}

console.log('Starting services (migrations run automatically)...');
compose(['up', '-d']);
console.log('Done. Sign in with the account that existed when the backup was taken.');

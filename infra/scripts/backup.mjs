// Host-side backup:  pnpm backup [--out <dir>]
// Writes backups/creatoros-<timestamp>.dump (+ attachments archive + manifest with a SHA-256 checksum), then verifies it.
// Original media files are NOT included: they stay on their machines. Preview cache is excluded (rebuildable).
// ENCRYPTION_KEY (in .env) is NOT included on purpose: keep it somewhere separate, a backup is useless without it for
// connected integrations (their stored tokens cannot be decrypted).
import fs from 'node:fs';
import path from 'node:path';
import { compose, composeToFile, dbCreds, fileToCompose, parseArgs, root, sha256File, stamp } from './lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const outDir = path.resolve(root, typeof flags.out === 'string' ? flags.out : 'backups');
fs.mkdirSync(outDir, { recursive: true });

export async function runBackup(kind = 'manual') {
  const { user, db } = dbCreds();
  const base = path.join(outDir, `creatoros-${stamp()}`);
  const dump = `${base}.dump`;
  compose(['exec', '-T', 'db', 'true']); // fails early with a clear message if the stack is down
  console.log('Dumping database...');
  try {
    await composeToFile(['exec', '-T', 'db', 'pg_dump', '-U', user, '--format=custom', '--no-owner', db], dump);
    const size = fs.statSync(dump).size;
    if (size < 1024) throw new Error('Backup file is suspiciously small; refusing to keep it');
    const toc = await fileToCompose(dump, ['exec', '-T', 'db', 'pg_restore', '--list']);
    if (!/TABLE DATA/.test(toc)) throw new Error('pg_restore could not read any tables from the new backup');

    let attachments = null;
    const has = compose(['exec', '-T', 'api', 'sh', '-c', 'ls -A /data/attachments 2>/dev/null | head -1'], { allowFail: true });
    if (has.stdout.trim()) {
      attachments = `${base}-attachments.tar.gz`;
      console.log('Archiving attachments...');
      await composeToFile(['exec', '-T', 'api', 'tar', '-czf', '-', '-C', '/data/attachments', '.'], attachments);
    }
    const checksum = await sha256File(dump);
    const manifest = {
      app: 'creatoros',
      createdAt: new Date().toISOString(),
      kind,
      dumpFile: path.basename(dump),
      attachmentsArchive: attachments ? path.basename(attachments) : null,
      checksumSha256: checksum,
      sizeBytes: size,
      tables: (toc.match(/TABLE DATA/g) ?? []).length,
      note: 'Contains no original media and no ENCRYPTION_KEY. Keep .env (or at least ENCRYPTION_KEY) backed up separately.',
    };
    fs.writeFileSync(`${dump}.manifest.json`, JSON.stringify(manifest, null, 2));
    console.log(`OK  ${dump}  (${(size / 1024 / 1024).toFixed(1)} MB, ${manifest.tables} tables, sha256 ${checksum.slice(0, 12)}...)`);
    return dump;
  } catch (e) {
    fs.rmSync(dump, { force: true });
    throw e;
  }
}

if (import.meta.filename === process.argv[1] || path.resolve(process.argv[1] ?? '') === import.meta.filename) {
  runBackup().catch((e) => {
    console.error(`Backup failed: ${e.message}`);
    process.exit(1);
  });
}

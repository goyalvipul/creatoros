import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Webserver processes are killed hard on Windows, so the disposable Postgres container is removed here. */
export default function globalTeardown() {
  const f = path.join(import.meta.dirname, '..', '.e2e-pg-container');
  if (!fs.existsSync(f)) return;
  const name = fs.readFileSync(f, 'utf8').trim();
  if (name) spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
  fs.rmSync(f, { force: true });
}

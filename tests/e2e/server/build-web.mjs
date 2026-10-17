// Next.js bakes rewrites at build time, so the E2E run builds the web app pointing at the E2E API port.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const api = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 4100}`;
const cwd = path.resolve(import.meta.dirname, '../../../apps/web');
const r = spawnSync('pnpm', ['run', 'build'], { cwd, stdio: 'inherit', shell: true, env: { ...process.env, API_INTERNAL_URL: api } });
process.exit(r.status ?? 1);

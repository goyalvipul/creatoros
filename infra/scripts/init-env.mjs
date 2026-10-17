// Creates .env from .env.example with freshly generated secrets. Never overwrites an existing .env.
//   node infra/scripts/init-env.mjs [--lan-ip 192.168.1.50] [--base-url https://pc.tailnet.ts.net]
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const target = join(root, '.env');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

if (existsSync(target)) {
  console.log('.env already exists - leaving it untouched.');
  process.exit(0);
}

const secret = (bytes = 24) => randomBytes(bytes).toString('base64url');
const pgPassword = secret(18);
let text = readFileSync(join(root, '.env.example'), 'utf8');
const set = (key, value) => {
  text = text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
};
set('POSTGRES_PASSWORD', pgPassword);
set('ENCRYPTION_KEY', secret(32));
set('AGENT_PAIRING_SECRET', secret(32));
set('WORKFLOW_WEBHOOK_SECRET', secret(32));
set('DATABASE_URL', `postgres://creatoros:${pgPassword}@127.0.0.1:5432/creatoros`);

const port = '8080';
const origins = new Set([`http://localhost:${port}`]);
const lan = arg('--lan-ip');
if (lan) origins.add(`http://${lan}:${port}`);
const base = arg('--base-url');
if (base) origins.add(base.replace(/\/$/, ''));
set('APP_BASE_URL', (base ?? `http://localhost:${port}`).replace(/\/$/, ''));
set('ALLOWED_ORIGINS', [...origins].join(','));

writeFileSync(target, text, { mode: 0o600 });
console.log('Created .env with generated secrets.');
console.log('BACK UP ENCRYPTION_KEY somewhere safe and separate from database backups.');

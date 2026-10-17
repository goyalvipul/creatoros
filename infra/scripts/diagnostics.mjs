// Support bundle:  pnpm diagnostics   ->  diagnostics/creatoros-diagnostics-<timestamp>.txt
// Collects service state, health checks, port exposure and recent error log lines. Secrets are never printed:
// only whether each required variable is set. Safe to share.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compose, readEnvFile, root, stamp } from './lib.mjs';

const lines = [];
const out = (s = '') => lines.push(s);
const section = (t) => (out(), out(`== ${t} ==`));
const safe = (fn) => {
  try {
    return fn();
  } catch (e) {
    return `(failed: ${e.message.split('\n')[0]})`;
  }
};
const redact = (s) =>
  s
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, '$1***@')
    .replace(/((?:password|secret|token|key)["':= ]+)[^\s",]+/gi, '$1***');

out(`Creator OS diagnostics, ${new Date().toISOString()}`);
out(
  `Host: ${os.type()} ${os.release()} (${os.arch()}), ${(os.totalmem() / 2 ** 30).toFixed(1)} GB RAM, ${(os.freemem() / 2 ** 30).toFixed(1)} GB free, node ${process.version}`,
);

section('Configuration (values never shown)');
const env = readEnvFile();
for (const k of ['POSTGRES_PASSWORD', 'ENCRYPTION_KEY', 'AGENT_PAIRING_SECRET'])
  out(`${k}: ${env[k] ? 'set' : 'MISSING'}`);
out(`APP_BASE_URL: ${env.APP_BASE_URL ?? '(default http://localhost:8080)'}`);
out(`ALLOWED_ORIGINS: ${env.ALLOWED_ORIGINS ?? '(default)'}`);
out(`HTTP_PORT: ${env.HTTP_PORT ?? '8080 (default)'}`);

section('Containers');
out(
  safe(() => compose(['ps', '-a', '--format', 'table {{.Service}}\t{{.Status}}\t{{.Ports}}']).stdout.trim()),
);

section('Port exposure (Postgres and Redis must not be reachable beyond loopback)');
const ports = safe(() => compose(['ps', '--format', '{{.Service}} {{.Ports}}']).stdout);
for (const svc of ['db', 'redis']) {
  const line = ports.split('\n').find((l) => l.startsWith(`${svc} `)) ?? '';
  const exposed = /0\.0\.0\.0:\d+->|\[::\]:\d+->/.test(line);
  out(`${svc}: ${exposed ? 'EXPOSED ON ALL INTERFACES (fix this!)' : 'not published to the network'}`);
}
const proxies = ports.split('\n').filter((l) => /^(db|redis)-proxy /.test(l));
if (proxies.length)
  out(
    `note: dev proxies are running (${proxies.map((l) => l.split(' ')[0]).join(', ')}); they listen on 127.0.0.1 only. Stop with: docker compose --profile dev stop db-proxy redis-proxy`,
  );

section('Health');
const base = `http://localhost:${env.HTTP_PORT || 8080}`;
for (const p of ['/api/v1/health/live', '/api/v1/health/ready', '/healthz']) {
  try {
    const r = await fetch(base + p, { signal: AbortSignal.timeout(5000) });
    out(`${p}: HTTP ${r.status}`);
  } catch (e) {
    out(`${p}: unreachable (${e.message})`);
  }
}

section('Recent errors (last 200 lines per service, errors only)');
for (const svc of ['api', 'worker', 'web', 'caddy', 'migrate']) {
  const log = safe(() => compose(['logs', '--no-color', '--tail', '200', svc], { allowFail: true }).stdout);
  const errs = log
    .split('\n')
    .filter((l) => /"level":"(error|fatal)"|\berror\b|\bfatal\b/i.test(l))
    .slice(-8);
  out(`-- ${svc}: ${errs.length} error line(s)`);
  for (const l of errs) out(`   ${redact(l).slice(0, 400)}`);
}

section('Disk');
out(safe(() => compose(['exec', '-T', 'api', 'df', '-h', '/data']).stdout.trim()));
out(safe(() => spawnSync('docker', ['system', 'df'], { encoding: 'utf8' }).stdout.trim()));

section('Tailscale');
const ts = spawnSync('tailscale', ['status'], { encoding: 'utf8' });
const tsLines = ts.error ? [] : ts.stdout.trim().split('\n').filter(Boolean);
out(
  ts.error
    ? 'tailscale CLI not found on PATH'
    : `this device: ${(tsLines[0] ?? '').trim().split(/\s+/).slice(0, 2).join(' ')}; peers listed: ${Math.max(0, tsLines.length - 1)} (names omitted)`,
);
const serve = spawnSync('tailscale', ['serve', 'status'], { encoding: 'utf8' });
if (!serve.error)
  out(
    `serve mappings: ${((serve.stdout || '').match(/proxy |tcp:\/\/127/g) ?? []).length} (details omitted; run "tailscale serve status" yourself)`,
  );

const dir = path.join(root, 'diagnostics');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `creatoros-diagnostics-${stamp()}.txt`);
fs.writeFileSync(file, lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log(`\nSaved to ${file}`);

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import pgLib from 'pg';

/**
 * Integration tests run against a REAL PostgreSQL server, never a mock. Order of preference:
 *  1. TEST_DATABASE_URL (e.g. an already running server)
 *  2. a disposable `postgres:17-alpine` Docker container (tmpfs data dir)
 *  3. an embedded PostgreSQL binary (only works when the shell is not elevated/admin)
 */
export interface TestPg {
  url: string;
  stop: () => Promise<void>;
  kind: 'external' | 'docker' | 'embedded';
  /** Docker container name when kind === 'docker' (lets backup tests run pg_dump inside the container). */
  container?: string;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForPg(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    const c = new pgLib.Client({ connectionString: url });
    try {
      await c.connect();
      await c.query('select 1');
      await c.end();
      return;
    } catch (e) {
      lastErr = e;
      try {
        await c.end();
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Postgres not ready: ${String(lastErr)}`);
}

function dockerAvailable(): boolean {
  const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  return r.status === 0 && !!r.stdout.trim();
}

export async function startTestPg(name = 'creatoros_test'): Promise<TestPg> {
  if (process.env.TEST_DATABASE_URL) {
    return { url: process.env.TEST_DATABASE_URL, stop: async () => {}, kind: 'external' };
  }
  if (dockerAvailable()) {
    const port = await freePort();
    const cname = `creatoros-testpg-${process.pid}-${port}`;
    const r = spawnSync(
      'docker',
      [
        'run',
        '-d',
        '--rm',
        '--name',
        cname,
        '-p',
        `127.0.0.1:${port}:5432`,
        '-e',
        'POSTGRES_PASSWORD=postgres',
        '-e',
        `POSTGRES_DB=${name}`,
        '--tmpfs',
        '/var/lib/postgresql/data',
        'postgres:17-alpine',
        '-c',
        'fsync=off',
        '-c',
        'synchronous_commit=off',
        '-c',
        'full_page_writes=off',
      ],
      { encoding: 'utf8' },
    );
    if (r.status === 0) {
      const url = `postgres://postgres:postgres@127.0.0.1:${port}/${name}`;
      try {
        await waitForPg(url);
        return {
          url,
          kind: 'docker',
          container: cname,
          stop: async () => {
            spawnSync('docker', ['rm', '-f', cname], { encoding: 'utf8' });
          },
        };
      } catch (e) {
        spawnSync('docker', ['rm', '-f', cname], { encoding: 'utf8' });
        console.warn('docker postgres failed, trying embedded:', String(e));
      }
    } else {
      console.warn('docker run failed, trying embedded:', r.stderr);
    }
  }
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creatoros-pg-'));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(name);
  return {
    url: `postgres://postgres:postgres@127.0.0.1:${port}/${name}`,
    kind: 'embedded',
    stop: async () => {
      await pg.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

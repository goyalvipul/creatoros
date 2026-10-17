// Restart / failure-injection test (spec T31):  pnpm restart-test
//   1. snapshot every table's row count, a Redis marker key and a delayed BullMQ job
//   2. `docker compose restart` the whole stack
//   3. the API comes back, no table lost rows, the marker and queued job survived, and the worker processes jobs again
//   4. restart only Redis (failure injection): the API stays up, the worker reconnects and keeps processing
// Runs against the live stack (docker compose up -d) and touches no business data; it only adds a throwaway Redis key
// and a delayed job in a private queue, both removed at the end. Exit code 1 if any check fails.
import { compose, dbCreds, readEnvFile } from './lib.mjs';

const env = readEnvFile();
const base = `http://localhost:${env.HTTP_PORT || 8080}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const { user, db } = dbCreds();
const psql = (sql) =>
  compose(['exec', '-T', 'db', 'psql', '-U', user, '-d', db, '-At', '-F', '|', '-c', sql]).stdout.trim();
const tableCounts = () => {
  const rows = psql(
    `select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
  );
  return Object.fromEntries(
    rows
      .split('\n')
      .map((l) => l.split('|'))
      .map(([t, n]) => [t, Number(n)]),
  );
};
const redis = (...args) => compose(['exec', '-T', 'redis', 'redis-cli', ...args]).stdout.trim();
/** Run a snippet with bullmq inside the worker container (it has the dependency and REDIS_URL). */
const bull = (code) =>
  compose(
    [
      'exec',
      '-T',
      '-w',
      '/app/apps/worker',
      'worker',
      'node',
      '-e',
      `const {Queue}=require('bullmq');const IORedis=require('ioredis');(async()=>{const c=new IORedis(process.env.REDIS_URL,{maxRetriesPerRequest:null});${code};await c.quit()})().catch(e=>{console.error(e);process.exit(1)})`,
    ],
    { allowFail: false },
  ).stdout.trim();

async function apiReady(timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${base}/api/v1/health/ready`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(2000);
  }
  return false;
}
async function workerProcessesJobsAfter(t0, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const out = bull(
      `const q=new Queue('jobs',{connection:c});const done=await q.getCompleted(0,10);console.log(Math.max(0,...done.map(j=>j.finishedOn||0)));await q.close()`,
    );
    if (Number(out.split('\n').pop()) > t0) return true;
    await sleep(5000);
  }
  return false;
}

console.log(`Restart test against ${base}\n`);
check('stack is up before the test', await apiReady(30_000));

// ---- 1. snapshot
const before = tableCounts();
const tables = Object.keys(before);
console.log(`snapshot: ${tables.length} tables, ${Object.values(before).reduce((a, b) => a + b, 0)} rows`);
const marker = `t31-${Date.now()}`;
redis('set', 't31:marker', marker);
bull(
  `const q=new Queue('restart-probe',{connection:c});await q.obliterate({force:true}).catch(()=>{});await q.add('probe',{marker:'${marker}'},{delay:3600000,jobId:'t31-probe'});await q.close()`,
);
await sleep(2500); // let the AOF fsync (everysec)

// ---- 2. restart everything
const t0 = Date.now();
console.log('\nrestarting every service ...');
compose(['restart']);
check(
  'API is ready again after a full restart',
  await apiReady(),
  `${Math.round((Date.now() - t0) / 1000)}s`,
);
const running = compose(['ps', '--format', '{{.Service}} {{.State}}']).stdout.trim().split('\n');
const notRunning = running.filter((l) => !/ running$/.test(l.trim()) && !/^migrate /.test(l));
check('all services are running', notRunning.length === 0, notRunning.join('; '));

// ---- 3. data survived
const after = tableCounts();
const lost = tables.filter((t) => (after[t] ?? 0) < before[t]);
check(
  'no table lost rows (same database)',
  lost.length === 0,
  lost.map((t) => `${t}: ${before[t]}->${after[t]}`).join(', '),
);
check('Redis key survived', redis('get', 't31:marker') === marker);
const delayed = bull(
  `const q=new Queue('restart-probe',{connection:c});const j=await q.getJob('t31-probe');console.log(j?JSON.stringify({state:await j.getState(),m:j.data.marker}):'none');await q.close()`,
);
check(
  'a queued job survived the restart',
  delayed.includes('"delayed"') && delayed.includes(marker),
  delayed,
);
check('the worker processes jobs again after the restart', await workerProcessesJobsAfter(t0));

// ---- 4. failure injection: Redis only
const t1 = Date.now();
console.log('\nrestarting only Redis ...');
compose(['restart', 'redis']);
await sleep(3000);
check('API stays ready while Redis restarts (database-backed)', await apiReady(60_000));
check('worker reconnects to Redis and keeps processing', await workerProcessesJobsAfter(t1));
const workerRestarts = Number(
  compose(['ps', '-q', 'worker']).stdout.trim()
    ? (await import('node:child_process'))
        .spawnSync(
          'docker',
          ['inspect', '-f', '{{.RestartCount}}', compose(['ps', '-q', 'worker']).stdout.trim()],
          { encoding: 'utf8' },
        )
        .stdout.trim()
    : NaN,
);
console.log(`(worker container auto-restart count: ${workerRestarts})`);
check(
  'queued job still present after Redis restart',
  bull(
    `const q=new Queue('restart-probe',{connection:c});console.log(await q.getDelayedCount());await q.close()`,
  )
    .trim()
    .endsWith('1'),
);

// ---- cleanup
redis('del', 't31:marker');
bull(`const q=new Queue('restart-probe',{connection:c});await q.obliterate({force:true});await q.close()`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

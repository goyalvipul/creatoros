import { startTestPg } from './pg';

const pg = await startTestPg('creatoros_dev');
console.log(`Embedded PostgreSQL ready: ${pg.url}`);
console.log('Press Ctrl+C to stop.');
process.on('SIGINT', async () => {
  await pg.stop();
  process.exit(0);
});
setInterval(() => {}, 1 << 30);

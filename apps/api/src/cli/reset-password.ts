// Recovery when you are locked out (nothing here sends e-mail, so there is no "forgot password" link):
//   docker compose exec -it api node apps/api/dist/cli/reset-password.js you@example.com
// Run on the machine that hosts the stack. It asks for the new password (input is hidden), applies the same strength
// rules as the app, clears a login lock-out and signs that person out everywhere. Recorded in the audit trail.
import readline from 'node:readline';
import { createDb, sql } from '@creatoros/db';
import { loadConfig, resetMemberPassword, systemCtx } from '@creatoros/services';

const email = process.argv[2];
if (!email) {
  console.error('Usage: reset-password.js <e-mail of the person>');
  process.exit(2);
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const w = rl as unknown as { _writeToOutput: (s: string) => void };
    let muted = false;
    const original = w._writeToOutput.bind(rl);
    w._writeToOutput = (s: string) => {
      if (!muted) original(s);
      else if (s.includes('\n')) original('\n');
    };
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

const config = loadConfig();
const handle = createDb(config.databaseUrl, { max: 2, applicationName: 'creatoros-reset-password' });
try {
  const res = await handle.db.execute(
    sql`select m.org_id as org_id, u.id as id from users u join organization_memberships m on m.user_id = u.id where lower(u.email) = lower(${email}) limit 1`,
  );
  const row = (Array.isArray(res) ? res[0] : (res as any).rows?.[0]) as
    { org_id: string; id: string } | undefined;
  if (!row) {
    console.error(`No person with the e-mail ${email} exists.`);
    process.exitCode = 1;
  } else {
    const pw = process.env.NEW_PASSWORD ?? (await askHidden('New password (at least 12 characters): '));
    const again = process.env.NEW_PASSWORD ?? (await askHidden('Repeat it: '));
    if (pw !== again) {
      console.error('The two entries differ. Nothing was changed.');
      process.exitCode = 1;
    } else {
      await resetMemberPassword(systemCtx({ db: handle.db, env: config.env }, row.org_id), row.id, pw);
      console.log('Password changed. That person is signed out everywhere and any lock-out is cleared.');
    }
  }
} catch (e) {
  console.error(`Could not reset the password: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await handle.close();
}

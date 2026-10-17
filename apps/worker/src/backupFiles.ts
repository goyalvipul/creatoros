import fsp from 'node:fs/promises';
import path from 'node:path';

/** Newest-first list of backup dump files in a directory. */
export async function listBackupFiles(dir: string): Promise<string[]> {
  try {
    const names = (await fsp.readdir(dir)).filter((n) => n.startsWith('creatoros-') && n.endsWith('.dump'));
    const withTime = await Promise.all(names.map(async (n) => ({ n, t: (await fsp.stat(path.join(dir, n))).mtimeMs })));
    return withTime.sort((a, b) => b.t - a.t).map((x) => path.join(dir, x.n));
  } catch {
    return [];
  }
}

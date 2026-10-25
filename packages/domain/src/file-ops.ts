import { baseName, canonicalPath, dirName, extName, isInsideRoot, pathSeparator, type PathOs } from './paths';

export class FileOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileOpError';
  }
}

export interface FileOpRoot {
  id: string;
  displayPath: string;
  canonicalPath: string;
}

export interface PlannedFileOp {
  fromPath: string;
  toPath: string | null;
  rootId: string;
  fileName: string;
  ext: string;
}

const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

function checkName(name: string) {
  if (!name || name === '.' || name === '..') throw new FileOpError('Enter a file name.');
  if (name.length > 240) throw new FileOpError('That file name is too long.');
  if (BAD_NAME.test(name)) throw new FileOpError('A file name cannot contain \\ / : * ? " < > |');
  if (/[. ]$/.test(name)) throw new FileOpError('A file name cannot end with a space or a dot.');
  if (RESERVED.test(name)) throw new FileOpError('That name is reserved by Windows.');
}

function longestRoot(roots: FileOpRoot[], key: string, os: PathOs): FileOpRoot | null {
  let best: FileOpRoot | null = null;
  for (const root of roots) {
    if (!isInsideRoot(root.canonicalPath, key, os)) continue;
    if (!best || root.canonicalPath.length > best.canonicalPath.length) best = root;
  }
  return best;
}

function separators(p: string, os: PathOs): string {
  const sep = pathSeparator(os);
  const other = os === 'windows' ? '/' : '\\';
  return p.split(other).join(sep);
}

/**
 * Decide the exact path a same-machine rename, move, or delete is allowed to use.
 * The destination has to stay inside a folder that machine already indexes.
 */
export function planFileOperation(input: {
  kind: 'RENAME' | 'MOVE' | 'DELETE';
  displayPath: string;
  os: PathOs;
  roots: FileOpRoot[];
  name?: string;
  folder?: string;
}): PlannedFileOp {
  const fromPath = input.displayPath.trim();
  if (!fromPath) throw new FileOpError('This file has no path.');
  const os = input.os;
  const fromKey = canonicalPath(fromPath, os);
  const source = longestRoot(input.roots, fromKey, os);
  if (!source) throw new FileOpError('This file is outside the folders this machine is indexing.');
  const currentName = baseName(fromPath);
  if (input.kind === 'DELETE') {
    return { fromPath, toPath: null, rootId: source.id, fileName: currentName, ext: extName(currentName) };
  }

  let toPath: string;
  if (input.kind === 'RENAME') {
    const name = (input.name ?? '').trim();
    checkName(name);
    const dir = dirName(fromPath);
    if (!dir) throw new FileOpError('This file has no folder.');
    toPath = separators(dir, os).replace(/[\\/]+$/, '') + pathSeparator(os) + name;
  } else {
    let folder = (input.folder ?? '').trim().replace(/^["']|["']$/g, '');
    folder = separators(folder, os).replace(/[\\/]+$/, '');
    if (!folder) throw new FileOpError('Choose a folder on this machine.');
    if (os === 'windows' && !/^[a-zA-Z]:\\/.test(folder) && !folder.startsWith('\\\\'))
      throw new FileOpError('Use the full path of a folder on this machine, such as D:\\ComfyUI\\output\\Final.');
    if (os === 'posix' && !folder.startsWith('/'))
      throw new FileOpError('Use the full path of a folder on this machine.');
    checkName(currentName);
    toPath = folder + pathSeparator(os) + currentName;
  }

  const toKey = canonicalPath(toPath, os);
  const dest = longestRoot(input.roots, toKey, os);
  if (!dest) throw new FileOpError('That folder is not inside a folder this machine is indexing.');
  if (toKey === fromKey)
    throw new FileOpError(input.kind === 'RENAME' ? 'That is already the file name.' : 'The file is already in that folder.');
  return { fromPath, toPath, rootId: dest.id, fileName: baseName(toPath), ext: extName(toPath) };
}

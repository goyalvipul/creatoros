/**
 * Path rules shared by the API and tests. The scanner agent never lets the server trust its own
 * canonical form: the server always re-derives `canonicalKey` from the display path + OS.
 */

export type PathOs = 'windows' | 'posix';

export function detectPathOs(p: string): PathOs {
  if (/^[a-zA-Z]:([\\/]|$)/.test(p)) return 'windows';
  if (p.startsWith('\\\\') || p.startsWith('//')) return p.startsWith('\\\\') ? 'windows' : 'posix';
  if (p.includes('\\') && !p.includes('/')) return 'windows';
  return 'posix';
}

export function osToPathOs(os: string | null | undefined, samplePath?: string): PathOs {
  const v = (os ?? '').toLowerCase();
  if (v.startsWith('win')) return 'windows';
  if (v === 'linux' || v === 'darwin' || v === 'macos' || v === 'posix') return 'posix';
  return samplePath ? detectPathOs(samplePath) : 'posix';
}

/** Strip Win32 extended prefixes: `\\?\C:\x` -> `C:\x`, `\\?\UNC\h\s` -> `\\h\s`. */
function stripExtendedPrefix(p: string): string {
  if (p.startsWith('\\\\?\\UNC\\')) return '\\\\' + p.slice(8);
  if (p.startsWith('\\\\?\\')) return p.slice(4);
  return p;
}

/**
 * Canonical key: Windows -> case-insensitive, backslash separated, no trailing separator (except drive root),
 * UNC preserved with leading `\\`. POSIX -> forward slashes, no duplicate/trailing slash, case preserved.
 */
export function canonicalPath(input: string, os: PathOs = detectPathOs(input)): string {
  let p = input.trim();
  if (os === 'windows') {
    p = stripExtendedPrefix(p);
    const unc = p.startsWith('\\\\') || p.startsWith('//');
    p = p.replace(/\//g, '\\');
    p = p.replace(/\\{2,}/g, '\\');
    if (unc) p = '\\' + p;
    // resolve . and .. segments without touching the root portion
    const parts = p.split('\\');
    const out: string[] = [];
    for (const seg of parts) {
      if (seg === '.') continue;
      if (seg === '..') {
        if (out.length > 1 && out[out.length - 1] !== '') out.pop();
        continue;
      }
      out.push(seg);
    }
    p = out.join('\\');
    if (/^[a-zA-Z]:\\$/.test(p)) return p.toLowerCase();
    if (p.length > 1 && p.endsWith('\\')) p = p.slice(0, -1);
    return p.toLowerCase();
  }
  p = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const parts = p.split('/');
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === '.') continue;
    if (seg === '..') {
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(seg);
  }
  p = out.join('/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

export function pathSeparator(os: PathOs): string {
  return os === 'windows' ? '\\' : '/';
}

export function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

export function dirName(p: string): string {
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return idx <= 0 ? '' : p.slice(0, idx);
}

export function extName(p: string): string {
  const b = baseName(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i + 1).toLowerCase();
}

export function stemName(p: string): string {
  const b = baseName(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? b : b.slice(0, i);
}

/** True when `candidate` is the root or beneath it (both canonical keys of the same OS). */
export function isInsideRoot(rootCanonical: string, candidateCanonical: string, os: PathOs): boolean {
  const sep = pathSeparator(os);
  if (candidateCanonical === rootCanonical) return true;
  const prefix = rootCanonical.endsWith(sep) ? rootCanonical : rootCanonical + sep;
  return candidateCanonical.startsWith(prefix);
}

/** Display form of an SMB path (`\\host\share\x`) built from a mapped root, for the Copy Path helper. */
export function mapToSmbPath(
  filePath: string,
  mapping: { localRoot: string; smbRoot: string } | null | undefined,
  os: PathOs,
): string | null {
  if (!mapping) return null;
  const rootKey = canonicalPath(mapping.localRoot, os);
  const fileKey = canonicalPath(filePath, os);
  if (!isInsideRoot(rootKey, fileKey, os)) return null;
  const rest = filePath.slice(mapping.localRoot.replace(/[\\/]+$/, '').length).replace(/^[\\/]+/, '');
  const smb = mapping.smbRoot.replace(/[\\/]+$/, '');
  return rest
    ? `${smb}${os === 'windows' ? '\\' : '/'}${rest.replace(/[\\/]/g, os === 'windows' ? '\\' : '/')}`
    : smb;
}

const MEDIA_EXT: Record<string, 'VIDEO' | 'AUDIO' | 'IMAGE' | 'DOCUMENT' | 'PROJECT'> = {
  mp4: 'VIDEO',
  mov: 'VIDEO',
  mkv: 'VIDEO',
  avi: 'VIDEO',
  webm: 'VIDEO',
  m4v: 'VIDEO',
  mxf: 'VIDEO',
  mp3: 'AUDIO',
  wav: 'AUDIO',
  flac: 'AUDIO',
  aac: 'AUDIO',
  m4a: 'AUDIO',
  ogg: 'AUDIO',
  jpg: 'IMAGE',
  jpeg: 'IMAGE',
  png: 'IMAGE',
  webp: 'IMAGE',
  gif: 'IMAGE',
  bmp: 'IMAGE',
  tif: 'IMAGE',
  tiff: 'IMAGE',
  psd: 'IMAGE',
  txt: 'DOCUMENT',
  md: 'DOCUMENT',
  pdf: 'DOCUMENT',
  docx: 'DOCUMENT',
  srt: 'DOCUMENT',
  json: 'DOCUMENT',
  prproj: 'PROJECT',
  drp: 'PROJECT',
  aep: 'PROJECT',
};

export function kindFromExtension(
  ext: string,
): 'VIDEO' | 'AUDIO' | 'IMAGE' | 'DOCUMENT' | 'PROJECT' | 'OTHER' {
  return MEDIA_EXT[ext.toLowerCase()] ?? 'OTHER';
}

/** Default patterns for incomplete outputs that scanners must ignore. */
export const DEFAULT_IGNORE_PATTERNS = [
  '*.part',
  '*.tmp',
  '*.temp',
  '*.crdownload',
  '*.partial',
  '~$*',
  'Thumbs.db',
  'desktop.ini',
  '.DS_Store',
];

/** Safe file name for derived artefacts (no traversal, no separators). */
export function safeFileName(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^\.+/, '_')
      .slice(0, 120) || 'file'
  );
}

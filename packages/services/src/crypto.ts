import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/** Derive the 32-byte encryption key from CREDENTIAL_ENCRYPTION_KEY (64 hex, base64 of 32 bytes, or a passphrase). */
export function deriveKey(secret: string): Buffer {
  const s = secret.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  try {
    const b = Buffer.from(s, 'base64');
    if (b.length === 32 && b.toString('base64').replace(/=+$/, '') === s.replace(/=+$/, '')) return b;
  } catch {}
  return scryptSync(s, 'creatoros.credential.key.v1', 32);
}

/** AES-256-GCM. Output format: `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(payload: string, key: Buffer): string {
  const [v, iv, tag, ct] = payload.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported ciphertext format');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

export function encryptJson(value: unknown, key: Buffer): string {
  return encrypt(JSON.stringify(value), key);
}
export function decryptJson<T>(payload: string, key: Buffer): T {
  return JSON.parse(decrypt(payload, key)) as T;
}

export const sha256Hex = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const hmacHex = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

/** Human friendly one-time pairing code, e.g. `K7QM-93XD-ALP2` (no ambiguous characters). */
export function pairingCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((c) => c.join('')).join('-');
}

/** Redact secrets/bodies before they are written to audit logs. */
export function redact<T>(value: T): T {
  const SENSITIVE = /(password|token|secret|key|authorization|cookie|body|credential)/i;
  const walk = (v: any, depth = 0): any => {
    if (v == null || depth > 6) return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v).map(([k, val]) => [k, SENSITIVE.test(k) ? '[redacted]' : walk(val, depth + 1)]),
      );
    }
    return v;
  };
  return walk(value);
}

/** Sign a short-lived media access token bound to an instance id. */
export function signMediaToken(
  secret: string,
  parts: { instanceId: string; userId: string; exp: number },
): string {
  const payload = `${parts.instanceId}.${parts.userId}.${parts.exp}`;
  return `${Buffer.from(payload).toString('base64url')}.${hmacHex(secret, payload)}`;
}

export function verifyMediaToken(
  secret: string,
  token: string,
  now = Date.now(),
): { instanceId: string; userId: string } | null {
  const [p, sig] = token.split('.');
  if (!p || !sig) return null;
  const payload = Buffer.from(p, 'base64url').toString('utf8');
  if (!safeEqualHex(hmacHex(secret, payload), sig)) return null;
  const [instanceId, userId, exp] = payload.split('.');
  if (!instanceId || !userId || Number(exp) < now) return null;
  return { instanceId, userId };
}

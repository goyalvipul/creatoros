/** Query parameters whose values must never reach a log line (webhook handshake, OAuth, app secrets, tokens). */
const SENSITIVE = new Set(
  [
    'hub.verify_token',
    'hub_verify_token',
    'verify_token',
    'hub.challenge',
    'hub_challenge',
    'access_token',
    'refresh_token',
    'id_token',
    'token',
    'code',
    'state',
    'client_secret',
    'app_secret',
    'secret',
    'password',
    'api_key',
    'apikey',
    'key',
    'signature',
    'sig',
  ].map((k) => k.toLowerCase()),
);

const WEBHOOK_PATH = /\/integrations\/meta\/[a-z]+\/webhook$/i;

export const REDACTED = 'REDACTED';

/**
 * Log-safe version of a request URL.
 * - Webhook endpoints: pathname only (the query holds the verification token and challenge).
 * - Everything else: sensitive query values are replaced, other parameters are kept.
 * Never throws; an unparsable URL is reduced to its path portion.
 */
export function redactUrl(raw: string | undefined): string {
  if (!raw) return '';
  const q = raw.indexOf('?');
  const path = (q === -1 ? raw : raw.slice(0, q)).replace(/#.*$/, '');
  if (q === -1) return path;
  if (WEBHOOK_PATH.test(path)) return path;
  const params = new URLSearchParams(raw.slice(q + 1).replace(/#.*$/, ''));
  const out: string[] = [];
  for (const [k, v] of params) {
    const hide = SENSITIVE.has(k.toLowerCase()) || /token|secret|password/i.test(k);
    out.push(`${encodeURIComponent(k)}=${hide ? REDACTED : encodeURIComponent(v)}`);
  }
  return out.length ? `${path}?${out.join('&')}` : path;
}

/** Scrubs token-looking text from free-form strings (error messages, URLs inside messages). */
export function scrubText(s: string): string {
  return s
    .replace(
      /([?&](?:hub[._])?verify_token|[?&]access_token|[?&]refresh_token|[?&]client_secret|[?&]app_secret|[?&]code|[?&]state)=[^&\s"']*/gi,
      `$1=${REDACTED}`,
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, `$1${REDACTED}`)
    .replace(/\bIG[A-Za-z0-9_-]{40,}/g, REDACTED)
    .replace(/\bEAA[A-Za-z0-9]{30,}/g, REDACTED);
}

/** Pino serializers: request line without a raw URL, errors without tokens. Headers and bodies are never logged. */
export const logSerializers = {
  req(req: any) {
    return {
      method: req.method,
      url: redactUrl(req.url),
      host: req.hostname,
      remoteAddress: req.ip ?? req.socket?.remoteAddress,
    };
  },
  err(err: any) {
    return {
      type: err?.name ?? 'Error',
      code: err?.code,
      statusCode: err?.statusCode ?? err?.status,
      message: scrubText(String(err?.message ?? '')),
      stack: err?.stack ? scrubText(String(err.stack)) : undefined,
    };
  },
};

/**
 * Redacts secret-bearing fields before request bodies are written to logs.
 *
 * The HTTP exception filter logs request bodies on 4xx to aid debugging, but
 * auth/OAuth endpoints carry credentials there: identity tokens
 * (Apple/Google), authorization codes, PKCE verifiers, refresh tokens, client
 * secrets. Those must never reach the logs.
 */

// Compared case-insensitively against object keys (normalized: lowercased,
// non-alphanumerics stripped, so "code_verifier"/"codeVerifier" both match).
const SENSITIVE_KEYS = new Set([
  'code',
  'codeverifier',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'identitytoken',
  'credential',
  'clientsecret',
  'secret',
  'password',
  'authorization',
  'jwt',
  'assertion',
  'appledomainassociation',
]);

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_LOG_LENGTH = 2000;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > MAX_DEPTH) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEYS.has(normalizeKey(key))
        ? REDACTED
        : redactSensitive(val, depth + 1);
    }
    return out;
  }
  return value;
}

/** Produces a redacted, length-capped string of a request body for logging. */
export function safeBodyForLog(body: unknown): string {
  if (body === undefined || body === null) return '';
  let serialized: string;
  try {
    serialized = JSON.stringify(redactSensitive(body));
  } catch {
    return '[unserializable body]';
  }
  if (serialized === undefined) return '';
  return serialized.length > MAX_LOG_LENGTH
    ? `${serialized.slice(0, MAX_LOG_LENGTH)}…[truncated]`
    : serialized;
}

import type { JsonValue } from '@odudu/mcp';
import { maskEmailAddresses } from '#/service/mask-emails';

export const MASKED = '[masked]';

// Members that hold a secret, a key or a one-time value, whatever they hold.
// The MCP client drops the first five from what a tool returns; they are named
// again here because a trace also stores what the model wrote and what an
// error said, which that filter never sees.
const SECRET_MEMBERS = new Set([
  'client_secret',
  'client_secrets',
  'secret',
  'password',
  'password_hash',
  'secret_hash',
  'previous_secret_hash',
  'private_jwk_encrypted',
  'private_key',
  'signing_key',
  'key_material',
  'kek',
  'registration_access_token',
  'registration_token',
  'initial_access_token',
  'access_token',
  'refresh_token',
  'id_token',
  'token',
  'authorization',
  'cookie',
  'set_cookie',
  'api_key',
  'apikey',
  'recovery_codes',
  'recovery_code',
  'totp_secret',
  'otp',
  'one_time_code',
  'one_time_password',
  'code_verifier',
  'client_assertion',
]);
// The private members of a JWK, which an object with a `kty` carries.
const PRIVATE_KEY_MEMBERS = new Set(['d', 'p', 'q', 'dp', 'dq', 'qi', 'k', 'oth']);
const MAX_DEPTH = 32;
// A value shorter than this is not learned: masking "a" everywhere would
// ruin the text without hiding anything.
const MIN_LEARNED = 6;

const isList = (value: JsonValue): value is JsonValue[] => Array.isArray(value);
const normal = (key: string): string => key.toLowerCase().replaceAll('-', '_');
const isSecretMember = (key: string): boolean => SECRET_MEMBERS.has(normal(key));

// A header spells `set-cookie` and `api-key` with a hyphen; the members use an underscore.
const MEMBER_NAMES = [...SECRET_MEMBERS].map((name) => name.replaceAll('_', '[_-]')).join('|');
// `"client_secret":` in JSON text, and the same with its quotes escaped, as it
// appears inside a string that was itself serialised.
const PLAIN_MEMBER = new RegExp(`"(?:${MEMBER_NAMES})"\\s*:\\s*`, 'giu');
const ESCAPED_MEMBER = new RegExp(`\\\\"(?:${MEMBER_NAMES})\\\\"\\s*:\\s*`, 'giu');
// `client_secret=abc`, `password: "abc"` and `Set-Cookie: sid=abc` in an error or a header.
const ASSIGNED = new RegExp(
  `(\\b(?:${MEMBER_NAMES})\\s*[=:]\\s*)("[^"]*"|'[^']*'|[^\\s,;&"']+)`,
  'giu',
);

// Where the JSON value that starts at `from` ends, or -1 when it is not one
// this can read. Strings and nested brackets are followed, so a bracket inside
// a string does not end an array early.
function valueEnd(text: string, from: number, escaped: boolean): number {
  const open = text[from];
  if (open === '"' || (escaped && text.startsWith('\\"', from))) {
    const quote = escaped ? '\\"' : '"';
    const end = text.indexOf(quote, from + quote.length);
    return end === -1 ? -1 : end + quote.length;
  }
  if (open === '[' || open === '{') {
    let depth = 0;
    let inString = false;
    for (let i = from; i < text.length; i += 1) {
      const c = text[i];
      if (inString) {
        if (c === '\\') i += 1;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '[' || c === '{') depth += 1;
      else if ((c === ']' || c === '}') && (depth -= 1) === 0) return i + 1;
    }
    return -1;
  }
  const bare = /^[^,}\]\s]+/u.exec(text.slice(from, from + 4_096));
  return bare === null ? -1 : from + bare[0].length;
}

function unquoted(raw: string): string {
  const inner = raw.replace(/^\\?"/u, '').replace(/\\?"$/u, '');
  return inner;
}

// Replaces the value of each secret member in JSON text, and hands what it
// replaced to `learn`.
function maskMembers(
  text: string,
  pattern: RegExp,
  escaped: boolean,
  learn: (value: string) => void,
): string {
  let out = '';
  let at = 0;
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const start = match.index + match[0].length;
    const end = valueEnd(text, start, escaped);
    if (end === -1) continue;
    const raw = text.slice(start, end);
    learn(/^[[{]/u.test(raw) ? raw : unquoted(raw));
    const mask = escaped ? `\\"${MASKED}\\"` : `"${MASKED}"`;
    out += text.slice(at, start) + mask;
    at = end;
    pattern.lastIndex = end;
  }
  return out + text.slice(at);
}

const PRIVATE_MEMBER = new RegExp(`"(?:${[...PRIVATE_KEY_MEMBERS].join('|')})"\\s*:\\s*`, 'giu');

// Where the object that holds the member at `at` starts, or -1.
function objectStart(text: string, at: number): number {
  let depth = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    const c = text[i];
    if (c === '}') depth += 1;
    else if (c === '{') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

// In JSON text, the private members of each object that has a `kty`: only a key
// has them, and `d` or `p` in any other object is an ordinary name.
function maskKeyObjects(text: string, learn: (value: string) => void): string {
  let out = '';
  let at = 0;
  for (let i = text.indexOf('"kty"'); i !== -1; i = text.indexOf('"kty"', i + 1)) {
    const start = objectStart(text, i);
    const end = start < at ? -1 : valueEnd(text, start, false);
    if (end === -1) continue;
    out +=
      text.slice(at, start) + maskMembers(text.slice(start, end), PRIVATE_MEMBER, false, learn);
    at = end;
  }
  return out + text.slice(at);
}

const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gu;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/gu;
const PEM =
  /-----BEGIN [A-Z ]*(?:PRIVATE KEY|SECRET)[A-Z ]*-----[\s\S]*?(?:-----END [A-Z ]*-----|$)/gu;
const PASSWORD_HASH =
  /\$(?:argon2(?:id|i|d)?|scrypt|pbkdf2[a-z0-9-]*)\$[^\s"'\\]+|\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{40,}/gu;
// A run of 40 or more base64url characters is what an issued secret or token
// looks like (a client secret is 43). A run made only of hex digits is a
// digest, which is no secret, and a run with no digit is a word or a slug.
const LONG_TOKEN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/gu;

function maskPatterns(text: string): string {
  return text
    .replace(PEM, MASKED)
    .replace(PASSWORD_HASH, MASKED)
    .replace(JWT, MASKED)
    .replace(BEARER, (_whole, scheme: string) => `${scheme} ${MASKED}`)
    .replace(LONG_TOKEN, (run) =>
      /^[0-9a-f]+$/iu.test(run) || !/\d/u.test(run) || !/[A-Za-z]/u.test(run) ? run : MASKED,
    );
}

export interface Masker {
  /** The value with every secret hidden; what it learned masks the same text in later calls. */
  mask(value: JsonValue): JsonValue;
}

/**
 * A masker for one turn. Besides the members and shapes `maskSecrets` knows, it
 * remembers each value it hid, so a secret a tool returned is also hidden where
 * the model repeats it in its answer or passes it on in a later call. With
 * `emails`, the address masking the tenant asked for is applied to what is
 * kept as well: the trace must not hold what the model was never shown.
 */
export function createMasker(options: { readonly emails: boolean }): Masker {
  const learned = new Set<string>();
  // A secret held in an array or an object is learned member by member.
  const learn = (value: string): void => {
    if (/^[[{]/u.test(value)) {
      try {
        learnAll(JSON.parse(value) as JsonValue, 0);
        return;
      } catch {
        // Not JSON after all: what it holds is learned as text.
      }
    }
    if (value.length < MIN_LEARNED || value === MASKED) return;
    learned.add(value);
    const escaped = JSON.stringify(value).slice(1, -1);
    if (escaped !== value) learned.add(escaped);
  };
  const learnAll = (value: JsonValue, depth: number): void => {
    if (typeof value === 'string') learn(value);
    else if (depth < MAX_DEPTH && isList(value)) {
      for (const item of value) learnAll(item, depth + 1);
    } else if (depth < MAX_DEPTH && typeof value === 'object' && value !== null) {
      for (const item of Object.values(value)) learnAll(item, depth + 1);
    }
  };

  const text = (input: string): string => {
    let out = maskMembers(input, PLAIN_MEMBER, false, learn);
    out = maskMembers(out, ESCAPED_MEMBER, true, learn);
    out = maskKeyObjects(out, learn);
    out = out.replace(ASSIGNED, (_whole, name: string, value: string) => {
      const quote = /^["']/u.exec(value)?.[0] ?? '';
      learn(quote === '' ? value : value.slice(1, -1));
      return `${name}${quote}${MASKED}${quote}`;
    });
    for (const value of learned) out = out.split(value).join(MASKED);
    out = maskPatterns(out);
    return options.emails ? maskEmailAddresses(out) : out;
  };

  const walk = (value: JsonValue, depth: number): JsonValue => {
    if (typeof value === 'string') return text(value);
    if (typeof value !== 'object' || value === null) return value;
    if (depth >= MAX_DEPTH) return MASKED;
    if (isList(value)) return value.map((item) => walk(item, depth + 1));
    const isKey = 'kty' in value;
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const hidden = isSecretMember(key) || (isKey && PRIVATE_KEY_MEMBERS.has(normal(key)));
      if (hidden) {
        learnAll(item, depth + 1);
        out[key] = MASKED;
      } else {
        out[key] = walk(item, depth + 1);
      }
    }
    return out;
  };

  return { mask: (value) => walk(value, 0) };
}

/**
 * `output` with every secret in it replaced by `"[masked]"`: the members that
 * hold one, the private part of a key, and the shapes a secret takes in text
 * (a bearer token, a JWT, a PEM key, a password hash, a long issued token).
 */
export function maskSecrets(output: JsonValue): JsonValue {
  return createMasker({ emails: false }).mask(output);
}

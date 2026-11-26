import type { JsonValue } from '@odudu/mcp';
import { maskEmailAddresses } from '#/service/mask-emails';

export const MASKED = '[masked]';

// A member is a secret by its name, whatever it holds. The name is read as
// snake case, so `clientSecret`, `client-secret` and `Client_Secret` are one, and
// any word of it in this list makes the member one (`new_password`,
// `session_token`, `x_api_key`). The MCP client drops a few members from what a
// tool returns; the trace also stores what the model wrote and what an error
// said, which that filter never sees.
const SECRET_WORDS = new Set([
  'secret',
  'secrets',
  'password',
  'passwords',
  'passwd',
  'passphrase',
  'token',
  'credential',
  'credentials',
  'cookie',
  'authorization',
  'otp',
  'kek',
  'apikey',
  'assertion',
]);
// Names with no such word, or that a word alone would not catch.
const SECRET_NAMES = new Set([
  'private_jwk_encrypted',
  'key_material',
  'recovery_codes',
  'recovery_code',
  'one_time_code',
  'code_verifier',
]);
// The private members of a JWK, which an object with a `kty` carries.
const PRIVATE_KEY_MEMBERS = new Set(['d', 'p', 'q', 'dp', 'dq', 'qi', 'k', 'oth']);
const MAX_DEPTH = 32;
// A value shorter than this is not learned: masking "true" everywhere would
// ruin the text without hiding anything.
const MIN_LEARNED = 12;
// What one turn remembers: at most this many values and this many characters in all.
const MAX_LEARNED = 64;
const MAX_LEARNED_CHARS = 4_096;
// A string longer than this is cut before it is read; the trace keeps far less.
const MAX_TEXT = 65_536;

const isList = (value: JsonValue): value is JsonValue[] => Array.isArray(value);

function snake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .toLowerCase()
    .replace(/[-.\s]/gu, '_');
}

function isSecretName(name: string): boolean {
  const n = snake(name);
  if (SECRET_NAMES.has(n) || n.includes('api_key')) return true;
  const words = n.split('_');
  if (words.some((word) => SECRET_WORDS.has(word))) return true;
  // `signing_key`, `backup_key`, `etag_hash`; a bare `key` or `public_key` is no secret.
  const last = words.at(-1);
  return words.length > 1 && n !== 'public_key' && (last === 'key' || last === 'hash');
}

// How much of a text the scans below may read in all, so a hostile one cannot
// make them quadratic: each scan spends from it and, once it is gone, what is
// left of the text is masked rather than read on.
interface Budget {
  left: number;
}
const READ_ON = -1;
const SPENT = -2;

// `"client_secret":` in JSON text, and the same with its quotes escaped, as it
// appears inside a string that was itself serialised; the name is checked after.
const PLAIN_MEMBER = /"([A-Za-z][A-Za-z0-9_.-]{0,63})"\s*:\s*/gu;
const ESCAPED_MEMBER = /\\"([A-Za-z][A-Za-z0-9_.-]{0,63})\\"\s*:\s*/gu;
const PRIVATE_MEMBER = new RegExp(`"(${[...PRIVATE_KEY_MEMBERS].join('|')})"\\s*:\\s*`, 'gu');
// `client_secret=abc`, `password: "abc"`, `Authorization: Bearer abc` and
// `Set-Cookie: sid=abc` in an error or a header. A scheme takes its credential too.
const ASSIGNED =
  /\b([A-Za-z][A-Za-z0-9_-]{0,63})(\s*[=:]\s*)((?:Bearer|Basic)\s+[^\s,;&"']+|"[^"]*"|'[^']*'|[^\s,;&"']+)/gu;

// Where the JSON value that starts at `from` ends: `READ_ON` when it is not one
// this can read, `SPENT` when the budget ran out. Strings and nested brackets are
// followed, so a bracket inside a string does not end an array early.
function valueEnd(text: string, from: number, escaped: boolean, budget: Budget): number {
  const open = text[from];
  if (open === '"' || (escaped && text.startsWith('\\"', from))) {
    const quote = escaped ? '\\"' : '"';
    const end = text.indexOf(quote, from + quote.length);
    budget.left -= (end === -1 ? text.length : end) - from;
    if (budget.left < 0) return SPENT;
    return end === -1 ? READ_ON : end + quote.length;
  }
  if (open === '[' || open === '{') {
    let depth = 0;
    let inString = false;
    for (let i = from; i < text.length; i += 1) {
      budget.left -= 1;
      if (budget.left < 0) return SPENT;
      const c = text[i];
      if (inString) {
        if (c === '\\') i += 1;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '[' || c === '{') depth += 1;
      else if ((c === ']' || c === '}') && (depth -= 1) === 0) return i + 1;
    }
    return READ_ON;
  }
  budget.left -= 64;
  const bare = /^[^,}\]\s]+/u.exec(text.slice(from, from + 64));
  return bare === null ? READ_ON : from + bare[0].length;
}

function unquoted(raw: string): string {
  return raw.replace(/^\\?"/u, '').replace(/\\?"$/u, '');
}

// Replaces the value of each member `isSecret` names in JSON text, and hands
// what it replaced to `learn`.
function maskMembers(
  text: string,
  pattern: RegExp,
  escaped: boolean,
  isSecret: (name: string) => boolean,
  learn: (value: string) => void,
  budget: Budget,
): string {
  let out = '';
  let at = 0;
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (!isSecret(match[1] ?? '')) continue;
    const start = match.index + match[0].length;
    const end = valueEnd(text, start, escaped, budget);
    const mask = escaped ? `\\"${MASKED}\\"` : `"${MASKED}"`;
    if (end === SPENT) return out + text.slice(at, start) + mask;
    if (end === READ_ON) continue;
    const raw = text.slice(start, end);
    learn(/^[[{]/u.test(raw) ? raw : unquoted(raw));
    out += text.slice(at, start) + mask;
    at = end;
    pattern.lastIndex = end;
  }
  return out + text.slice(at);
}

// Where the object that holds the member at `at` starts, or `READ_ON`.
function objectStart(text: string, at: number, budget: Budget): number {
  let depth = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    budget.left -= 1;
    if (budget.left < 0) return SPENT;
    const c = text[i];
    if (c === '}') depth += 1;
    else if (c === '{') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return READ_ON;
}

// In JSON text, the private members of each object that has a `kty`: only a key
// has them, and `d` or `p` in any other object is an ordinary name.
function maskKeyObjects(text: string, learn: (value: string) => void, budget: Budget): string {
  let out = '';
  let at = 0;
  const always = (): boolean => true;
  for (let i = text.indexOf('"kty"'); i !== -1; i = text.indexOf('"kty"', i + 1)) {
    const start = objectStart(text, i, budget);
    if (start === SPENT) return `${out}${text.slice(at, i)}${MASKED}`;
    const end = start < at ? READ_ON : valueEnd(text, start, false, budget);
    if (end === SPENT) return `${out}${text.slice(at, start)}${MASKED}`;
    if (end === READ_ON) continue;
    const inner = maskMembers(text.slice(start, end), PRIVATE_MEMBER, false, always, learn, budget);
    out += text.slice(at, start) + inner;
    at = end;
  }
  return out + text.slice(at);
}

const BEARER = /\b(Bearer|Basic)\s+(?=[A-Za-z0-9._~+/=-]*[\d._~+/=-])[A-Za-z0-9._~+/=-]{8,}/gu;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/gu;
const PEM =
  /-----BEGIN [A-Z ]*(?:PRIVATE KEY|SECRET)[A-Z ]*-----[\s\S]*?(?:-----END [A-Z ]*-----|$)/gu;
const PASSWORD_HASH =
  /\$(?:argon2(?:id|i|d)?|scrypt|pbkdf2[a-z0-9-]*)\$[^\s"'\\]+|\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{40,}/gu;
const LONG_TOKEN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/gu;

// A run of 40 or more base64url characters with a letter and a digit, or of 32
// to 39 with both cases and a digit, is what an issued secret or token looks
// like (a client secret is 43). A run of hex digits is a digest, which is no
// secret, and a run with no digit is a word or a slug.
function looksIssued(run: string): boolean {
  if (/^[0-9a-f]+$/iu.test(run) || !/\d/u.test(run) || !/[A-Za-z]/u.test(run)) return false;
  return run.length >= 40 || (/[a-z]/u.test(run) && /[A-Z]/u.test(run));
}

function maskPatterns(text: string): string {
  return text
    .replace(PEM, MASKED)
    .replace(PASSWORD_HASH, MASKED)
    .replace(JWT, MASKED)
    .replace(BEARER, (_whole, scheme: string) => `${scheme} ${MASKED}`)
    .replace(LONG_TOKEN, (run) => (looksIssued(run) ? MASKED : run));
}

export interface Masker {
  /**
   * The value with every secret hidden, for what a tool returned or the model
   * wrote. What it hid under a secret member is remembered and hidden in later
   * calls too.
   */
  mask(value: JsonValue): JsonValue;
  /**
   * The same for a record the server wrote itself: members and shapes are
   * hidden, but nothing remembered is applied, and nothing is learned from it.
   */
  maskRecord(value: JsonValue): JsonValue;
}

export interface MaskerOptions {
  /** The tenant masks email addresses, so the trace holds none the model was not shown. */
  readonly emails: boolean;
  /** Secrets the server itself holds, hidden wherever they turn up. */
  readonly known?: readonly string[];
}

/**
 * A masker for one turn. Besides the members and shapes `maskSecrets` knows, it
 * remembers each value it hid under a secret member, so a secret a tool returned
 * is also hidden where the model repeats it in its answer or passes it on in a
 * later call. It learns from structure only, never from prose such as
 * `password: word`, which another person wrote and which would otherwise let
 * them choose what is hidden; it learns only values of 12 characters or more,
 * and at most 64 values and 4,096 characters in a turn.
 */
export function createMasker(options: MaskerOptions): Masker {
  const learned = new Set<string>();
  let learnedChars = 0;
  const remember = (value: string): void => {
    const forms = [value, JSON.stringify(value).slice(1, -1)];
    for (const form of forms) {
      if (learned.has(form)) continue;
      if (learned.size >= MAX_LEARNED || learnedChars + form.length > MAX_LEARNED_CHARS) return;
      learned.add(form);
      learnedChars += form.length;
    }
  };
  // A secret held in an array or an object is learned member by member.
  const learn = (value: string, depth = 0): void => {
    if (depth < MAX_DEPTH && /^[[{]/u.test(value)) {
      try {
        learnAll(JSON.parse(value) as JsonValue, depth + 1);
        return;
      } catch {
        // Not JSON after all: what it holds is learned as text.
      }
    }
    if (value.length >= MIN_LEARNED && value !== MASKED) remember(value);
  };
  const learnAll = (value: JsonValue, depth: number): void => {
    if (typeof value === 'string') learn(value, depth);
    else if (depth < MAX_DEPTH && isList(value)) {
      for (const item of value) learnAll(item, depth + 1);
    } else if (depth < MAX_DEPTH && typeof value === 'object' && value !== null) {
      for (const item of Object.values(value)) learnAll(item, depth + 1);
    }
  };
  for (const secret of options.known ?? []) learn(secret);

  const run = (value: JsonValue, memory: boolean): JsonValue => {
    const note = memory ? learn : (): void => undefined;
    const text = (whole: string): string => {
      const input = whole.length > MAX_TEXT ? whole.slice(0, MAX_TEXT) : whole;
      const budget: Budget = { left: 8 * input.length + 4_096 };
      let out = maskMembers(input, PLAIN_MEMBER, false, isSecretName, note, budget);
      out = maskMembers(out, ESCAPED_MEMBER, true, isSecretName, note, budget);
      out = maskKeyObjects(out, note, budget);
      out = out.replace(ASSIGNED, (whole2, name: string, sep: string, found: string) => {
        if (!isSecretName(name)) return whole2;
        const quote = /^["']/u.exec(found)?.[0] ?? '';
        return `${name}${sep}${quote}${MASKED}${quote}`;
      });
      if (memory) for (const secret of learned) out = out.split(secret).join(MASKED);
      out = maskPatterns(out);
      return options.emails ? maskEmailAddresses(out) : out;
    };
    const walk = (node: JsonValue, depth: number): JsonValue => {
      if (typeof node === 'string') return text(node);
      if (typeof node !== 'object' || node === null) return node;
      if (depth >= MAX_DEPTH) return MASKED;
      if (isList(node)) return node.map((item) => walk(item, depth + 1));
      const isKey = 'kty' in node;
      const out: Record<string, JsonValue> = {};
      for (const [key, item] of Object.entries(node)) {
        if (isSecretName(key) || (isKey && PRIVATE_KEY_MEMBERS.has(snake(key)))) {
          if (memory) learnAll(item, depth + 1);
          out[key] = MASKED;
        } else {
          out[key] = walk(item, depth + 1);
        }
      }
      return out;
    };
    return walk(value, 0);
  };

  return { mask: (value) => run(value, true), maskRecord: (value) => run(value, false) };
}

/**
 * `output` with every secret in it replaced by `"[masked]"`: the members that
 * hold one, the private part of a key, and the shapes a secret takes in text
 * (a bearer token, a JWT, a PEM key, a password hash, a long issued token).
 */
export function maskSecrets(output: JsonValue): JsonValue {
  return createMasker({ emails: false }).mask(output);
}

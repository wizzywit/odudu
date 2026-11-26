import type { JsonValue } from '@odudu/mcp';
import { maskEmailAddresses } from '#/service/mask-emails';

export const MASKED = '[masked]';

// A member is a secret by its name, whatever it holds. The name is read as snake
// case, so `clientSecret`, `client-secret` and `Client_Secret` are one, and any
// word of it in this list makes the member one (`new_password`, `session_token`,
// `x_api_key`). The MCP client drops a few members from what a tool returns; the
// trace also stores what the model wrote and what an error said.
const SECRET_WORDS = new Set([
  'secret',
  'secrets',
  'password',
  'passwords',
  'passwd',
  'pwd',
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
  'sig',
  'signature',
  'pass',
  'pw',
  'creds',
  'jwt',
  'bearer',
  'totp',
  'sessionid',
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
// A name that ends in one of these describes a secret and holds none
// (`token_type`, `token_count`, `password_policy`, `token_endpoint_auth_method`).
const METADATA_WORDS = new Set([
  'type',
  'types',
  'count',
  'endpoint',
  'method',
  'methods',
  'lifetime',
  'ttl',
  'expires',
  'expiry',
  'length',
  'format',
  'algorithm',
  'alg',
  'policy',
  'required',
  'enabled',
  'min',
  'max',
  'rotation',
  'status',
  'state',
  'size',
  'limit',
  'age',
  'at',
  'days',
  'seconds',
  'hours',
  'minutes',
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
// More members or items than this in one object or array are replaced by a count, so
// a huge result is not walked whole.
const MAX_ITEMS = 500;
const COOKIE_ATTRIBUTES = new Set([
  'path',
  'domain',
  'expires',
  'max-age',
  'secure',
  'httponly',
  'samesite',
  'priority',
]);
const SCHEMES = ['bearer', 'basic', 'digest', 'token', 'negotiate'];

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
  const last = words.at(-1) ?? '';
  if (words.length > 1 && METADATA_WORDS.has(last)) return false;
  if (words.some((word) => SECRET_WORDS.has(word))) return true;
  // `signing_key`, `backup_key`, `etag_hash`; a bare `key` or `public_key` is no secret.
  return words.length > 1 && n !== 'public_key' && (last === 'key' || last === 'hash');
}

// How much of a text the scans below may read in all, so a hostile one cannot
// make them quadratic: each scan spends from it and, once it is gone, what is
// left of the text is masked rather than read on.
interface Budget {
  left: number;
}
const spent = (budget: Budget, cost: number): boolean => {
  budget.left -= cost;
  return budget.left < 0;
};

// One replacement: the text from `start` to `end` becomes `text`.
interface Span {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

// Replaces the spans, which may overlap: those that do become one masked span.
function applySpans(text: string, spans: readonly Span[]): string {
  if (spans.length === 0) return text;
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  let out = '';
  let at = 0;
  let current: Span | undefined;
  const flush = (): void => {
    if (current === undefined) return;
    out += text.slice(at, current.start) + current.text;
    at = current.end;
  };
  for (const span of sorted) {
    if (current !== undefined && span.start < current.end) {
      current = {
        start: current.start,
        end: Math.max(current.end, span.end),
        text: span.end > current.end || span.start < current.start ? MASKED : current.text,
      };
    } else {
      flush();
      current = span;
    }
  }
  flush();
  return out + text.slice(at);
}

const isNameChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_.-]/u.test(c);
const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t';
const isBreak = (c: string | undefined): boolean => c === '\n' || c === '\r';
// What may follow the end of a quoted value: anything else means the quote was not its end.
const CLEAN_AFTER = /[\s,;&})\]]/u;

function skip(text: string, from: number, chars: (c: string | undefined) => boolean): number {
  let i = from;
  while (i < text.length && chars(text[i])) i += 1;
  return i;
}

// A quote written inside text that was serialised `b` times is `b` backslashes
// and a quote; this is how many backslashes the quote at `at` has, or 0 if it has
// none or is no quote.
function escapedQuote(text: string, at: number): number {
  let i = at;
  while (text[i] === '\\') i += 1;
  return i > at && text[i] === '"' ? i - at : 0;
}

// Where the quoted value at `from` ends, honouring backslash escapes. A value
// that is never closed is masked to the end of the text.
function lineEnd(text: string, from: number): number {
  let end = from;
  while (end < text.length && !isBreak(text[end])) end += 1;
  return end;
}

// A quoted value whose closing quote is followed by more of the same word
// (`'it''s-tail'`, `"ab"cd-tail"`) was not closed there: it is masked to the line's end.
function closed(text: string, from: number, end: number, open: string): Span {
  const next = text[end];
  if (next === undefined || CLEAN_AFTER.test(next)) {
    return { start: from, end, text: `${open}${MASKED}${open}` };
  }
  return { start: from, end: lineEnd(text, end), text: `${open}${MASKED}${open}` };
}

function readQuoted(text: string, from: number, budget: Budget): Span {
  const b = escapedQuote(text, from);
  const open = b > 0 ? `${'\\'.repeat(b)}"` : (text[from] ?? '"');
  let i = from + open.length;
  while (i < text.length) {
    if (spent(budget, 1)) break;
    if (b > 0) {
      // Inside text serialised b times, the value's own quote is 2b+1 backslashes
      // and a quote, and its closing quote is b of them.
      const run = escapedQuote(text, i);
      if (run === b) return closed(text, from, i + run + 1, open);
      i += run > 0 ? run + 1 : 1;
    } else if (text[i] === '\\') i += 2;
    else if (text[i] === open) return closed(text, from, i + 1, open);
    else i += 1;
  }
  return { start: from, end: text.length, text: `${open}${MASKED}` };
}

// Where the array or object at `from` ends; one never closed is masked to the end.
function readBracket(text: string, from: number, budget: Budget): Span {
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i += 1) {
    if (spent(budget, 1)) break;
    const c = text[i];
    if (c === '\\') i += 1;
    else if (inString) inString = c !== '"';
    else if (c === '"') inString = true;
    else if (c === '[' || c === '{') depth += 1;
    else if ((c === ']' || c === '}') && (depth -= 1) === 0) {
      return { start: from, end: i + 1, text: MASKED };
    }
  }
  return { start: from, end: text.length, text: MASKED };
}

// A cookie header: every pair is session material, so every value goes and every
// name stays, apart from the attributes of Set-Cookie, which hold none.
function readCookie(text: string, from: number): Span {
  let end = from;
  while (end < text.length && !isBreak(text[end])) end += 1;
  const parts = text.slice(from, end).split(';');
  const masked = parts.map((part) => {
    const eq = part.indexOf('=');
    if (eq === -1) return part;
    const name = part.slice(0, eq);
    if (COOKIE_ATTRIBUTES.has(name.trim().toLowerCase())) return part;
    return `${name}=${MASKED}`;
  });
  return { start: from, end, text: masked.join(';') };
}

// The value of a secret name that starts at `from`, or undefined if it is empty.
// A scheme (`Bearer`, `Basic`, `Token`) stays and its credential goes; a Digest
// header's parameters all go.
function readValue(text: string, from: number, name: string, budget: Budget): Span | undefined {
  if (
    snake(name)
      .split('_')
      .some((word) => word === 'cookie')
  )
    return readCookie(text, from);
  const head = text.slice(from, from + 10).toLowerCase();
  const scheme = SCHEMES.find((s) => head.startsWith(s) && isSpace(text[from + s.length]));
  if (scheme === 'digest') {
    let end = from;
    while (end < text.length && !isBreak(text[end])) end += 1;
    return { start: from, end, text: MASKED };
  }
  if (scheme !== undefined) {
    const credential = skip(text, from + scheme.length, isSpace);
    const inner = readValue(text, credential, '', budget);
    return inner === undefined ? undefined : { ...inner, start: credential };
  }
  const c = text[from];
  if (c === '"' || c === "'" || escapedQuote(text, from) > 0) return readQuoted(text, from, budget);
  if (c === '[' || c === '{') return readBracket(text, from, budget);
  // Whatever else follows runs to the end of the line, however it is punctuated:
  // a passphrase or a password with a comma or a semicolon in it is one value.
  let end = lineEnd(text, from);
  spent(budget, end - from);
  if (end === from) return undefined;
  // A YAML block scalar (`password: |`): the indented lines under it are the value.
  if (/^[|>][+-]?\d*\s*$/u.test(text.slice(from, end))) {
    while (end < text.length) {
      const next = lineEnd(text, skip(text, end, isBreak));
      const line = text.slice(skip(text, end, isBreak), next);
      if (line.trim() !== '' && !/^\s/u.test(line)) break;
      if (spent(budget, next - end) || next === end) break;
      end = next;
    }
  }
  return { start: from, end, text: MASKED };
}

// Every `name<separator>value` where the name is a secret's: `client_secret=abc`,
// `password: "abc"`, `Authorization: Bearer abc`, the same with a quote after the
// name (`"password": "abc`, a fragment of JSON) and with the quotes escaped.
function findPairs(text: string, budget: Budget): Span[] {
  const spans: Span[] = [];
  let i = 0;
  while (i < text.length) {
    if (spent(budget, 1)) {
      spans.push({ start: i, end: text.length, text: MASKED });
      break;
    }
    if (!isNameChar(text[i]) || isNameChar(text[i - 1])) {
      i += 1;
      continue;
    }
    const nameEnd = skip(text, i, isNameChar);
    let k = nameEnd;
    const quote = escapedQuote(text, k);
    if (quote > 0) k += quote + 1;
    else if (text[k] === '"' || text[k] === "'") k += 1;
    k = skip(text, k, isSpace);
    const name = text.slice(i, nameEnd);
    const sep =
      text[k] === '='
        ? text[k + 1] === '>'
          ? 2
          : 1
        : text[k] === ':'
          ? text[k + 1] === '='
            ? 2
            : 1
          : 0;
    if (sep > 0 && isSecretName(name)) {
      const start = skip(text, k + sep, (c) => isSpace(c) || isBreak(c));
      const value = readValue(text, start, name, budget);
      if (value !== undefined) {
        spans.push(value);
        i = value.end;
        continue;
      }
    }
    i = nameEnd;
  }
  return spans;
}

const BEARER = /\b(bearer|basic)\s+(?=[A-Za-z0-9._~+/=-]*[\d._~+/=-])([A-Za-z0-9._~+/=-]{8,})/giu;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/gu;
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

// A PEM private key to its end line, or to the end of the text when it has none.
function findPem(text: string): Span[] {
  const spans: Span[] = [];
  let at = text.indexOf('-----BEGIN ');
  while (at !== -1) {
    const header = text.slice(at, at + 64);
    if (!/^-----BEGIN [A-Z ]*(?:PRIVATE KEY|SECRET)[A-Z ]*-----/u.test(header)) {
      at = text.indexOf('-----BEGIN ', at + 1);
      continue;
    }
    const close = text.indexOf('-----END ', at);
    if (close === -1) {
      spans.push({ start: at, end: text.length, text: MASKED });
      break;
    }
    const lineEnd = text.indexOf('-----', close + 9);
    const end = lineEnd === -1 ? text.length : lineEnd + 5;
    spans.push({ start: at, end, text: MASKED });
    at = text.indexOf('-----BEGIN ', end);
  }
  return spans;
}

// `scheme://user:PASS@host`, whatever the scheme: the password is masked, the
// user and the host stay. The password runs to the last `@` of the authority.
const USERINFO = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:/@?#]*:([^\s/?#]+)@/gu;
// `<password>x</password>`, whose tag names a secret.
const TAG = /<([A-Za-z_][A-Za-z0-9_.-]*)>([^<]+)<\/\1>/gu;
// `curl -u user:PASS`, and `--password x`, `--client-secret=x` flags that name a secret.
const BASIC_FLAG = /(?<![\w-])-u[ =]+[^\s:]+:(\S+)/gu;
const NAMED_FLAG = /(?<![\w-])--([A-Za-z][\w-]*)(?:=|[ \t]+)(\S+)/gu;

function findForms(text: string): Span[] {
  const spans: Span[] = [];
  for (const m of text.matchAll(USERINFO)) {
    const password = m[1] ?? '';
    spans.push({
      start: m.index + m[0].length - 1 - password.length,
      end: m.index + m[0].length - 1,
      text: MASKED,
    });
  }
  for (const m of text.matchAll(TAG)) {
    if (!isSecretName(m[1] ?? '')) continue;
    const inner = m[2] ?? '';
    spans.push({
      start: m.index + m[0].length - (m[1] ?? '').length - 3 - inner.length,
      end: m.index + m[0].length - (m[1] ?? '').length - 3,
      text: MASKED,
    });
  }
  for (const m of text.matchAll(BASIC_FLAG)) {
    const password = m[1] ?? '';
    spans.push({
      start: m.index + m[0].length - password.length,
      end: m.index + m[0].length,
      text: MASKED,
    });
  }
  for (const m of text.matchAll(NAMED_FLAG)) {
    if (!isSecretName(m[1] ?? '')) continue;
    const value = m[2] ?? '';
    spans.push({
      start: m.index + m[0].length - value.length,
      end: m.index + m[0].length,
      text: MASKED,
    });
  }
  return spans;
}

function findShapes(text: string): Span[] {
  const spans = [...findPem(text), ...findForms(text)];
  for (const m of text.matchAll(PASSWORD_HASH)) {
    spans.push({ start: m.index, end: m.index + m[0].length, text: MASKED });
  }
  for (const m of text.matchAll(JWT)) {
    spans.push({ start: m.index, end: m.index + m[0].length, text: MASKED });
  }
  for (const m of text.matchAll(BEARER)) {
    const token = m[2] ?? '';
    spans.push({
      start: m.index + m[0].length - token.length,
      end: m.index + m[0].length,
      text: MASKED,
    });
  }
  for (const m of text.matchAll(LONG_TOKEN)) {
    if (looksIssued(m[0])) spans.push({ start: m.index, end: m.index + m[0].length, text: MASKED });
  }
  return spans;
}

// The text with its percent escapes read, and where each character came from, so
// a secret found in the copy is masked in the original.
interface Decoded {
  readonly text: string;
  readonly origin: number[];
}

function decode(text: string): Decoded {
  let out = '';
  const origin: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const hex = text[i] === '%' ? text.slice(i + 1, i + 3) : '';
    origin.push(i);
    if (/^[0-9A-Fa-f]{2}$/u.test(hex)) {
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 2;
    } else {
      out += text[i] ?? '';
    }
  }
  origin.push(text.length);
  return { text: out, origin };
}

// Masks plain text, which holds no JSON: pairs, shapes and the same in its
// percent-decoded copy, each by position in the original.
function maskPlain(text: string, budget: Budget): string {
  const spans = [...findPairs(text, budget), ...findShapes(text)];
  if (/%[0-9A-Fa-f]{2}/u.test(text)) {
    const copy = decode(text);
    for (const span of [...findPairs(copy.text, budget), ...findShapes(copy.text)]) {
      spans.push({
        start: copy.origin[span.start] ?? text.length,
        end: copy.origin[span.end] ?? text.length,
        text: MASKED,
      });
    }
  }
  return applySpans(text, spans);
}

// The JSON arrays and objects in a text: where each starts and ends, and what it
// parses to. A candidate that does not close, or does not parse, is plain text.
interface JsonSpan {
  readonly start: number;
  readonly end: number;
  readonly value: JsonValue;
}

// A candidate nested deeper than the walker reads is not read at all: 'deep'.
function balancedEnd(
  text: string,
  from: number,
  budget: Budget,
): number | 'spent' | 'deep' | undefined {
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i += 1) {
    if (spent(budget, 1)) return 'spent';
    const c = text[i];
    if (inString) {
      if (c === '\\') i += 1;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '[' || c === '{') {
      depth += 1;
      if (depth > MAX_DEPTH) return 'deep';
    } else if ((c === ']' || c === '}') && (depth -= 1) === 0) return i + 1;
  }
  return undefined;
}

function findJson(
  text: string,
  budget: Budget,
): { spans: JsonSpan[]; spentAt: number | undefined } {
  const spans: JsonSpan[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '{' && text[i] !== '[') {
      i += 1;
      continue;
    }
    const end = balancedEnd(text, i, budget);
    if (end === 'spent' || end === 'deep') return { spans, spentAt: i };
    if (end === undefined) {
      i += 1;
      continue;
    }
    try {
      spans.push({ start: i, end, value: JSON.parse(text.slice(i, end)) as JsonValue });
      i = end;
    } catch {
      i += 1;
    }
  }
  return { spans, spentAt: undefined };
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
  /** A secret the server holds, hidden from now on wherever it turns up. */
  know(secret: string): void;
}

export interface MaskerOptions {
  /** The tenant masks email addresses, so the trace holds none the model was not shown. */
  readonly emails: boolean;
  /** Secrets the server itself holds, hidden wherever they turn up. */
  readonly known?: readonly string[];
}

// A secret in the forms it may be written again: as read, as JSON escapes it,
// percent-encoded and in base64.
function formsOf(value: string): string[] {
  const forms = [
    value,
    JSON.stringify(value).slice(1, -1),
    encodeURIComponent(value),
    Buffer.from(value).toString('base64'),
    Buffer.from(value).toString('base64url'),
  ];
  return [...new Set(forms)];
}

// An object that names a secret and carries its value beside the name:
// `{name: 'DB_PASSWORD', value: 'x'}`, a header or an environment entry.
const NAME_MEMBERS = ['name', 'key', 'header'];
function namesSecret(node: Record<string, JsonValue>): boolean {
  return NAME_MEMBERS.some((member) => {
    const name = node[member];
    return typeof name === 'string' && isSecretName(name);
  });
}

/**
 * A masker for one turn. Text that is or holds JSON is parsed and masked by member
 * name; the rest is scanned for `name<separator>value` pairs and secret shapes. A
 * value that is cut off or outruns the read budget is masked to the end. Values
 * hidden under a secret member are remembered, never learned from prose, only at
 * 12 characters or more, and at most 64 values and 4,096 characters per turn.
 */
export function createMasker(options: MaskerOptions): Masker {
  const learned = new Set<string>();
  let learnedChars = 0;
  // What the server holds is kept apart from what is learned from a turn's text, so
  // text another person wrote cannot use up the room for it.
  const known = new Set<string>();
  const remember = (value: string): void => {
    if (learned.has(value)) return;
    if (learned.size >= MAX_LEARNED || learnedChars + value.length > MAX_LEARNED_CHARS) return;
    for (const form of formsOf(value)) learned.add(form);
    learnedChars += value.length;
  };
  // A secret held in an array or an object is learned member by member.
  const learn = (value: string, into: (secret: string) => void, depth = 0): void => {
    if (depth < MAX_DEPTH && /^[[{]/u.test(value)) {
      try {
        learnAll(JSON.parse(value) as JsonValue, into, depth + 1);
        return;
      } catch {
        // Not JSON after all: what it holds is learned as text.
      }
    }
    if (value.length >= MIN_LEARNED && value !== MASKED) into(value);
  };
  const learnAll = (value: JsonValue, into: (secret: string) => void, depth: number): void => {
    if (typeof value === 'string') learn(value, into, depth);
    else if (depth < MAX_DEPTH && isList(value)) {
      for (const item of value) learnAll(item, into, depth + 1);
    } else if (depth < MAX_DEPTH && typeof value === 'object' && value !== null) {
      for (const item of Object.values(value)) learnAll(item, into, depth + 1);
    }
  };
  const know = (secret: string): void => {
    learn(secret, (value) => {
      for (const form of formsOf(value)) known.add(form);
    });
  };
  for (const secret of options.known ?? []) know(secret);

  const run = (value: JsonValue, memory: boolean): JsonValue => {
    // How many things the walk has changed; a JSON text that it changed nothing in
    // is kept exactly as it was.
    let changes = 0;
    const text = (whole: string, depth: number): string => {
      const input = whole.length > MAX_TEXT ? whole.slice(0, MAX_TEXT) : whole;
      const budget: Budget = { left: 8 * input.length + 4_096 };
      const found = depth < MAX_DEPTH ? findJson(input, budget) : { spans: [], spentAt: undefined };
      let out = '';
      let at = 0;
      for (const span of found.spans) {
        out += maskPlain(input.slice(at, span.start), budget);
        const before = changes;
        const masked = walk(span.value, depth + 1);
        out += changes > before ? JSON.stringify(masked) : input.slice(span.start, span.end);
        at = span.end;
      }
      const stop = found.spentAt ?? input.length;
      out += maskPlain(input.slice(at, stop), budget);
      if (found.spentAt !== undefined) out += MASKED;
      for (const secret of known) out = out.split(secret).join(MASKED);
      if (memory) for (const secret of learned) out = out.split(secret).join(MASKED);
      return options.emails ? maskEmailAddresses(out) : out;
    };
    const hide = (item: JsonValue, depth: number): string => {
      if (memory) learnAll(item, remember, depth + 1);
      changes += 1;
      return MASKED;
    };
    const walk = (node: JsonValue, depth: number): JsonValue => {
      if (typeof node === 'string') {
        const out = text(node, depth);
        if (out !== node) changes += 1;
        return out;
      }
      if (typeof node !== 'object' || node === null) return node;
      if (depth >= MAX_DEPTH) {
        changes += 1;
        return MASKED;
      }
      if (isList(node)) {
        // A name and its value as a pair: ['Authorization', 'Bearer x'].
        const [first, second] = node;
        if (node.length === 2 && typeof first === 'string' && isSecretName(first)) {
          return [first, hide(second ?? null, depth)];
        }
        const items = node.slice(0, MAX_ITEMS).map((item) => walk(item, depth + 1));
        if (node.length > MAX_ITEMS) {
          changes += 1;
          items.push(`[${String(node.length - MAX_ITEMS)} more]`);
        }
        return items;
      }
      const isKey = 'kty' in node;
      const named = namesSecret(node as Record<string, JsonValue>);
      const entries = Object.entries(node);
      const out: Record<string, JsonValue> = {};
      for (const [key, item] of entries.slice(0, MAX_ITEMS)) {
        const shown = text(key, depth);
        if (shown !== key) changes += 1;
        const secret =
          isSecretName(key) ||
          (isKey && PRIVATE_KEY_MEMBERS.has(snake(key))) ||
          (named && key.toLowerCase() === 'value');
        out[shown] = secret ? hide(item, depth) : walk(item, depth + 1);
      }
      if (entries.length > MAX_ITEMS) {
        changes += 1;
        out['…'] = `${String(entries.length - MAX_ITEMS)} more`;
      }
      return out;
    };
    return walk(value, 0);
  };

  return {
    mask: (value) => run(value, true),
    maskRecord: (value) => run(value, false),
    know,
  };
}

/**
 * `output` with every secret in it replaced by `"[masked]"`: the members that
 * hold one, the private part of a key, and the shapes a secret takes in text
 * (a bearer token, a JWT, a PEM key, a password hash, a long issued token).
 */
export function maskSecrets(output: JsonValue): JsonValue {
  return createMasker({ emails: false }).mask(output);
}

import { describe, expect, it } from 'vitest';
import { MASKED, maskSecrets } from '#/service/mask-secrets';

// A seeded generator, so a failure names the case that reproduces it.
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLAIN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._~+/=!@#$%^*()';
// What a quoted value may hold: quotes, backslashes, newlines, unicode, and punctuation
// that would end an unquoted one.
const HARD = `${PLAIN} ,;&"'\\\n\t}]{[é漢😀`;
const USERINFO = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~!$&'()*+,;=%";
const NAMES = ['client_secret', 'password', 'access_token', 'api_key', 'clientSecret', 'X-Api-Key'];

type Pick = (alphabet: string, min: number, max: number) => string;

// The text a secret travels in, and whether its value can hold the hard characters.
interface Carrier {
  readonly name: string;
  readonly hard: boolean;
  // What the secret may be made of, when the carrier restricts it.
  readonly alphabet?: string;
  // A cut inside the secret leaves nothing to tell it by (no closing tag, no `@` yet).
  readonly noCut?: boolean;
  readonly build: (secret: string, field: string) => string;
}

const PLAIN_JSON: Carrier = {
  name: 'json',
  hard: true,
  build: (s, f) => `{"id":"c1","${f}":${JSON.stringify(s)},"n":1}`,
};

const CARRIERS: Carrier[] = [
  PLAIN_JSON,
  {
    name: 'nested json in a fence',
    hard: true,
    build: (s, f) =>
      `<tool-data>\n${JSON.stringify({ data: { items: [{ [f]: s }] } })}\n</tool-data>`,
  },
  {
    name: 'escaped json text',
    hard: true,
    build: (s, f) => JSON.stringify({ text: JSON.stringify({ [f]: s }), n: 1 }),
  },
  {
    name: 'double escaped json text',
    hard: true,
    build: (s, f) => JSON.stringify({ text: JSON.stringify({ text: JSON.stringify({ [f]: s }) }) }),
  },
  {
    name: 'quoted assignment',
    hard: true,
    build: (s, f) => `failed: ${f}=${JSON.stringify(s)} next`,
  },
  { name: 'assignment', hard: false, build: (s, f) => `failed with ${f}=${s} and more` },
  { name: 'colon pair', hard: false, build: (s, f) => `${f}: ${s}\nnext line` },
  {
    name: 'header',
    hard: false,
    build: (s) => `GET / HTTP/1.1\nAuthorization: Bearer ${s}\nHost: x`,
  },
  { name: 'lowercase header', hard: false, build: (s) => `authorization = bearer ${s}` },
  { name: 'quoted header', hard: true, build: (s) => `Authorization: Bearer ${JSON.stringify(s)}` },
  {
    name: 'url query',
    hard: false,
    build: (s, f) => `GET /cb?x=1&${f}=${encodeURIComponent(s)}&y=2`,
  },
  {
    name: 'encoded url query',
    hard: false,
    build: (s, f) => `${f}%3D${encodeURIComponent(s)}&y=2`,
  },
  {
    name: 'encoded header',
    hard: false,
    build: (s) => `Authorization%3A%20Bearer%20${encodeURIComponent(s)}`,
  },
  { name: 'cookie', hard: false, build: (s) => `Cookie: theme=dark; sid=${s}; lang=en` },
  { name: 'set-cookie', hard: false, build: (s) => `Set-Cookie: sid=${s}; Path=/; HttpOnly` },
  {
    name: 'error text',
    hard: false,
    build: (s, f) => `Error: the provider refused (${f}: ${s}) at line 3`,
  },
  {
    name: 'url userinfo',
    hard: false,
    alphabet: USERINFO,
    noCut: true,
    build: (s) => `fetch failed: https://svc:${s}@api.example.com/v1/items?a=1 timed out`,
  },
  {
    name: 'connection string',
    hard: false,
    alphabet: USERINFO,
    noCut: true,
    build: (s) => `could not connect to postgres://app:${s}@db:5432/odudu`,
  },
  {
    name: 'unquoted with separators',
    hard: false,
    alphabet: `${PLAIN} ,;}]"'`,
    build: (s, f) => `config ${f}=${s}\nnext=line`,
  },
  {
    name: 'yaml block',
    hard: false,
    alphabet: `${PLAIN} ,;}]"'`,
    build: (s, f) => `env:\n  ${f}: |\n    ${s}\n    more-${s}\n  other: ok`,
  },
  {
    name: 'env list',
    hard: true,
    noCut: true,
    build: (s, f) =>
      JSON.stringify([
        { name: f, value: s },
        { name: 'LOG', value: 'debug' },
      ]),
  },
  {
    name: 'header list',
    hard: true,
    noCut: true,
    build: (s) =>
      JSON.stringify({
        headers: [
          ['Authorization', `Bearer ${s}`],
          ['Accept', 'x'],
        ],
      }),
  },
  {
    name: 'key value object',
    hard: true,
    noCut: true,
    build: (s, f) => JSON.stringify({ request: { key: f, value: s } }),
  },
  {
    name: 'deep nesting beside the secret',
    hard: true,
    build: (s, f) =>
      JSON.stringify({ noise: `${'['.repeat(5_000)}${']'.repeat(5_000)}`, [f]: s, ok: 1 }),
  },
  {
    name: 'xml tag',
    hard: false,
    alphabet: 'abcdefghijklmnopqrstuvwxyz0123456789-_.~!@#$%^*()+=/ ',
    noCut: true,
    build: (s, f) =>
      `<config><${f.replaceAll(/[^A-Za-z0-9_]/gu, '_')}>${s}</${f.replaceAll(/[^A-Za-z0-9_]/gu, '_')}></config>`,
  },
  {
    name: 'curl user',
    hard: false,
    alphabet: 'abcdefghijklmnopqrstuvwxyzABCDEF0123456789-_.~!@#$%^*()+=/',
    build: (s) => `curl -u admin:${s} https://x`,
  },
  { name: 'password flag', hard: false, build: (s) => `run --password ${s}` },
];

function secretFor(carrier: Carrier, pick: Pick): string {
  // A secret with a letter and a digit at both ends, so its prefix is no word of the carrier.
  return `Q7${pick(carrier.alphabet ?? (carrier.hard ? HARD : PLAIN), 6, 30)}z9`;
}

describe('masking a secret in any carrier', () => {
  const cases = 2_000;

  it(`never leaves the secret, or an escaped or encoded form of it, in ${String(cases)} seeded cases`, () => {
    const random = generator(20_261_126);
    const pick: Pick = (alphabet, min, max) => {
      const length = min + Math.floor(random() * (max - min + 1));
      const symbols = Array.from(alphabet);
      let out = '';
      for (let i = 0; i < length; i += 1)
        out += symbols[Math.floor(random() * symbols.length)] ?? '';
      return out;
    };
    const oneOf = <T>(items: readonly T[], fallback: T): T =>
      items[Math.floor(random() * items.length)] ?? fallback;
    const started = performance.now();
    for (let n = 0; n < cases; n += 1) {
      const carrier = oneOf(CARRIERS, PLAIN_JSON);
      const field = oneOf(NAMES, 'password');
      const secret = secretFor(carrier, pick);
      const whole = carrier.build(secret, field);
      // Half the cases are cut at a random point inside the secret, as a truncated body is.
      const at = whole.indexOf(secret.slice(0, 4));
      const cut =
        random() < 0.5 && at >= 0 && carrier.noCut !== true
          ? at + 4 + Math.floor(random() * (secret.length - 3))
          : -1;
      const text = cut >= 0 ? whole.slice(0, cut) : whole;
      const out = maskSecrets(text) as string;
      const forms = [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];
      // Cut inside the secret, only what was cut is left to find.
      const visible = cut >= 0 ? secret.slice(0, text.length - at) : secret;
      const probes = cut >= 0 ? [visible, JSON.stringify(visible).slice(1, -1)] : forms;
      for (const probe of probes) {
        if (probe.length < 6) continue;
        expect(
          out.includes(probe),
          `${carrier.name} ${JSON.stringify(text)} -> ${JSON.stringify(out)}`,
        ).toBe(false);
      }
      expect(out, carrier.name).toContain(MASKED);
    }
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

// Writes keys.json, jwks.json and cases.json beside this file. RS256 signatures
// are deterministic and the ES256 token is kept from the previous cases.json, so
// a rerun reproduces the same bytes. Run: node --experimental-strip-types generate.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { type JWK, SignJWT, exportJWK, exportSPKI, generateKeyPair, importJWK } from 'jose';

const ISSUER = 'https://id.example.test/tenants/demo';
const API = 'https://api.example.test';
const NOW_MS = 1_800_000_000_000;
const NOW = NOW_MS / 1000;

const here = (name: string): URL => new URL(name, import.meta.url);

type KeyFile = Record<string, JWK>;

// Keys already in keys.json are kept; a missing one is minted.
async function keysFile(): Promise<KeyFile> {
  const out: KeyFile = existsSync(here('keys.json'))
    ? (JSON.parse(readFileSync(here('keys.json'), 'utf8')) as KeyFile)
    : {};
  for (const [kid, alg] of [
    ['key-1', 'RS256'],
    ['key-2', 'RS256'],
    ['key-3', 'ES256'],
  ] as const) {
    if (out[kid] !== undefined) continue;
    const { privateKey } = await generateKeyPair(alg, { extractable: true, modulusLength: 2048 });
    out[kid] = { ...(await exportJWK(privateKey)), kid, alg, use: 'sig' };
  }
  return out;
}

// ECDSA signatures are random, so a token signed with an EC key is taken from
// the cases.json already on disk when it has one of that name.
const previous: { name: string; token: string }[] = existsSync(here('cases.json'))
  ? (JSON.parse(readFileSync(here('cases.json'), 'utf8')) as { name: string; token: string }[])
  : [];

const privateKeys = await keysFile();
function keyOf(kid: string): JWK {
  const jwk = privateKeys[kid];
  if (jwk === undefined) throw new Error(`no key ${kid}`);
  return jwk;
}
const publicOf = (jwk: JWK): JWK => {
  const { kty, n, e, crv, x, y, kid, alg, use } = jwk;
  return { kty, n, e, crv, x, y, kid, alg, use } as JWK;
};

interface Spec {
  header?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  signWith?: string;
}

const baseClaims = (): Record<string, unknown> => ({
  iss: ISSUER,
  sub: 'subject-1',
  aud: API,
  client_id: 'client-1',
  scope: 'openid reports:read',
  iat: NOW - 60,
  nbf: NOW - 60,
  exp: NOW + 300,
});

async function sign(spec: Spec): Promise<string> {
  const claims = { ...baseClaims(), ...spec.claims };
  const jwk = keyOf(spec.signWith ?? 'key-1');
  const alg = jwk.alg ?? 'RS256';
  const header = { alg, typ: 'at+jwt', kid: spec.signWith ?? 'key-1', ...spec.header };
  return new SignJWT(claims).setProtectedHeader(header).sign(await importJWK(jwk, alg));
}

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

interface Case {
  name: string;
  token: string;
  issuer: string;
  audience: string;
  requiredScope?: string;
  now: number;
  expected:
    { ok: true; scope: string[] } | { ok: false; status: 401 | 403; code: string; reason: string };
}

const cases: Case[] = [];
async function add(
  name: string,
  spec: Spec | string,
  expected: Case['expected'],
  extra: { requiredScope?: string; issuer?: string; audience?: string; now?: number } = {},
): Promise<void> {
  cases.push({
    name,
    token: typeof spec === 'string' ? spec : await sign(spec),
    issuer: extra.issuer ?? ISSUER,
    audience: extra.audience ?? API,
    ...(extra.requiredScope === undefined ? {} : { requiredScope: extra.requiredScope }),
    now: extra.now ?? NOW_MS,
    expected,
  });
}
const refused = (status: 401 | 403, code: string, reason: string): Case['expected'] => ({
  ok: false,
  status,
  code,
  reason,
});
const invalid = (reason: string): Case['expected'] => refused(401, 'invalid_token', reason);
const ME = `${ISSUER}/me`;

await add('a valid at+jwt', {}, { ok: true, scope: ['openid', 'reports:read'] });
await add(
  'a valid at+jwt holding the required scope',
  {},
  { ok: true, scope: ['openid', 'reports:read'] },
  { requiredScope: 'reports:read' },
);
await add(
  'an ID token',
  { header: { typ: 'JWT' }, claims: { aud: 'client-1' } },
  invalid('wrong_type'),
  { audience: 'client-1' },
);
await add('typ other than at+jwt', { header: { typ: 'JWT' } }, invalid('wrong_type'));
await add(
  'application/at+jwt, which the server refuses',
  { header: { typ: 'application/at+jwt' } },
  invalid('wrong_type'),
);
await add('no typ', { header: { typ: undefined } }, invalid('wrong_type'));
await add(
  'a wrong issuer',
  { claims: { iss: 'https://evil.example.test' } },
  invalid('wrong_issuer'),
);
await add(
  'a wrong audience',
  { claims: { aud: 'https://other.example.test' } },
  invalid('wrong_audience'),
);
await add('an expired token', { claims: { exp: NOW - 3600 } }, invalid('expired'));
await add('a token not yet valid', { claims: { nbf: NOW + 3600 } }, invalid('not_yet_valid'));
await add('a token with no exp', { claims: { exp: undefined } }, invalid('invalid_claims'));
await add('a token with no sub', { claims: { sub: undefined } }, invalid('invalid_claims'));
await add('only the me audience', { claims: { aud: ME } }, invalid('wrong_audience'));
await add(
  'the me audience beside the API audience',
  { claims: { aud: [API, ME] } },
  invalid('me_audience'),
);
await add(
  'the API audience as one of several',
  { claims: { aud: [API, 'https://other.example.test'] } },
  { ok: true, scope: ['openid', 'reports:read'] },
);
await add('a missing scope', {}, refused(403, 'insufficient_scope', 'insufficient_scope'), {
  requiredScope: 'reports:write',
});
await add('an unknown kid', { header: { kid: 'nope' } }, invalid('unknown_key'));
await add('no kid', { header: { kid: undefined } }, invalid('invalid_header'));

const good = await sign({});
const [goodHeader = '', , goodSignature = ''] = good.split('.');
await add(
  'alg none',
  `${b64({ alg: 'none', typ: 'at+jwt', kid: 'key-1' })}.${b64(baseClaims())}.`,
  invalid('unsupported_algorithm'),
);
await add(
  'alg none with a signature part',
  `${b64({ alg: 'none', typ: 'at+jwt', kid: 'key-1' })}.${b64(baseClaims())}.${goodSignature}`,
  invalid('unsupported_algorithm'),
);

const publicKey = await importJWK(publicOf(keyOf('key-1')), 'RS256');
if (publicKey instanceof Uint8Array) throw new Error('expected an asymmetric key');
const spki = await exportSPKI(publicKey);
const hmac = await new SignJWT(baseClaims())
  .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt', kid: 'key-1' })
  .sign(new TextEncoder().encode(spki));
await add('HS256 signed with the public key as the secret', hmac, invalid('unsupported_algorithm'));

await add(
  'a tampered payload',
  `${goodHeader}.${b64({ ...baseClaims(), scope: 'openid reports:read admin' })}.${goodSignature}`,
  invalid('bad_signature'),
);
await add(
  'the kid of another key, signed by the first',
  { header: { kid: 'key-2' }, signWith: 'key-1' },
  invalid('bad_signature'),
);
await add(
  'the second key',
  { header: { kid: 'key-2' }, signWith: 'key-2' },
  { ok: true, scope: ['openid', 'reports:read'] },
);
await add(
  'an AT+JWT typ, which the server refuses: the match is exact',
  { header: { typ: 'AT+JWT' } },
  invalid('wrong_type'),
);
const exp = NOW_MS + 300_000;
const early = NOW_MS - 60_000;
await add(
  'expired 4 s ago, inside the tolerance',
  {},
  { ok: true, scope: ['openid', 'reports:read'] },
  { now: exp + 4_000 },
);
await add('expired 6 s ago, outside the tolerance', {}, invalid('expired'), { now: exp + 6_000 });
await add(
  'valid in 4 s, inside the tolerance',
  {},
  { ok: true, scope: ['openid', 'reports:read'] },
  { now: early - 4_000 },
);
await add('valid in 6 s, outside the tolerance', {}, invalid('not_yet_valid'), {
  now: early - 6_000,
});
{
  const name = 'an ES256 token';
  const known = previous.find((c) => c.name === name)?.token;
  await add(name, known ?? { signWith: 'key-3' }, { ok: true, scope: ['openid', 'reports:read'] });
}
await add('garbage', 'not-a-token', invalid('malformed'));

const jwks = { keys: Object.values(privateKeys).map(publicOf) };
writeFileSync(here('keys.json'), `${JSON.stringify(privateKeys, null, 2)}\n`);
writeFileSync(here('jwks.json'), `${JSON.stringify(jwks, null, 2)}\n`);
writeFileSync(here('cases.json'), `${JSON.stringify(cases, null, 2)}\n`);

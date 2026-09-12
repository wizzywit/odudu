import { describe, expect, it } from 'vitest';
import { OduduError } from '@odudu/kernel';
import { generateSigningKey } from '#/service/generate';
import { type SigningKeyRecord } from '#/schema/signing-keys';
import { AUDIENCE_UNCHECKED, TYP_UNCHECKED, signJwt, verifyJwt } from '#/service/sign';

const KEK = new Uint8Array(32).fill(5);
const ISS = 'https://issuer.example';

async function makeKey(alg: 'RS256' | 'ES256'): Promise<SigningKeyRecord> {
  const generated = await generateSigningKey(alg, KEK);
  return {
    id: 'id-1',
    realmId: 'realm-1',
    kid: generated.kid,
    alg: generated.alg,
    status: 'active',
    publicJwk: generated.publicJwk,
    privateJwkEncrypted: generated.privateJwkEncrypted,
    createdAt: new Date(),
    notAfter: null,
  };
}

describe('signJwt / verifyJwt', () => {
  it('round-trips a payload signed with an RS256 key', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt({ sub: 'user-1', iss: ISS }, { key, kek: KEK });
    const payload = await verifyJwt(token, {
      keys: [key],
      issuer: ISS,
      audience: AUDIENCE_UNCHECKED,
      typ: TYP_UNCHECKED,
    });
    expect(payload.sub).toBe('user-1');
  });

  it('round-trips a payload signed with an ES256 key', async () => {
    const key = await makeKey('ES256');
    const token = await signJwt({ sub: 'user-2', iss: ISS }, { key, kek: KEK });
    const payload = await verifyJwt(token, {
      keys: [key],
      issuer: ISS,
      audience: AUDIENCE_UNCHECKED,
      typ: TYP_UNCHECKED,
    });
    expect(payload.sub).toBe('user-2');
  });

  it('carries the requested typ header through to verification', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt({ sub: 'user-3', iss: ISS }, { key, kek: KEK, typ: 'at+jwt' });
    const payload = await verifyJwt(token, {
      keys: [key],
      issuer: ISS,
      audience: AUDIENCE_UNCHECKED,
      typ: 'at+jwt',
    });
    expect(payload.sub).toBe('user-3');
  });

  it('rejects a token whose issuer does not match', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt({ sub: 'user-4', iss: ISS }, { key, kek: KEK });
    await expect(
      verifyJwt(token, {
        keys: [key],
        issuer: 'https://someone-else.example',
        audience: AUDIENCE_UNCHECKED,
        typ: TYP_UNCHECKED,
      }),
    ).rejects.toThrow();
  });

  it('rejects an audience that is not present', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt(
      { sub: 'user-5', iss: ISS, aud: 'https://someone.example' },
      { key, kek: KEK },
    );
    await expect(
      verifyJwt(token, {
        keys: [key],
        issuer: ISS,
        audience: 'https://api.example',
        typ: TYP_UNCHECKED,
      }),
    ).rejects.toThrow();
  });

  it('picks the matching key by kid out of several candidates', async () => {
    const first = await makeKey('RS256');
    const second = await makeKey('ES256');
    const token = await signJwt({ sub: 'user-6', iss: ISS }, { key: second, kek: KEK });
    const payload = await verifyJwt(token, {
      keys: [first, second],
      issuer: ISS,
      audience: AUDIENCE_UNCHECKED,
      typ: TYP_UNCHECKED,
    });
    expect(payload.sub).toBe('user-6');
  });

  it('throws OduduError, not a raw SyntaxError, on a malformed header', async () => {
    const key = await makeKey('RS256');
    await expect(
      verifyJwt('not-a-jwt-at-all', {
        keys: [key],
        issuer: ISS,
        audience: AUDIENCE_UNCHECKED,
        typ: TYP_UNCHECKED,
      }),
    ).rejects.toBeInstanceOf(OduduError);
  });
});

function segmentText(token: string, index: number): string {
  const segment = token.split('.')[index];
  if (segment === undefined || segment.length === 0) {
    throw new Error(`token carries no segment ${String(index)}`);
  }
  return Buffer.from(segment, 'base64url').toString('utf8');
}

function segmentObject(token: string, index: number): Record<string, unknown> {
  const parsed: unknown = JSON.parse(segmentText(token, index));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`segment ${String(index)} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

describe('[JOSE-4.1.1-01] every minted JWS names its algorithm in the protected header', () => {
  it('names the signing key’s alg when minted without a typ', async () => {
    const key = await makeKey('RS256');
    const header = segmentObject(await signJwt({ sub: 'a', iss: ISS }, { key, kek: KEK }), 0);
    expect(Object.keys(header)).toContain('alg');
    expect(header.alg).toBe('RS256');
  });

  it('names the signing key’s alg for an elliptic-curve key', async () => {
    const key = await makeKey('ES256');
    const header = segmentObject(await signJwt({ sub: 'a', iss: ISS }, { key, kek: KEK }), 0);
    expect(Object.keys(header)).toContain('alg');
    expect(header.alg).toBe('ES256');
  });

  it('names the signing key’s alg when minted with a typ', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt({ sub: 'a', iss: ISS }, { key, kek: KEK, typ: 'at+jwt' });
    const header = segmentObject(token, 0);
    expect(Object.keys(header)).toContain('alg');
    expect(header.alg).toBe('RS256');
    expect(header.typ).toBe('at+jwt');
  });
});

// JSON.parse keeps only the last of a repeated name, so a duplicate claim
// name is visible nowhere but the raw payload text.
const CLAIM_NAME_ON_THE_WIRE = /"((?:[^"\\]|\\.)*)"\s*:/gu;

function claimNamesOnTheWire(json: string): string[] {
  return [...json.matchAll(CLAIM_NAME_ON_THE_WIRE)].map((match) => match[1] ?? '');
}

describe('[JOSE-4.1-01] a minted Claims Set carries each claim name once', () => {
  it('emits one occurrence of every claim name in the payload segment', async () => {
    const key = await makeKey('RS256');
    // Every value here is a string, number or array of strings, so no
    // nested object can contribute a name of its own and each `"name":`
    // in the payload JSON is a claim name of the Claims Set itself.
    const claims = {
      iss: ISS,
      sub: 'user-7',
      aud: ['https://api.example', ISS],
      client_id: 'web-app',
      scope: 'openid profile',
      iat: 1_757_000_000,
      exp: 1_757_000_300,
      jti: 'a3f0c0de-0000-7000-8000-000000000001',
    };

    const token = await signJwt(claims, { key, kek: KEK });
    const json = segmentText(token, 1);
    const names = claimNamesOnTheWire(json);

    expect(names).toHaveLength(Object.keys(claims).length);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(Object.keys(segmentObject(token, 1)).sort());
  });

  // The claim set handed to signJwt is an object, so uniqueness cannot be
  // violated from the caller's side; this keeps the wire-level check above
  // from passing for the trivial reason that it detects nothing.
  it('reads a repeated name as two occurrences of one name', () => {
    const names = claimNamesOnTheWire('{"iss":"a","sub":"b","iss":"c"}');
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(2);
  });
});

describe('[JOSE-4.1-02] aud is matched against the principal processing the token', () => {
  const API = 'https://api.example';

  it('accepts a token whose single-valued aud names the processing principal', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt({ sub: 'u', iss: ISS, aud: API }, { key, kek: KEK });
    await expect(
      verifyJwt(token, { keys: [key], issuer: ISS, audience: API, typ: TYP_UNCHECKED }),
    ).resolves.toMatchObject({
      sub: 'u',
    });
  });

  it('accepts a token whose multi-valued aud contains the processing principal', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt({ sub: 'u', iss: ISS, aud: [ISS, API] }, { key, kek: KEK });
    await expect(
      verifyJwt(token, { keys: [key], issuer: ISS, audience: API, typ: TYP_UNCHECKED }),
    ).resolves.toMatchObject({
      sub: 'u',
    });
  });

  it('rejects a token whose aud omits the processing principal', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt(
      { sub: 'u', iss: ISS, aud: ['https://other.example'] },
      { key, kek: KEK },
    );
    await expect(
      verifyJwt(token, { keys: [key], issuer: ISS, audience: API, typ: TYP_UNCHECKED }),
    ).rejects.toThrow(/aud/i);
  });

  // The check is only as good as its default. An optional `audience` made
  // omission mean "check nothing", which is this clause switched off by
  // silence at whichever call site forgot it — how a token minted for
  // another audience once reached /userinfo. The guarantee is carried by the
  // type rather than by a runtime test, so this assertion is a compile-time
  // one: making `audience` optional again turns the directive below into an
  // unused-`@ts-expect-error` error from `pnpm typecheck`.
  it('will not verify at all unless the caller states an audience policy', () => {
    // @ts-expect-error — `audience` is required; declining the check is
    // AUDIENCE_UNCHECKED, said out loud.
    const omitted: Parameters<typeof verifyJwt>[1] = { keys: [], issuer: ISS };
    expect(omitted).not.toHaveProperty('audience');
  });

  it('rejects an aud entry that merely has the principal as a prefix', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt(
      { sub: 'u', iss: ISS, aud: `${API}.evil.example` },
      { key, kek: KEK },
    );
    await expect(
      verifyJwt(token, { keys: [key], issuer: ISS, audience: API, typ: TYP_UNCHECKED }),
    ).rejects.toThrow(/aud/i);
  });
});

describe('[JOSE-4.1-03] a token is not accepted at or after the time in exp', () => {
  function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  it('accepts a token whose exp is still ahead', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt({ sub: 'u', iss: ISS, exp: nowSeconds() + 300 }, { key, kek: KEK });
    await expect(
      verifyJwt(token, {
        keys: [key],
        issuer: ISS,
        audience: AUDIENCE_UNCHECKED,
        typ: TYP_UNCHECKED,
      }),
    ).resolves.toMatchObject({
      sub: 'u',
    });
  });

  // exp is a whole second and the wall clock is ahead of its own floor, so
  // an exp of the current second is already the instant of expiry.
  it('rejects a token at the instant named by exp', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt({ sub: 'u', iss: ISS, exp: nowSeconds() }, { key, kek: KEK });
    await expect(
      verifyJwt(token, {
        keys: [key],
        issuer: ISS,
        audience: AUDIENCE_UNCHECKED,
        typ: TYP_UNCHECKED,
      }),
    ).rejects.toThrow(/exp/i);
  });

  it('rejects a token one second past exp', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt({ sub: 'u', iss: ISS, exp: nowSeconds() - 1 }, { key, kek: KEK });
    await expect(
      verifyJwt(token, {
        keys: [key],
        issuer: ISS,
        audience: AUDIENCE_UNCHECKED,
        typ: TYP_UNCHECKED,
      }),
    ).rejects.toThrow(/exp/i);
  });
});

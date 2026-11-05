import { describe, expect, it } from 'vitest';
import { OduduError } from '@odudu/kernel';
import { generateSigningKey } from '#/service/generate';
import { type SigningKeyRecord } from '#/schema/signing-keys';
import {
  AUDIENCE_UNCHECKED,
  EXPIRY_NOT_ENFORCED,
  TYP_ABSENT,
  TYP_UNCHECKED,
  encodeUnsecuredJwt,
  signJwt,
  verifyJwt,
} from '#/service/sign';

const KEK = new Uint8Array(32).fill(5);
const ISS = 'https://issuer.example';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// `verifyJwt` requires `exp` (RFC 7519 §4.1.4); every payload below that
// expects to verify carries one, the same way a real caller's would.
function futureExp(): { exp: number } {
  return { exp: nowSeconds() + 300 };
}

async function makeKey(alg: 'RS256' | 'ES256'): Promise<SigningKeyRecord> {
  const generated = await generateSigningKey(alg, KEK);
  return {
    id: 'id-1',
    tenantId: 'tenant-1',
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
    const token = await signJwt({ sub: 'user-1', iss: ISS, ...futureExp() }, { key, kek: KEK });
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
    const token = await signJwt({ sub: 'user-2', iss: ISS, ...futureExp() }, { key, kek: KEK });
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
    const token = await signJwt(
      { sub: 'user-3', iss: ISS, ...futureExp() },
      { key, kek: KEK, typ: 'at+jwt' },
    );
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
    const token = await signJwt({ sub: 'user-4', iss: ISS, ...futureExp() }, { key, kek: KEK });
    await expect(
      verifyJwt(token, {
        keys: [key],
        issuer: 'https://someone-else.example',
        audience: AUDIENCE_UNCHECKED,
        typ: TYP_UNCHECKED,
      }),
    ).rejects.toThrow(/iss/i);
  });

  it('accepts an iss named among several, and refuses one named in none', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt({ sub: 'user-4', iss: ISS, ...futureExp() }, { key, kek: KEK });
    const verify = (issuer: string[]) =>
      verifyJwt(token, { keys: [key], issuer, audience: AUDIENCE_UNCHECKED, typ: TYP_UNCHECKED });
    await expect(verify(['https://someone-else.example', ISS])).resolves.toMatchObject({
      sub: 'user-4',
    });
    await expect(verify(['https://someone-else.example'])).rejects.toThrow(/iss/i);
  });

  it('rejects an audience that is not present', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt(
      { sub: 'user-5', iss: ISS, aud: 'https://someone.example', ...futureExp() },
      { key, kek: KEK },
    );
    await expect(
      verifyJwt(token, {
        keys: [key],
        issuer: ISS,
        audience: 'https://api.example',
        typ: TYP_UNCHECKED,
      }),
    ).rejects.toThrow(/aud/i);
  });

  it('rejects a token carrying no exp at all', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt({ sub: 'user-4b', iss: ISS }, { key, kek: KEK });
    await expect(
      verifyJwt(token, {
        keys: [key],
        issuer: ISS,
        audience: AUDIENCE_UNCHECKED,
        typ: TYP_UNCHECKED,
      }),
    ).rejects.toThrow(/exp/i);
  });

  it('picks the matching key by kid out of several candidates', async () => {
    const first = await makeKey('RS256');
    const second = await makeKey('ES256');
    const token = await signJwt(
      { sub: 'user-6', iss: ISS, ...futureExp() },
      { key: second, kek: KEK },
    );
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

describe('an expectation that names nothing', () => {
  const API = 'https://api.example';

  async function tokens(): Promise<{ key: SigningKeyRecord; issued: string[] }> {
    const key = await makeKey('ES256');
    const claims = [{ iss: ISS, aud: API }, { aud: API }, { iss: ISS }, { iss: '', aud: '' }];
    const issued = await Promise.all(
      claims.map((c) => signJwt({ sub: 'u', ...c, ...futureExp() }, { key, kek: KEK })),
    );
    return { key, issued };
  }

  it('accepts no token for an empty list of issuers', async () => {
    const { key, issued } = await tokens();
    for (const token of issued) {
      await expect(
        verifyJwt(token, {
          keys: [key],
          issuer: [],
          audience: AUDIENCE_UNCHECKED,
          typ: TYP_UNCHECKED,
        }),
      ).rejects.toThrow();
    }
  });

  it('accepts no token for an empty list of audiences', async () => {
    const { key, issued } = await tokens();
    for (const token of issued) {
      await expect(
        verifyJwt(token, { keys: [key], issuer: ISS, audience: [], typ: TYP_UNCHECKED }),
      ).rejects.toThrow();
    }
  });

  it('accepts no token for a list holding only the empty string', async () => {
    const { key, issued } = await tokens();
    for (const token of issued) {
      await expect(
        verifyJwt(token, {
          keys: [key],
          issuer: [''],
          audience: AUDIENCE_UNCHECKED,
          typ: TYP_UNCHECKED,
        }),
      ).rejects.toThrow();
      await expect(
        verifyJwt(token, { keys: [key], issuer: ISS, audience: [''], typ: TYP_UNCHECKED }),
      ).rejects.toThrow();
    }
  });
});

describe('[JOSE-4.1-02] aud is matched against the principal processing the token', () => {
  const API = 'https://api.example';

  it('accepts a token whose aud contains any of several named principals, and only those', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt(
      { sub: 'u', iss: ISS, aud: [API, 'https://other.example'], ...futureExp() },
      { key, kek: KEK },
    );
    await expect(
      verifyJwt(token, {
        keys: [key],
        issuer: ISS,
        audience: ['https://nobody.example', API],
        typ: TYP_UNCHECKED,
      }),
    ).resolves.toMatchObject({ sub: 'u' });
    await expect(
      verifyJwt(token, {
        keys: [key],
        issuer: ISS,
        audience: ['https://nobody.example', 'https://nobody-else.example'],
        typ: TYP_UNCHECKED,
      }),
    ).rejects.toThrow(/aud/i);
  });

  it('accepts a token whose single-valued aud names the processing principal', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt(
      { sub: 'u', iss: ISS, aud: API, ...futureExp() },
      { key, kek: KEK },
    );
    await expect(
      verifyJwt(token, { keys: [key], issuer: ISS, audience: API, typ: TYP_UNCHECKED }),
    ).resolves.toMatchObject({
      sub: 'u',
    });
  });

  it('accepts a token whose multi-valued aud contains the processing principal', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt(
      { sub: 'u', iss: ISS, aud: [ISS, API], ...futureExp() },
      { key, kek: KEK },
    );
    await expect(
      verifyJwt(token, { keys: [key], issuer: ISS, audience: API, typ: TYP_UNCHECKED }),
    ).resolves.toMatchObject({
      sub: 'u',
    });
  });

  it('rejects a token whose aud omits the processing principal', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt(
      { sub: 'u', iss: ISS, aud: ['https://other.example'], ...futureExp() },
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
      { sub: 'u', iss: ISS, aud: `${API}.evil.example`, ...futureExp() },
      { key, kek: KEK },
    );
    await expect(
      verifyJwt(token, { keys: [key], issuer: ISS, audience: API, typ: TYP_UNCHECKED }),
    ).rejects.toThrow(/aud/i);
  });
});

describe('[JOSE-4.1-03] a token is not accepted at or after the time in exp', () => {
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

describe('EXPIRY_NOT_ENFORCED reads a token whose exp has passed', () => {
  const years = 3 * 365 * 24 * 3600;

  async function verifyLapsed(
    token: string,
    key: SigningKeyRecord,
    overrides: { issuer?: string } = {},
  ): Promise<unknown> {
    return verifyJwt(token, {
      keys: [key],
      issuer: overrides.issuer ?? ISS,
      audience: AUDIENCE_UNCHECKED,
      typ: TYP_ABSENT,
      expiry: EXPIRY_NOT_ENFORCED,
    });
  }

  it('accepts a token that expired years ago', async () => {
    const key = await makeKey('ES256');
    const token = await signJwt(
      { sub: 'u', iss: ISS, exp: nowSeconds() - years },
      { key, kek: KEK },
    );
    await expect(verifyLapsed(token, key)).resolves.toMatchObject({ sub: 'u' });
  });

  it('still refuses a token carrying no exp at all', async () => {
    const key = await makeKey('ES256');
    const token = await signJwt({ sub: 'u', iss: ISS }, { key, kek: KEK });
    await expect(verifyLapsed(token, key)).rejects.toThrow(/exp/i);
  });

  it('still refuses a wrong issuer', async () => {
    const key = await makeKey('ES256');
    const token = await signJwt({ sub: 'u', iss: 'https://other', exp: 1 }, { key, kek: KEK });
    await expect(verifyLapsed(token, key)).rejects.toThrow(/iss/i);
  });

  it('still refuses a signature made by another key under the same kid', async () => {
    const key = await makeKey('ES256');
    const forger = { ...(await makeKey('ES256')), kid: key.kid };
    const token = await signJwt({ sub: 'u', iss: ISS, exp: 1 }, { key: forger, kek: KEK });
    await expect(verifyLapsed(token, key)).rejects.toThrow();
  });

  it('still refuses an explicit typ when typ must be absent', async () => {
    const key = await makeKey('ES256');
    const token = await signJwt({ sub: 'u', iss: ISS, exp: 1 }, { key, kek: KEK, typ: 'at+jwt' });
    await expect(verifyLapsed(token, key)).rejects.toThrow(/typ/i);
  });

  it('refuses a token carrying nbf, which the epoch clock would place in the future', async () => {
    const key = await makeKey('ES256');
    const token = await signJwt(
      { sub: 'u', iss: ISS, nbf: nowSeconds() - years - 60, exp: nowSeconds() - years },
      { key, kek: KEK },
    );
    await expect(verifyLapsed(token, key)).rejects.toThrow(/nbf/i);
  });

  it('still refuses alg none', async () => {
    const key = await makeKey('ES256');
    await expect(
      verifyLapsed(encodeUnsecuredJwt({ sub: 'u', iss: ISS, exp: 1 }), key),
    ).rejects.toThrow();
  });

  it('still checks audience when one is named', async () => {
    const key = await makeKey('ES256');
    const token = await signJwt({ sub: 'u', iss: ISS, aud: 'a', exp: 1 }, { key, kek: KEK });
    await expect(
      verifyJwt(token, {
        keys: [key],
        issuer: ISS,
        audience: 'b',
        typ: TYP_ABSENT,
        expiry: EXPIRY_NOT_ENFORCED,
      }),
    ).rejects.toThrow(/aud/i);
  });

  it('leaves the default untouched: an expired token is refused without it', async () => {
    const key = await makeKey('ES256');
    const token = await signJwt(
      { sub: 'u', iss: ISS, exp: nowSeconds() - years },
      { key, kek: KEK },
    );
    await expect(
      verifyJwt(token, { keys: [key], issuer: ISS, audience: AUDIENCE_UNCHECKED, typ: TYP_ABSENT }),
    ).rejects.toThrow(/exp/i);
  });
});

describe('encodeUnsecuredJwt', () => {
  it('produces a three-part JWT with alg none and no signature segment', () => {
    const token = encodeUnsecuredJwt({ sub: 'user-1', iss: ISS });
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[2]).toBe('');
    const header = JSON.parse(Buffer.from(parts[0] ?? '', 'base64url').toString('utf8')) as {
      alg: string;
    };
    expect(header).toEqual({ alg: 'none' });
  });

  it('carries the payload members unchanged', () => {
    const token = encodeUnsecuredJwt({ sub: 'user-2', iss: ISS, aud: 'client-1' });
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as {
      sub: string;
      iss: string;
      aud: string;
    };
    expect(payload).toEqual({ sub: 'user-2', iss: ISS, aud: 'client-1' });
  });
});

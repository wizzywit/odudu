import { beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, importJWK } from 'jose';
import { generateSigningKey } from '#/service/generate';
import { unwrapPrivateJwk } from '#/service/kek';
import { type SigningKeyRecord } from '#/schema/signing-keys';
import { AUDIENCE_UNCHECKED, TYP_UNCHECKED, signJwt, verifyJwt } from '#/service/sign';

const KEK = new Uint8Array(32).fill(9);
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

let key: SigningKeyRecord;
let keys: SigningKeyRecord[];

beforeAll(async () => {
  key = await makeKey('RS256');
  keys = [key];
});

// Signs a genuine token with the real key, then swaps in whatever header the
// caller wants: alg and kid become fully attacker-controlled while the body
// and signature stay whatever they were, since verifyJwt must reject a bad
// header before it ever asks jose to check a signature.
async function tokenWithHeader(header: Record<string, unknown>): Promise<string> {
  const jwk = unwrapPrivateJwk<Record<string, unknown>>(key.privateJwkEncrypted, KEK);
  const privateKey = await importJWK(jwk, key.alg);
  const signed = await new SignJWT({ sub: 'attacker' })
    .setProtectedHeader({ alg: key.alg, kid: key.kid })
    .setIssuer(ISS)
    .setExpirationTime('5m')
    .sign(privateKey);
  const [, body, signature] = signed.split('.');
  const forgedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  return `${forgedHeader}.${String(body)}.${String(signature)}`;
}

// The published JWK is already the public key material as JSON — exactly
// what an attacker who fetched /jwks would hold — so it is used verbatim as
// the HMAC secret, no re-export needed.
async function forgeHs256UsingPublicKey(record: SigningKeyRecord): Promise<string> {
  const hsSecret = new TextEncoder().encode(JSON.stringify(record.publicJwk));
  return new SignJWT({ sub: 'attacker' })
    .setProtectedHeader({ alg: 'HS256', kid: record.kid })
    .setIssuer(ISS)
    .setExpirationTime('5m')
    .sign(hsSecret);
}

describe('[JOSE-5.2-01] algorithm comes from the key record, never the token header', () => {
  it('rejects alg: none', async () => {
    // jose itself refuses to build a "none" JWS, so the wire format is
    // constructed directly: a genuinely-signed token's header is swapped for
    // one claiming alg:none, with no third (signature) segment.
    const signed = await tokenWithHeader({ alg: 'none', kid: key.kid });
    const [header, body] = signed.split('.');
    const forged = `${String(header)}.${String(body)}.`;

    await expect(
      verifyJwt(forged, { keys, issuer: ISS, audience: AUDIENCE_UNCHECKED, typ: TYP_UNCHECKED }),
    ).rejects.toThrow();
  });

  it('rejects an RS256 public key used as an HS256 secret', async () => {
    await expect(
      verifyJwt(await forgeHs256UsingPublicKey(key), {
        keys,
        issuer: ISS,
        audience: AUDIENCE_UNCHECKED,
        typ: TYP_UNCHECKED,
      }),
    ).rejects.toThrow(/alg/i);
  });

  it('rejects a header alg that differs from the key record alg', async () => {
    await expect(
      verifyJwt(await tokenWithHeader({ alg: 'ES256', kid: key.kid }), {
        keys,
        issuer: ISS,
        audience: AUDIENCE_UNCHECKED,
        typ: TYP_UNCHECKED,
      }),
    ).rejects.toThrow(/alg/i);
  });
});

describe('[JOSE-4.1.4-01] kid is an exact-match lookup, never a path', () => {
  it.each(['../../etc/passwd', '../../../dev/null', "' OR '1'='1", 'a b'])(
    'rejects kid %j',
    async (kid) => {
      await expect(
        verifyJwt(await tokenWithHeader({ alg: key.alg, kid }), {
          keys,
          issuer: ISS,
          audience: AUDIENCE_UNCHECKED,
          typ: TYP_UNCHECKED,
        }),
      ).rejects.toThrow(/unknown key|kid/i);
    },
  );

  // '' and absent kid both take the jwt_kid_missing guard, distinct from
  // the jwt_unknown_key path a non-empty unmatched kid takes above. Pinned
  // to the specific code: /unknown key|kid/i matches both messages, so it
  // would pass even with the empty-string half of the guard deleted.
  it('rejects an empty-string kid', async () => {
    await expect(
      verifyJwt(await tokenWithHeader({ alg: key.alg, kid: '' }), {
        keys,
        issuer: ISS,
        audience: AUDIENCE_UNCHECKED,
        typ: TYP_UNCHECKED,
      }),
    ).rejects.toMatchObject({ code: 'jwt_kid_missing' });
  });

  it('rejects a token with no kid rather than trying every key in turn', async () => {
    await expect(
      verifyJwt(await tokenWithHeader({ alg: key.alg }), {
        keys,
        issuer: ISS,
        audience: AUDIENCE_UNCHECKED,
        typ: TYP_UNCHECKED,
      }),
    ).rejects.toMatchObject({ code: 'jwt_kid_missing' });
  });
});

describe('[JOSE-4.1.1-02] the header alg is only honoured when the verifier understands it', () => {
  it('verifies a token whose header alg is the one the key record pins', async () => {
    const token = await signJwt({ sub: 's', iss: ISS }, { key, kek: KEK });
    const headerText = Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8');
    expect(headerText).toContain(`"alg":"${key.alg}"`);
    await expect(
      verifyJwt(token, { keys, issuer: ISS, audience: AUDIENCE_UNCHECKED, typ: TYP_UNCHECKED }),
    ).resolves.toMatchObject({ sub: 's' });
  });

  // The body and signature stay genuine in every case below: only the alg
  // the header advertises changes, so a verifier that took the header's
  // word for the algorithm — or ignored alg altogether — would accept these.
  // `undefined` serializes away, leaving a header with no alg member.
  it.each([
    { case: 'an algorithm no JWA registers', alg: 'RS9999' },
    { case: 'a different RSA algorithm', alg: 'RS512' },
    { case: 'an algorithm for another key type', alg: 'ES256' },
    { case: 'the unsecured algorithm', alg: 'none' },
    { case: 'a non-string alg', alg: 42 },
    { case: 'no alg at all', alg: undefined },
  ])('rejects $case', async ({ alg }) => {
    const forged = await tokenWithHeader({ alg, kid: key.kid });
    await expect(
      verifyJwt(forged, { keys, issuer: ISS, audience: AUDIENCE_UNCHECKED, typ: TYP_UNCHECKED }),
    ).rejects.toMatchObject({
      code: 'jwt_alg_mismatch',
    });
  });
});

describe('[JOSE-7.2-01] a token that fails any validation step is rejected outright', () => {
  // A token that passes every step, so each case below differs from an
  // accepted token in exactly the one step it is named for.
  async function genuine(expiresIn = '5m'): Promise<string> {
    const jwk = unwrapPrivateJwk<Record<string, unknown>>(key.privateJwkEncrypted, KEK);
    const privateKey = await importJWK(jwk, key.alg);
    return new SignJWT({ sub: 'subject', aud: 'https://api.example' })
      .setProtectedHeader({ alg: key.alg, kid: key.kid })
      .setIssuer(ISS)
      .setExpirationTime(expiresIn)
      .sign(privateKey);
  }

  function corruptSignature(token: string): string {
    const [header, body, signature = ''] = token.split('.');
    const flipped = signature.startsWith('A') ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    return `${String(header)}.${String(body)}.${flipped}`;
  }

  // The options are thunks because `keys` is only assigned in beforeAll,
  // after this table is built.
  const cases: {
    step: string;
    token: () => Promise<string>;
    opts: () => Parameters<typeof verifyJwt>[1];
    message: RegExp;
  }[] = [
    {
      step: 'the kid is structurally unusable',
      token: async () => tokenWithHeader({ alg: key.alg, kid: '' }),
      opts: () => ({ keys, issuer: ISS, audience: AUDIENCE_UNCHECKED, typ: TYP_UNCHECKED }),
      message: /kid/i,
    },
    {
      step: 'the kid names no key this verifier holds',
      token: async () => tokenWithHeader({ alg: key.alg, kid: 'no-such-key' }),
      opts: () => ({ keys, issuer: ISS, audience: AUDIENCE_UNCHECKED, typ: TYP_UNCHECKED }),
      message: /unknown key/i,
    },
    {
      step: 'the header alg is not the key record alg',
      token: async () => tokenWithHeader({ alg: 'ES256', kid: key.kid }),
      opts: () => ({ keys, issuer: ISS, audience: AUDIENCE_UNCHECKED, typ: TYP_UNCHECKED }),
      message: /alg/i,
    },
    {
      step: 'the typ is not what the call site requires',
      token: async () => genuine(),
      opts: () => ({ keys, issuer: ISS, audience: AUDIENCE_UNCHECKED, typ: 'at+jwt' }),
      message: /typ/i,
    },
    {
      step: 'the signature does not verify',
      token: async () => corruptSignature(await genuine()),
      opts: () => ({ keys, issuer: ISS, audience: AUDIENCE_UNCHECKED, typ: TYP_UNCHECKED }),
      message: /signature/i,
    },
    {
      step: 'the issuer is not the expected one',
      token: async () => genuine(),
      opts: () => ({
        keys,
        issuer: 'https://someone-else.example',
        audience: AUDIENCE_UNCHECKED,
        typ: TYP_UNCHECKED,
      }),
      message: /iss/i,
    },
    {
      step: 'the audience does not include this principal',
      token: async () => genuine(),
      opts: () => ({
        keys,
        issuer: ISS,
        audience: 'https://elsewhere.example',
        typ: TYP_UNCHECKED,
      }),
      message: /aud/i,
    },
    {
      step: 'the token has expired',
      token: async () => genuine('-1s'),
      opts: () => ({ keys, issuer: ISS, audience: AUDIENCE_UNCHECKED, typ: TYP_UNCHECKED }),
      message: /exp/i,
    },
  ];

  it.each(cases)('rejects a token where $step', async ({ token, opts, message }) => {
    const outcome = await verifyJwt(await token(), opts()).then(
      (payload) => ({ resolved: true, payload }),
      (error: unknown) => ({ resolved: false, error }),
    );

    expect(outcome.resolved).toBe(false);
    expect('payload' in outcome).toBe(false);

    const error: unknown = 'error' in outcome ? outcome.error : undefined;
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : '').toMatch(message);
  });
});

describe('[RFC9068-2.1-01] token type confusion', () => {
  it('rejects an ID token where an access token is required', async () => {
    const idToken = await signJwt({ sub: 's' }, { key, kek: KEK });
    await expect(
      verifyJwt(idToken, { keys, issuer: ISS, audience: AUDIENCE_UNCHECKED, typ: 'at+jwt' }),
    ).rejects.toThrow(/typ/i);
  });

  it('accepts an access token whose typ matches what the caller requires', async () => {
    const accessToken = await signJwt({ sub: 's', iss: ISS }, { key, kek: KEK, typ: 'at+jwt' });
    await expect(
      verifyJwt(accessToken, { keys, issuer: ISS, audience: AUDIENCE_UNCHECKED, typ: 'at+jwt' }),
    ).resolves.toMatchObject({ sub: 's' });
  });
});

// The other direction: a reader of ID Tokens cannot name the typ it wants,
// because an OIDC Core §2 ID Token has none. What it can say is which typ is
// not welcome, and refusing `at+jwt` is refusing an access token.
describe('a typ the verifier refuses', () => {
  it('rejects a token carrying the refused typ', async () => {
    const accessToken = await signJwt({ sub: 's', iss: ISS }, { key, kek: KEK, typ: 'at+jwt' });
    await expect(
      verifyJwt(accessToken, {
        keys,
        issuer: ISS,
        audience: AUDIENCE_UNCHECKED,
        typ: { refused: 'at+jwt' },
      }),
    ).rejects.toThrow(/typ/i);
  });

  it('accepts a token carrying no typ at all', async () => {
    const idToken = await signJwt({ sub: 's', iss: ISS }, { key, kek: KEK });
    await expect(
      verifyJwt(idToken, {
        keys,
        issuer: ISS,
        audience: AUDIENCE_UNCHECKED,
        typ: { refused: 'at+jwt' },
      }),
    ).resolves.toMatchObject({ sub: 's' });
  });

  it('accepts a token carrying some other typ', async () => {
    const token = await signJwt({ sub: 's', iss: ISS }, { key, kek: KEK, typ: 'JWT' });
    await expect(
      verifyJwt(token, {
        keys,
        issuer: ISS,
        audience: AUDIENCE_UNCHECKED,
        typ: { refused: 'at+jwt' },
      }),
    ).resolves.toMatchObject({ sub: 's' });
  });

  // Silence used to mean "check nothing", and that is how an access token
  // came to be honoured as an `id_token_hint`: the call site said nothing
  // about typ and got the token-type confusion RFC 9068 §2.1 exists to
  // prevent. As with `audience`, the guarantee is carried by the type, so
  // this assertion is a compile-time one — making `typ` optional again turns
  // the directive below into an unused-`@ts-expect-error` from
  // `pnpm typecheck`.
  it('will not verify at all unless the caller states a typ policy', () => {
    // @ts-expect-error — `typ` is required; declining the check is
    // TYP_UNCHECKED, said out loud.
    const omitted: Parameters<typeof verifyJwt>[1] = {
      keys: [],
      issuer: ISS,
      audience: AUDIENCE_UNCHECKED,
    };
    expect(omitted).not.toHaveProperty('typ');
  });
});

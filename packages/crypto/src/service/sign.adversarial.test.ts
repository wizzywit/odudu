import { beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, importJWK } from 'jose';
import { generateSigningKey } from '#/service/generate';
import { unwrapPrivateJwk } from '#/service/kek';
import { type SigningKeyRecord } from '#/schema/signing-keys';
import { signJwt, verifyJwt } from '#/service/sign';

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

    await expect(verifyJwt(forged, { keys, issuer: ISS })).rejects.toThrow();
  });

  it('rejects an RS256 public key used as an HS256 secret', async () => {
    await expect(
      verifyJwt(await forgeHs256UsingPublicKey(key), { keys, issuer: ISS }),
    ).rejects.toThrow(/alg/i);
  });

  it('rejects a header alg that differs from the key record alg', async () => {
    await expect(
      verifyJwt(await tokenWithHeader({ alg: 'ES256', kid: key.kid }), { keys, issuer: ISS }),
    ).rejects.toThrow(/alg/i);
  });
});

describe('[JOSE-4.1.4-01] kid is an exact-match lookup, never a path', () => {
  it.each(['../../etc/passwd', '../../../dev/null', "' OR '1'='1", 'a b'])(
    'rejects kid %j',
    async (kid) => {
      await expect(
        verifyJwt(await tokenWithHeader({ alg: key.alg, kid }), { keys, issuer: ISS }),
      ).rejects.toThrow(/unknown key|kid/i);
    },
  );

  // '' and absent kid both take the jwt_kid_missing guard, distinct from
  // the jwt_unknown_key path a non-empty unmatched kid takes above. Pinned
  // to the specific code: /unknown key|kid/i matches both messages, so it
  // would pass even with the empty-string half of the guard deleted.
  it('rejects an empty-string kid', async () => {
    await expect(
      verifyJwt(await tokenWithHeader({ alg: key.alg, kid: '' }), { keys, issuer: ISS }),
    ).rejects.toMatchObject({ code: 'jwt_kid_missing' });
  });

  it('rejects a token with no kid rather than trying every key in turn', async () => {
    await expect(
      verifyJwt(await tokenWithHeader({ alg: key.alg }), { keys, issuer: ISS }),
    ).rejects.toMatchObject({ code: 'jwt_kid_missing' });
  });
});

describe('[RFC9068-2.1-01] token type confusion', () => {
  it('rejects an ID token where an access token is required', async () => {
    const idToken = await signJwt({ sub: 's' }, { key, kek: KEK });
    await expect(verifyJwt(idToken, { keys, issuer: ISS, typ: 'at+jwt' })).rejects.toThrow(/typ/i);
  });

  it('accepts an access token whose typ matches what the caller requires', async () => {
    const accessToken = await signJwt({ sub: 's', iss: ISS }, { key, kek: KEK, typ: 'at+jwt' });
    await expect(
      verifyJwt(accessToken, { keys, issuer: ISS, typ: 'at+jwt' }),
    ).resolves.toMatchObject({ sub: 's' });
  });
});

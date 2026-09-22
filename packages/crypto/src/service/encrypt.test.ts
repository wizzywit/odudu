import {
  compactDecrypt,
  decodeProtectedHeader,
  generateKeyPair,
  exportJWK,
  type CryptoKey,
  type JWK,
} from 'jose';
import { describe, expect, it } from 'vitest';
import { encryptCompact, selectEncryptionKey } from '#/service/encrypt';

async function decryptWith(privateKey: CryptoKey, jwe: string): Promise<string> {
  const { plaintext } = await compactDecrypt(jwe, privateKey);
  return new TextDecoder().decode(plaintext);
}

function protectedHeaderOf(jwe: string): Record<string, unknown> {
  return decodeProtectedHeader(jwe);
}

async function rsaOaep256Pair(): Promise<{ publicJwk: JWK; privateKey: CryptoKey }> {
  const { publicKey, privateKey } = await generateKeyPair('RSA-OAEP-256', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  return { publicJwk, privateKey };
}

describe('encryptCompact', () => {
  it('produces a five-part compact JWE the holder of the private key can read', async () => {
    const { publicJwk, privateKey } = await rsaOaep256Pair();
    const jwe = await encryptCompact('{"sub":"s1"}', publicJwk, 'RSA-OAEP-256', 'A256GCM');
    expect(jwe.split('.')).toHaveLength(5);
    expect(await decryptWith(privateKey, jwe)).toBe('{"sub":"s1"}');
  });

  it('names alg and enc in the protected header', async () => {
    const { publicJwk } = await rsaOaep256Pair();
    const header = protectedHeaderOf(
      await encryptCompact('{"sub":"s1"}', publicJwk, 'RSA-OAEP-256', 'A256GCM'),
    );
    expect(header).toMatchObject({ alg: 'RSA-OAEP-256', enc: 'A256GCM' });
  });

  it('sets cty for a nested JWT, so a reader knows the plaintext is a JWS', async () => {
    const { publicJwk } = await rsaOaep256Pair();
    const header = protectedHeaderOf(
      await encryptCompact('header.payload.sig', publicJwk, 'RSA-OAEP-256', 'A256GCM', {
        nested: true,
      }),
    );
    expect(header.cty).toBe('JWT');
  });

  it('carries no cty when the payload is not nested', async () => {
    const { publicJwk } = await rsaOaep256Pair();
    const header = protectedHeaderOf(
      await encryptCompact('{"sub":"s1"}', publicJwk, 'RSA-OAEP-256', 'A256GCM'),
    );
    expect(header.cty).toBeUndefined();
  });

  it('refuses an algorithm the spike did not confirm', async () => {
    const { publicJwk } = await rsaOaep256Pair();
    await expect(
      encryptCompact('{"sub":"s1"}', publicJwk, 'unsupported', 'A256GCM'),
    ).rejects.toThrow();
  });

  it('refuses RSA-OAEP even though jose would produce it against a key generated for it', async () => {
    const { publicKey } = await generateKeyPair('RSA-OAEP', { extractable: true });
    const publicJwk = await exportJWK(publicKey);
    await expect(
      encryptCompact('{"sub":"s1"}', publicJwk, 'RSA-OAEP', 'A256GCM'),
    ).rejects.toThrow();
  });
});

describe('selectEncryptionKey', () => {
  it('chooses the key marked for encryption', async () => {
    const { publicJwk: encJwk } = await rsaOaep256Pair();
    const { publicKey: sigKey } = await generateKeyPair('RS256', { extractable: true });
    const sigJwk = await exportJWK(sigKey);
    const mixedJwks = {
      keys: [
        { ...sigJwk, kid: 'sig-1', use: 'sig' },
        { ...encJwk, kid: 'enc-1', use: 'enc' },
      ],
    };
    expect(selectEncryptionKey(mixedJwks, 'RSA-OAEP-256')?.kid).toBe('enc-1');
  });

  it('chooses nothing when the set has no encryption key', async () => {
    const { publicKey: sigKey } = await generateKeyPair('RS256', { extractable: true });
    const sigJwk = await exportJWK(sigKey);
    const signingOnlyJwks = { keys: [{ ...sigJwk, kid: 'sig-1', use: 'sig' }] };
    expect(selectEncryptionKey(signingOnlyJwks, 'RSA-OAEP-256')).toBeNull();
  });

  it('chooses nothing when two candidates are equally good', async () => {
    const { publicJwk: first } = await rsaOaep256Pair();
    const { publicJwk: second } = await rsaOaep256Pair();
    const twoEncKeys = {
      keys: [
        { ...first, kid: 'enc-1', use: 'enc' },
        { ...second, kid: 'enc-2', use: 'enc' },
      ],
    };
    expect(selectEncryptionKey(twoEncKeys, 'RSA-OAEP-256')).toBeNull();
  });

  it('breaks a tie between two enc keys when alg distinguishes them', async () => {
    const { publicJwk: matching } = await rsaOaep256Pair();
    const { publicJwk: other } = await rsaOaep256Pair();
    const jwks = {
      keys: [
        { ...other, kid: 'enc-1', use: 'enc', alg: 'RSA-OAEP' },
        { ...matching, kid: 'enc-2', use: 'enc', alg: 'RSA-OAEP-256' },
      ],
    };
    expect(selectEncryptionKey(jwks, 'RSA-OAEP-256')?.kid).toBe('enc-2');
  });

  it('excludes an OKP key on the wrong curve from an ECDH-ES selection', async () => {
    const { publicKey: ed25519Key } = await generateKeyPair('EdDSA', {
      crv: 'Ed25519',
      extractable: true,
    });
    const ed25519Jwk = await exportJWK(ed25519Key);
    const { publicKey: x25519Key } = await generateKeyPair('ECDH-ES', {
      crv: 'X25519',
      extractable: true,
    });
    const x25519Jwk = await exportJWK(x25519Key);
    const jwks = {
      keys: [
        { ...ed25519Jwk, kid: 'ed25519-1' },
        { ...x25519Jwk, kid: 'x25519-1' },
      ],
    };
    expect(selectEncryptionKey(jwks, 'ECDH-ES')?.kid).toBe('x25519-1');
  });
});

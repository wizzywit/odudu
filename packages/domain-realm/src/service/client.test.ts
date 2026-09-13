import { describe, expect, it } from 'vitest';
import { verifyClientSecret } from '#/service/client';

// eslint-disable-next-line @typescript-eslint/require-await -- matches the injected compare's async signature verbatim
const compare = async (hash: string, secret: string) => hash === `hashed:${secret}`;

const confidential = {
  id: 'c',
  realmId: 'r',
  clientId: 'web-app',
  name: 'Web',
  enabled: true,
  type: 'confidential' as const,
  secretHash: 'hashed:s3cret',
  createdAt: new Date(),
  serviceSubjectId: null,
};
const publicClient = { ...confidential, type: 'public' as const, secretHash: null };

describe('[RFC6749-2.3.1-01] client secret verification', () => {
  it('accepts the correct secret for a confidential client', async () => {
    expect(await verifyClientSecret(confidential, 's3cret', compare)).toBe(true);
  });

  it('rejects a wrong secret', async () => {
    expect(await verifyClientSecret(confidential, 'wrong', compare)).toBe(false);
  });

  it('rejects a confidential client presenting no secret', async () => {
    expect(await verifyClientSecret(confidential, null, compare)).toBe(false);
  });

  it('rejects a public client that presents a secret', async () => {
    expect(await verifyClientSecret(publicClient, 'anything', compare)).toBe(false);
  });

  it('accepts a public client presenting nothing', async () => {
    expect(await verifyClientSecret(publicClient, null, compare)).toBe(true);
  });

  it('rejects a disabled client regardless of secret', async () => {
    expect(await verifyClientSecret({ ...confidential, enabled: false }, 's3cret', compare)).toBe(
      false,
    );
  });
});

describe('[RFC6749-2.3-02] public clients are never authenticated by a presented secret', () => {
  // RFC 6749 §2.3: a credential a public client can present is not a secret,
  // so the client's type — not the presence of a matching hash — decides.
  const publicWithSecret = { ...publicClient, secretHash: 'hashed:s3cret' };

  it('refuses a public client even when the presented secret matches its stored hash', async () => {
    expect(await verifyClientSecret(publicWithSecret, 's3cret', compare)).toBe(false);
  });

  it('never consults the comparison function for a public client', async () => {
    let consulted = false;
    const spying = (hash: string, secret: string) => {
      consulted = true;
      return compare(hash, secret);
    };
    await verifyClientSecret(publicWithSecret, 's3cret', spying);
    expect(consulted).toBe(false);
  });
});

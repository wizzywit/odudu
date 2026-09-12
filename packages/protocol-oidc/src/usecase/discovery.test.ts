import { describe, expect, it } from 'vitest';
import { resolveDiscoveryDocument } from '#/usecase/discovery';

const claimNames = () => ['sub', 'name', 'email', 'email_verified'];

describe('resolveDiscoveryDocument', () => {
  it('returns null for an unknown realm', async () => {
    const doc = await resolveDiscoveryDocument(
      { findRealm: () => Promise.resolve(null), claimNames },
      'no-such-realm',
      'https://idp.example',
    );
    expect(doc).toBeNull();
  });

  it('returns null for a disabled realm', async () => {
    const doc = await resolveDiscoveryDocument(
      { findRealm: () => Promise.resolve({ id: 'r1', enabled: false }), claimNames },
      'disabled-realm',
      'https://idp.example',
    );
    expect(doc).toBeNull();
  });

  it('builds the document under the resolved issuer for an enabled realm', async () => {
    const doc = await resolveDiscoveryDocument(
      { findRealm: () => Promise.resolve({ id: 'r1', enabled: true }), claimNames },
      'acme',
      'https://idp.example',
    );
    expect(doc?.issuer).toBe('https://idp.example/realms/acme');
  });

  it('builds claims_supported from the claim mapper registry, not a literal', async () => {
    const doc = await resolveDiscoveryDocument(
      { findRealm: () => Promise.resolve({ id: 'r1', enabled: true }), claimNames },
      'acme',
      'https://idp.example',
    );
    expect([...(doc?.claims_supported ?? [])].sort()).toEqual([
      'email',
      'email_verified',
      'name',
      'sub',
    ]);
  });
});

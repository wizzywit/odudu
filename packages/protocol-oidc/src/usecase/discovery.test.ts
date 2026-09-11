import { describe, expect, it } from 'vitest';
import { resolveDiscoveryDocument } from '#/usecase/discovery';

describe('resolveDiscoveryDocument', () => {
  it('returns null for an unknown realm', async () => {
    const doc = await resolveDiscoveryDocument(
      { findRealm: () => Promise.resolve(null) },
      'no-such-realm',
      'https://idp.example',
    );
    expect(doc).toBeNull();
  });

  it('returns null for a disabled realm', async () => {
    const doc = await resolveDiscoveryDocument(
      { findRealm: () => Promise.resolve({ id: 'r1', enabled: false }) },
      'disabled-realm',
      'https://idp.example',
    );
    expect(doc).toBeNull();
  });

  it('builds the document under the resolved issuer for an enabled realm', async () => {
    const doc = await resolveDiscoveryDocument(
      { findRealm: () => Promise.resolve({ id: 'r1', enabled: true }) },
      'acme',
      'https://idp.example',
    );
    expect(doc?.issuer).toBe('https://idp.example/realms/acme');
  });
});

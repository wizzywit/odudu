import { domainAddress, pathAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { resolveResourceMetadata } from '#/usecase/resource-metadata';

const PATH = pathAddress('https://idp.example', 'acme');
const found = (enabled: boolean) => ({
  findTenant: () => Promise.resolve({ enabled }),
});

describe('resolveResourceMetadata', () => {
  it('[RFC9728-2-01] states the resource, and names the issuer as the one authorization server', async () => {
    const doc = await resolveResourceMetadata(found(true), 'acme', PATH);
    expect(doc).toEqual({
      resource: 'https://idp.example/tenants/acme/mcp',
      authorization_servers: ['https://idp.example/tenants/acme'],
      scopes_supported: ['mcp:read', 'mcp:write'],
      bearer_methods_supported: ['header'],
    });
  });

  it('answers at a tenant domain with that domain as resource and issuer', async () => {
    const doc = await resolveResourceMetadata(
      found(true),
      'acme',
      domainAddress('login.acme.com', true),
    );
    expect(doc?.resource).toBe('https://login.acme.com/mcp');
    expect(doc?.authorization_servers).toEqual(['https://login.acme.com']);
  });

  it('returns null for an unknown tenant and for a disabled one', async () => {
    const unknown = { findTenant: () => Promise.resolve(null) };
    expect(await resolveResourceMetadata(unknown, 'acme', PATH)).toBeNull();
    expect(await resolveResourceMetadata(found(false), 'acme', PATH)).toBeNull();
  });
});

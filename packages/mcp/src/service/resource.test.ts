import { domainAddress, pathAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { mcpResourceUrl, resourceMetadataDocument, resourceMetadataUrl } from '#/service/resource';

const PATH = pathAddress('https://idp.example', 'acme');
const DOMAIN = domainAddress('login.acme.com', true);

describe('mcpResourceUrl', () => {
  it('[RFC9728-3.3-01] is the tenant address plus /mcp, with no trailing slash', () => {
    expect(mcpResourceUrl(PATH)).toBe('https://idp.example/tenants/acme/mcp');
    expect(mcpResourceUrl(DOMAIN)).toBe('https://login.acme.com/mcp');
  });
});

describe('resourceMetadataUrl', () => {
  it('inserts the well-known suffix between the host and the resource path', () => {
    expect(resourceMetadataUrl(PATH)).toBe(
      'https://idp.example/.well-known/oauth-protected-resource/tenants/acme/mcp',
    );
    expect(resourceMetadataUrl(DOMAIN)).toBe(
      'https://login.acme.com/.well-known/oauth-protected-resource/mcp',
    );
  });

  it('[RFC9728-3.1-02] drops the terminating slash of the base before inserting it', () => {
    const slashed = pathAddress('https://idp.example/', 'acme');
    expect(resourceMetadataUrl(slashed)).toBe(
      'https://idp.example/.well-known/oauth-protected-resource/tenants/acme/mcp',
    );
    expect(mcpResourceUrl(slashed)).toBe('https://idp.example/tenants/acme/mcp');
  });
});

describe('resourceMetadataDocument', () => {
  it('states the resource and names the issuer as the one authorization server', () => {
    expect(resourceMetadataDocument(PATH)).toEqual({
      resource: 'https://idp.example/tenants/acme/mcp',
      authorization_servers: ['https://idp.example/tenants/acme'],
      scopes_supported: ['mcp:read', 'mcp:write'],
      bearer_methods_supported: ['header'],
    });
  });

  it('uses the tenant domain as resource and issuer', () => {
    const doc = resourceMetadataDocument(DOMAIN);
    expect(doc.resource).toBe('https://login.acme.com/mcp');
    expect(doc.authorization_servers).toEqual(['https://login.acme.com']);
  });
});

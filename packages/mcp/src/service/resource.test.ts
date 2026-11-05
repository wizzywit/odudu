import { domainAddress, pathAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { mcpResourceUrl, resourceMetadataUrl } from '#/service/resource';

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

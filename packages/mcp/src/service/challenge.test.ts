import { domainAddress, pathAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { challengeFor, insufficientScope, invalidToken } from '#/service/challenge';

const PATH = pathAddress('https://idp.example', 'acme');
const PRM = 'https://idp.example/.well-known/oauth-protected-resource/tenants/acme/mcp';

describe('challengeFor', () => {
  it('[RFC9728-5-01] names the metadata URL and the scope the first request needs', () => {
    expect(challengeFor(PATH, 'mcp:read')).toBe(
      `Bearer resource_metadata="${PRM}", scope="mcp:read"`,
    );
  });

  it('points a tenant on its own domain at that domain', () => {
    expect(challengeFor(domainAddress('login.acme.com', true), 'mcp:read')).toBe(
      'Bearer resource_metadata="https://login.acme.com/.well-known/oauth-protected-resource/mcp", scope="mcp:read"',
    );
  });
});

describe('insufficientScope', () => {
  it('[MCP-AUTH-ERR-02] carries error="insufficient_scope" and the scopes the call needs, space separated', () => {
    expect(insufficientScope(PATH, ['mcp:read', 'mcp:write'])).toBe(
      `Bearer error="insufficient_scope", scope="mcp:read mcp:write", resource_metadata="${PRM}"`,
    );
  });
});

describe('invalidToken', () => {
  it('[RFC6750-3-01] carries error="invalid_token", the metadata URL and the scope to ask for', () => {
    expect(invalidToken(PATH, 'mcp:read')).toBe(
      `Bearer error="invalid_token", resource_metadata="${PRM}", scope="mcp:read"`,
    );
  });
});

import { describe, expect, it } from 'vitest';
import { meAudienceRequestAllowed } from '#/service/me-scopes';

const ME = 'https://idp.example/tenants/acme/me';
const MCP = 'https://idp.example/tenants/acme/mcp';

describe('meAudienceRequestAllowed', () => {
  it('asks nothing of a request that does not name the me audience', () => {
    expect(meAudienceRequestAllowed(['openid', 'mcp:read'], [MCP], ME)).toBe(true);
    expect(meAudienceRequestAllowed(['openid'], [], ME)).toBe(true);
  });

  it('accepts me:read alone and me:read with me:write', () => {
    expect(meAudienceRequestAllowed(['openid', 'me:read'], [ME], ME)).toBe(true);
    expect(meAudienceRequestAllowed(['me:read', 'me:write'], [ME], ME)).toBe(true);
  });

  it('refuses me:write without me:read', () => {
    expect(meAudienceRequestAllowed(['me:write'], [ME], ME)).toBe(false);
    expect(meAudienceRequestAllowed(['openid', 'me:write'], [ME], ME)).toBe(false);
  });

  it('refuses the me audience with no me scope at all', () => {
    expect(meAudienceRequestAllowed(['openid'], [ME], ME)).toBe(false);
    expect(meAudienceRequestAllowed([], [ME], ME)).toBe(false);
  });

  it('holds me:write to me:read wherever it is asked', () => {
    expect(meAudienceRequestAllowed(['me:write'], [], ME)).toBe(false);
    expect(meAudienceRequestAllowed(['me:write'], [MCP], ME)).toBe(false);
  });
});

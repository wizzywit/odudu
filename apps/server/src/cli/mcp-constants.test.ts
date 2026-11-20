import { ADMIN_API_AUDIENCE, MCP_CLIENT_ID, SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import * as sdk from '@odudu-io/mcp-stdio';
import { describe, expect, it } from 'vitest';

// The stdio client names the sign-in it makes with strings the server defines.
describe('the names the stdio client holds a copy of', () => {
  it('are the ones the tenant domain defines', () => {
    expect(sdk.MCP_CLIENT_ID).toBe(MCP_CLIENT_ID);
    expect(sdk.ADMIN_API_AUDIENCE).toBe(ADMIN_API_AUDIENCE);
    expect(sdk.SYSTEM_TENANT_NAME).toBe(SYSTEM_TENANT_NAME);
  });
});

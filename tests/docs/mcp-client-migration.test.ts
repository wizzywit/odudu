import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADMIN_API_AUDIENCE } from '../../packages/domain-tenant/src/service/admin-capabilities.js';
import {
  MCP_CLIENT_ID,
  MCP_CLIENT_LIFETIMES,
  MCP_CLIENT_NAME,
  MCP_CLIENT_REDIRECT_URIS,
} from '../../packages/domain-tenant/src/service/mcp-client.js';

const MIGRATION = readFileSync(
  new URL('../../packages/db/drizzle/0114_builtin_mcp_client.sql', import.meta.url),
  'utf8',
);

describe('the built-in MCP client', () => {
  it('is the same in provisioning and in the backfill migration', () => {
    for (const literal of [
      MCP_CLIENT_ID,
      MCP_CLIENT_NAME,
      ADMIN_API_AUDIENCE,
      ...MCP_CLIENT_REDIRECT_URIS,
    ]) {
      expect(MIGRATION).toContain(`'${literal}'`);
    }
    const { accessToken, idToken, refreshToken } = MCP_CLIENT_LIFETIMES;
    expect(MIGRATION).toContain(
      `${String(accessToken)}, ${String(idToken)}, ${String(refreshToken)}`,
    );
  });
});

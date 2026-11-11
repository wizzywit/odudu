import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCOPES } from '../../packages/domain-tenant/src/usecase/provision-defaults.js';

const MIGRATION = readFileSync(
  new URL('../../packages/db/drizzle/0113_mcp_scopes.sql', import.meta.url),
  'utf8',
);

describe('the MCP scope rows', () => {
  it('is the same in provisioning and in the backfill migration', () => {
    const mcp = DEFAULT_SCOPES.filter(({ scope }) => scope.name.startsWith('mcp:'));
    expect(mcp).toHaveLength(2);
    for (const { scope } of mcp) {
      const wording = [scope.name, scope.description];
      for (const text of wording) {
        expect(MIGRATION).toContain(`'${(text ?? '').replaceAll("'", "''")}'`);
      }
    }
  });
});

const ME_MIGRATION = readFileSync(
  new URL('../../packages/db/drizzle/0125_me_scopes.sql', import.meta.url),
  'utf8',
);

describe('the "me" scope rows', () => {
  it('is the same in provisioning and in the backfill migration', () => {
    const me = DEFAULT_SCOPES.filter(({ scope }) => scope.name.startsWith('me:'));
    expect(me).toHaveLength(2);
    for (const { scope } of me) {
      for (const text of [scope.name, scope.description]) {
        expect(ME_MIGRATION).toContain(`'${(text ?? '').replaceAll("'", "''")}'`);
      }
    }
  });
});

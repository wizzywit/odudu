import type { DatabaseHandle } from '@odudu/db';
import { describe, expect, it } from 'vitest';
import { mcpDepsFor, type McpDepsParts } from '#/mcp-deps';

function parts(publicBaseUrl: string | undefined, warned: string[]): McpDepsParts {
  return {
    app: { inject: () => Promise.reject(new Error('not used')) },
    database: {} as DatabaseHandle,
    ownerDatabase: { db: {} } as DatabaseHandle,
    kek: new Uint8Array(32),
    claimMappers: [],
    logger: { warn: (message: string) => warned.push(message), debug: () => undefined },
    publicBaseUrl,
  } as unknown as McpDepsParts;
}

describe('mcpDepsFor', () => {
  it('warns that admin calls are addressed at the token issuer when no base URL is set', () => {
    const warned: string[] = [];
    const deps = mcpDepsFor(parts(undefined, warned));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('ODUDU_PUBLIC_BASE_URL');
    expect(deps.adminHost).toBeUndefined();
  });

  it('is silent, and addresses the base URL host, when one is set', () => {
    const warned: string[] = [];
    const deps = mcpDepsFor(parts('https://id.example.com', warned));
    expect(warned).toHaveLength(0);
    expect(deps.adminHost).toBe('id.example.com');
  });
});

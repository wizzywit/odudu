import { describe, expect, it } from 'vitest';
import { NO_MCP_GRANT } from '#/service/mcp-registration-policy';
import { amendmentOf, placementOf } from '#/service/cimd-client-plan';
import { parseCimdDocument, type CimdClient } from '#/service/client-id-metadata';

const URL_A = 'https://app.example.com/client.json';
const NOW = new Date('2026-11-05T12:00:00.000Z');

function doc(extra: Record<string, unknown> = {}): CimdClient {
  const out = parseCimdDocument(URL_A, {
    client_id: URL_A,
    client_name: 'App',
    redirect_uris: ['https://app.example.com/cb'],
    ...extra,
  });
  if (out.kind !== 'ok') throw new Error('invalid');
  return out.client;
}
const stored = { name: 'App', type: 'public' as const, metadataUsedAt: NOW };
const config = {
  redirectUris: ['https://app.example.com/cb'],
  tokenEndpointAuthMethod: 'none',
  jwks: null,
  jwksUri: null,
  audiences: [] as string[],
};

describe('placementOf', () => {
  it('never touches a client of another origin', () => {
    expect(placementOf('seeded', 0, 10)).toBe('foreign');
    expect(placementOf('operator', 99, 10)).toBe('foreign');
  });
  it('rewrites one of its own origin whatever the count', () => {
    expect(placementOf('cimd', 10, 10)).toBe('amend');
  });
  it('creates under the ceiling and makes room at it', () => {
    expect(placementOf(null, 9, 10)).toBe('create');
    expect(placementOf(null, 10, 10)).toBe('make_room');
  });
});

describe('amendmentOf', () => {
  it('writes nothing for a document that matches what is stored', () => {
    expect(amendmentOf(stored, config, doc(), NOW, NO_MCP_GRANT)).toEqual({
      client: null,
      config: null,
      touch: false,
    });
  });
  it('writes the name and type that changed, and the configuration that differs', () => {
    const changed = amendmentOf(
      stored,
      config,
      doc({ client_name: 'New', redirect_uris: ['https://app.example.com/other'] }),
      NOW,
      NO_MCP_GRANT,
    );
    expect(changed.client).toEqual({ name: 'New', type: 'public' });
    expect(changed.config).toMatchObject({ redirectUris: ['https://app.example.com/other'] });
  });
  it('asks for a configuration when there is none, and touches once a day', () => {
    const later = new Date(NOW.getTime() + 86_400_000);
    expect(amendmentOf(stored, null, doc(), later, NO_MCP_GRANT)).toMatchObject({
      config: 'create',
      touch: true,
    });
    expect(
      amendmentOf({ ...stored, metadataUsedAt: null }, config, doc(), NOW, NO_MCP_GRANT).touch,
    ).toBe(true);
  });
  it('writes the MCP audience a policy grants, and only when it differs', () => {
    const mcp = { audience: 'https://idp.example/mcp', granted: true };
    expect(amendmentOf(stored, config, doc(), NOW, mcp).config).toMatchObject({
      audiences: ['https://idp.example/mcp'],
    });
    const held = { ...config, audiences: ['https://idp.example/mcp'] };
    expect(amendmentOf(stored, held, doc(), NOW, mcp).config).toBeNull();
    expect(amendmentOf(stored, held, doc(), NOW, { ...mcp, granted: false }).config).toMatchObject({
      audiences: [],
    });
  });
});

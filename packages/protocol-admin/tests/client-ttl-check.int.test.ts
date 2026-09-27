import { withTenant } from '@odudu/db';
import { newId } from '@odudu/kernel';
import {
  CLIENT_TOKEN_TTL_RANGES,
  clientOidcConfig,
  clientTokenTtlProblem,
} from '@odudu/protocol-oidc';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const INT4_MAX = 2_147_483_647;

const COLUMN = {
  access_token_ttl_seconds: 'accessTokenTtlSeconds',
  refresh_token_ttl_seconds: 'refreshTokenTtlSeconds',
} as const;

const cases = (Object.keys(COLUMN) as (keyof typeof COLUMN)[]).flatMap((field) => {
  const { min, max = INT4_MAX } = CLIENT_TOKEN_TTL_RANGES[field];
  return [min - 1, min, max, ...(max < INT4_MAX ? [max + 1] : [])].map((value) => ({
    field,
    value,
  }));
});

// Written straight to the row, so the CHECK itself answers, not a caller.
async function databaseAccepts(field: keyof typeof COLUMN, value: number): Promise<boolean> {
  const t = await fixture.createTenant(`ttl-${newId()}`);
  const client = await fixture.createConfidentialClient(t.name, {});
  try {
    await withTenant(fixture.app.db, t.id, (tx) =>
      tx
        .update(clientOidcConfig)
        .set({ [COLUMN[field]]: value })
        .where(eq(clientOidcConfig.clientId, client.id)),
    );
    return true;
  } catch {
    return false;
  }
}

describe('clientTokenTtlProblem agrees with the client_oidc_config CHECKs', () => {
  it.each(cases)('$field = $value', async ({ field, value }) => {
    expect(clientTokenTtlProblem(field, value) === null).toBe(await databaseAccepts(field, value));
  });
});

describe('POST /clients', () => {
  it('refuses an access token lifetime above the ceiling with 400, not 500', async () => {
    const t = await fixture.createTenant(`ttl-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/clients`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        client_id: 'long-lived',
        redirect_uris: ['https://app.example/cb'],
        access_token_ttl_seconds: 7200,
      },
    });

    expect(res.statusCode, res.payload).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('access_token_ttl_seconds');
  });
});

describe('PATCH /clients', () => {
  it('refuses an access token lifetime above the ceiling with 400, naming the field', async () => {
    const t = await fixture.createTenant(`ttl-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});

    const res = await fixture.patchClient(t.name, client.id, { access_token_ttl_seconds: 7200 });

    expect(res.statusCode, res.payload).toBe(400);
    expect(res.json<{ detail: string }>().detail).toMatch(/^access_token_ttl_seconds: /u);
  });
});

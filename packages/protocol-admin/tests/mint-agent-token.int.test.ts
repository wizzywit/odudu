import { newId } from '@odudu/kernel';
import { withTenant } from '@odudu/db';
import { sessionRepository } from '@odudu/authn-flows';
import { clientRepository, MCP_CLIENT_ID } from '@odudu/domain-tenant';
import { tokenGrantRepository } from '@odudu/protocol-oidc';
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

function call(
  tenant: string,
  token: string,
  method: 'GET' | 'PATCH' | 'POST' | 'DELETE',
  path: string,
  payload?: Record<string, unknown>,
  targetTenant = tenant,
) {
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${targetTenant}${path}`,
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { payload }),
  });
}

const OWNER_CAPABILITIES = ['manage-clients', 'manage-users', 'view-users'];

describe('the admin API and a token mintAgentToken signed', () => {
  it('admits it as an agent principal and serves a read', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { token } = await fixture.mintAgentTokenForOwner(t.name, OWNER_CAPABILITIES, {
      scope: ['mcp:read'],
    });
    expect((await call(t.name, token, 'GET', '/whoami')).statusCode).toBe(200);
    expect((await call(t.name, token, 'GET', '/clients')).statusCode).toBe(200);
  });

  it('refuses a write beyond the allowlist, even with the owner holding the capability', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { token } = await fixture.mintAgentTokenForOwner(t.name, OWNER_CAPABILITIES, {
      scope: ['mcp:read'],
    });
    const client = await fixture.createConfidentialClient(t.name, {});
    const patch = await call(t.name, token, 'PATCH', `/clients/${client.id}`, {
      description: 'an agent wrote this',
    });
    expect(patch.statusCode).toBe(403);
    expect((await call(t.name, token, 'DELETE', `/clients/${client.id}`)).statusCode).toBe(403);
  });

  it('with mcp:write admits an allowlisted field and refuses a field outside it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { token } = await fixture.mintAgentTokenForOwner(t.name, OWNER_CAPABILITIES, {
      scope: ['mcp:read', 'mcp:write'],
    });
    const client = await fixture.createConfidentialClient(t.name, {});
    const ok = await call(t.name, token, 'PATCH', `/clients/${client.id}`, {
      description: 'an agent wrote this',
    });
    expect(ok.statusCode).toBe(200);
    const refused = await call(t.name, token, 'PATCH', `/clients/${client.id}`, {
      enabled: false,
    });
    expect(refused.statusCode).toBe(403);
  });

  it('is no wider than its owner: a write the owner may not make is refused', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { token } = await fixture.mintAgentTokenForOwner(t.name, ['view-users'], {
      scope: ['mcp:read', 'mcp:write'],
    });
    const client = await fixture.createConfidentialClient(t.name, {});
    const res = await call(t.name, token, 'PATCH', `/clients/${client.id}`, {
      description: 'no capability',
    });
    expect(res.statusCode).toBe(403);
  });

  it('dies with the owner grant: revoked, the next call is a 401', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { token, grantId } = await fixture.mintAgentTokenForOwner(t.name, OWNER_CAPABILITIES, {
      scope: ['mcp:read'],
    });
    expect((await call(t.name, token, 'GET', '/whoami')).statusCode).toBe(200);
    await withTenant(fixture.app.db, t.id, (tx) =>
      tokenGrantRepository(tx).revoke(grantId, fixture.clock.now()),
    );
    expect((await call(t.name, token, 'GET', '/whoami')).statusCode).toBe(401);
  });

  it('dies with the owner session', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { token, sessionId } = await fixture.mintAgentTokenForOwner(t.name, OWNER_CAPABILITIES, {
      scope: ['mcp:read'],
    });
    await withTenant(fixture.app.db, t.id, (tx) =>
      sessionRepository(tx).end(sessionId, fixture.clock.now()),
    );
    fixture.clock.advance(1000);
    expect((await call(t.name, token, 'GET', '/whoami')).statusCode).toBe(401);
  });

  it('dies when the agent client is disabled', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { token } = await fixture.mintAgentTokenForOwner(t.name, OWNER_CAPABILITIES, {
      scope: ['mcp:read'],
    });
    await withTenant(fixture.app.db, t.id, async (tx) => {
      const agent = await clientRepository(tx).byClientId(MCP_CLIENT_ID);
      if (agent === null) throw new Error('no built-in MCP client');
      await clientRepository(tx).update(agent.id, { enabled: false });
    });
    expect((await call(t.name, token, 'GET', '/whoami')).statusCode).toBe(401);
  });

  it("is refused at another tenant's admin API", async () => {
    const mine = await fixture.createTenant(`acme-${newId()}`);
    const theirs = await fixture.createTenant(`evil-${newId()}`);
    const { token } = await fixture.mintAgentTokenForOwner(mine.name, OWNER_CAPABILITIES, {
      scope: ['mcp:read'],
    });
    expect(
      (await call(mine.name, token, 'GET', '/whoami', undefined, theirs.name)).statusCode,
    ).toBe(401);
  });
});

import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { clientRepository, MCP_CLIENT_ID } from '@odudu/domain-tenant';
import { themeRepository } from '@odudu/domain-theme';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

// The theme draft routes an agent may use: a PUT of a draft, held to a token the
// MCP endpoint signed, and never a route that makes a theme live or discards one.

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const OWNER = ['manage-tenant', 'manage-clients'];
const SIGN_IN =
  '<div class="card"><h1>{{t "login.title"}}</h1>{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}</div>';

const direct = (tenant: string) =>
  fixture.agentToken(tenant, OWNER, { scope: 'mcp:write', viaMcpClient: true });
const exchanged = (tenant: string) =>
  fixture.agentToken(tenant, OWNER, { scope: 'mcp:write', act: { sub: 'agent-client' } });
const viaEndpoint = (tenant: string) =>
  fixture.agentToken(tenant, OWNER, {
    scope: 'mcp:write',
    act: { sub: 'agent-client' },
    via: 'mcp',
  });

function send(
  tenant: string,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  path: string,
  token: string,
  options: { payload?: unknown; headers?: Record<string, string> } = {},
) {
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${tenant}${path}`,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...options.headers,
    },
    ...(options.payload === undefined ? {} : { payload: options.payload as never }),
  });
}

const rows = (tenantId: string, action: string) =>
  withTenant(fixture.app.db, tenantId, (tx) =>
    tx.select().from(auditEvents).where(eq(auditEvents.action, action)).orderBy(auditEvents.id),
  );

const draftOf = (tenantId: string, clientRowId: string | null) =>
  withTenant(fixture.app.db, tenantId, (tx) =>
    themeRepository(tx).draft({ tenantId, clientId: clientRowId }),
  );

const STYLE = '.page { color: red; }';

describe('a theme draft saved by an agent the MCP endpoint did not sign', () => {
  it.each([
    ['holds a token issued straight to it', direct],
    ['holds an exchanged token, which carries act and no marker', exchanged],
  ])('is refused for the tenant and a client when the agent %s', async (_label, mint) => {
    const t = await fixture.createTenant(`theme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const token = await mint(t.name);
    for (const path of ['/theme', `/clients/${client.id}/theme`]) {
      const res = await send(t.name, 'PUT', path, token, { payload: { stylesheet: STYLE } });
      expect(res.statusCode, path).toBe(403);
      expect(res.json()).toMatchObject({ detail: 'insufficient_scope' });
    }
    expect(await draftOf(t.id, null)).toBeNull();
    expect(await draftOf(t.id, client.id)).toBeNull();
    expect(await rows(t.id, 'theme.draft_saved')).toEqual([]);
    expect(await rows(t.id, 'capability.refused')).toHaveLength(2);
    expect(await rows(t.id, 'agent.tool_call')).toEqual([]);
  });
});

describe('a theme draft saved by a token the MCP endpoint signed', () => {
  it('creates the first draft with no If-Match, replaces it only under the etag, and the row names the scope alone', async () => {
    const t = await fixture.createTenant(`theme-${newId()}`);
    const token = await viaEndpoint(t.name);
    const first = await send(t.name, 'PUT', '/theme', token, { payload: { stylesheet: STYLE } });
    expect(first.statusCode).toBe(200);
    const unconditional = await send(t.name, 'PUT', '/theme', token, {
      payload: { stylesheet: '.page { color: blue; }' },
    });
    expect(unconditional.statusCode).toBe(428);
    const stale = await send(t.name, 'PUT', '/theme', token, {
      payload: { stylesheet: '.page { color: blue; }' },
      headers: { 'if-match': `"${'0'.repeat(64)}"` },
    });
    expect(stale.statusCode).toBe(412);
    const second = await send(t.name, 'PUT', '/theme', token, {
      payload: { stylesheet: '.page { color: blue; }' },
      headers: { 'if-match': String(first.headers.etag) },
    });
    expect(second.statusCode).toBe(200);
    expect((await draftOf(t.id, null))?.body.stylesheet).toBe('.page { color: blue; }');
    expect((await rows(t.id, 'theme.draft_saved')).map((row) => row.detail)).toEqual([
      { scope: 'tenant' },
      { scope: 'tenant' },
    ]);
    expect(await rows(t.id, 'agent.tool_call')).toEqual([]);
  });

  it('records a bounded row, whatever the size of the stylesheet and the templates saved', async () => {
    const t = await fixture.createTenant(`theme-${newId()}`);
    const token = await viaEndpoint(t.name);
    const big = `.page { color: red; }\n${'/* pad */\n'.repeat(11_000)}`;
    const res = await send(t.name, 'PUT', '/theme', token, {
      payload: { stylesheet: big, templates: { 'sign-in': SIGN_IN } },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await rows(t.id, 'theme.draft_saved');
    expect(JSON.stringify(row?.detail).length).toBeLessThan(100);
  });

  it('refuses a body naming anything but the four parts of a theme', async () => {
    const t = await fixture.createTenant(`theme-${newId()}`);
    const token = await viaEndpoint(t.name);
    for (const payload of [
      { stylesheet: STYLE, enabled: false },
      { stylesheet: STYLE, redirect_uris: ['https://evil.example/cb'] },
      { name: 'x' },
    ]) {
      const res = await send(t.name, 'PUT', '/theme', token, { payload });
      expect([400, 403], JSON.stringify(payload)).toContain(res.statusCode);
    }
    expect(await draftOf(t.id, null)).toBeNull();
  });

  it('saves a client’s draft, and a client of another tenant is not found', async () => {
    const t = await fixture.createTenant(`theme-${newId()}`);
    const other = await fixture.createTenant(`theme-${newId()}`);
    const mine = await fixture.createConfidentialClient(t.name, {});
    const theirs = await fixture.createConfidentialClient(other.name, {});
    const token = await viaEndpoint(t.name);
    const ok = await send(t.name, 'PUT', `/clients/${mine.id}/theme`, token, {
      payload: { stylesheet: STYLE },
    });
    expect(ok.statusCode).toBe(200);
    const foreign = await send(t.name, 'PUT', `/clients/${theirs.id}/theme`, token, {
      payload: { stylesheet: STYLE },
    });
    expect(foreign.statusCode).toBe(404);
    expect(await draftOf(other.id, theirs.id)).toBeNull();
    expect(await draftOf(t.id, mine.id)).not.toBeNull();
  });

  it('refuses the draft of the built-in admin client and of the built-in MCP client, whatever it names', async () => {
    const t = await fixture.createTenant(`theme-${newId()}`);
    const token = await viaEndpoint(t.name);
    const admin = await fixture.builtinAdminClient(t.name);
    const mcp = await withTenant(fixture.app.db, t.id, (tx) =>
      clientRepository(tx).byClientId(MCP_CLIENT_ID),
    );
    if (mcp === null) throw new Error('the tenant has no built-in MCP client');
    for (const id of [admin.id, mcp.id]) {
      const res = await send(t.name, 'PUT', `/clients/${id}/theme`, token, {
        payload: { stylesheet: STYLE },
      });
      expect(res.statusCode, id).toBe(403);
      expect(res.json()).toMatchObject({ detail: 'insufficient_scope' });
      expect(await draftOf(t.id, id)).toBeNull();
    }
    expect(await rows(t.id, 'theme.draft_saved')).toEqual([]);
    // A person's own token still saves it: only an agent is held from it.
    const person = await fixture.adminToken(t.name, OWNER);
    const res = await send(t.name, 'PUT', `/clients/${admin.id}/theme`, person, {
      payload: { stylesheet: STYLE },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('the routes that make a theme live or take a draft away, for an agent', () => {
  it('refuses all eight, for the tenant and a client, with a token the endpoint signed, and leaves the draft', async () => {
    const t = await fixture.createTenant(`theme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const person = await fixture.adminToken(t.name, OWNER);
    const token = await viaEndpoint(t.name);
    const bases = ['/theme', `/clients/${client.id}/theme`];
    for (const base of bases) {
      const made = await send(t.name, 'PUT', base, person, { payload: { stylesheet: STYLE } });
      expect(made.statusCode).toBe(200);
    }
    const etag = (base: string) => send(t.name, 'GET', base, person);
    const calls: [string, 'POST' | 'DELETE', string, Record<string, string>][] = [];
    for (const base of bases) {
      const read = await etag(base);
      const headers = { 'if-match': String(read.headers.etag) };
      calls.push(['publish', 'POST', `${base}/publish`, headers]);
      calls.push(['restore', 'POST', `${base}/versions/${newId()}/restore`, {}]);
      calls.push(['discard', 'DELETE', `${base}/draft`, headers]);
      calls.push(['reset', 'DELETE', base, {}]);
    }
    for (const [what, method, path, headers] of calls) {
      const res = await send(t.name, method, path, token, { headers });
      expect(res.statusCode, `${what} ${path}`).toBe(403);
    }
    expect(calls).toHaveLength(8);
    // The versions list is a read and stays open; the preview and reads are not writes.
    expect(await rows(t.id, 'theme.published')).toEqual([]);
    expect(await draftOf(t.id, null)).not.toBeNull();
    expect(await draftOf(t.id, client.id)).not.toBeNull();
    expect(await rows(t.id, 'capability.refused')).toHaveLength(8);
  });

  it('is still done by a person’s own token, which only an agent is held from', async () => {
    const t = await fixture.createTenant(`theme-${newId()}`);
    const person = await fixture.adminToken(t.name, OWNER);
    const saved = await send(t.name, 'PUT', '/theme', person, { payload: { stylesheet: STYLE } });
    expect(saved.statusCode).toBe(200);
    const published = await send(t.name, 'POST', '/theme/publish', person, {
      headers: { 'if-match': String(saved.headers.etag) },
    });
    expect(published.statusCode).toBe(200);
  });
});

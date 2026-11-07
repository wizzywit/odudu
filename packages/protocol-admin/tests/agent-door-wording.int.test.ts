import { withTenant } from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import {
  messageOverrideRepository,
  TENANT_SETTING_NAMES,
  tenantSettingsRepository,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

// The wording routes an agent may use: the three wording settings, and a message
// override set and cleared. An amendment is open to a direct holder like any
// other; a PUT can add an override and a DELETE removes one, so both are held to
// a token the MCP endpoint signed, whose calls its write budget counts.

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const OVERRIDE = 'login.title';
const WORDING = ['display_name', 'supported_locales', 'default_locale'];

const rows = (tenantId: string, action: string) =>
  withTenant(fixture.app.db, tenantId, (tx) =>
    tx.select().from(auditEvents).where(eq(auditEvents.action, action)).orderBy(auditEvents.id),
  );

const settingsOf = (tenantId: string) =>
  withTenant(fixture.app.db, tenantId, (tx) => tenantSettingsRepository(tx).byId(tenantId));

const overridesOf = (tenantId: string) =>
  withTenant(fixture.app.db, tenantId, (tx) =>
    messageOverrideRepository(tx, { isKnownKey: () => true }).all(tenantId),
  );

const direct = (tenant: string) =>
  fixture.agentToken(tenant, ['manage-tenant'], { scope: 'mcp:write', viaMcpClient: true });
const exchanged = (tenant: string) =>
  fixture.agentToken(tenant, ['manage-tenant'], {
    scope: 'mcp:write',
    act: { sub: 'agent-client' },
  });
const viaEndpoint = (tenant: string) =>
  fixture.agentToken(tenant, ['manage-tenant'], {
    scope: 'mcp:write',
    act: { sub: 'agent-client' },
    via: 'mcp',
  });

function send(
  tenant: string,
  method: 'GET' | 'PATCH' | 'PUT' | 'DELETE',
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

const put = (tenant: string, token: string, message: string, etag?: string) =>
  send(tenant, 'PUT', `/message-overrides/fr/${OVERRIDE}`, token, {
    payload: { message },
    headers: etag === undefined ? { 'if-none-match': '*' } : { 'if-match': etag },
  });

// A person's own token sets one first, so a refusal has an override to spare.
async function seeded(tenant: { id: string; name: string }) {
  const admin = await fixture.adminToken(tenant.name, ['manage-tenant']);
  const made = await put(tenant.name, admin, 'Connexion');
  expect(made.statusCode).toBe(200);
  return { admin, etag: String(made.headers.etag) };
}

describe('an override set or cleared by an agent the MCP endpoint did not sign', () => {
  it.each([
    ['holds a token issued straight to it', direct],
    ['holds an exchanged token, which carries act and no marker', exchanged],
  ])('is refused for a PUT and a DELETE when the agent %s', async (_label, mint) => {
    const t = await fixture.createTenant(`wording-${newId()}`);
    const { etag } = await seeded(t);
    const token = await mint(t.name);
    const replaced = await put(t.name, token, 'Changed', etag);
    const created = await send(t.name, 'PUT', '/message-overrides/de/login.submit', token, {
      payload: { message: 'Weiter' },
      headers: { 'if-none-match': '*' },
    });
    const cleared = await send(t.name, 'DELETE', `/message-overrides/fr/${OVERRIDE}`, token, {
      headers: { 'if-match': etag },
    });
    for (const res of [replaced, created, cleared]) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ detail: 'insufficient_scope' });
    }
    expect((await overridesOf(t.id)).map((row) => [row.locale, row.key, row.message])).toEqual([
      ['fr', OVERRIDE, 'Connexion'],
    ]);
    const refusals = await rows(t.id, 'capability.refused');
    expect(refusals).toHaveLength(3);
    for (const row of refusals) {
      expect(row).toMatchObject({ outcome: 'refused', detail: { reason: 'insufficient_scope' } });
    }
    expect(await rows(t.id, 'agent.tool_call')).toEqual([]);
    expect(await rows(t.id, 'message_override.delete')).toEqual([]);
    expect(await rows(t.id, 'message_override.set')).toHaveLength(1);
  });

  it('is refused whatever the headers say, so only the token decides', async () => {
    const t = await fixture.createTenant(`wording-${newId()}`);
    const token = await direct(t.name);
    for (const headers of [{}, { 'if-none-match': '*' }, { 'if-match': '*' }]) {
      const res = await send(t.name, 'PUT', `/message-overrides/fr/${OVERRIDE}`, token, {
        payload: { message: 'x' },
        headers,
      });
      expect(res.statusCode).toBe(403);
    }
    expect(await overridesOf(t.id)).toEqual([]);
  });
});

describe('the wording settings, amended by an agent the MCP endpoint did not sign', () => {
  it.each([
    ['holds a token issued straight to it', direct],
    ['holds an exchanged token, which carries act and no marker', exchanged],
  ])(
    'are amended, and the call is recorded at the door, when the agent %s',
    async (_label, mint) => {
      const t = await fixture.createTenant(`wording-${newId()}`);
      const token = await mint(t.name);
      const res = await send(t.name, 'PATCH', '/settings', token, {
        payload: { display_name: 'Acme', supported_locales: ['en', 'de'], default_locale: 'de' },
      });
      expect(res.statusCode).toBe(200);
      expect(await settingsOf(t.id)).toMatchObject({
        display_name: 'Acme',
        supported_locales: ['en', 'de'],
        default_locale: 'de',
      });
      const calls = await rows(t.id, 'agent.tool_call');
      expect(calls.map((row) => (row.detail as { tool: string }).tool)).toEqual([
        'admin.patch.settings',
      ]);
    },
  );
});

describe('an override set and cleared by a token the MCP endpoint signed', () => {
  it('creates, replaces and removes, and the audit rows hold the text before and after', async () => {
    const t = await fixture.createTenant(`wording-${newId()}`);
    const token = await viaEndpoint(t.name);
    const first = await put(t.name, token, 'first');
    expect(first.statusCode).toBe(200);
    const second = await put(t.name, token, 'second', String(first.headers.etag));
    expect(second.statusCode).toBe(200);
    const stale = await put(t.name, token, 'third', String(first.headers.etag));
    expect(stale.statusCode).toBe(412);
    const clash = await put(t.name, token, 'fourth');
    expect(clash.statusCode).toBe(412);
    const gone = await send(t.name, 'DELETE', `/message-overrides/fr/${OVERRIDE}`, token, {
      headers: { 'if-match': String(second.headers.etag) },
    });
    expect(gone.statusCode).toBe(204);
    expect(await overridesOf(t.id)).toEqual([]);
    expect((await rows(t.id, 'message_override.set')).map((row) => row.detail)).toEqual([
      { locale: 'fr', key: OVERRIDE, before: null, after: 'first' },
      { locale: 'fr', key: OVERRIDE, before: 'first', after: 'second' },
    ]);
    expect((await rows(t.id, 'message_override.delete')).map((row) => row.detail)).toEqual([
      { locale: 'fr', key: OVERRIDE, before: 'second' },
    ]);
    // The endpoint records the call itself, so the door writes none.
    expect(await rows(t.id, 'agent.tool_call')).toEqual([]);
  });

  it('refuses a PUT and a DELETE that name a member or a body the allowlist does not', async () => {
    const t = await fixture.createTenant(`wording-${newId()}`);
    const { etag } = await seeded(t);
    const token = await viaEndpoint(t.name);
    const extra = await send(t.name, 'PUT', `/message-overrides/fr/${OVERRIDE}`, token, {
      payload: { message: 'x', locale: 'de' },
      headers: { 'if-match': etag },
    });
    expect([400, 403]).toContain(extra.statusCode);
    const withBody = await send(t.name, 'DELETE', `/message-overrides/fr/${OVERRIDE}`, token, {
      payload: { message: 'x' },
      headers: { 'if-match': etag },
    });
    expect([400, 403]).toContain(withBody.statusCode);
    expect((await overridesOf(t.id)).map((row) => row.message)).toEqual(['Connexion']);
  });
});

describe('a body sent to the settings route past the tool', () => {
  const OTHERS = TENANT_SETTING_NAMES.filter((name) => !WORDING.includes(name));

  it('is refused whole for each of the other settings, alone and beside a wording one', async () => {
    const t = await fixture.createTenant(`wording-${newId()}`);
    const token = await viaEndpoint(t.name);
    const before = await settingsOf(t.id);
    let refused = 0;
    for (const name of OTHERS) {
      for (const body of [
        { [name]: true },
        { display_name: 'Hijacked', [name]: true },
        { [name]: 1, default_locale: 'en' },
      ]) {
        const res = await send(t.name, 'PATCH', '/settings', token, { payload: body });
        expect(res.statusCode, JSON.stringify(body)).toBe(403);
        expect(res.json()).toMatchObject({ detail: 'insufficient_scope' });
        refused += 1;
      }
    }
    expect(refused).toBe(OTHERS.length * 3);
    expect(await settingsOf(t.id)).toEqual(before);
    expect(await rows(t.id, 'tenant.amend_settings')).toEqual([]);
    expect(await rows(t.id, 'capability.refused')).toHaveLength(refused);
  });

  it('is refused for a name that is no setting and for a casing of a wording one', async () => {
    const t = await fixture.createTenant(`wording-${newId()}`);
    const token = await viaEndpoint(t.name);
    for (const body of [{ Display_Name: 'x' }, { displayName: 'x' }, { not_a_setting: true }]) {
      const res = await send(t.name, 'PATCH', '/settings', token, { payload: body });
      expect(res.statusCode, JSON.stringify(body)).toBe(403);
    }
  });

  it('takes the three wording settings together, and the audit row names those three alone', async () => {
    const t = await fixture.createTenant(`wording-${newId()}`);
    const token = await viaEndpoint(t.name);
    const res = await send(t.name, 'PATCH', '/settings', token, {
      payload: { display_name: 'Acme', supported_locales: ['en', 'fr'], default_locale: 'fr' },
    });
    expect(res.statusCode).toBe(200);
    expect((await rows(t.id, 'tenant.amend_settings')).map((row) => row.detail)).toEqual([
      {
        display_name: { before: null, after: 'Acme' },
        supported_locales: { before: ['en'], after: ['en', 'fr'] },
        default_locale: { before: null, after: 'fr' },
      },
    ]);
  });
});

describe('a person’s own token', () => {
  it('still sets any setting, which only an agent is held from', async () => {
    const t = await fixture.createTenant(`wording-${newId()}`);
    const admin = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await send(t.name, 'PATCH', '/settings', admin, {
      payload: { otp_required: true, display_name: 'Acme' },
    });
    expect(res.statusCode).toBe(200);
    expect(await settingsOf(t.id)).toMatchObject({ otp_required: true, display_name: 'Acme' });
  });
});

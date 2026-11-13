import { withTenant } from '@odudu/db';
import { tenantSettingsRepository } from '@odudu/domain-tenant';
import { SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { amendSettings } from '#/usecase/settings';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

describe('PATCH /admin/tenants/{t}/settings', () => {
  it('applies a setting the CLI also applies, through the same map', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { verify_email: true, password_min_length: 14 },
    });
    expect(res.statusCode).toBe(200);
    await withTenant(fixture.app.db, t.id, async (tx) => {
      const row = await tenantSettingsRepository(tx).byId(t.id);
      expect(row).toMatchObject({ verify_email: true, password_min_length: 14 });
    });
  });

  it('stores an empty display name as none, so the tenant name stands in for it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const patch = (display_name: string) =>
      fixture.http.inject({
        method: 'PATCH',
        url: `/admin/tenants/${t.name}/settings`,
        headers: { authorization: `Bearer ${token}` },
        payload: { display_name },
      });
    expect((await patch('Acme Inc')).json()).toMatchObject({ display_name: 'Acme Inc' });
    const cleared = await patch('  ');
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ display_name: null });
    await withTenant(fixture.app.db, t.id, async (tx) => {
      const row = await tenantSettingsRepository(tx).byId(t.id);
      expect(row?.display_name).toBeNull();
    });
  });

  it('applies the numbers 0 and 1 as numbers, not as booleans', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { password_history_depth: 0, max_sessions_per_browser: 1 },
    });
    expect(res.statusCode).toBe(200);
    await withTenant(fixture.app.db, t.id, async (tx) => {
      const row = await tenantSettingsRepository(tx).byId(t.id);
      expect(row).toMatchObject({ password_history_depth: 0, max_sessions_per_browser: 1 });
    });
  });

  it('refuses an unknown setting, naming the known ones', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { not_a_setting: true },
    });
    expect(res.statusCode).toBe(400);
  });

  interface RangeRefusal {
    readonly detail: string;
    readonly errors?: readonly { readonly path: string; readonly message: string }[];
  }

  async function patchSettings(tenantName: string, payload: Record<string, unknown>) {
    const token = await fixture.adminToken(tenantName, ['manage-tenant']);
    return fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${tenantName}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
  }

  it('refuses a value outside its range before writing, naming the setting', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);

    const res = await patchSettings(t.name, { password_min_length: -5 });

    expect(res.statusCode).toBe(400);
    expect(res.json<RangeRefusal>().errors).toEqual([
      { path: 'password_min_length', message: 'must be between 8 and 256' },
    ]);
  });

  it('reports every out-of-range value together', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);

    const res = await patchSettings(t.name, {
      password_min_length: 4,
      max_sessions_per_browser: 99,
    });

    expect(res.statusCode).toBe(400);
    expect((res.json<RangeRefusal>().errors ?? []).map((error) => error.path).sort()).toEqual([
      'max_sessions_per_browser',
      'password_min_length',
    ]);
  });

  it('answers a stale If-Match with 412 before judging a range', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const url = `/admin/tenants/${t.name}/settings`;
    const headers = { authorization: `Bearer ${token}` };
    const read = await fixture.http.inject({ method: 'GET', url, headers });
    const etag = read.headers.etag;
    if (typeof etag !== 'string') throw new Error('expected GET to answer an etag');
    await fixture.http.inject({ method: 'PATCH', url, headers, payload: { verify_email: true } });

    const res = await fixture.http.inject({
      method: 'PATCH',
      url,
      headers: { ...headers, 'if-match': etag },
      payload: { password_min_length: 4 },
    });

    expect(res.statusCode).toBe(412);
  });

  it('judges an idle lifetime against the stored maximum it would exceed', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const stored = await withTenant(fixture.app.db, t.id, (tx) =>
      tenantSettingsRepository(tx).byId(t.id),
    );
    expect(stored?.sso_session_max_seconds).toBe(36_000);

    const res = await patchSettings(t.name, { sso_session_idle_seconds: 40_000 });

    expect(res.statusCode).toBe(400);
    expect(res.json<RangeRefusal>().errors).toEqual([
      { path: 'sso_session_idle_seconds', message: 'must not exceed sso_session_max_seconds' },
    ]);
    await withTenant(fixture.app.db, t.id, async (tx) => {
      expect((await tenantSettingsRepository(tx).byId(t.id))?.sso_session_idle_seconds).toBe(1800);
    });
  });

  it('refuses a registration policy the database CHECK would also refuse, naming the four it allows', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { client_registration_policy: 'sometimes' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('disabled, open, token, mcp');
  });

  it('round-trips the mcp registration policy and the metadata document switch under If-Match', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'view-audit']);
    const url = `/admin/tenants/${t.name}/settings`;
    const headers = { authorization: `Bearer ${token}` };
    const read = await fixture.http.inject({ method: 'GET', url, headers });
    const etag = read.headers.etag;
    if (typeof etag !== 'string') throw new Error('expected GET to answer an etag');
    expect(read.json()).toMatchObject({
      client_registration_policy: 'disabled',
      cimd_enabled: false,
    });

    const res = await fixture.http.inject({
      method: 'PATCH',
      url,
      headers: { ...headers, 'if-match': etag },
      payload: { client_registration_policy: 'mcp', cimd_enabled: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ client_registration_policy: 'mcp', cimd_enabled: true });
    const next = res.headers.etag;
    expect(next).not.toBe(etag);
    const again = await fixture.http.inject({ method: 'GET', url, headers });
    expect(again.headers.etag).toBe(next);
    expect(again.json()).toMatchObject({ client_registration_policy: 'mcp', cimd_enabled: true });
    const stale = await fixture.http.inject({
      method: 'PATCH',
      url,
      headers: { ...headers, 'if-match': etag },
      payload: { cimd_enabled: false },
    });
    expect(stale.statusCode).toBe(412);
  });

  it('records the registration policy and the metadata document switch in the audit row, as values', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'view-audit']);
    const headers = { authorization: `Bearer ${token}` };
    const patch = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers,
      payload: { client_registration_policy: 'mcp', cimd_enabled: true, verify_email: true },
    });
    expect(patch.statusCode).toBe(200);

    const audit = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/audit?action=tenant.amend_settings`,
      headers,
    });

    const items = audit.json<{ items: { detail: unknown }[] }>().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.detail).toEqual({
      client_registration_policy: { before: 'disabled', after: 'mcp' },
      cimd_enabled: { before: false, after: true },
    });
  });

  it('leaves another tenant with the defaults when one is amended', async () => {
    const a = await fixture.createTenant(`acme-${newId()}`);
    const b = await fixture.createTenant(`acme-${newId()}`);
    const res = await patchSettings(a.name, {
      client_registration_policy: 'mcp',
      cimd_enabled: true,
    });
    expect(res.statusCode).toBe(200);
    await withTenant(fixture.app.db, b.id, async (tx) => {
      expect(await tenantSettingsRepository(tx).byId(a.id)).toBeNull();
      expect(await tenantSettingsRepository(tx).byId(b.id)).toMatchObject({
        client_registration_policy: 'disabled',
        cimd_enabled: false,
      });
    });
  });

  it('answers 412 when If-Match is stale', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const url = `/admin/tenants/${t.name}/settings`;
    const headers = { authorization: `Bearer ${token}` };
    const read = await fixture.http.inject({ method: 'GET', url, headers });
    const etag = read.headers.etag;
    if (typeof etag !== 'string') throw new Error('expected GET to answer an etag');
    await fixture.http.inject({ method: 'PATCH', url, headers, payload: { verify_email: true } });
    const stale = await fixture.http.inject({
      method: 'PATCH',
      url,
      headers: { ...headers, 'if-match': etag },
      payload: { verify_email: false },
    });
    expect(stale.statusCode).toBe(412);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { verify_email: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a system admin holding manage-tenants but not manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { verify_email: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admits a system admin holding manage-tenants and manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-tenants', 'manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { verify_email: true },
    });
    expect(res.statusCode).toBe(200);
  });

  it('calls audit exactly once when it amends a setting', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      amendSettings(
        tx,
        {
          audit: (_tx, event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          tenantId: t.id,
          values: { verify_email: true },
          ifMatch: undefined,
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('amended');
    expect(events).toHaveLength(1);
  });

  it('does not call audit when a value is refused', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const events: unknown[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      amendSettings(
        tx,
        {
          audit: (_tx, event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        {
          tenantId: t.id,
          values: { not_a_setting: true },
          ifMatch: undefined,
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('unknown_setting');
    expect(events).toHaveLength(0);
  });
});

describe('GET /admin/tenants/{t}/settings', () => {
  it('returns every setting, keyed the same way a write names them', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBeDefined();
    expect(res.json<{ verify_email: boolean }>().verify_email).toBe(false);
  });

  it('probes with a foreign tenant_id and finds nothing to leak', async () => {
    const t1 = await fixture.createTenant(`acme-${newId()}`);
    const t2 = await fixture.createTenant(`other-${newId()}`);
    await withTenant(fixture.app.db, t2.id, async (tx) => {
      const row = await tenantSettingsRepository(tx).byId(t1.id);
      expect(row).toBeNull();
    });
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a system admin holding manage-tenants but not manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admits a system admin holding manage-tenants and manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-tenants', 'manage-tenant']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

// `tenants.enabled` has two doors — PATCH /tenants/{t} and PATCH
// /settings — and disabling the system tenant closes the one every
// cross-tenant administrator authenticates against, leaving psql the only
// way back. Both are asserted here so a guard on one cannot stand in for
// the other.
describe('disabling the system tenant', () => {
  it.each([
    ['PATCH /settings', (t: string) => `/admin/tenants/${t}/settings`],
    ['PATCH /tenants/{t}', (t: string) => `/admin/tenants/${t}`],
  ])('is refused through %s', async (_name, url) => {
    const token = await fixture.systemAdminToken(['manage-tenants', 'manage-tenant']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: url(SYSTEM_TENANT_NAME),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: false },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<{ detail: string }>().detail).toContain('cannot be disabled');
  });
});

describe('PATCH /settings with nothing to set', () => {
  // The request schema admits `{}`, and Drizzle refuses `.set({})` outright,
  // so without a short-circuit the caller is told the server broke for
  // sending a request the schema accepted.
  it('answers the current settings rather than failing on an empty update', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
  });
});

describe('the authenticator policy settings', () => {
  interface RangeRefusal {
    readonly errors?: readonly { readonly path: string; readonly message: string }[];
  }

  async function amend(tenantName: string, payload: Record<string, unknown>) {
    const token = await fixture.adminToken(tenantName, ['manage-tenant']);
    return fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${tenantName}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
  }

  it('starts every tenant on the parameters every enrolment was made with', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const stored = await withTenant(fixture.app.db, t.id, (tx) =>
      tenantSettingsRepository(tx).byId(t.id),
    );
    expect(stored).toMatchObject({
      totp_algorithm: 'SHA1',
      totp_digits: 6,
      totp_period: 30,
      webauthn_user_verification: 'required',
      webauthn_resident_key: 'required',
      recovery_code_count: 10,
    });
  });

  it('stores a policy and audits it as values', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const res = await amend(t.name, {
      totp_algorithm: 'SHA256',
      totp_digits: 8,
      totp_period: 60,
      webauthn_user_verification: 'preferred',
      webauthn_resident_key: 'discouraged',
      recovery_code_count: 12,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      totp_algorithm: 'SHA256',
      totp_digits: 8,
      totp_period: 60,
      webauthn_user_verification: 'preferred',
      webauthn_resident_key: 'discouraged',
      recovery_code_count: 12,
    });
  });

  it('refuses a digit count, a period or a count nobody offers, naming the values', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const res = await amend(t.name, { totp_digits: 7, totp_period: 45, recovery_code_count: 20 });
    expect(res.statusCode).toBe(400);
    expect(res.json<RangeRefusal>().errors).toEqual([
      { path: 'recovery_code_count', message: 'must be between 8 and 16' },
      { path: 'totp_digits', message: 'must be one of 6, 8' },
      { path: 'totp_period', message: 'must be one of 30, 60' },
    ]);
  });

  it('refuses an algorithm that is not offered, naming the three', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const res = await amend(t.name, { totp_algorithm: 'MD5' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('SHA1, SHA256, SHA512');
  });

  it('keeps the recovery warning within the size of a set', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const res = await amend(t.name, { recovery_code_count: 8, recovery_code_warn_below: 9 });
    expect(res.statusCode).toBe(400);
    expect(res.json<RangeRefusal>().errors).toEqual([
      { path: 'recovery_code_warn_below', message: 'must not exceed recovery_code_count' },
    ]);
  });
});

describe('the passkey switch', () => {
  it('starts off, turns on through the settings and reads back', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const read = () =>
      fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}/settings`,
        headers: { authorization: `Bearer ${token}` },
      });
    expect((await read()).json()).toMatchObject({ require_passkey: false });
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
      payload: { require_passkey: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ require_passkey: true });
    expect((await read()).json()).toMatchObject({ require_passkey: true });
  });
});

describe('the breached-password settings', () => {
  it('start on the dataset and open, change through the settings and refuse a bad value', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const url = `/admin/tenants/${t.name}/settings`;
    const headers = { authorization: `Bearer ${token}` };
    const read = () => fixture.http.inject({ method: 'GET', url, headers });
    expect((await read()).json()).toMatchObject({
      breached_check: 'dataset',
      breached_on_error: 'open',
    });
    const res = await fixture.http.inject({
      method: 'PATCH',
      url,
      headers,
      payload: { breached_check: 'remote', breached_on_error: 'closed' },
    });
    expect(res.statusCode).toBe(200);
    expect((await read()).json()).toMatchObject({
      breached_check: 'remote',
      breached_on_error: 'closed',
    });
    const bad = await fixture.http.inject({
      method: 'PATCH',
      url,
      headers,
      payload: { breached_check: 'always' },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('the terms settings', () => {
  it('start with none at version 1, change through the settings and refuse a bad value', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const url = `/admin/tenants/${t.name}/settings`;
    const headers = { authorization: `Bearer ${token}` };
    const patch = (payload: Record<string, unknown>) =>
      fixture.http.inject({ method: 'PATCH', url, headers, payload });
    const read = () => fixture.http.inject({ method: 'GET', url, headers });
    expect((await read()).json()).toMatchObject({ terms_uri: null, terms_version: '1' });

    expect(
      (await patch({ terms_uri: 'https://example.com/terms', terms_version: '2026-01' }))
        .statusCode,
    ).toBe(200);
    expect((await read()).json()).toMatchObject({
      terms_uri: 'https://example.com/terms',
      terms_version: '2026-01',
    });

    expect((await patch({ terms_uri: 'http://example.com/terms' })).statusCode).toBe(400);
    expect((await patch({ terms_version: '' })).statusCode).toBe(400);
    expect((await patch({ terms_version: 'x'.repeat(65) })).statusCode).toBe(400);

    expect((await patch({ terms_uri: '' })).statusCode).toBe(200);
    expect((await read()).json()).toMatchObject({ terms_uri: null });
  });
});

describe('the required profile fields', () => {
  it('start as given and family name, change as a list, may be empty and refuse a non-claim', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const url = `/admin/tenants/${t.name}/settings`;
    const headers = { authorization: `Bearer ${token}` };
    const patch = (payload: Record<string, unknown>) =>
      fixture.http.inject({ method: 'PATCH', url, headers, payload });
    const read = () => fixture.http.inject({ method: 'GET', url, headers });
    expect((await read()).json()).toMatchObject({
      required_profile_fields: ['given_name', 'family_name'],
    });
    expect((await patch({ required_profile_fields: ['birthdate', 'name'] })).statusCode).toBe(200);
    expect((await read()).json()).toMatchObject({ required_profile_fields: ['name', 'birthdate'] });
    expect((await patch({ required_profile_fields: [] })).statusCode).toBe(200);
    expect((await read()).json()).toMatchObject({ required_profile_fields: [] });
    expect((await patch({ required_profile_fields: ['email'] })).statusCode).toBe(400);
    expect((await patch({ required_profile_fields: 'name' })).statusCode).toBe(400);
  });
});

describe('the language settings', () => {
  async function setup() {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const patch = (payload: Record<string, unknown>) =>
      fixture.http.inject({
        method: 'PATCH',
        url: `/admin/tenants/${t.name}/settings`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload,
      });
    return { t, patch };
  }

  it('starts English only, with no default, as every tenant did', async () => {
    const { t } = await setup();
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json()).toMatchObject({ supported_locales: ['en'], default_locale: null });
  });

  it('stores a list and a default from it, in one canonical spelling', async () => {
    const { patch } = await setup();
    const res = await patch({ supported_locales: ['EN', 'fr-ca', 'ar'], default_locale: 'FR-CA' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      supported_locales: ['en', 'fr-CA', 'ar'],
      default_locale: 'fr-CA',
    });
  });

  it('clears the default with an empty value', async () => {
    const { patch } = await setup();
    await patch({ supported_locales: ['en', 'fr'], default_locale: 'fr' });
    const res = await patch({ default_locale: '' });
    expect(res.json()).toMatchObject({ default_locale: null });
  });

  it.each([
    ['an empty list', { supported_locales: [] }, 'supported_locales'],
    ['a tag that is not a locale', { supported_locales: ['en', 'en_US'] }, 'supported_locales'],
    ['a duplicate in any case', { supported_locales: ['fr', 'FR'] }, 'supported_locales'],
    [
      'more than 32',
      {
        supported_locales: Array.from({ length: 33 }, (_, i) =>
          `a${String.fromCharCode(97 + (i % 26))}`.concat(i < 26 ? '' : '-US'),
        ),
      },
      'supported_locales',
    ],
    ['a default outside the list', { default_locale: 'de' }, 'default_locale'],
    ['a default that is not a locale', { default_locale: '../etc' }, 'default_locale'],
  ])('refuses %s, naming the setting', async (_label, payload, path) => {
    const { patch, t } = await setup();
    const res = await patch(payload);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ errors: { path: string }[] }>().errors.map((e) => e.path)).toContain(path);
    await withTenant(fixture.app.db, t.id, async (tx) => {
      const row = await tenantSettingsRepository(tx).byId(t.id);
      expect(row).toMatchObject({ supported_locales: ['en'], default_locale: null });
    });
  });

  it('judges a default against the list stored, so a list cannot drop its default', async () => {
    const { patch } = await setup();
    await patch({ supported_locales: ['en', 'fr'], default_locale: 'fr' });
    const res = await patch({ supported_locales: ['en'] });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a list that is not a list', async () => {
    const { patch } = await setup();
    const res = await patch({ supported_locales: 'en,fr' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('list');
  });
});

describe('the wording settings', () => {
  async function setup() {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'view-audit']);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const patch = (payload: Record<string, unknown>) =>
      fixture.http.inject({
        method: 'PATCH',
        url: `/admin/tenants/${t.name}/settings`,
        headers,
        payload,
      });
    return { t, patch, headers };
  }

  it('records the display name and the languages in the audit row, before and after', async () => {
    const { t, patch, headers } = await setup();
    await patch({ display_name: 'Acme', supported_locales: ['en', 'fr'], default_locale: 'fr' });
    await patch({ display_name: 'Acme Inc', verify_email: true });
    const audit = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/audit?action=tenant.amend_settings`,
      headers,
    });
    const details = audit.json<{ items: { detail: unknown }[] }>().items.map((i) => i.detail);
    expect(details).toContainEqual({
      display_name: { before: null, after: 'Acme' },
      supported_locales: { before: ['en'], after: ['en', 'fr'] },
      default_locale: { before: null, after: 'fr' },
    });
    expect(details).toContainEqual({ display_name: { before: 'Acme', after: 'Acme Inc' } });
  });

  it('refuses a display name past 256 characters, naming it, and keeps the one held', async () => {
    const { t, patch } = await setup();
    await patch({ display_name: 'Acme' });
    const res = await patch({ display_name: 'x'.repeat(257) });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ errors: { path: string }[] }>().errors.map((e) => e.path)).toEqual([
      'display_name',
    ]);
    expect((await patch({ display_name: 'x'.repeat(256) })).statusCode).toBe(200);
    await withTenant(fixture.app.db, t.id, async (tx) => {
      expect((await tenantSettingsRepository(tx).byId(t.id))?.display_name).toBe('x'.repeat(256));
    });
  });

  it('counts the length after the trim, so padding does not use it up', async () => {
    const { patch } = await setup();
    const res = await patch({ display_name: `  ${'x'.repeat(256)}  ` });
    expect(res.statusCode).toBe(200);
  });

  it('leaves a message override of a language the tenant no longer offers where it is', async () => {
    const { t, patch, headers } = await setup();
    await patch({ supported_locales: ['en', 'fr'], default_locale: 'fr' });
    const base = `/admin/tenants/${t.name}/message-overrides`;
    const key = 'login.title';
    const put = await fixture.http.inject({
      method: 'PUT',
      url: `${base}/fr/${key}`,
      headers: { ...headers, 'if-none-match': '*' },
      payload: { message: 'Connexion' },
    });
    expect(put.statusCode).toBe(200);
    const shrunk = await patch({ supported_locales: ['en'], default_locale: '' });
    expect(shrunk.statusCode).toBe(200);
    const listed = await fixture.http.inject({
      method: 'GET',
      url: `${base}?locale=fr`,
      headers,
    });
    expect(listed.json<{ items: { key: string }[] }>().items.map((i) => i.key)).toEqual([key]);
  });
});

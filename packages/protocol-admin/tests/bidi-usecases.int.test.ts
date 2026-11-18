import { BIDI_REFUSED_MESSAGE } from '@odudu/contracts';
import { type TenantScopedDatabase, withTenant } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_AMEND_MAIL } from '#/testing/amend-mail';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { amendClient } from '#/usecase/clients';
import { amendGroup } from '#/usecase/groups';
import { amendProfile } from '#/usecase/profile';
import { amendRole } from '#/usecase/roles';
import { amendScope } from '#/usecase/scopes';
import { amendSettings } from '#/usecase/settings';
import { amendSubject } from '#/usecase/subjects';
import { amendTenant } from '#/usecase/tenants';

// An amendment is judged in its usecase, before any write or audit row, so the
// refusal is a returned outcome naming the field. The repositories refuse the
// same value too, but by throwing out of a half-done transaction; each test
// here fails if the usecase's own check is deleted, because the call would
// then throw instead of returning.

const RLO = String.fromCodePoint(0x202e);

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const audit = (): Promise<void> => Promise.resolve();
const actor = {
  actorSubjectId: 'test',
  actorTenantId: 'test-tenant',
  actorClientId: 'test-client',
};
const caller = { ...actor, callerCapabilities: new Set<string>() };
const refused = (field: string) => ({
  kind: 'invalid_value',
  field,
  description: BIDI_REFUSED_MESSAGE,
});

async function post(tenant: string, token: string, path: string, payload: object): Promise<string> {
  const res = await fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenant}/${path}`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: JSON.stringify(payload),
  });
  expect(res.statusCode, res.payload).toBe(201);
  return res.json<{ id: string }>().id;
}

describe('each amendment usecase answers a bidirectional control as a field refusal', () => {
  it('on a role, group and scope', async () => {
    const t = await fixture.createTenant(`bidi-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const roleId = await post(t.name, token, 'roles', { name: 'r' });
    const groupId = await post(t.name, token, 'groups', { name: 'g' });
    const scopeId = await post(t.name, token, 'scopes', { name: 'orders' });
    const run = <T>(work: (tx: TenantScopedDatabase) => Promise<T>) =>
      withTenant(fixture.app.db, t.id, work);

    expect(
      await run((tx) =>
        amendRole(
          tx,
          { audit },
          { roleId, values: { description: `d${RLO}` }, ifMatch: undefined, ...actor },
        ),
      ),
    ).toEqual(refused('description'));
    expect(
      await run((tx) =>
        amendGroup(
          tx,
          { audit },
          { groupId, values: { description: `d${RLO}` }, ifMatch: undefined, ...caller },
        ),
      ),
    ).toEqual(refused('description'));
    expect(
      await run((tx) =>
        amendScope(
          tx,
          { audit },
          { scopeId, values: { description: `d${RLO}` }, ifMatch: undefined, ...actor },
        ),
      ),
    ).toEqual(refused('description'));
    expect(
      await run((tx) =>
        amendScope(
          tx,
          { audit },
          { scopeId, values: { consent_text: `c${RLO}` }, ifMatch: undefined, ...actor },
        ),
      ),
    ).toEqual(refused('consent_text'));
  });

  it('on a client name and description, a tenant display name and the settings door', async () => {
    const t = await fixture.createTenant(`bidi-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);
    const clientId = await post(t.name, token, 'clients', {
      client_id: `app-${newId()}`,
      redirect_uris: ['https://app.example/callback'],
      token_endpoint_auth_method: 'none',
    });
    const run = <T>(work: (tx: TenantScopedDatabase) => Promise<T>) =>
      withTenant(fixture.app.db, t.id, work);

    for (const field of ['name', 'description']) {
      expect(
        await run((tx) =>
          amendClient(
            tx,
            { audit, tlsClientAuthEnabled: false },
            {
              clientDbId: clientId,
              values: { [field]: `x${RLO}` },
              ifMatch: undefined,
              ...caller,
            },
          ),
        ),
      ).toEqual(refused(field));
    }
    expect(
      await run((tx) =>
        amendTenant(
          tx,
          { audit },
          { tenantId: t.id, values: { display_name: `A${RLO}` }, ifMatch: undefined, ...actor },
        ),
      ),
    ).toEqual(refused('display_name'));
    const settings = await run((tx) =>
      amendSettings(
        tx,
        { audit },
        { tenantId: t.id, values: { display_name: `A${RLO}` }, ifMatch: undefined, ...actor },
      ),
    );
    expect(settings).toEqual({
      kind: 'out_of_range',
      problems: [{ name: 'display_name', message: BIDI_REFUSED_MESSAGE }],
      ranged: false,
    });
  });

  it('on a username and a profile name', async () => {
    const t = await fixture.createTenant(`bidi-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users', 'manage-tenant']);
    const settings = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ username_editable: true }),
    });
    expect(settings.statusCode).toBe(200);
    const subjectId = await post(t.name, token, 'subjects', { username: `u-${newId()}` });
    const got = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const etag = String(got.headers.etag);
    const run = <T>(work: (tx: TenantScopedDatabase) => Promise<T>) =>
      withTenant(fixture.app.db, t.id, work);

    expect(
      await run((tx) =>
        amendSubject(
          tx,
          { audit, ...NO_AMEND_MAIL },
          { tenantId: t.id, subjectId, values: { username: `a${RLO}` }, ifMatch: etag, ...caller },
        ),
      ),
    ).toEqual(refused('username'));
    expect(
      await run((tx) =>
        amendProfile(
          tx,
          { audit },
          { subjectId, values: { given_name: `a${RLO}` }, ifMatch: undefined, ...caller },
        ),
      ),
    ).toEqual(refused('given_name'));
  });
});

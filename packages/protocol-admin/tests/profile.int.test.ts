import { withTenant } from '@odudu/db';
import { subjectRepository } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
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

function url(tenantName: string, subjectId: string): string {
  return `/admin/tenants/${tenantName}/subjects/${subjectId}/profile`;
}

async function getProfile(
  tenantName: string,
  subjectId: string,
  token: string,
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'GET',
    url: url(tenantName, subjectId),
    headers: { authorization: `Bearer ${token}` },
  });
}

async function patchProfile(
  tenantName: string,
  subjectId: string,
  token: string,
  body: Record<string, unknown>,
  ifMatch?: string,
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'PATCH',
    url: url(tenantName, subjectId),
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
    },
    payload: body,
  });
}

const FULL_PATCH = {
  name: 'Ada Lovelace',
  given_name: 'Ada',
  family_name: 'Lovelace',
  middle_name: 'Augusta',
  nickname: 'Ada',
  preferred_username: 'ada',
  profile: 'https://example.com/ada',
  picture: 'https://example.com/ada.png',
  website: 'https://ada.example.com',
  gender: 'female',
  birthdate: '1815-12-10',
  zoneinfo: 'Europe/London',
  locale: 'en-GB',
  phone_number: '+441234567890',
  address_formatted: '12 Downing St, London',
  address_street: '12 Downing St',
  address_locality: 'London',
  address_region: 'London',
  address_postal_code: 'SW1A 2AA',
  address_country: 'GB',
};

describe('GET /admin/tenants/{t}/subjects/{id}/profile', () => {
  it('shows every claim once amended', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `ada-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users', 'view-users']);

    const amend = await patchProfile(t.name, id, token, FULL_PATCH);
    expect(amend.statusCode).toBe(200);

    const res = await getProfile(t.name, id, token);
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBeDefined();
    const body = res.json<Record<string, unknown>>();
    expect(body).toMatchObject(FULL_PATCH);
    expect(body.email_verified).toBe(false);
    expect(body.phone_number_verified).toBe(false);
    expect(body.profile_updated_at).toEqual(expect.any(String));
  });

  it('answers 404 for an unknown subject', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await getProfile(t.name, newId(), token);
    expect(res.statusCode).toBe(404);
  });

  it('answers 404 for a service subject, which carries no profile', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const serviceSubjectId = await withTenant(fixture.app.db, t.id, async (tx) => {
      const subject = await subjectRepository(tx).create({ tenantId: t.id, type: 'service' });
      return subject.id;
    });

    const res = await getProfile(t.name, serviceSubjectId, token);
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /admin/tenants/{t}/subjects/{id}/profile', () => {
  it('changes the next /userinfo response and stamps profile_updated_at', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `ada-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users', 'view-users']);
    const client = await fixture.createConfidentialClient(t.name, {});

    const before = await getProfile(t.name, id, token);
    expect(before.json<{ profile_updated_at: string | null }>().profile_updated_at).toBeNull();

    const res = await patchProfile(t.name, id, token, { given_name: 'Ada' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ given_name: string | null }>().given_name).toBe('Ada');

    const after = await getProfile(t.name, id, token);
    expect(after.json<{ profile_updated_at: string | null }>().profile_updated_at).toEqual(
      expect.any(String),
    );

    const accessToken = await fixture.mintUserinfoAccessTokenForSubject(
      t.name,
      client,
      id,
      'openid profile',
    );
    const userinfo = await fixture.callUserinfo(t.name, accessToken);
    expect(userinfo.statusCode).toBe(200);
    expect(userinfo.json<{ given_name?: string }>().given_name).toBe('Ada');
  });

  it('setting email_verified makes the next token carry it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `ada-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users', 'view-users']);
    const client = await fixture.createConfidentialClient(t.name, {});

    // email itself is set through the subject route, which owns it; the
    // profile route only ever sets `email_verified` against it.
    const setEmail = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { email: `ada-${newId()}@example.com` },
    });
    expect(setEmail.statusCode).toBe(200);

    const res = await patchProfile(t.name, id, token, { email_verified: true });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ email_verified: boolean }>().email_verified).toBe(true);

    const accessToken = await fixture.mintUserinfoAccessTokenForSubject(
      t.name,
      client,
      id,
      'openid email',
    );
    const userinfo = await fixture.callUserinfo(t.name, accessToken);
    expect(userinfo.statusCode).toBe(200);
    expect(userinfo.json<{ email_verified?: boolean }>().email_verified).toBe(true);
  });

  it('refuses an unknown member with 400', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `ada-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await patchProfile(t.name, id, token, { favorite_color: 'blue' });
    expect(res.statusCode).toBe(400);
  });

  it('refuses email, naming the route that owns it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `ada-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await patchProfile(t.name, id, token, { email: 'ada@example.com' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail?: string }>().detail).toContain(
      '/admin/tenants/{tenant}/subjects/{id}',
    );
  });

  it('refuses username, naming the route that owns it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `ada-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await patchProfile(t.name, id, token, { username: 'someone-else' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail?: string }>().detail).toContain(
      '/admin/tenants/{tenant}/subjects/{id}',
    );
  });

  it('answers 404 for a service subject', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const serviceSubjectId = await withTenant(fixture.app.db, t.id, async (tx) => {
      const subject = await subjectRepository(tx).create({ tenantId: t.id, type: 'service' });
      return subject.id;
    });

    const res = await patchProfile(t.name, serviceSubjectId, token, { nickname: 'x' });
    expect(res.statusCode).toBe(404);
  });

  it('refuses a birthdate the shape does not admit', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `ada-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await patchProfile(t.name, id, token, { birthdate: '31/01/1990' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail?: string }>().detail).toContain('birthdate');
  });

  it('refuses verifying a phone_number that is not E.164, and writes nothing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `ada-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users', 'view-users']);

    const res = await patchProfile(t.name, id, token, {
      phone_number: '(415) 555-2671',
      phone_number_verified: true,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail?: string }>().detail).toContain(
      'phone_number must be E.164-shaped for phone_number_verified to be true',
    );

    const after = await getProfile(t.name, id, token);
    const body = after.json<{ phone_number: string | null; phone_number_verified: boolean }>();
    expect(body.phone_number).toBeNull();
    expect(body.phone_number_verified).toBe(false);
  });

  it('accepts unverifying and changing the number in one PATCH, in either order', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `ada-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users', 'view-users']);

    const verify = await patchProfile(t.name, id, token, {
      phone_number: '+14155552671',
      phone_number_verified: true,
    });
    expect(verify.statusCode).toBe(200);

    // A write that once ran `updateProfile` (the new, malformed number)
    // before `setVerification` (unverifying) would have hit
    // `users_verified_phone_is_e164` between the two statements, since the
    // row briefly carried the new number against the still-true flag.
    const res = await patchProfile(t.name, id, token, {
      phone_number: '555-2671',
      phone_number_verified: false,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ phone_number: string | null; phone_number_verified: boolean }>();
    expect(body.phone_number).toBe('555-2671');
    expect(body.phone_number_verified).toBe(false);
  });

  it('resets phone_number_verified to false when phone_number changes without it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `ada-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users', 'view-users']);

    const verify = await patchProfile(t.name, id, token, {
      phone_number: '+14155552671',
      phone_number_verified: true,
    });
    expect(verify.statusCode).toBe(200);

    const res = await patchProfile(t.name, id, token, { phone_number: '+442083661177' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ phone_number: string | null; phone_number_verified: boolean }>();
    expect(body.phone_number).toBe('+442083661177');
    expect(body.phone_number_verified).toBe(false);
  });

  it('leaves phone_number_verified untouched when the same number is resubmitted', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `ada-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users', 'view-users', 'view-audit']);

    const verify = await patchProfile(t.name, id, token, {
      phone_number: '+14155552671',
      phone_number_verified: true,
    });
    expect(verify.statusCode).toBe(200);

    // An echoed full-object PATCH carries `phone_number` on every call,
    // whether or not it changed — the reset must compare the submitted
    // value against the stored one, not merely notice the field was sent.
    const res = await patchProfile(t.name, id, token, { phone_number: '+14155552671' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ phone_number: string | null; phone_number_verified: boolean }>();
    expect(body.phone_number).toBe('+14155552671');
    expect(body.phone_number_verified).toBe(true);

    const audit = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/audit`,
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = audit
      .json<{ items: { action: string; resource_id: string; detail: Record<string, unknown> }[] }>()
      .items.filter((item) => item.action === 'subject.profile_amend' && item.resource_id === id);
    // Two amendments were made: the initial verify, then the resubmit
    // that changed nothing — newest first, so rows[0] is the resubmit.
    // Its diff is empty: neither the number nor the flag actually moved.
    expect(rows).toHaveLength(2);
    expect(rows[0]?.detail).toEqual({});
  });

  it('honours If-Match when present, and refuses a stale one with 412', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `ada-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users', 'view-users']);

    const read = await getProfile(t.name, id, token);
    const etag = read.headers.etag;
    if (typeof etag !== 'string') throw new Error('expected GET to answer an ETag');

    const stale = await patchProfile(t.name, id, token, { nickname: 'x' }, '"not-the-right-etag"');
    expect(stale.statusCode).toBe(412);

    const matching = await patchProfile(t.name, id, token, { nickname: 'x' }, etag);
    expect(matching.statusCode).toBe(200);
  });

  it('accepts a PATCH with no If-Match at all', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `ada-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await patchProfile(t.name, id, token, { nickname: 'x' });
    expect(res.statusCode).toBe(200);
  });

  it('records a redacted diff in the audit trail, marking address changed rather than by value', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `ada-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users', 'view-audit']);

    const res = await patchProfile(t.name, id, token, {
      nickname: 'ally',
      address_street: '221B Baker St',
    });
    expect(res.statusCode).toBe(200);

    const audit = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/audit`,
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = audit
      .json<{ items: { action: string; resource_id: string; detail: Record<string, unknown> }[] }>()
      .items.filter((item) => item.action === 'subject.profile_amend' && item.resource_id === id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail.nickname).toEqual({ before: null, after: 'ally' });
    expect(rows[0]?.detail.address_street).toEqual({ changed: true });
    expect(JSON.stringify(rows[0]?.detail)).not.toContain('221B Baker St');
  });
});

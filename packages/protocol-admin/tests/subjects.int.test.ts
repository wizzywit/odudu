import { requiredActionRepository } from '@odudu/authn-flows';
import { generateTotpSecret, totpCode, totpCounter } from '@odudu/crypto';
import { withTenant, type TenantScopedDatabase } from '@odudu/db';
import { groupRepository, roleRepository } from '@odudu/domain-authz';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userRepository,
} from '@odudu/domain-identity';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  MANAGE_TENANTS,
  SYSTEM_TENANT_NAME,
  TENANT_ADMIN,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { etagOf } from '#/service/etag';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import {
  amendSubject,
  createSubject,
  deleteCredential,
  deleteSubject,
  setRequiredActions,
  setRoles,
  setSubjectGroups,
  type SubjectAuditEvent,
} from '#/usecase/subjects';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

describe('POST /admin/tenants/{t}/subjects', () => {
  it('creates a user subject that then appears in the listing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const username = `ada-${newId()}`;
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { username, email: `${username}@example.com` },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<{ id: string; username: string | null; type: string }>();
    expect(created.username).toBe(username);
    expect(created.type).toBe('user');

    const list = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    const listed = list.json<{ items: { username: string | null }[] }>().items;
    expect(listed.map((s) => s.username)).toContain(username);
  });

  // The other half of "no password field": a created subject owes
  // update-password rather than simply having none, which is what makes
  // the refusal below safe rather than merely strict — without this, an
  // operator-created account would authenticate with no factor at all.
  it('writes an update-password required action for the created subject', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { username: `owed-${newId()}` },
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json<{ id: string }>();

    const pending = await withTenant(fixture.app.db, t.id, (tx) =>
      requiredActionRepository(tx).pendingFor(id),
    );
    expect(pending).toEqual(['update-password']);
  });

  // No password field exists on this door: creating a subject writes an
  // update-password required action instead, so no operator ever handles a
  // user's password. Zod's default `additionalProperties: false` is what
  // refuses it; this pins the rule rather than the mechanism.
  it('refuses a password field on the request', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { username: `x-${newId()}`, password: 'hunter2' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { username: `x-${newId()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a duplicate username with 409', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const payload = { username: `dup-${newId()}` };
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const url = `/admin/tenants/${t.name}/subjects`;

    const first = await fixture.http.inject({ method: 'POST', url, headers, payload });
    expect(first.statusCode).toBe(201);

    const second = await fixture.http.inject({ method: 'POST', url, headers, payload });
    expect(second.statusCode).toBe(409);
  });

  it('refuses a malformed email with 400', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { username: `x-${newId()}`, email: 'not-an-address' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a duplicate email with 409', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const url = `/admin/tenants/${t.name}/subjects`;
    const email = `dup-${newId()}@example.com`;

    const first = await fixture.http.inject({
      method: 'POST',
      url,
      headers,
      payload: { username: `a-${newId()}`, email },
    });
    expect(first.statusCode).toBe(201);

    const second = await fixture.http.inject({
      method: 'POST',
      url,
      headers,
      payload: { username: `b-${newId()}`, email },
    });
    expect(second.statusCode).toBe(409);
  });
});

describe('GET /admin/tenants/{t}/subjects', () => {
  // manage-users composes view-users (provisionAdminClient's own
  // viewCounterpart wiring), through role_composites — not a special case
  // in authorizeAdmin, so a caller holding only manage-users passes a read
  // route exactly like one holding view-users.
  it('is read by view-users, and by manage-users alone', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await fixture.createSubject(t.name, `bob-${newId()}`);
    for (const capability of ['view-users', 'manage-users']) {
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}/subjects`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('refuses a caller holding neither capability', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, []);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('carries ?username= into the next page link, so following it stays filtered', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const prefix = `carry-${newId()}`;
    await fixture.createSubject(t.name, `${prefix}-a`);
    await fixture.createSubject(t.name, `${prefix}-b`);
    await fixture.createSubject(t.name, `other-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const first = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects?username=${prefix}&limit=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    const link = first.headers.link;
    if (typeof link !== 'string') throw new Error('expected a Link header on a filtered page');
    const nextPath = /<([^>]+)>/.exec(link)?.[1];
    if (nextPath === undefined) throw new Error('expected a URL inside the Link header');
    expect(nextPath).toContain(`username=${prefix}`);

    const second = await fixture.http.inject({
      method: 'GET',
      url: nextPath,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.statusCode).toBe(200);
    const items = second.json<{ items: { username: string | null }[] }>().items;
    expect(items.map((s) => s.username)).toEqual([`${prefix}-b`]);
  });

  it('pages by cursor', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await fixture.createSubject(t.name, `page-a-${newId()}`);
    await fixture.createSubject(t.name, `page-b-${newId()}`);
    await fixture.createSubject(t.name, `page-c-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const first = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects?limit=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    const body = first.json<{ items: unknown[]; next?: string }>();
    expect(body.items.length).toBe(1);
    expect(body.next).toBeDefined();
    expect(first.headers.link).toContain('rel="next"');
  });

  it('lists a service subject, distinguishable by type', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await fixture.createConfidentialClient(t.name, {});
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects?limit=200`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: { type: string }[] }>().items;
    expect(items.some((s) => s.type === 'service')).toBe(true);
  });
});

async function seedUser(
  tenantId: string,
  username: string,
  email: string | null = null,
): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await userRepository(tx).create({ subjectId: subject.id, tenantId, username, email });
    return subject.id;
  });
}

function listSubjectsAt(
  tenantName: string,
  token: string,
  query: string,
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/subjects?${query}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

function usernamesOf(res: LightMyRequestResponse): (string | null)[] {
  return res.json<{ items: { username: string | null }[] }>().items.map((s) => s.username);
}

// PostgreSQL's own answer to "which usernames start with this prefix,
// case-folded", in the order a searched listing promises — the oracle the
// search is held to, so no expectation here folds a string in JavaScript.
async function foldedPrefixMatches(tenantId: string, prefix: string): Promise<string[]> {
  const rows = await fixture.owner.db.execute<{ username: string }>(sql`
    select username from users
     where tenant_id = ${tenantId} and starts_with(lower(username), lower(${prefix}))
     order by lower(username) collate "C", subject_id
  `);
  return rows.map((row) => row.username);
}

describe('GET /admin/tenants/{t}/subjects — search and exact filters', () => {
  it('finds a username case-insensitively', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await seedUser(t.id, 'ada.lovelace');
    await seedUser(t.id, 'grace.hopper');
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await listSubjectsAt(t.name, token, 'username=ADA');
    expect(res.statusCode).toBe(200);
    expect(usernamesOf(res)).toEqual(['ada.lovelace']);
  });

  it('orders matches by the folded username, then by id', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const name of ['ada-c', 'Ada-a', 'ADA-b', 'ada-a', 'bob']) await seedUser(t.id, name);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await listSubjectsAt(t.name, token, 'username=ada');
    expect(res.statusCode).toBe(200);
    const expected = await foldedPrefixMatches(t.id, 'ada');
    expect(expected).toHaveLength(4);
    expect(usernamesOf(res)).toEqual(expected);
  });

  it('pages a search one row at a time, returning each match once and in order', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const name of ['pg-b', 'PG-a', 'pg-c', 'other']) await seedUser(t.id, name);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const seen: (string | null)[] = [];
    let query = 'username=pg&limit=1';
    for (let page = 0; page < 5; page += 1) {
      const res = await listSubjectsAt(t.name, token, query);
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: { username: string | null }[]; next?: string }>();
      seen.push(...body.items.map((s) => s.username));
      if (body.next === undefined) break;
      query = `username=pg&limit=1&cursor=${encodeURIComponent(body.next)}`;
    }
    expect(seen).toEqual(await foldedPrefixMatches(t.id, 'pg'));
    expect(seen).toHaveLength(3);
  });

  it('reads _ and % as ordinary characters', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await seedUser(t.id, 'axb');
    await seedUser(t.id, 'a_b');
    await seedUser(t.id, 'a%b');
    const token = await fixture.adminToken(t.name, ['view-users']);

    expect(usernamesOf(await listSubjectsAt(t.name, token, 'username=a_b'))).toEqual(['a_b']);
    expect(usernamesOf(await listSubjectsAt(t.name, token, 'username=a%25'))).toEqual(['a%b']);
  });

  it.each([
    ['ÄR', 'ärger'],
    ['İz', 'İzmir'],
    ['ß', 'ßtraße'],
  ])('folds %s the way the column was folded, so it finds %s', async (prefix, username) => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await seedUser(t.id, username);
    await seedUser(t.id, 'zebra');
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await listSubjectsAt(t.name, token, `username=${encodeURIComponent(prefix)}`);
    expect(res.statusCode).toBe(200);
    expect(usernamesOf(res)).toEqual([username]);
    expect(usernamesOf(res)).toEqual(await foldedPrefixMatches(t.id, prefix));
  });

  it('searches by email prefix', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await seedUser(t.id, 'grace', 'grace@navy.example');
    await seedUser(t.id, 'ada', 'ada@analytical.example');
    await seedUser(t.id, 'nomail');
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await listSubjectsAt(t.name, token, 'email=GRACE%40');
    expect(res.statusCode).toBe(200);
    expect(usernamesOf(res)).toEqual(['grace']);
  });

  it('filters to disabled subjects with ?enabled=false, and to the rest with true', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const off = await seedUser(t.id, 'off');
    await seedUser(t.id, 'on');
    await withTenant(fixture.app.db, t.id, (tx) => subjectRepository(tx).setEnabled(off, false));
    const token = await fixture.adminToken(t.name, ['view-users']);

    const disabled = await listSubjectsAt(t.name, token, 'enabled=false&limit=200');
    expect(disabled.statusCode).toBe(200);
    const items = disabled.json<{ items: { id: string; enabled: boolean }[] }>().items;
    expect(items.map((s) => s.id)).toEqual([off]);

    const enabled = await listSubjectsAt(t.name, token, 'enabled=true&limit=200');
    const rest = enabled.json<{ items: { id: string; enabled: boolean }[] }>().items;
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((s) => s.enabled)).toBe(true);
  });

  it('filters to subjects directly assigned a role with ?role=', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const holder = await seedUser(t.id, 'holder');
    const viaGroup = await seedUser(t.id, 'via-group');
    await seedUser(t.id, 'bystander');
    const roleId = await withTenant(fixture.app.db, t.id, async (tx) => {
      const role = await roleRepository(tx).create({ tenantId: t.id, name: `r-${newId()}` });
      await roleRepository(tx).assignToSubject(holder, role.id);
      const group = await groupRepository(tx).create({
        tenantId: t.id,
        name: `g-${newId()}`,
        parentId: null,
      });
      await groupRepository(tx).mapRole(group.id, role.id);
      await groupRepository(tx).addToSubject(viaGroup, group.id);
      return role.id;
    });
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await listSubjectsAt(t.name, token, `role=${roleId}`);
    expect(res.statusCode).toBe(200);
    expect(usernamesOf(res)).toEqual(['holder']);
  });

  it('filters to a group direct members with ?group=', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const member = await seedUser(t.id, 'member');
    await seedUser(t.id, 'outsider');
    const groupId = await withTenant(fixture.app.db, t.id, async (tx) => {
      const group = await groupRepository(tx).create({
        tenantId: t.id,
        name: `g-${newId()}`,
        parentId: null,
      });
      await groupRepository(tx).addToSubject(member, group.id);
      return group.id;
    });
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await listSubjectsAt(t.name, token, `group=${groupId}`);
    expect(res.statusCode).toBe(200);
    expect(usernamesOf(res)).toEqual(['member']);
  });

  it('ANDs a search with an exact filter', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const off = await seedUser(t.id, 'dora-off');
    await seedUser(t.id, 'dora-on');
    await withTenant(fixture.app.db, t.id, (tx) => subjectRepository(tx).setEnabled(off, false));
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await listSubjectsAt(t.name, token, 'username=dora&enabled=false');
    expect(usernamesOf(res)).toEqual(['dora-off']);
  });

  it('finds nothing for a role id that belongs to another tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`acme-${newId()}`);
    await seedUser(t.id, 'here');
    const foreignRoleId = await withTenant(fixture.app.db, other.id, async (tx) => {
      const subject = await subjectRepository(tx).create({ tenantId: other.id, type: 'user' });
      const role = await roleRepository(tx).create({ tenantId: other.id, name: `r-${newId()}` });
      await roleRepository(tx).assignToSubject(subject.id, role.id);
      return role.id;
    });
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await listSubjectsAt(t.name, token, `role=${foreignRoleId}`);
    expect(res.statusCode).toBe(200);
    expect(usernamesOf(res)).toEqual([]);
  });

  it('refuses the retired ?search= parameter with 400 naming it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await listSubjectsAt(t.name, token, 'search=ada');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('search');
  });

  it('refuses a search over username and email at once', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await listSubjectsAt(t.name, token, 'username=a&email=b');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('one field at a time');
  });

  it('refuses an enabled value that is not true or false, and a role that is not a uuid', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    expect((await listSubjectsAt(t.name, token, 'enabled=yes')).statusCode).toBe(400);
    expect((await listSubjectsAt(t.name, token, 'role=admin')).statusCode).toBe(400);
  });

  it('refuses a prefix carrying NUL, which no text column can hold, with 400 rather than 500', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    expect((await listSubjectsAt(t.name, token, 'username=a%00')).statusCode).toBe(400);
  });

  it('refuses a cursor minted under one search when replayed under another', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await seedUser(t.id, 'ab-1');
    await seedUser(t.id, 'ab-2');
    await seedUser(t.id, 'b-1');
    await seedUser(t.id, 'b-2');
    const token = await fixture.adminToken(t.name, ['view-users']);

    const first = await listSubjectsAt(t.name, token, 'username=a&limit=1');
    const next = first.json<{ next?: string }>().next;
    if (next === undefined) throw new Error('expected a next cursor');

    const replayed = await listSubjectsAt(
      t.name,
      token,
      `username=b&limit=1&cursor=${encodeURIComponent(next)}`,
    );
    expect(replayed.statusCode).toBe(400);
    expect(replayed.json<{ detail: string }>().detail).toBe('cursor is invalid or expired');
  });

  it.each([
    ['a filter added', 'username=a&limit=1', 'username=a&enabled=true&limit=1'],
    ['a filter dropped', 'username=a&enabled=true&limit=1', 'username=a&limit=1'],
  ])('refuses a cursor replayed with %s', async (_label, minted, replayedUnder) => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await seedUser(t.id, 'ab-1');
    await seedUser(t.id, 'ab-2');
    const token = await fixture.adminToken(t.name, ['view-users']);

    const first = await listSubjectsAt(t.name, token, minted);
    const next = first.json<{ next?: string }>().next;
    if (next === undefined) throw new Error('expected a next cursor');

    const replayed = await listSubjectsAt(
      t.name,
      token,
      `${replayedUnder}&cursor=${encodeURIComponent(next)}`,
    );
    expect(replayed.statusCode).toBe(400);
    expect(replayed.json<{ detail: string }>().detail).toBe('cursor is invalid or expired');
  });

  it('finds nothing for a group id that belongs to another tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`acme-${newId()}`);
    await seedUser(t.id, 'here');
    const foreignGroupId = await withTenant(fixture.app.db, other.id, async (tx) => {
      const subject = await subjectRepository(tx).create({ tenantId: other.id, type: 'user' });
      const group = await groupRepository(tx).create({
        tenantId: other.id,
        name: `g-${newId()}`,
        parentId: null,
      });
      await groupRepository(tx).addToSubject(subject.id, group.id);
      return group.id;
    });
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await listSubjectsAt(t.name, token, `group=${foreignGroupId}`);
    expect(res.statusCode).toBe(200);
    expect(usernamesOf(res)).toEqual([]);
  });
});

describe('GET /admin/tenants/{t}/subjects/{id}', () => {
  it('returns the subject with an ETag pinned to the body', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `read-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe(etagOf(res.json()));
  });

  it('404s an id no subject holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${newId()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// The role id a tenant's own admin client carries for a capability name —
// what a PUT .../roles body names, and what the ceiling tests below assign
// to smuggle (or legitimately hold) an escalation.
async function capabilityRoleId(tenantId: string, name: string): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const adminClient = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    if (adminClient === null) throw new Error('fixture: tenant has no built-in admin client');
    const role = await roleRepository(tx).byName(name, adminClient.id);
    if (role === null) throw new Error(`fixture: no role named ${JSON.stringify(name)}`);
    return role.id;
  });
}

// A role that composites to `tenant-admin` without itself being named
// `tenant-admin` — the capability ceiling has to catch this through
// role_composites, not through a name comparison on the request body.
async function roleNestingTenantAdmin(tenantId: string): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const nested = await roleRepository(tx).create({ tenantId, name: `nests-admin-${newId()}` });
    const tenantAdminId = await capabilityRoleId(tenantId, TENANT_ADMIN);
    await roleRepository(tx).addComposite(nested.id, tenantAdminId);
    return nested.id;
  });
}

function putRoles(
  tenantName: string,
  subjectId: string,
  token: string,
  roleIds: string[],
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'PUT',
    url: `/admin/tenants/${tenantName}/subjects/${subjectId}/roles`,
    headers: {
      'if-match': '*',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    payload: { role_ids: roleIds },
  });
}

describe('PUT /admin/tenants/{t}/subjects/{id}/roles — the capability ceiling', () => {
  it('refuses a manage-users-only caller assigning tenant-admin', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const tenantAdminId = await capabilityRoleId(t.id, TENANT_ADMIN);

    const res = await putRoles(t.name, targetId, token, [tenantAdminId]);
    expect(res.statusCode).toBe(403);
  });

  it('leaves a row in the audit trail naming what the caller did not hold', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users', 'view-audit']);
    const tenantAdminId = await capabilityRoleId(t.id, TENANT_ADMIN);

    expect((await putRoles(t.name, targetId, token, [tenantAdminId])).statusCode).toBe(403);

    const audit = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/audit`,
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = audit
      .json<{ items: { action: string; outcome: string; resource_id: string }[] }>()
      .items.filter((item) => item.action === 'subject.roles_set');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'refused', resource_id: targetId });
  });

  it('refuses the same escalation in the system tenant, for manage-tenants', async () => {
    const { id: targetId } = await fixture.createSubject(SYSTEM_TENANT_NAME, `target-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-users']);
    const manageTenantsId = await capabilityRoleId(fixture.systemTenantId, MANAGE_TENANTS);

    const res = await putRoles(SYSTEM_TENANT_NAME, targetId, token, [manageTenantsId]);
    expect(res.statusCode).toBe(403);
  });

  it('lets a tenant-admin holder assign manage-users freely', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const manageUsersId = await capabilityRoleId(t.id, 'manage-users');

    const res = await putRoles(t.name, targetId, token, [manageUsersId]);
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: { name: string }[] }>().items;
    expect(items.map((r) => r.name)).toContain('manage-users');
  });

  it('refuses a composite that nests tenant-admin rather than naming it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const nestedRoleId = await roleNestingTenantAdmin(t.id);

    const res = await putRoles(t.name, targetId, token, [nestedRoleId]);
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /admin/tenants/{t}/subjects/{id}/roles', () => {
  it('replaces a subject role assignment, and a removed role stops appearing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const viewUsersId = await capabilityRoleId(t.id, 'view-users');
    const manageUsersId = await capabilityRoleId(t.id, 'manage-users');

    const first = await putRoles(t.name, targetId, token, [viewUsersId]);
    expect(first.statusCode).toBe(200);

    const second = await putRoles(t.name, targetId, token, [manageUsersId]);
    expect(second.statusCode).toBe(200);
    const items = second.json<{ items: { id: string; name: string }[] }>().items;
    expect(items.map((r) => r.id)).toEqual([manageUsersId]);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const viewUsersId = await capabilityRoleId(t.id, 'view-users');

    const res = await putRoles(t.name, targetId, token, [viewUsersId]);
    expect(res.statusCode).toBe(403);
  });

  it('400s a role id that is not an id at all, not 500', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);

    const res = await putRoles(t.name, targetId, token, ['not-a-uuid']);
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /admin/tenants/{t}/subjects/{id}', () => {
  it('amends email and enabled', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `pat-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { email: 'ada@example.com', enabled: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ email: string | null; enabled: boolean }>();
    expect(body.email).toBe('ada@example.com');
    expect(body.enabled).toBe(false);
  });

  // Regression for a partial write: `enabled` used to be written before
  // `email` was validated, so a refusal on `email` still committed the
  // disable. A service subject has no `users` row, which is what makes
  // `email` refuse here — the write of `enabled` must not survive that.
  it('refuses email on a service subject with 400, and leaves it enabled', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const serviceSubjectId = await withTenant(fixture.app.db, t.id, async (tx) => {
      const row = await clientRepository(tx).byId(client.id);
      if (row?.serviceSubjectId === null || row?.serviceSubjectId === undefined) {
        throw new Error('fixture: confidential client has no service subject');
      }
      return row.serviceSubjectId;
    });
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${serviceSubjectId}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: false, email: 'ops@example.com' },
    });
    expect(res.statusCode).toBe(400);

    const after = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${serviceSubjectId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.json<{ enabled: boolean }>().enabled).toBe(true);
  });

  it('refuses a malformed email with 400 and writes nothing, enabled included', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `pat-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: false, email: 'x' },
    });
    expect(res.statusCode).toBe(400);

    const after = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = after.json<{ enabled: boolean; email: string | null }>();
    expect(body.enabled).toBe(true);
    expect(body.email).toBeNull();
  });

  it('repeating a disable is a no-op for the timestamp', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `pat-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const first = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers,
      payload: { enabled: false },
    });
    expect(first.statusCode).toBe(200);
    const disabledAt = await withTenant(fixture.app.db, t.id, (tx) =>
      subjectRepository(tx).byId(id),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers,
      payload: { enabled: false },
    });
    expect(second.statusCode).toBe(200);
    const stillDisabledAt = await withTenant(fixture.app.db, t.id, (tx) =>
      subjectRepository(tx).byId(id),
    );

    expect(stillDisabledAt?.disabledAt?.getTime()).toBe(disabledAt?.disabledAt?.getTime());
  });

  it('answers 412 when If-Match no longer matches', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `pat-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': '"stale"',
      },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(412);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `pat-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /admin/tenants/{t}/subjects/{id}', () => {
  it('removes the subject and detaches a client that named it as its service account', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const serviceSubjectId = await withTenant(fixture.app.db, t.id, async (tx) => {
      const row = await clientRepository(tx).byId(client.id);
      if (row?.serviceSubjectId === null || row?.serviceSubjectId === undefined) {
        throw new Error('fixture: confidential client has no service subject');
      }
      return row.serviceSubjectId;
    });
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${serviceSubjectId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);

    const survived = await withTenant(fixture.app.db, t.id, (tx) =>
      clientRepository(tx).byId(client.id),
    );
    expect(survived?.serviceSubjectId).toBeNull();
    expect(survived?.tenantId).toBe(t.id);
  });

  it('404s an id no subject holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${newId()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `del-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /admin/tenants/{t}/subjects/{id}/required-actions', () => {
  it('sets the list', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `req-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/subjects/${id}/required-actions`,
      headers: {
        'if-match': '*',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { actions: ['configure-totp', 'generate-recovery-codes'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ actions: string[] }>().actions.sort()).toEqual(
      ['configure-totp', 'generate-recovery-codes'].sort(),
    );

    // A second PUT that omits one clears it — a replacement, not a merge.
    const replaced = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/subjects/${id}/required-actions`,
      headers: {
        'if-match': '*',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { actions: ['configure-totp'] },
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json<{ actions: string[] }>().actions).toEqual(['configure-totp']);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `req-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/subjects/${id}/required-actions`,
      headers: {
        'if-match': '*',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { actions: ['configure-totp'] },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /admin/tenants/{t}/subjects/{id}/credentials', () => {
  it('carries type, created_at and a recovery-code count, never a secret', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `cred-${newId()}`);
    await withTenant(fixture.app.db, t.id, async (tx) => {
      await credentialRepository(tx).insert({
        tenantId: t.id,
        subjectId: id,
        type: 'password',
        secret: { kind: 'password', hash: await hashPassword('correct horse battery staple') },
      });
      await credentialRepository(tx).insert({
        tenantId: t.id,
        subjectId: id,
        type: 'recovery-code',
        secret: { kind: 'recovery-code', hash: await hashPassword('one-of-ten') },
      });
    });
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${id}/credentials`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);

    // The serialised body, not a mapped object — a leak through a field
    // the wire mapping forgot to omit would not show up any other way.
    expect(res.body).not.toContain('secret_data');
    expect(res.body).not.toContain('hash');

    const items = res.json<{
      items: {
        id?: string;
        type: string;
        created_at: string;
        expired?: boolean;
        recovery_code_count?: number;
      }[];
    }>().items;
    const password = items.find((c) => c.type === 'password');
    expect(password?.expired).toBe(false);
    const recovery = items.find((c) => c.type === 'recovery-code');
    expect(recovery?.recovery_code_count).toBe(1);
    expect(recovery?.id).toBeUndefined();
  });

  it('refuses a caller holding neither view-users nor manage-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `cred-${newId()}`);
    const token = await fixture.adminToken(t.name, []);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${id}/credentials`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /admin/tenants/{t}/subjects/{id}/credentials/{credentialId}', () => {
  const REDIRECT_URI = 'https://app.example/callback';
  // RFC 7636 Appendix B's worked example.
  const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const PASSWORD = 'correct horse battery staple';

  function authorizeUrl(tenantName: string, clientId: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: 'openid',
      state: 'xyz',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
    });
    return `/tenants/${tenantName}/protocol/openid-connect/auth?${params.toString()}`;
  }

  async function startAuthSession(tenantName: string, clientId: string): Promise<string> {
    const authorize = await fixture.http.inject({ url: authorizeUrl(tenantName, clientId) });
    if (authorize.statusCode !== 200) {
      throw new Error(
        `expected /authorize to render the login form, got ${String(authorize.statusCode)}`,
      );
    }
    const match = /name="auth_session_id" value="([^"]*)"/.exec(authorize.body);
    const authSessionId = match?.[1];
    if (authSessionId === undefined) throw new Error('auth_session_id not found in the login form');
    return authSessionId;
  }

  function submit(
    tenantName: string,
    fields: Record<string, string>,
  ): Promise<LightMyRequestResponse> {
    return fixture.http.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/login-actions/authenticate`,
      payload: new URLSearchParams(fields).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  }

  async function redeemCode(
    tenantName: string,
    clientId: string,
    clientSecret: string,
    code: string,
  ): Promise<LightMyRequestResponse> {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
    });
    return fixture.http.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/protocol/openid-connect/token`,
      payload: form.toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
    });
  }

  it('removes a TOTP enrolment, and the subject then logs in without it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {
      grantTypes: ['authorization_code'],
      redirectUris: [REDIRECT_URI],
    });
    const username = `mfa-${newId()}`;

    const { subjectId, credentialId, totpSecret } = await withTenant(
      fixture.app.db,
      t.id,
      async (tx) => {
        const subject = await subjectRepository(tx).create({ tenantId: t.id, type: 'user' });
        await userRepository(tx).create({ subjectId: subject.id, tenantId: t.id, username });
        await credentialRepository(tx).insert({
          tenantId: t.id,
          subjectId: subject.id,
          type: 'password',
          secret: { kind: 'password', hash: await hashPassword(PASSWORD) },
        });
        const secret = generateTotpSecret();
        await credentialRepository(tx).insert({
          tenantId: t.id,
          subjectId: subject.id,
          type: 'totp',
          secret: { kind: 'totp', secret, digits: 6, lastStep: 0 },
        });
        const [row] = await credentialRepository(tx).listFor(subject.id, 'totp');
        if (row === undefined) throw new Error('fixture: no totp credential row after insert');
        return { subjectId: subject.id, credentialId: row.id, totpSecret: secret };
      },
    );

    // Prove the second factor is actually required before removing it —
    // otherwise this test could pass with delete doing nothing.
    const firstSession = await startAuthSession(t.name, client.clientId);
    const challenged = await submit(t.name, {
      auth_session_id: firstSession,
      username,
      password: PASSWORD,
    });
    expect(challenged.statusCode).toBe(200);
    expect(challenged.body).toContain('name="code"');
    const completed = await submit(t.name, {
      auth_session_id: firstSession,
      code: totpCode(totpSecret, totpCounter(new Date())),
    });
    expect(completed.statusCode).toBe(302);

    const adminToken = await fixture.adminToken(t.name, ['manage-users']);
    const deleteRes = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}/credentials/${credentialId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(deleteRes.statusCode).toBe(204);

    // A fresh login: password alone now completes it, without the OTP
    // step the first login above proved was required.
    const secondSession = await startAuthSession(t.name, client.clientId);
    const afterDelete = await submit(t.name, {
      auth_session_id: secondSession,
      username,
      password: PASSWORD,
    });
    expect(afterDelete.statusCode).toBe(302);
    const location = afterDelete.headers.location;
    if (typeof location !== 'string') throw new Error('expected a location header');
    const code = new URL(location).searchParams.get('code');
    expect(code).not.toBeNull();
    if (code === null) throw new Error('expected a code on the post-delete login redirect');

    const redeemed = await redeemCode(t.name, client.clientId, client.secret, code);
    expect(redeemed.statusCode).toBe(200);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `cred-${newId()}`);
    const credentialId = await withTenant(fixture.app.db, t.id, async (tx) => {
      await credentialRepository(tx).insert({
        tenantId: t.id,
        subjectId: id,
        type: 'totp',
        secret: { kind: 'totp', secret: generateTotpSecret(), digits: 6, lastStep: 0 },
      });
      const [row] = await credentialRepository(tx).listFor(id, 'totp');
      if (row === undefined) throw new Error('fixture: no totp credential after insert');
      return row.id;
    });
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${id}/credentials/${credentialId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// Every usecase in this file takes `audit` as a dependency rather than
// calling a sink directly (the same seam #/usecase/clients.ts and
// #/usecase/tenants.ts use) — these drive the usecases directly, the way
// clients.int.test.ts's own `describe('createClient', ...)` does, so a
// mutation's exactly-once call and a refusal's zero calls are pinned
// without going through HTTP.
describe('audit', () => {
  function collector(): {
    events: SubjectAuditEvent[];
    audit: (tx: TenantScopedDatabase, e: SubjectAuditEvent) => Promise<void>;
  } {
    const events: SubjectAuditEvent[] = [];
    return {
      events,
      audit: (_tx, event) => {
        events.push(event);
        return Promise.resolve();
      },
    };
  }

  it('calls audit exactly once when it creates a subject', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { events, audit } = collector();
    await withTenant(fixture.app.db, t.id, (tx) =>
      createSubject(
        tx,
        { audit },
        {
          tenantId: t.id,
          username: `audited-${newId()}`,
          email: null,
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('subject.create');
  });

  it('calls audit exactly once on a successful amendment, and not on a refusal', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `amend-${newId()}`);

    const ok = collector();
    const amended = await withTenant(fixture.app.db, t.id, (tx) =>
      amendSubject(
        tx,
        { audit: ok.audit },
        {
          callerCapabilities: new Set<string>(),
          subjectId: id,
          values: { enabled: false },
          ifMatch: undefined,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(amended.kind).toBe('ok');
    expect(ok.events).toHaveLength(1);

    const refused = collector();
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      amendSubject(
        tx,
        { audit: refused.audit },
        {
          callerCapabilities: new Set<string>(),
          subjectId: id,
          values: { not_a_field: true },
          ifMatch: undefined,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('refused_field');
    expect(refused.events).toHaveLength(0);
  });

  it('calls audit exactly once on a successful delete, and not on not_found', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `del-${newId()}`);

    const ok = collector();
    const deleted = await withTenant(fixture.app.db, t.id, (tx) =>
      deleteSubject(
        tx,
        { audit: ok.audit },
        {
          callerCapabilities: new Set<string>(),
          subjectId: id,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(deleted.kind).toBe('deleted');
    expect(ok.events).toHaveLength(1);

    const refused = collector();
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      deleteSubject(
        tx,
        { audit: refused.audit },
        {
          callerCapabilities: new Set<string>(),
          subjectId: newId(),
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('not_found');
    expect(refused.events).toHaveLength(0);
  });

  it('calls audit exactly once removing a credential, and not when refused', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `cred-${newId()}`);
    const credentialId = await withTenant(fixture.app.db, t.id, async (tx) => {
      await credentialRepository(tx).insert({
        tenantId: t.id,
        subjectId: id,
        type: 'totp',
        secret: { kind: 'totp', secret: generateTotpSecret(), digits: 6, lastStep: 0 },
      });
      const [row] = await credentialRepository(tx).listFor(id, 'totp');
      if (row === undefined) throw new Error('fixture: no totp credential after insert');
      return row.id;
    });

    const ok = collector();
    const deleted = await withTenant(fixture.app.db, t.id, (tx) =>
      deleteCredential(
        tx,
        { audit: ok.audit },
        {
          callerCapabilities: new Set<string>(),
          subjectId: id,
          credentialId,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(deleted.kind).toBe('deleted');
    expect(ok.events).toHaveLength(1);

    const refused = collector();
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      deleteCredential(
        tx,
        { audit: refused.audit },
        {
          callerCapabilities: new Set<string>(),
          subjectId: id,
          credentialId: newId(),
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('not_found');
    expect(refused.events).toHaveLength(0);
  });

  it('calls audit exactly once setting required actions, and not on not_found', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `ra-${newId()}`);

    const ok = collector();
    const set = await withTenant(fixture.app.db, t.id, (tx) =>
      setRequiredActions(
        tx,
        { audit: ok.audit },
        {
          tenantId: t.id,
          subjectId: id,
          actions: ['configure-totp'],
          callerCapabilities: new Set<string>(),
          ifMatch: '*',
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(set.kind).toBe('ok');
    expect(ok.events).toHaveLength(1);

    const refused = collector();
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      setRequiredActions(
        tx,
        { audit: refused.audit },
        {
          tenantId: t.id,
          subjectId: newId(),
          actions: [],
          callerCapabilities: new Set<string>(),
          ifMatch: '*',
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('not_found');
    expect(refused.events).toHaveLength(0);
  });

  it('calls audit exactly once replacing roles, and not on a capability-ceiling refusal', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `roles-${newId()}`);
    const viewUsersId = await capabilityRoleId(t.id, 'view-users');
    const tenantAdminId = await capabilityRoleId(t.id, TENANT_ADMIN);

    const ok = collector();
    const set = await withTenant(fixture.app.db, t.id, (tx) =>
      setRoles(
        tx,
        { audit: ok.audit },
        {
          subjectId: id,
          roleIds: [viewUsersId],
          callerCapabilities: new Set(['manage-users', 'view-users']),
          ifMatch: '*',
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(set.kind).toBe('ok');
    expect(ok.events).toHaveLength(1);

    const refused = collector();
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      setRoles(
        tx,
        { audit: refused.audit },
        {
          subjectId: id,
          roleIds: [tenantAdminId],
          callerCapabilities: new Set(['manage-users', 'view-users']),
          ifMatch: '*',
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('capability_ceiling');
    // An attempted privilege escalation is the one refusal this phase
    // records, so the row is the assertion rather than its absence.
    expect(refused.events.map((event) => event.outcome)).toEqual(['refused']);
  });
});

async function createGroupMapped(
  tenantId: string,
  roleIds: readonly string[],
  parentId: string | null = null,
): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const group = await groupRepository(tx).create({ tenantId, name: `g-${newId()}`, parentId });
    for (const roleId of roleIds) await groupRepository(tx).mapRole(group.id, roleId);
    return group.id;
  });
}

function getGroups(
  tenantName: string,
  subjectId: string,
  token: string,
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/subjects/${subjectId}/groups`,
    headers: { authorization: `Bearer ${token}` },
  });
}

function putGroups(
  tenantName: string,
  subjectId: string,
  token: string,
  groupIds: string[],
  ifMatch: string | null = '*',
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'PUT',
    url: `/admin/tenants/${tenantName}/subjects/${subjectId}/groups`,
    headers: {
      ...(ifMatch === null ? {} : { 'if-match': ifMatch }),
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    payload: { group_ids: groupIds },
  });
}

function groupIdsOf(res: LightMyRequestResponse): string[] {
  return res.json<{ items: { id: string }[] }>().items.map((group) => group.id);
}

describe('GET|PUT /admin/tenants/{t}/subjects/{id}/groups', () => {
  it('replaces the membership set and reads it back under an ETag', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const a = await createGroupMapped(t.id, []);
    const b = await createGroupMapped(t.id, []);

    const empty = await getGroups(t.name, targetId, token);
    expect(empty.statusCode).toBe(200);
    expect(groupIdsOf(empty)).toEqual([]);
    const emptyEtag = empty.headers.etag;
    expect(typeof emptyEtag).toBe('string');

    const first = await putGroups(t.name, targetId, token, [a, b], String(emptyEtag));
    expect(first.statusCode).toBe(200);
    expect(groupIdsOf(first)).toEqual([a, b].sort());
    expect(first.json<{ items: { path: string }[] }>().items[0]?.path).toMatch(/^\/g-/);

    const read = await getGroups(t.name, targetId, token);
    expect(groupIdsOf(read)).toEqual([a, b].sort());
    expect(read.headers.etag).toBe(first.headers.etag);

    const second = await putGroups(t.name, targetId, token, [b], String(read.headers.etag));
    expect(second.statusCode).toBe(200);
    expect(groupIdsOf(await getGroups(t.name, targetId, token))).toEqual([b]);
  });

  it('answers 428 without If-Match and 412 for a stale one, and writes nothing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const a = await createGroupMapped(t.id, []);
    const staleEtag = String((await getGroups(t.name, targetId, token)).headers.etag);
    expect((await putGroups(t.name, targetId, token, [a])).statusCode).toBe(200);

    expect((await putGroups(t.name, targetId, token, [], null)).statusCode).toBe(428);
    expect((await putGroups(t.name, targetId, token, [], staleEtag)).statusCode).toBe(412);
    expect(groupIdsOf(await getGroups(t.name, targetId, token))).toEqual([a]);
  });

  it('400s an unknown group id, and one that is not an id at all', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const a = await createGroupMapped(t.id, []);
    const missing = newId();

    const unknown = await putGroups(t.name, targetId, token, [a, missing]);
    expect(unknown.statusCode).toBe(400);
    expect(unknown.body).toContain(missing);
    expect((await putGroups(t.name, targetId, token, ['not-a-uuid'])).statusCode).toBe(400);
    expect(groupIdsOf(await getGroups(t.name, targetId, token))).toEqual([]);
  });

  it('400s a group that belongs to another tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`other-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    // Mapped to tenant-admin in its own tenant: were it resolved at all, the
    // ceiling would refuse it with 403, so a 400 shows it was never found.
    const foreign = await createGroupMapped(other.id, [
      await capabilityRoleId(other.id, TENANT_ADMIN),
    ]);

    const res = await putGroups(t.name, targetId, token, [foreign]);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain(foreign);
    expect(groupIdsOf(await getGroups(t.name, targetId, token))).toEqual([]);
  });

  it('treats an id repeated in another letter case as one membership', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const a = await createGroupMapped(t.id, []);

    const res = await putGroups(t.name, targetId, token, [a, a.toUpperCase()]);
    expect(res.statusCode).toBe(200);
    expect(groupIdsOf(res)).toEqual([a]);
    expect(groupIdsOf(await getGroups(t.name, targetId, token))).toEqual([a]);
  });

  it('changes the ETag when a member group is reparented, and refuses the old one', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const member = await createGroupMapped(t.id, []);
    const newParent = await createGroupMapped(t.id, []);
    expect((await putGroups(t.name, targetId, token, [member])).statusCode).toBe(200);
    const before = await getGroups(t.name, targetId, token);

    const moved = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/groups/${member}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': '*',
      },
      payload: { parent_id: newParent },
    });
    expect(moved.statusCode).toBe(200);

    const after = await getGroups(t.name, targetId, token);
    expect(after.json<{ items: { path: string }[] }>().items[0]?.path).not.toBe(
      before.json<{ items: { path: string }[] }>().items[0]?.path,
    );
    expect(after.headers.etag).not.toBe(before.headers.etag);
    const stale = await putGroups(t.name, targetId, token, [], String(before.headers.etag));
    expect(stale.statusCode).toBe(412);
  });

  it('404s a subject no one holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    expect((await getGroups(t.name, newId(), token)).statusCode).toBe(404);
    expect((await putGroups(t.name, newId(), token, [])).statusCode).toBe(404);
  });

  it('is read by view-users, and refuses view-users a replacement', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    expect((await getGroups(t.name, targetId, token)).statusCode).toBe(200);
    expect((await putGroups(t.name, targetId, token, [])).statusCode).toBe(403);
  });

  it('reaches the groups claim of the subject’s next token', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {
      grantTypes: ['client_credentials'],
    });
    const serviceSubjectId = await withTenant(fixture.app.db, t.id, async (tx) => {
      const record = await clientRepository(tx).byClientId(client.clientId);
      return record?.serviceSubjectId ?? null;
    });
    if (serviceSubjectId === null) throw new Error('fixture: client has no service subject');
    const patched = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: {
        authorization: `Bearer ${await fixture.adminToken(t.name, ['manage-clients'])}`,
        'content-type': 'application/json',
        'if-match': '*',
      },
      payload: { client_credentials_scopes: ['groups'] },
    });
    expect(patched.statusCode).toBe(200);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const groupId = await createGroupMapped(t.id, []);
    const path = await withTenant(fixture.app.db, t.id, async (tx) => {
      const group = await groupRepository(tx).byId(groupId);
      return group?.path;
    });

    const claimOf = async (): Promise<unknown> => {
      const res = await fixture.tokenRequest(t.name, client, {
        grant_type: 'client_credentials',
        scope: 'groups',
      });
      expect(res.statusCode).toBe(200);
      const accessToken = res.json<{ access_token: string }>().access_token;
      const payload: unknown = JSON.parse(
        Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
      );
      return (payload as Record<string, unknown>).groups;
    };

    expect(await claimOf()).toBeUndefined();
    expect((await putGroups(t.name, serviceSubjectId, token, [groupId])).statusCode).toBe(200);
    expect(await claimOf()).toEqual([path]);
  });
});

// The ceiling looks at the whole resulting membership set, not only the
// groups being added — the same rule `PUT .../roles` applies to a role set.
describe('PUT /admin/tenants/{t}/subjects/{id}/groups — the capability ceiling', () => {
  it('refuses a manage-users-only caller joining a group mapped to tenant-admin, with a refused audit row, and leaves the membership unchanged', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users', 'view-audit']);
    const adminGroup = await createGroupMapped(t.id, [await capabilityRoleId(t.id, TENANT_ADMIN)]);

    const res = await putGroups(t.name, targetId, token, [adminGroup]);
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain(TENANT_ADMIN);

    const audit = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/audit`,
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = audit
      .json<{ items: { action: string; outcome: string; resource_id: string }[] }>()
      .items.filter((item) => item.action === 'subject.groups_set');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'refused', resource_id: targetId });

    expect(groupIdsOf(await getGroups(t.name, targetId, token))).toEqual([]);
  });

  it('refuses a group that inherits tenant-admin from an ancestor', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const parent = await createGroupMapped(t.id, [await capabilityRoleId(t.id, TENANT_ADMIN)]);
    const child = await createGroupMapped(t.id, [], parent);

    expect((await putGroups(t.name, targetId, token, [child])).statusCode).toBe(403);
  });

  it('refuses a group whose role nests tenant-admin through a composite', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const nesting = await createGroupMapped(t.id, [await roleNestingTenantAdmin(t.id)]);

    expect((await putGroups(t.name, targetId, token, [nesting])).statusCode).toBe(403);
  });

  // Removing the membership is refused too: the target holds tenant-admin
  // through it, which the caller does not (the target ceiling).
  it('refuses a set that keeps a membership the caller could not grant, and removing it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const adminGroup = await createGroupMapped(t.id, [await capabilityRoleId(t.id, TENANT_ADMIN)]);
    const plain = await createGroupMapped(t.id, []);
    await withTenant(fixture.app.db, t.id, (tx) =>
      groupRepository(tx).addToSubject(targetId, adminGroup),
    );

    expect((await putGroups(t.name, targetId, token, [adminGroup, plain])).statusCode).toBe(403);
    expect(groupIdsOf(await getGroups(t.name, targetId, token))).toEqual([adminGroup]);

    expect((await putGroups(t.name, targetId, token, [plain])).statusCode).toBe(403);
    expect(groupIdsOf(await getGroups(t.name, targetId, token))).toEqual([adminGroup]);
  });

  it('lets a tenant-admin holder join a group mapped to tenant-admin', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const adminGroup = await createGroupMapped(t.id, [await capabilityRoleId(t.id, TENANT_ADMIN)]);

    expect((await putGroups(t.name, targetId, token, [adminGroup])).statusCode).toBe(200);
  });

  it('refuses joining a group mapped to manage-tenants in the system tenant', async () => {
    const { id: targetId } = await fixture.createSubject(SYSTEM_TENANT_NAME, `target-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-users']);
    const group = await createGroupMapped(fixture.systemTenantId, [
      await capabilityRoleId(fixture.systemTenantId, MANAGE_TENANTS),
    ]);

    expect((await putGroups(SYSTEM_TENANT_NAME, targetId, token, [group])).statusCode).toBe(403);
  });
});

describe('setSubjectGroups audit', () => {
  it('calls audit exactly once on a replacement, and records a refusal on the ceiling', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `groups-${newId()}`);
    const plain = await createGroupMapped(t.id, []);
    const adminGroup = await createGroupMapped(t.id, [await capabilityRoleId(t.id, TENANT_ADMIN)]);
    const actor = {
      ifMatch: '*',
      actorSubjectId: 'test',
      actorTenantId: 'test-tenant',
      actorClientId: 'test-client',
      callerCapabilities: new Set(['manage-users']),
    };

    const ok: SubjectAuditEvent[] = [];
    const set = await withTenant(fixture.app.db, t.id, (tx) =>
      setSubjectGroups(
        tx,
        { audit: (_tx, event) => Promise.resolve(ok.push(event)).then(() => undefined) },
        { ...actor, subjectId: id, groupIds: [plain] },
      ),
    );
    expect(set.kind).toBe('ok');
    expect(ok.map((event) => [event.action, event.outcome])).toEqual([
      ['subject.groups_set', 'allowed'],
    ]);
    expect(ok[0]?.detail).toEqual({ group_ids: { before: [], after: [plain] } });

    const refused: SubjectAuditEvent[] = [];
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      setSubjectGroups(
        tx,
        { audit: (_tx, event) => Promise.resolve(refused.push(event)).then(() => undefined) },
        { ...actor, subjectId: id, groupIds: [adminGroup] },
      ),
    );
    expect(outcome.kind).toBe('capability_ceiling');
    expect(refused.map((event) => event.outcome)).toEqual(['refused']);
  });
});

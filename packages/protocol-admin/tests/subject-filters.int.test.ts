import { withTenant } from '@odudu/db';
import { groupRepository } from '@odudu/domain-authz';
import { loginFailures, subjectRepository, userRepository, users } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
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

async function seedUser(
  tenantId: string,
  username: string,
  claims: { name?: string; givenName?: string; familyName?: string } = {},
): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await userRepository(tx).create({ subjectId: subject.id, tenantId, username, email: null });
    await tx
      .update(users)
      .set({
        name: claims.name ?? null,
        givenName: claims.givenName ?? null,
        familyName: claims.familyName ?? null,
      })
      .where(eq(users.subjectId, subject.id));
    return subject.id;
  });
}

async function lockUntil(tenantId: string, subjectId: string, until: Date): Promise<void> {
  await withTenant(fixture.app.db, tenantId, async (tx) => {
    await tx.insert(loginFailures).values({
      tenantId,
      subjectId,
      failureCount: 5,
      firstFailureAt: until,
      lastFailureAt: until,
      lockedUntil: until,
    });
  });
}

function get(tenantName: string, token: string, tail: string): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/${tail}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

function idsOf(res: LightMyRequestResponse): string[] {
  return res.json<{ items: { id: string }[] }>().items.map((item) => item.id);
}

describe('GET /subjects?type=', () => {
  it('lists only the subjects of the named type, and counts the same', async () => {
    const t = await fixture.createTenant(`types-${newId()}`);
    const user = await seedUser(t.id, 'ada');
    const service = await withTenant(
      fixture.app.db,
      t.id,
      async (tx) => (await subjectRepository(tx).create({ tenantId: t.id, type: 'service' })).id,
    );
    const token = await fixture.adminToken(t.name, ['view-users']);

    const services = await get(t.name, token, 'subjects?type=service&limit=200');
    expect(services.statusCode).toBe(200);
    expect(idsOf(services)).toEqual([service]);

    const people = await get(t.name, token, 'subjects?type=user&limit=200');
    expect(idsOf(people)).toContain(user);
    expect(idsOf(people)).not.toContain(service);

    const count = await get(t.name, token, 'subjects/count?type=service');
    expect(count.json()).toEqual({ count: 1, capped: false });
  });

  it('refuses a type no subject can have with 400 naming it', async () => {
    const t = await fixture.createTenant(`types-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await get(t.name, token, 'subjects?type=robot');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe('type');
  });
});

describe('GET /subjects?locked=', () => {
  it('lists the subjects locked now, by the clock GET …/lockout judges with', async () => {
    const t = await fixture.createTenant(`locked-${newId()}`);
    const now = fixture.clock.now().getTime();
    const locked = await seedUser(t.id, 'locked');
    const lapsed = await seedUser(t.id, 'lapsed');
    const free = await seedUser(t.id, 'free');
    await lockUntil(t.id, locked, new Date(now + 60_000));
    await lockUntil(t.id, lapsed, new Date(now - 1_000));
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await get(t.name, token, 'subjects?locked=true&limit=200');
    expect(res.statusCode).toBe(200);
    expect(idsOf(res)).toEqual([locked]);

    const lockout = await get(t.name, token, `subjects/${lapsed}/lockout`);
    expect(lockout.json<{ locked: boolean }>().locked).toBe(false);

    const unlocked = idsOf(await get(t.name, token, 'subjects?locked=false&limit=200'));
    expect(unlocked).toEqual(expect.arrayContaining([lapsed, free]));
    expect(unlocked).not.toContain(locked);

    const count = await get(t.name, token, 'subjects/count?locked=true');
    expect(count.json()).toEqual({ count: 1, capped: false });
  });
});

describe('GET /subjects?name=, ?given_name=, ?family_name=', () => {
  it('finds a subject by a prefix of each claim, case-insensitively', async () => {
    const t = await fixture.createTenant(`claims-${newId()}`);
    const ada = await seedUser(t.id, 'u1', {
      name: 'Ada Lovelace',
      givenName: 'Ada',
      familyName: 'Lovelace',
    });
    const grace = await seedUser(t.id, 'u2', {
      name: 'Grace Hopper',
      givenName: 'Grace',
      familyName: 'Hopper',
    });
    await seedUser(t.id, 'u3');
    const token = await fixture.adminToken(t.name, ['view-users']);

    expect(idsOf(await get(t.name, token, 'subjects?name=ada%20l'))).toEqual([ada]);
    expect(idsOf(await get(t.name, token, 'subjects?given_name=GRA'))).toEqual([grace]);
    expect(idsOf(await get(t.name, token, 'subjects?family_name=love'))).toEqual([ada]);
    const count = await get(t.name, token, 'subjects/count?family_name=h');
    expect(count.json()).toEqual({ count: 1, capped: false });
  });

  it('never matches name against the username a name claim would fall back to', async () => {
    const t = await fixture.createTenant(`claims-${newId()}`);
    await seedUser(t.id, 'lovelace');
    const token = await fixture.adminToken(t.name, ['view-users']);
    expect(idsOf(await get(t.name, token, 'subjects?name=love'))).toEqual([]);
  });

  it('pages a name search and keeps the search in the next link', async () => {
    const t = await fixture.createTenant(`claims-${newId()}`);
    const first = await seedUser(t.id, 'a', { name: 'Kim A' });
    const second = await seedUser(t.id, 'b', { name: 'Kim B' });
    const token = await fixture.adminToken(t.name, ['view-users']);

    const page = await get(t.name, token, 'subjects?name=kim&limit=1');
    expect(idsOf(page)).toEqual([first]);
    expect(page.headers.link).toContain('name=kim');
    const next = page.json<{ next: string }>().next;
    const rest = await get(t.name, token, `subjects?name=kim&limit=1&cursor=${next}`);
    expect(idsOf(rest)).toEqual([second]);
  });

  it('refuses two searches at once with 400', async () => {
    const t = await fixture.createTenant(`claims-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await get(t.name, token, 'subjects?name=a&username=b');
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /groups?parent=', () => {
  it('lists one level: a group’s children, or the roots, and counts the same', async () => {
    const t = await fixture.createTenant(`tree-${newId()}`);
    const { root, child, grandchild } = await withTenant(fixture.app.db, t.id, async (tx) => {
      const groups = groupRepository(tx);
      const top = await groups.create({ tenantId: t.id, name: 'eng', parentId: null });
      const mid = await groups.create({ tenantId: t.id, name: 'web', parentId: top.id });
      const low = await groups.create({ tenantId: t.id, name: 'css', parentId: mid.id });
      return { root: top.id, child: mid.id, grandchild: low.id };
    });
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    expect(idsOf(await get(t.name, token, `groups?parent=${root}`))).toEqual([child]);
    expect(idsOf(await get(t.name, token, `groups?parent=${child}`))).toEqual([grandchild]);
    expect(idsOf(await get(t.name, token, 'groups?parent=root'))).toEqual([root]);
    const count = await get(t.name, token, `groups/count?parent=${root}`);
    expect(count.json()).toEqual({ count: 1, capped: false });
  });

  it('refuses a parent that is neither a group id nor root with 400', async () => {
    const t = await fixture.createTenant(`tree-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await get(t.name, token, 'groups?parent=nope');
    expect(res.statusCode).toBe(400);
  });
});

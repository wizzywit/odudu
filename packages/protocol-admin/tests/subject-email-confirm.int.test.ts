import { completeEmailVerification } from '@odudu/account';
import { requiredActionRepository } from '@odudu/authn-flows';
import { tenants, withTenant } from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { auditRepository } from '@odudu/domain-audit';
import {
  lockEmailForCreation,
  pendingEmailRepository,
  subjectRepository,
  userRepository,
} from '@odudu/domain-identity';
import { emailOutbox } from '@odudu/email';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { readSubjectDetail } from '#/usecase/subjects';

let relayedHandle: AdminFixture | undefined;
let bareHandle: AdminFixture | undefined;
let baselessHandle: AdminFixture | undefined;
let relayed: AdminFixture;
let bare: AdminFixture;
let baseless: AdminFixture;
beforeAll(async () => {
  relayedHandle = await startAdminFixture({ deploymentSmtp: true });
  bareHandle = await startAdminFixture();
  baselessHandle = await startAdminFixture({ deploymentSmtp: true, publicBaseUrl: false });
  relayed = relayedHandle;
  bare = bareHandle;
  baseless = baselessHandle;
}, 300_000);
afterAll(async () => {
  await relayedHandle?.stop();
  await bareHandle?.stop();
  await baselessHandle?.stop();
});

const OLD = 'ada@example.com';
const NEW = 'ada.new@example.com';

interface Person {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly subjectId: string;
  readonly token: string;
}

async function person(
  on: AdminFixture,
  options: { email?: string | null; verified?: boolean } = {},
): Promise<Person> {
  const email = options.email === undefined ? OLD : options.email;
  const t = await on.createTenant(`confirm-${newId()}`);
  const subjectId = await withTenant(on.app.db, t.id, async (tx) => {
    const subject = await subjectRepository(tx).create({ tenantId: t.id, type: 'user' });
    await userRepository(tx).create({
      subjectId: subject.id,
      tenantId: t.id,
      username: `ada-${newId()}`,
      email,
    });
    return subject.id;
  });
  if (options.verified === true) {
    await on.owner.sql`update users set email_verified = true where subject_id = ${subjectId}`;
  }
  const token = await on.adminToken(t.name, ['manage-users']);
  return { tenantId: t.id, tenantName: t.name, subjectId, token };
}

function patch(
  on: AdminFixture,
  who: Person,
  payload: Record<string, unknown>,
  ifMatch?: string,
): Promise<LightMyRequestResponse> {
  return on.http.inject({
    method: 'PATCH',
    url: `/admin/tenants/${who.tenantName}/subjects/${who.subjectId}`,
    headers: {
      authorization: `Bearer ${who.token}`,
      'content-type': 'application/json',
      ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
    },
    payload,
  });
}

function read(on: AdminFixture, who: Person): Promise<LightMyRequestResponse> {
  return on.http.inject({
    method: 'GET',
    url: `/admin/tenants/${who.tenantName}/subjects/${who.subjectId}`,
    headers: { authorization: `Bearer ${who.token}` },
  });
}

const mailOf = (on: AdminFixture, who: Person) =>
  withTenant(on.app.db, who.tenantId, async (tx) =>
    (await tx.select().from(emailOutbox)).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    ),
  );

const userOf = (on: AdminFixture, who: Person) =>
  withTenant(on.app.db, who.tenantId, (tx) => userRepository(tx).bySubjectId(who.subjectId));

const pendingOf = (on: AdminFixture, who: Person) =>
  withTenant(on.app.db, who.tenantId, (tx) => pendingEmailRepository(tx).forSubject(who.subjectId));

const amendRows = (on: AdminFixture, who: Person) =>
  withTenant(on.app.db, who.tenantId, async (tx) =>
    (await auditRepository(tx).list({ action: 'subject.amend', limit: 50 })).filter(
      (row) => row.resourceId === who.subjectId,
    ),
  );

function keyOf(message: { bodyText: string }): string {
  const found = /action-token\?key=([^\s&"]+)/u.exec(message.bodyText);
  if (found?.[1] === undefined) throw new Error('no link in the mail');
  return found[1];
}

// What a person's opening the mailed link does, through the same usecase the link's page calls.
function complete(on: AdminFixture, who: Person, key: string) {
  return completeEmailVerification(
    {
      database: on.app,
      tenantId: who.tenantId,
      request: { requestId: newId(), ip: '127.0.0.1' },
      getCurrentEmail: async (tx, subjectId) =>
        (await userRepository(tx).bySubjectId(subjectId))?.email ?? null,
      markVerified: async (tx, subjectId) => {
        await userRepository(tx).markEmailVerified(subjectId);
        await requiredActionRepository(tx).complete(subjectId, 'verify-email');
      },
      changeAddress: {
        lockAddress: (tx, tenantId, email) => lockEmailForCreation(tx, tenantId, email),
        takePending: (tx, subjectId, email) => pendingEmailRepository(tx).take(subjectId, email),
        holderOf: (tx, email) => userRepository(tx).holderOfEmail(email),
        replaceVerified: async (tx, subjectId, email) => {
          await userRepository(tx).replaceVerifiedEmail(subjectId, email);
          await requiredActionRepository(tx).complete(subjectId, 'verify-email');
        },
      },
    },
    key,
  );
}

describe('PATCH /subjects/:id with an email', () => {
  it('holds the new address as pending, mails it, and tells the verified old address', async () => {
    const who = await person(relayed, { verified: true });
    const res = await patch(relayed, who, { email: NEW });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email: OLD, pending_email: NEW });

    expect(await userOf(relayed, who)).toMatchObject({ email: OLD, emailVerified: true });
    expect(await pendingOf(relayed, who)).toBe(NEW);
    const queued = await mailOf(relayed, who);
    expect(queued.map((row) => row.toAddress).sort()).toEqual([NEW, OLD].sort());
    const link = queued.find((row) => row.toAddress === NEW);
    expect(link?.bodyText).toContain('action-token');
    const notice = queued.find((row) => row.toAddress === OLD);
    expect(notice?.bodyText).not.toMatch(/action-token|https?:/u);
    expect(notice?.bodyText).not.toContain(NEW);

    const got = await read(relayed, who);
    expect(got.json()).toMatchObject({ email: OLD, pending_email: NEW });
    const rows = await amendRows(relayed, who);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toMatchObject({
      email_change: 'requested',
      pending_email: NEW,
      notice: 'sent',
    });
  });

  it('leaves the old address finding the person until the link is used, then swaps it as verified', async () => {
    const who = await person(relayed, { verified: true });
    expect((await patch(relayed, who, { email: NEW })).statusCode).toBe(200);
    const byAddress = (email: string) =>
      withTenant(
        relayed.app.db,
        who.tenantId,
        async (tx) => (await userRepository(tx).byVerifiedEmail(email))?.subject.id ?? null,
      );
    expect(await byAddress(OLD)).toBe(who.subjectId);
    expect(await byAddress(NEW)).toBeNull();

    const link = (await mailOf(relayed, who)).find((row) => row.toAddress === NEW);
    if (link === undefined) throw new Error('no mail to the new address');
    expect(await complete(relayed, who, keyOf(link))).toEqual({ kind: 'verified' });

    expect(await userOf(relayed, who)).toMatchObject({ email: NEW, emailVerified: true });
    expect(await byAddress(NEW)).toBe(who.subjectId);
    expect(await byAddress(OLD)).toBeNull();
    expect(await pendingOf(relayed, who)).toBeNull();
    expect((await read(relayed, who)).json()).toMatchObject({ email: NEW, pending_email: null });
  });

  it('replaces the pending address with a later request, and the earlier link is dead', async () => {
    const who = await person(relayed, { verified: true });
    expect((await patch(relayed, who, { email: NEW })).statusCode).toBe(200);
    expect((await patch(relayed, who, { email: 'other@example.com' })).statusCode).toBe(200);
    expect(await pendingOf(relayed, who)).toBe('other@example.com');

    const first = (await mailOf(relayed, who)).find((row) => row.toAddress === NEW);
    if (first === undefined) throw new Error('no mail to the first address');
    expect(await complete(relayed, who, keyOf(first))).toEqual({ kind: 'invalid' });
    expect(await userOf(relayed, who)).toMatchObject({ email: OLD });
  });

  it('cancels a pending change when the current address is asked for, in any case, and mails nothing', async () => {
    const who = await person(relayed, { verified: true });
    expect((await patch(relayed, who, { email: NEW })).statusCode).toBe(200);
    const before = (await mailOf(relayed, who)).length;

    const res = await patch(relayed, who, { email: 'ADA@Example.com' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email: OLD, pending_email: null });
    expect(await pendingOf(relayed, who)).toBeNull();
    expect(await mailOf(relayed, who)).toHaveLength(before);
    const rows = await amendRows(relayed, who);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => JSON.stringify(row.detail).includes('email_change'))).toHaveLength(
      1,
    );
  });

  it('clears the address and any pending change at once for null', async () => {
    const who = await person(relayed, { verified: true });
    expect((await patch(relayed, who, { email: NEW })).statusCode).toBe(200);
    const before = (await mailOf(relayed, who)).length;

    const res = await patch(relayed, who, { email: null });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email: null, pending_email: null });
    expect(await userOf(relayed, who)).toMatchObject({ email: null });
    expect(await pendingOf(relayed, who)).toBeNull();
    expect(await mailOf(relayed, who)).toHaveLength(before);
  });

  it('answers 409 for an address another subject holds, in any case, and writes nothing', async () => {
    const who = await person(relayed, { verified: true });
    await withTenant(relayed.app.db, who.tenantId, async (tx) => {
      const other = await subjectRepository(tx).create({ tenantId: who.tenantId, type: 'user' });
      await userRepository(tx).create({
        subjectId: other.id,
        tenantId: who.tenantId,
        username: `grace-${newId()}`,
        email: 'Grace@Example.com',
      });
    });
    const res = await patch(relayed, who, { email: 'grace@example.com', enabled: false });
    expect(res.statusCode).toBe(409);
    expect(await pendingOf(relayed, who)).toBeNull();
    expect(await mailOf(relayed, who)).toEqual([]);
    expect((await read(relayed, who)).json()).toMatchObject({ enabled: true });
    expect(await amendRows(relayed, who)).toEqual([]);
  });

  it('answers 409 no-mail-relay with no relay and no deployment sender, and a disable in the same request is not applied', async () => {
    const who = await person(bare);
    const res = await patch(bare, who, { email: NEW, enabled: false });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ type: string }>().type).toBe('about:blank#no-mail-relay');
    expect(await pendingOf(bare, who)).toBeNull();
    expect(await mailOf(bare, who)).toEqual([]);
    expect((await read(bare, who)).json()).toMatchObject({ enabled: true, email: OLD });
  });

  it('answers 503 with no public base URL, and rolls back everything the request asked for', async () => {
    const who = await person(baseless, { verified: true });
    const res = await patch(baseless, who, { email: NEW, enabled: false });
    expect(res.statusCode).toBe(503);
    expect(await pendingOf(baseless, who)).toBeNull();
    expect(await mailOf(baseless, who)).toEqual([]);
    expect(await amendRows(baseless, who)).toEqual([]);
    expect((await read(baseless, who)).json()).toMatchObject({ enabled: true, email: OLD });
  });

  it.each([
    ['an unverified', { verified: false }, 'skipped_unverified'],
    ['an absent', { email: null }, 'skipped_none'],
  ] as const)(
    'tells nobody, and audits it, when the old address is %s one',
    async (_, options, notice) => {
      const who = await person(relayed, options);
      expect((await patch(relayed, who, { email: NEW })).statusCode).toBe(200);
      const queued = await mailOf(relayed, who);
      expect(queued.map((row) => row.toAddress)).toEqual([NEW]);
      expect((await amendRows(relayed, who))[0]?.detail).toMatchObject({ notice });
    },
  );

  it('needs no If-Match for an email, and answers an ETag the pending address does not move', async () => {
    const who = await person(relayed);
    const before = await read(relayed, who);
    const res = await patch(relayed, who, { email: NEW });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe(before.headers.etag);
    expect((await read(relayed, who)).headers.etag).toBe(before.headers.etag);
  });

  it('carries no pending_email in a list', async () => {
    const who = await person(relayed);
    expect((await patch(relayed, who, { email: NEW })).statusCode).toBe(200);
    const res = await relayed.http.inject({
      method: 'GET',
      url: `/admin/tenants/${who.tenantName}/subjects`,
      headers: { authorization: `Bearer ${who.token}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: Record<string, unknown>[] }>().items;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item).not.toHaveProperty('pending_email');
  });
});

describe('readSubjectDetail, probed with a foreign tenant_id', () => {
  it('finds no subject and no pending address from another tenant’s context', async () => {
    await expectCrossTenantMethodProbe(relayed.app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${newId()}` });
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        await userRepository(tx).create({
          subjectId: subject.id,
          tenantId,
          username: 'ada',
          email: OLD,
        });
        await pendingEmailRepository(tx).set(tenantId, subject.id, NEW);
        return subject.id;
      },
      verifySeeded: async (tx, subjectId) => {
        expect(await pendingEmailRepository(tx).forSubject(subjectId)).toBe(NEW);
      },
      attempt: async (tx, subjectId) => ({
        detail: await readSubjectDetail(tx, subjectId),
        pending: await pendingEmailRepository(tx).forSubject(subjectId),
      }),
      expectBlocked: (result) => {
        expect(result).toEqual({ detail: { kind: 'not_found' }, pending: null });
      },
    });
  });
});

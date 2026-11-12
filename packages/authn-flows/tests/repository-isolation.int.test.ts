import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { subjectRepository } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { sessionRepository } from '#/repository/sessions';
import { deviceDigest, newDeviceId } from '#/service/device-id';
import { SessionEntry } from '#/service/session-entry';
import { type PendingRequest } from '#/schema/authentication-sessions';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const PENDING_REQUEST: PendingRequest = {
  clientId: 'client-1',
  redirectUri: 'https://client.example/callback',
  scope: 'openid',
  state: null,
  nonce: null,
  codeChallenge: 'challenge-value',
  codeChallengeMethod: 'S256',
};

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
}

describe('sessionRepository', () => {
  it('cannot resolve a browser’s entry under a different tenant context', async () => {
    const lifespans = {
      ssoSessionIdleSeconds: 1800,
      ssoSessionMaxSeconds: 36_000,
      rememberMeIdleSeconds: 604_800,
      rememberMeMaxSeconds: 2_592_000,
    };
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        const entry = SessionEntry.issue(newId());
        await sessionRepository(tx).create({
          id: entry.id,
          tenantId,
          subjectId: subject.id,
          expiresAt: new Date(Date.now() + 3_600_000),
          authenticators: [],
          secretHash: entry.secretHash(),
        });
        return entry;
      },
      verifySeeded: async (tx, entry) => {
        const found = await sessionRepository(tx).liveByEntries([entry], lifespans, new Date());
        expect(found).toHaveLength(1);
      },
      attempt: async (tx, entry) =>
        sessionRepository(tx).liveByEntries([entry], lifespans, new Date()),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });

  it('cannot list a device’s sessions under a different tenant context', async () => {
    const lifespans = {
      ssoSessionIdleSeconds: 1800,
      ssoSessionMaxSeconds: 36_000,
      rememberMeIdleSeconds: 604_800,
      rememberMeMaxSeconds: 2_592_000,
    };
    const device = deviceDigest(newDeviceId(() => new Uint8Array(16).fill(7)));
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        const entry = SessionEntry.issue(newId());
        await sessionRepository(tx).create({
          id: entry.id,
          tenantId,
          subjectId: subject.id,
          expiresAt: new Date(Date.now() + 3_600_000),
          authenticators: [],
          secretHash: entry.secretHash(),
          deviceId: device,
        });
        return subject.id;
      },
      verifySeeded: async (tx, subjectId) => {
        const found = await sessionRepository(tx).liveByDevice(
          subjectId,
          device,
          lifespans,
          new Date(),
          10,
        );
        expect(found).toHaveLength(1);
      },
      attempt: async (tx, subjectId) =>
        sessionRepository(tx).liveByDevice(subjectId, device, lifespans, new Date(), 10),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });

  it('cannot find a session by id under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        const id = newId();
        await sessionRepository(tx).create({
          id,
          tenantId,
          subjectId: subject.id,
          expiresAt: new Date(Date.now() + 3_600_000),
          authenticators: [],
          secretHash: SessionEntry.issue(id).secretHash(),
        });
        return id;
      },
      verifySeeded: async (tx, id) => {
        const found = await sessionRepository(tx).byId(id);
        expect(found).not.toBeNull();
      },
      attempt: async (tx, id) => sessionRepository(tx).byId(id),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('cannot end a session under a different tenant context, and leaves it live', async () => {
    const originalExpiry = new Date(Date.now() + 3_600_000);
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        const id = newId();
        await sessionRepository(tx).create({
          id,
          tenantId,
          subjectId: subject.id,
          expiresAt: originalExpiry,
          authenticators: [],
          secretHash: SessionEntry.issue(id).secretHash(),
        });
        return id;
      },
      verifySeeded: async (tx, id) => {
        const found = await sessionRepository(tx).byId(id);
        expect(found?.expiresAt).toEqual(originalExpiry);
      },
      attempt: async (tx, id) => sessionRepository(tx).end(id, new Date()),
      expectBlocked: (ended) => {
        expect(ended).toBe(false);
      },
      verifyTenantAUnaffected: async (tx, id) => {
        const found = await sessionRepository(tx).byId(id);
        expect(found?.expiresAt).toEqual(originalExpiry);
      },
    });
  });
});

describe('sessionRepository, for many sessions at once', () => {
  async function seedSession(tx: TenantScopedDatabase, tenantId: string, expiresAt: Date) {
    await seedTenant(tx, tenantId);
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    const id = newId();
    await sessionRepository(tx).create({
      id,
      tenantId,
      subjectId: subject.id,
      expiresAt,
      authenticators: [],
      secretHash: SessionEntry.issue(id).secretHash(),
    });
    return { id, subjectId: subject.id };
  }

  it('cannot end a session under a different tenant context, and leaves it live', async () => {
    const originalExpiry = new Date(Date.now() + 3_600_000);
    await expectCrossTenantMethodProbe(app.db, {
      seed: (tx, tenantId) => seedSession(tx, tenantId, originalExpiry),
      verifySeeded: async (tx, seeded) => {
        expect((await sessionRepository(tx).byId(seeded.id))?.expiresAt).toEqual(originalExpiry);
      },
      attempt: async (tx, seeded) => sessionRepository(tx).endAll([seeded.id], new Date()),
      expectBlocked: (ended) => {
        expect(ended).toEqual([]);
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        expect((await sessionRepository(tx).byId(seeded.id))?.expiresAt).toEqual(originalExpiry);
      },
    });
  });

  it("cannot list a foreign tenant's sessions of a subject", async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: (tx, tenantId) => seedSession(tx, tenantId, new Date(Date.now() + 3_600_000)),
      verifySeeded: async (tx, seeded) => {
        expect(await sessionRepository(tx).liveIdsFor(seeded.subjectId, new Date(), 10)).toEqual([
          seeded.id,
        ]);
      },
      attempt: async (tx, seeded) =>
        sessionRepository(tx).liveIdsFor(seeded.subjectId, new Date(), 10),
      expectBlocked: (ids) => {
        expect(ids).toEqual([]);
      },
    });
  });

  it('ends only the live ones, and says which', async () => {
    const tenantId = newId();
    const result = await withTenant(app.db, tenantId, async (tx) => {
      const live = await seedSession(tx, tenantId, new Date(Date.now() + 3_600_000));
      const listed = await sessionRepository(tx).liveIdsFor(live.subjectId, new Date(), 10);
      const ended = await sessionRepository(tx).endAll([live.id, newId()], new Date());
      const again = await sessionRepository(tx).endAll([live.id], new Date(Date.now() + 1000));
      return { live: live.id, listed, ended, again };
    });
    expect(result.listed).toEqual([result.live]);
    expect(result.ended).toEqual([result.live]);
    expect(result.again).toEqual([]);
  });
});

describe('authenticationSessionRepository', () => {
  // `byId` is read twice per login attempt by the flow executor: once to
  // load the parked request and once after `consume` succeeds. `consume`
  // being tenant-scoped says nothing about the read that precedes it, which
  // is where the parked request — client_id, redirect_uri, scope, nonce —
  // would leak across tenants.
  it('cannot find an authentication session by id under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const id = newId();
        await authenticationSessionRepository(tx).create({
          id,
          tenantId,
          pendingRequest: PENDING_REQUEST,
          expiresAt: new Date(Date.now() + 600_000),
        });
        return id;
      },
      verifySeeded: async (tx, id) => {
        const found = await authenticationSessionRepository(tx).byId(id);
        expect(found?.pendingRequest.clientId).toBe(PENDING_REQUEST.clientId);
      },
      attempt: async (tx, id) => authenticationSessionRepository(tx).byId(id),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('cannot consume an authentication session under a different tenant context, and leaves it unconsumed', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const id = newId();
        await authenticationSessionRepository(tx).create({
          id,
          tenantId,
          pendingRequest: PENDING_REQUEST,
          expiresAt: new Date(Date.now() + 600_000),
        });
        return id;
      },
      verifySeeded: async (tx, id) => {
        const found = await authenticationSessionRepository(tx).byId(id);
        expect(found?.consumedAt).toBeNull();
      },
      attempt: async (tx, id) => authenticationSessionRepository(tx).consume(id, new Date()),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyTenantAUnaffected: async (tx, id) => {
        const found = await authenticationSessionRepository(tx).byId(id);
        expect(found?.consumedAt).toBeNull();
      },
    });
  });
});

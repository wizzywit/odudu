import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { auditRepository } from '@odudu/domain-audit';
import { subjectRepository } from '@odudu/domain-identity';
import { clientRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { recordActionStep } from '#/usecase/action-step';
import { startAuthentication } from '#/usecase/executor';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

const request: PendingRequest = {
  clientId: 'portal',
  redirectUri: 'https://app.example/callback',
  scope: 'openid',
  state: null,
  nonce: null,
  codeChallenge: 'challenge-value',
  codeChallengeMethod: 'S256',
  action: 'configure-totp',
};

interface Seeded {
  tenantId: string;
  subjectId: string;
  authSessionId: string;
  clientDbId: string;
}

async function seed(tx: TenantScopedDatabase, tenantId: string): Promise<Seeded> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  const client = await clientRepository(tx).create({
    tenantId,
    clientId: 'portal',
    name: 'Portal',
    type: 'public',
    secretHash: null,
  });
  const { authSessionId } = await startAuthentication(tx, tenantId, request);
  return { tenantId, subjectId: subject.id, authSessionId, clientDbId: client.id };
}

const parked = (tenantId: string, id: string) =>
  withTenant(app.db, tenantId, (tx) => authenticationSessionRepository(tx).byId(id));

const rows = (tenantId: string) =>
  withTenant(app.db, tenantId, (tx) =>
    auditRepository(tx).list({ eventType: 'credential', limit: 50 }),
  );

describe('recordActionStep', () => {
  it('audits the step with the client named, and parks only an ending', async () => {
    const tenantId = newId();
    const s = await withTenant(app.db, tenantId, (tx) => seed(tx, tenantId));
    const step = (kind: 'requested' | 'cancelled') =>
      withTenant(app.db, tenantId, (tx) =>
        recordActionStep(tx, {
          authSessionId: s.authSessionId,
          subjectId: s.subjectId,
          action: 'configure-totp',
          step: kind,
        }),
      );

    await step('requested');
    expect((await parked(tenantId, s.authSessionId))?.pendingRequest.actionStatus).toBeUndefined();
    await step('cancelled');
    expect((await parked(tenantId, s.authSessionId))?.pendingRequest.actionStatus).toBe(
      'cancelled',
    );

    const written = await rows(tenantId);
    expect(written.map((row) => row.action).sort()).toEqual([
      'action.cancelled',
      'action.requested',
    ]);
    for (const row of written) {
      expect(row.actorClientId).toBe(s.clientDbId);
      expect(row.actorSubjectId).toBe(s.subjectId);
      expect(row.detail).toEqual({ action: 'configure-totp' });
      expect(row.outcome).toBe('allowed');
    }
  });

  it('lets the first ending stand and audits nothing for a second', async () => {
    const tenantId = newId();
    const s = await withTenant(app.db, tenantId, (tx) => seed(tx, tenantId));
    const end = (status: 'success' | 'error') =>
      withTenant(app.db, tenantId, (tx) =>
        recordActionStep(tx, {
          authSessionId: s.authSessionId,
          subjectId: s.subjectId,
          action: 'configure-totp',
          step: status,
        }),
      );
    await end('success');
    await end('error');
    expect((await parked(tenantId, s.authSessionId))?.pendingRequest.actionStatus).toBe('success');
    expect((await rows(tenantId)).map((row) => row.action)).toEqual(['action.completed']);
  });

  it('writes a failure as a failed outcome', async () => {
    const tenantId = newId();
    const s = await withTenant(app.db, tenantId, (tx) => seed(tx, tenantId));
    await withTenant(app.db, tenantId, (tx) =>
      recordActionStep(tx, {
        authSessionId: s.authSessionId,
        subjectId: s.subjectId,
        action: 'generate-recovery-codes',
        step: 'error',
      }),
    );
    const [row] = await rows(tenantId);
    expect(row).toMatchObject({ action: 'action.failed', outcome: 'failed' });
  });

  it('does not write the status of another tenant’s parked request', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: (tx, tenantId) => seed(tx, tenantId),
      verifySeeded: async (tx, seeded) => {
        expect(
          await authenticationSessionRepository(tx).recordActionStatus(
            seeded.authSessionId,
            'success',
          ),
        ).toBe(true);
      },
      attempt: (tx, seeded) =>
        authenticationSessionRepository(tx).recordActionStatus(seeded.authSessionId, 'error'),
      expectBlocked: (written) => {
        expect(written).toBe(false);
      },
    });
  });
});

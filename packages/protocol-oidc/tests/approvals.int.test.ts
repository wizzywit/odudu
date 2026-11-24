import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { agentApprovalRepository, agentInstanceRepository } from '@odudu/domain-agents';
import { auditRepository } from '@odudu/domain-audit';
import { subjectRepository } from '@odudu/domain-identity';
import { clients } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApprovalLimitReached,
  consumeApproval,
  decideApproval,
  PENDING_APPROVALS_PER_SUBJECT,
  requestApproval,
} from '#/usecase/approvals';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let app: DatabaseHandle;

const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
const DIGEST = 'a'.repeat(64);

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  await runMigrations(ownerHandle.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 25 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

interface Seeded {
  tenantId: string;
  ownerId: string;
  otherId: string;
  clientId: string;
  grantId: string;
}

async function seed(tx: TenantScopedDatabase, tenantId: string): Promise<Seeded> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  const clientId = newId();
  await tx.insert(clients).values({
    id: clientId,
    tenantId,
    clientId: `client-${clientId}`,
    name: 'An agent',
    type: 'confidential',
    secretHash: 'hashed:secret',
  });
  const owner = await subjectRepository(tx).create({ tenantId, type: 'user' });
  const other = await subjectRepository(tx).create({ tenantId, type: 'user' });
  const grantId = newId();
  await tx.execute(
    sql`insert into token_grants (id, tenant_id, client_id, subject_id, scope)
        values (${grantId}, ${tenantId}, ${clientId}, ${owner.id}, 'openid')`,
  );
  return { tenantId, ownerId: owner.id, otherId: other.id, clientId, grantId };
}

async function inTenant<T>(fn: (tx: TenantScopedDatabase, s: Seeded) => Promise<T>): Promise<T> {
  const tenantId = newId();
  return withTenant(app.db, tenantId, async (tx) => fn(tx, await seed(tx, tenantId)));
}

function request(s: Seeded, overrides: Partial<Parameters<typeof requestApproval>[2]> = {}) {
  return {
    subjectId: s.ownerId,
    requestingClientId: s.clientId,
    instanceId: null,
    kind: 'tool_call',
    summary: 'Delete a client',
    actionDigest: DIGEST,
    now: NOW,
    ...overrides,
  };
}

function deps(s: Seeded) {
  return { tenantId: s.tenantId };
}

describe('requestApproval', () => {
  it('creates a pending approval that expires after the tenant ttl and records the request', async () => {
    await inTenant(async (tx, s) => {
      const record = await requestApproval(tx, deps(s), request(s));
      expect(record).toMatchObject({
        state: 'pending',
        subjectId: s.ownerId,
        actionDigest: DIGEST,
      });
      expect(record.expiresAt).toEqual(new Date(NOW.getTime() + 600_000));
      const rows = await auditRepository(tx).list({ limit: 100 });
      const row = rows.find((r) => r.action === 'agent.approval_requested');
      expect(row).toMatchObject({
        eventType: 'agent_identity',
        outcome: 'allowed',
        actorSubjectId: s.ownerId,
        actorClientId: s.clientId,
        resourceType: 'agent_approval',
        resourceId: record.id,
        detail: { agent_client: s.clientId, owner: s.ownerId, approval: record.id },
      });
    });
  });

  it('expires no later than the instance it names', async () => {
    await inTenant(async (tx, s) => {
      const instanceId = newId();
      const instanceEnd = new Date(NOW.getTime() + 60_000);
      await agentInstanceRepository(tx).mint({
        id: instanceId,
        tenantId: s.tenantId,
        ownerSubjectId: s.ownerId,
        agentClientId: s.clientId,
        parentInstanceId: null,
        rootGrantId: s.grantId,
        depth: 1,
        scope: 'openid',
        expiresAt: instanceEnd,
        idleExpiresAt: null,
      });
      const record = await requestApproval(tx, deps(s), request(s, { instanceId }));
      expect(record.expiresAt).toEqual(instanceEnd);
      expect(record.instanceId).toBe(instanceId);
    });
  });

  it('refuses the 21st pending approval for a subject and not another subject', async () => {
    await inTenant(async (tx, s) => {
      for (let i = 0; i < PENDING_APPROVALS_PER_SUBJECT; i += 1) {
        await requestApproval(tx, deps(s), request(s));
      }
      await expect(requestApproval(tx, deps(s), request(s))).rejects.toBeInstanceOf(
        ApprovalLimitReached,
      );
      await expect(
        requestApproval(tx, deps(s), request(s, { subjectId: s.otherId })),
      ).resolves.toMatchObject({ state: 'pending' });
    });
  });

  it('does not count a decided or an expired approval against the cap', async () => {
    await inTenant(async (tx, s) => {
      for (let i = 0; i < PENDING_APPROVALS_PER_SUBJECT; i += 1) {
        const r = await requestApproval(tx, deps(s), request(s));
        if (i < 10) {
          await decideApproval(tx, deps(s), {
            approvalId: r.id,
            subjectId: s.ownerId,
            approve: false,
            via: 'console',
            now: NOW,
          });
        }
      }
      await expect(requestApproval(tx, deps(s), request(s))).resolves.toBeDefined();
      const later = new Date(NOW.getTime() + 601_000);
      await expect(requestApproval(tx, deps(s), request(s, { now: later }))).resolves.toBeDefined();
    });
  });
});

describe('decideApproval', () => {
  it('approves for the owner and records who decided and how', async () => {
    await inTenant(async (tx, s) => {
      const r = await requestApproval(tx, deps(s), request(s));
      const outcome = await decideApproval(tx, deps(s), {
        approvalId: r.id,
        subjectId: s.ownerId,
        approve: true,
        via: 'ciba_page',
        now: NOW,
      });
      expect(outcome).toBe('decided');
      expect(await agentApprovalRepository(tx).byId(r.id)).toMatchObject({
        state: 'approved',
        decidedVia: 'ciba_page',
        decidedAt: NOW,
      });
      const rows = await auditRepository(tx).list({ limit: 100 });
      const row = rows.find((x) => x.action === 'agent.approval_decided');
      expect(row).toMatchObject({
        eventType: 'agent_identity',
        outcome: 'allowed',
        actorSubjectId: s.ownerId,
        resourceId: r.id,
        detail: { owner: s.ownerId, approval: r.id, state: 'approved', via: 'ciba_page' },
      });
      expect(Object.keys(row?.detail ?? {}).sort()).toEqual(['approval', 'owner', 'state', 'via']);
    });
  });

  it('records a denial', async () => {
    await inTenant(async (tx, s) => {
      const r = await requestApproval(tx, deps(s), request(s));
      await decideApproval(tx, deps(s), {
        approvalId: r.id,
        subjectId: s.ownerId,
        approve: false,
        via: 'console',
        now: NOW,
      });
      expect((await agentApprovalRepository(tx).byId(r.id))?.state).toBe('denied');
    });
  });

  it('refuses a subject who is not the owner and leaves the approval pending', async () => {
    await inTenant(async (tx, s) => {
      const r = await requestApproval(tx, deps(s), request(s));
      const outcome = await decideApproval(tx, deps(s), {
        approvalId: r.id,
        subjectId: s.otherId,
        approve: true,
        via: 'console',
        now: NOW,
      });
      expect(outcome).toBe('not_owner');
      expect(await agentApprovalRepository(tx).byId(r.id)).toMatchObject({
        state: 'pending',
        decidedAt: null,
        decidedVia: null,
      });
      const rows = await auditRepository(tx).list({ limit: 100 });
      expect(rows.some((x) => x.action === 'agent.approval_decided')).toBe(false);
    });
  });

  it('answers not_pending for an unknown id', async () => {
    await inTenant(async (tx, s) => {
      const outcome = await decideApproval(tx, deps(s), {
        approvalId: newId(),
        subjectId: s.ownerId,
        approve: true,
        via: 'console',
        now: NOW,
      });
      expect(outcome).toBe('not_pending');
    });
  });

  it('answers not_pending after expiry and after a decision', async () => {
    await inTenant(async (tx, s) => {
      const r = await requestApproval(tx, deps(s), request(s));
      const late = new Date(r.expiresAt.getTime());
      const decide = (approve: boolean, now: Date) =>
        decideApproval(tx, deps(s), {
          approvalId: r.id,
          subjectId: s.ownerId,
          approve,
          via: 'console',
          now,
        });
      expect(await decide(true, late)).toBe('not_pending');
      expect(await decide(true, NOW)).toBe('decided');
      expect(await decide(false, NOW)).toBe('not_pending');
      expect((await agentApprovalRepository(tx).byId(r.id))?.state).toBe('approved');
    });
  });

  it('applies exactly one of an approve and a deny arriving together, ten times over', async () => {
    const tenantId = newId();
    const s = await withTenant(app.db, tenantId, (tx) => seed(tx, tenantId));
    const ids = await withTenant(app.db, tenantId, async (tx) => {
      const made: string[] = [];
      for (let i = 0; i < 10; i += 1) {
        made.push((await requestApproval(tx, deps(s), request(s))).id);
      }
      return made;
    });
    const decide = (approvalId: string, approve: boolean) =>
      withTenant(app.db, tenantId, (tx) =>
        decideApproval(tx, deps(s), {
          approvalId,
          subjectId: s.ownerId,
          approve,
          via: approve ? 'console' : 'ciba_page',
          now: NOW,
        }),
      );
    const results = await Promise.all(ids.flatMap((id) => [decide(id, true), decide(id, false)]));
    for (let i = 0; i < ids.length; i += 1) {
      const pair = [results[2 * i], results[2 * i + 1]].sort();
      expect(pair).toEqual(['decided', 'not_pending']);
    }
    await withTenant(app.db, tenantId, async (tx) => {
      const rows = await auditRepository(tx).list({ limit: 100 });
      expect(rows.filter((x) => x.action === 'agent.approval_decided')).toHaveLength(10);
      for (const id of ids) {
        const rec = await agentApprovalRepository(tx).byId(id);
        expect(['approved', 'denied']).toContain(rec?.state);
        expect(rec?.decidedVia).toBe(rec?.state === 'approved' ? 'console' : 'ciba_page');
      }
    });
  });

  it('cannot reach another tenant approval', async () => {
    const other = await inTenant(async (tx, s) => ({
      s,
      id: (await requestApproval(tx, deps(s), request(s))).id,
    }));
    await inTenant(async (tx, s) => {
      const outcome = await decideApproval(tx, deps(s), {
        approvalId: other.id,
        subjectId: other.s.ownerId,
        approve: true,
        via: 'console',
        now: NOW,
      });
      expect(outcome).toBe('not_pending');
    });
    await withTenant(app.db, other.s.tenantId, async (tx) => {
      expect((await agentApprovalRepository(tx).byId(other.id))?.state).toBe('pending');
    });
  });
});

describe('consumeApproval', () => {
  it('spends an approved approval once and only for its digest', async () => {
    await inTenant(async (tx, s) => {
      const r = await requestApproval(tx, deps(s), request(s));
      expect(await consumeApproval(tx, r.id, DIGEST, NOW)).toBe(false);
      await decideApproval(tx, deps(s), {
        approvalId: r.id,
        subjectId: s.ownerId,
        approve: true,
        via: 'console',
        now: NOW,
      });
      expect(await consumeApproval(tx, r.id, 'b'.repeat(64), NOW)).toBe(false);
      expect(await consumeApproval(tx, r.id, DIGEST, NOW)).toBe(true);
      expect(await consumeApproval(tx, r.id, DIGEST, NOW)).toBe(false);
    });
  });

  it('does not spend a denied approval', async () => {
    await inTenant(async (tx, s) => {
      const r = await requestApproval(tx, deps(s), request(s));
      await decideApproval(tx, deps(s), {
        approvalId: r.id,
        subjectId: s.ownerId,
        approve: false,
        via: 'console',
        now: NOW,
      });
      expect(await consumeApproval(tx, r.id, DIGEST, NOW)).toBe(false);
    });
  });

  it('does not spend another tenant approval', async () => {
    const other = await inTenant(async (tx, s) => {
      const r = await requestApproval(tx, deps(s), request(s));
      await decideApproval(tx, deps(s), {
        approvalId: r.id,
        subjectId: s.ownerId,
        approve: true,
        via: 'console',
        now: NOW,
      });
      return { s, id: r.id };
    });
    await inTenant(async (tx) => {
      expect(await consumeApproval(tx, other.id, DIGEST, NOW)).toBe(false);
    });
    await withTenant(app.db, other.s.tenantId, async (tx) => {
      expect((await agentApprovalRepository(tx).byId(other.id))?.state).toBe('approved');
    });
  });
});

describe('the audit trail of approvals', () => {
  it('holds only allowlisted detail on every row', async () => {
    await inTenant(async (tx, s) => {
      const r = await requestApproval(tx, deps(s), request(s));
      await decideApproval(tx, deps(s), {
        approvalId: r.id,
        subjectId: s.ownerId,
        approve: true,
        via: 'console',
        now: NOW,
      });
      const rows = await auditRepository(tx).list({ limit: 100 });
      const keys = new Map(rows.map((x) => [x.action, Object.keys(x.detail ?? {}).sort()]));
      expect(keys.get('agent.approval_requested')).toEqual(['agent_client', 'approval', 'owner']);
      expect(keys.get('agent.approval_decided')).toEqual(['approval', 'owner', 'state', 'via']);
      expect(JSON.stringify(rows)).not.toContain('Delete a client');
    });
  });
});

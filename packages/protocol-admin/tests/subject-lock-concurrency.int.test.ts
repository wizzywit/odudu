import { SessionEntry, sessionRepository } from '@odudu/authn-flows';
import { withTenant, type TenantScopedDatabase } from '@odudu/db';
import { loginFailureRepository } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
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

interface Gate {
  readonly reached: Promise<void>;
  readonly open: Promise<void>;
  arrive(): void;
  release(): void;
}

function gate(): Gate {
  let arrive = (): void => undefined;
  let release = (): void => undefined;
  const reached = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reached, open, arrive, release };
}

async function awaitBlockedTransaction(): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const rows = await fixture.owner.db.execute(
      sql`select count(*)::int as waiting from pg_locks where not granted`,
    );
    if (((rows as unknown as { waiting: number }[])[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('the admin request never blocked; the two transactions did not overlap');
}

// What `/authorize` does once a login resumes: an insert whose foreign key
// on `subjects` takes a key-share lock on the subject row.
async function insertAuthorizationCode(
  tx: TenantScopedDatabase,
  tenantId: string,
  clientDbId: string,
  subjectId: string,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO authorization_codes
      (code_hash, tenant_id, client_id, subject_id, redirect_uri, scope,
       code_challenge, code_challenge_method, auth_time, expires_at)
    VALUES (${newId()}, ${tenantId}, ${clientDbId}, ${subjectId}, 'https://rp.example/cb',
            'openid', 'challenge', 'S256', now(), now() + interval '1 minute')
  `);
}

interface Scenario {
  readonly name: string;
  // What the protocol side has already written, and holds, when the
  // administrator's request arrives.
  readonly hold: (tx: TenantScopedDatabase, subjectId: string, sessionId: string) => Promise<void>;
  readonly capability: string;
  readonly request: (base: string, sessionId: string) => { method: 'DELETE'; url: string };
  readonly status: number;
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'ending one session while a login reusing it mints a code',
    hold: (tx, _subjectId, sessionId) => sessionRepository(tx).touch(sessionId, new Date()),
    capability: 'manage-sessions',
    request: (base, sessionId) => ({ method: 'DELETE', url: `${base}/sessions/${sessionId}` }),
    status: 204,
  },
  {
    name: 'ending every session while a login reusing one mints a code',
    hold: (tx, _subjectId, sessionId) => sessionRepository(tx).touch(sessionId, new Date()),
    capability: 'manage-sessions',
    request: (base) => ({ method: 'DELETE', url: `${base}/sessions` }),
    status: 200,
  },
  {
    name: 'clearing a lockout while a correct password clears it and binds the subject',
    hold: async (tx, subjectId) => {
      await loginFailureRepository(tx).clear(subjectId);
    },
    capability: 'manage-users',
    request: (base) => ({ method: 'DELETE', url: `${base}/lockout` }),
    status: 204,
  },
];

describe('an admin mutation locking a subject against a protocol write referencing it', () => {
  it.each(SCENARIOS)('$name: both complete, neither deadlocks', async (scenario) => {
    const t = await fixture.createTenant(`lock-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `ada-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const sessionId = newId();
    await withTenant(fixture.app.db, t.id, async (tx) => {
      await sessionRepository(tx).create({
        id: sessionId,
        tenantId: t.id,
        subjectId,
        expiresAt: new Date(fixture.clock.now().getTime() + 3_600_000),
        authenticators: ['pwd'],
        secretHash: SessionEntry.issue(sessionId).secretHash(),
      });
      await tx.execute(sql`
        INSERT INTO login_failures
          (tenant_id, subject_id, failure_count, first_failure_at, last_failure_at, locked_until)
        VALUES (${t.id}, ${subjectId}, 5, now(), now(), now() + interval '1 minute')
      `);
    });
    const token = await fixture.adminToken(t.name, [scenario.capability]);
    const held = gate();

    const protocolSide = withTenant(fixture.app.db, t.id, async (tx) => {
      await scenario.hold(tx, subjectId, sessionId);
      held.arrive();
      await held.open;
      await insertAuthorizationCode(tx, t.id, client.id, subjectId);
    });

    await held.reached;
    const base = `/admin/tenants/${t.name}/subjects/${subjectId}`;
    const adminSide: Promise<LightMyRequestResponse> = fixture.http.inject({
      ...scenario.request(base, sessionId),
      headers: { authorization: `Bearer ${token}` },
    });
    await awaitBlockedTransaction();
    held.release();

    await expect(protocolSide).resolves.toBeUndefined();
    const res = await adminSide;
    expect(res.statusCode, res.body).toBe(scenario.status);
  });
});

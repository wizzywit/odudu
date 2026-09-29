import { tenants, withTenant } from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { auditRepository } from '@odudu/domain-audit';
import { loginFailures } from '@odudu/domain-identity';
import { SYSTEM_TENANT_ID, SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { emailOutbox } from '@odudu/email';
import { BACKCHANNEL_LOGOUT_MAX_ATTEMPTS, backchannelLogoutDeliveries } from '@odudu/protocol-oidc';
import { newId } from '@odudu/kernel';
import { isNull, sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import {
  endDisabledTenantSessions,
  endSessionsWhere,
  type EndDisabledTenantSessionsDeps,
} from '#/usecase/end-sessions';
import { TENANT_SESSIONS_END_LIMIT } from '#/usecase/tenant-sessions';
import { deleteTenantRows } from '#/usecase/tenants';
import { createPasswordSubject, createSignInClient, signInForTokens } from '#/testing/sign-in';

const PASSWORD = 'correct horse battery staple';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const tableRowsSchema = z.array(z.object({ table_name: z.string() }));
const countRowsSchema = z.array(z.object({ n: z.number() }));

// Every table carrying a tenant, read from the catalogue rather than listed
// here, so a table added later is held to this without anyone remembering.
async function rowsPerTenantTable(tenantId: string): Promise<Map<string, number>> {
  const tables = tableRowsSchema.parse(
    await fixture.owner.db.execute(sql`
      SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'tenant_id'
       ORDER BY table_name`),
  );
  const counts = new Map<string, number>();
  for (const { table_name: table } of tables) {
    const rows = countRowsSchema.parse(
      await fixture.owner.db.execute(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`,
      ),
    );
    counts.set(table, rows[0]?.n ?? 0);
  }
  const own = countRowsSchema.parse(
    await fixture.owner.db.execute(
      sql`SELECT count(*)::int AS n FROM tenants WHERE id = ${tenantId}`,
    ),
  );
  counts.set('tenants', own[0]?.n ?? 0);
  return counts;
}

function call(
  token: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
}

// A tenant used the way one is: administered through the API, signed in to,
// and failed at, so most of what can hold a tenant's rows does.
async function populatedTenant(): Promise<{ id: string; name: string }> {
  const root = await fixture.systemAdminToken(['tenant-admin']);
  const name = `doomed-${newId()}`;
  const created = await call(root, 'POST', '/admin/tenants', { name });
  const id = created.json<{ id: string }>().id;
  const base = `/admin/tenants/${name}`;
  expect((await call(root, 'POST', `${base}/subjects`, { username: 'grace' })).statusCode).toBe(
    201,
  );
  expect(
    (
      await call(root, 'POST', `${base}/clients`, {
        client_id: 'app',
        grant_types: ['client_credentials'],
      })
    ).statusCode,
  ).toBe(201);
  expect((await call(root, 'POST', `${base}/roles`, { name: 'reader' })).statusCode).toBe(201);
  expect((await call(root, 'POST', `${base}/groups`, { name: 'staff' })).statusCode).toBe(201);
  expect((await call(root, 'POST', `${base}/scopes`, { name: 'billing' })).statusCode).toBe(201);
  expect(
    (await call(root, 'POST', `${base}/registration-tokens`, { uses: 1, ttl_seconds: 600 }))
      .statusCode,
  ).toBe(201);
  expect(
    (
      await call(root, 'PUT', `${base}/smtp`, {
        host: 'smtp.example.com',
        port: 587,
        from_address: 'noreply@example.com',
      })
    ).statusCode,
  ).toBe(200);

  const client = await createSignInClient(fixture, id, 'https://rp.example/backchannel');
  const subject = await createPasswordSubject(fixture, id, 'ada', PASSWORD);
  await signInForTokens(fixture, name, client, 'ada', PASSWORD, 'openid offline_access');
  await signInForTokens(fixture, name, client, 'ada', PASSWORD, 'openid');
  expect((await call(root, 'DELETE', `${base}/subjects/${subject}/sessions`)).statusCode).toBe(200);
  await withTenant(fixture.app.db, id, async (tx) => {
    await tx.insert(loginFailures).values({ tenantId: id, subjectId: subject, failureCount: 2 });
    await tx.insert(emailOutbox).values({
      id: newId(),
      tenantId: id,
      toAddress: 'ada@example.com',
      subject: 'Verify',
      bodyText: 'x',
      bodyHtml: 'x',
    });
  });
  return { id, name };
}

// What the sender does to a queued Logout Token, done directly: whether it
// arrived is the relying party's business, and only that it was sent is
// what a deletion waits for.
async function deliverEverything(tenantId: string): Promise<void> {
  await withTenant(fixture.app.db, tenantId, (tx) =>
    tx
      .update(backchannelLogoutDeliveries)
      .set({ deliveredAt: fixture.clock.now() })
      .where(isNull(backchannelLogoutDeliveries.deliveredAt)),
  );
}

async function liveSessionsOf(tenantId: string): Promise<number> {
  const rows = countRowsSchema.parse(
    await fixture.owner.db.execute(sql`
      SELECT count(*)::int AS n FROM sessions
       WHERE tenant_id = ${tenantId} AND expires_at > ${fixture.clock.now().toISOString()}::timestamptz`),
  );
  return rows[0]?.n ?? 0;
}

async function queuedDeliveriesOf(tenantId: string): Promise<number> {
  const rows = countRowsSchema.parse(
    await fixture.owner.db.execute(sql`
      SELECT count(*)::int AS n FROM backchannel_logout_deliveries
       WHERE tenant_id = ${tenantId} AND delivered_at IS NULL`),
  );
  return rows[0]?.n ?? 0;
}

// A tenant with a relying party that holds a live session's grant, the
// thing a disable must tell before anything else goes.
async function signedInTenant(): Promise<{ id: string; name: string }> {
  const t = await fixture.createTenant(`bcl-${newId()}`);
  const client = await createSignInClient(fixture, t.id, 'https://rp.example/backchannel');
  await createPasswordSubject(fixture, t.id, 'ada', PASSWORD);
  await signInForTokens(fixture, t.name, client, 'ada', PASSWORD, 'openid');
  return t;
}

// Sessions written straight into the table, as many as a batch needs,
// each live for an hour; the one subject holds them all.
async function seedLiveSessions(tenantId: string, subjectId: string, n: number): Promise<void> {
  const expires = new Date(fixture.clock.now().getTime() + 3_600_000).toISOString();
  const active = fixture.clock.now().toISOString();
  await withTenant(fixture.app.db, tenantId, (tx) =>
    tx.execute(sql`
      INSERT INTO sessions (id, tenant_id, subject_id, expires_at, last_active_at, secret_hash)
      SELECT gen_random_uuid(), ${tenantId}, ${subjectId}, ${expires}::timestamptz,
             ${active}::timestamptz, md5(g::text || ${tenantId})
        FROM generate_series(1, ${n}) g`),
  );
}

async function endAllRowsOf(tenantId: string): Promise<unknown[]> {
  const rows = await withTenant(fixture.app.db, tenantId, (tx) =>
    auditRepository(tx).list({ action: 'session.end_all', limit: 10 }),
  );
  return rows.map((row) => row.detail).reverse();
}

const BATCH_DEPS: EndDisabledTenantSessionsDeps = {
  kek: Buffer.alloc(32, 7),
  audit: (tx, event) => auditRepository(tx).record({ ...event, eventType: 'admin_mutation' }),
};

function batchInput(tenantId: string): Parameters<typeof endDisabledTenantSessions>[2] {
  return {
    tenantId,
    now: fixture.clock.now(),
    issuer: 'http://localhost/tenants/unused',
    actorSubjectId: newId(),
    actorTenantId: SYSTEM_TENANT_ID,
    actorClientId: newId(),
  };
}

// Until exactly `n` backends of this database wait on a row lock.
async function waitForLockWaiters(n: number): Promise<void> {
  for (let tries = 0; tries < 200; tries += 1) {
    const rows = countRowsSchema.parse(
      await fixture.owner.db.execute(sql`
        SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`),
    );
    if ((rows[0]?.n ?? 0) === n) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`never saw ${String(n)} lock waiters`);
}

describe('disabling a tenant', () => {
  it.each([
    ['PATCH /admin/tenants/{tenant}', (name: string) => `/admin/tenants/${name}`],
    ['PATCH /settings', (name: string) => `/admin/tenants/${name}/settings`],
  ])('through %s ends every live session and queues its Logout Tokens', async (_door, url) => {
    const t = await signedInTenant();
    expect(await liveSessionsOf(t.id)).toBe(1);
    const token = await fixture.systemAdminToken(['tenant-admin']);

    const res = await call(token, 'PATCH', url(t.name), { enabled: false });
    expect(res.statusCode).toBe(200);
    expect(await liveSessionsOf(t.id)).toBe(0);
    expect(await queuedDeliveriesOf(t.id)).toBe(1);
  });

  it('commits the disable, then ends sessions in batches, each audited', async () => {
    const t = await fixture.createTenant(`batch-${newId()}`);
    const ada = await createPasswordSubject(fixture, t.id, 'ada', PASSWORD);
    await seedLiveSessions(t.id, ada, TENANT_SESSIONS_END_LIMIT + 1);
    const token = await fixture.systemAdminToken(['tenant-admin']);

    const res = await call(token, 'PATCH', `/admin/tenants/${t.name}`, { enabled: false });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ enabled: boolean }>().enabled).toBe(false);
    expect(await liveSessionsOf(t.id)).toBe(0);
    expect(await endAllRowsOf(t.id)).toEqual([
      { ended: TENANT_SESSIONS_END_LIMIT, remaining: 1, via: 'tenant_disabled' },
      { ended: 1, remaining: 0, via: 'tenant_disabled' },
    ]);
    const amend = await withTenant(fixture.app.db, t.id, (tx) =>
      auditRepository(tx).list({ action: 'tenant.amend', limit: 1 }),
    );
    expect(amend[0]?.detail).toEqual({});
  });

  it('ends what is still live when a disabled tenant is disabled again', async () => {
    const t = await fixture.createTenant(`again-${newId()}`);
    const ada = await createPasswordSubject(fixture, t.id, 'ada', PASSWORD);
    const token = await fixture.systemAdminToken(['tenant-admin']);
    await call(token, 'PATCH', `/admin/tenants/${t.name}`, { enabled: false });
    await seedLiveSessions(t.id, ada, 2);

    const res = await call(token, 'PATCH', `/admin/tenants/${t.name}/settings`, {
      enabled: false,
    });
    expect(res.statusCode).toBe(200);
    expect(await liveSessionsOf(t.id)).toBe(0);
  });

  it('says so when an overlapping disable leaves it a session it did not see', async () => {
    const t = await fixture.createTenant(`overlap-${newId()}`);
    const ada = await createPasswordSubject(fixture, t.id, 'ada', PASSWORD);
    await seedLiveSessions(t.id, ada, TENANT_SESSIONS_END_LIMIT);
    await fixture.owner.db.execute(sql`UPDATE tenants SET enabled = false WHERE id = ${t.id}`);
    const token = await fixture.systemAdminToken(['tenant-admin']);

    // The first disable's batch ends every session and holds them locked; a
    // sign-in that raced the disable commits a session beside it. The second
    // disable's batch waits on the locked ones, finds them gone, and so ends
    // nothing while one is still live.
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withTenant(fixture.app.db, t.id, async (tx) => {
      const ended = await endSessionsWhere(
        tx,
        BATCH_DEPS.kek,
        batchInput(t.id),
        undefined,
        TENANT_SESSIONS_END_LIMIT,
      );
      await tx.execute(sql`
        INSERT INTO sessions (id, tenant_id, subject_id, expires_at, last_active_at, secret_hash)
        VALUES (gen_random_uuid(), ${t.id}, ${ada},
                ${new Date(fixture.clock.now().getTime() + 3_600_000).toISOString()}::timestamptz,
                ${fixture.clock.now().toISOString()}::timestamptz, md5(${t.id}))`);
      await released;
      return ended;
    });
    await waitForLockWaiters(0);
    const second = call(token, 'PATCH', `/admin/tenants/${t.name}`, { enabled: false });
    await waitForLockWaiters(1);
    release();

    expect(await first).toBe(TENANT_SESSIONS_END_LIMIT);
    const res = await second;
    expect(res.statusCode).toBe(500);
    expect(res.json<{ type: string; detail: string }>()).toMatchObject({
      type: 'about:blank#sessions-not-ended',
      detail: `${t.name} is disabled, but 1 of its sessions are still live: send the same request again to end them`,
    });
    expect(await liveSessionsOf(t.id)).toBe(1);
  });

  it('answers 500 sessions-not-ended when a batch fails, and the disable stands', async () => {
    const t = await signedInTenant();
    const token = await fixture.systemAdminToken(['tenant-admin']);
    await fixture.owner.db.execute(
      sql.raw(`
      CREATE FUNCTION refuse_delivery_${t.id.replaceAll('-', '_')}() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'delivery refused'; END $$;
      CREATE TRIGGER refuse_delivery BEFORE INSERT ON backchannel_logout_deliveries
        FOR EACH ROW WHEN (NEW.tenant_id = '${t.id}')
        EXECUTE FUNCTION refuse_delivery_${t.id.replaceAll('-', '_')}();`),
    );
    try {
      const res = await call(token, 'PATCH', `/admin/tenants/${t.name}`, { enabled: false });
      expect(res.statusCode).toBe(500);
      expect(res.json<{ type: string; detail: string }>()).toMatchObject({
        type: 'about:blank#sessions-not-ended',
        detail: `${t.name} is disabled, but not all of its sessions were ended: send the same request again to end them`,
      });
    } finally {
      await fixture.owner.db.execute(
        sql`DROP TRIGGER refuse_delivery ON backchannel_logout_deliveries`,
      );
    }
    const enabled = countRowsSchema.parse(
      await fixture.owner.db.execute(
        sql`SELECT count(*)::int AS n FROM tenants WHERE id = ${t.id} AND NOT enabled`,
      ),
    );
    expect(enabled[0]?.n).toBe(1);
    expect(await liveSessionsOf(t.id)).toBe(1);

    const again = await call(token, 'PATCH', `/admin/tenants/${t.name}`, { enabled: false });
    expect(again.statusCode).toBe(200);
    expect(await liveSessionsOf(t.id)).toBe(0);
  });

  it('ends nothing when it leaves the tenant as it was', async () => {
    const t = await signedInTenant();
    const token = await fixture.systemAdminToken(['tenant-admin']);
    await call(token, 'PATCH', `/admin/tenants/${t.name}`, { display_name: 'Still on' });
    expect(await liveSessionsOf(t.id)).toBe(1);
  });
});

describe('endDisabledTenantSessions', () => {
  it('ends nothing, and writes nothing, once the tenant is enabled again', async () => {
    const t = await signedInTenant();
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      endDisabledTenantSessions(tx, BATCH_DEPS, batchInput(t.id)),
    );
    expect(outcome).toEqual({ ended: 0, remaining: 0 });
    expect(await liveSessionsOf(t.id)).toBe(1);
    expect(await queuedDeliveriesOf(t.id)).toBe(0);
    expect(await endAllRowsOf(t.id)).toEqual([]);
  });
});

describe('DELETE /admin/tenants/:tenant', () => {
  it('removes every row the tenant holds, in every table, and audits it in system', async () => {
    const doomed = await populatedTenant();
    const before = await rowsPerTenantTable(doomed.id);
    const held = [...before].filter(([, n]) => n > 0).map(([table]) => table);
    expect(held.length, `tables holding rows: ${held.join(', ')}`).toBeGreaterThanOrEqual(20);

    const token = await fixture.systemAdminToken(['tenant-admin']);
    const url = `/admin/tenants/${doomed.name}?confirm=${encodeURIComponent(doomed.name)}`;
    const enabled = await call(token, 'DELETE', url);
    expect(enabled.statusCode).toBe(409);
    expect(enabled.json<{ type: string }>().type).toBe('about:blank#tenant-enabled');

    expect(
      (await call(token, 'PATCH', `/admin/tenants/${doomed.name}`, { enabled: false })).statusCode,
    ).toBe(200);
    const pending = await call(token, 'DELETE', url);
    expect(pending.statusCode).toBe(409);
    expect(pending.json<{ type: string; detail: string }>()).toMatchObject({
      type: 'about:blank#logout-deliveries-pending',
      detail:
        'Back-Channel Logout Tokens still to be sent: 1; deleting the tenant would discard them',
    });

    await deliverEverything(doomed.id);
    const res = await call(token, 'DELETE', url);
    expect(res.statusCode).toBe(204);

    const after = await rowsPerTenantTable(doomed.id);
    const left = [...after].filter(([, n]) => n > 0);
    expect(left, 'rows the deletion left behind').toEqual([]);

    const rows = await withTenant(fixture.app.db, SYSTEM_TENANT_ID, (tx) =>
      auditRepository(tx).list({ action: 'tenant.delete', resourceId: doomed.id, limit: 5 }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'allowed', resourceType: 'tenant' });
    expect(rows[0]?.detail).toEqual({ name: doomed.name });

    const again = await call(
      token,
      'DELETE',
      `/admin/tenants/${doomed.name}?confirm=${doomed.name}`,
    );
    expect(again.statusCode).toBe(401);
  });

  it('refuses a disabled tenant that still has a live session, with its own 409', async () => {
    const t = await fixture.createTenant(`live-${newId()}`);
    const ada = await createPasswordSubject(fixture, t.id, 'ada', PASSWORD);
    const token = await fixture.systemAdminToken(['tenant-admin']);
    await call(token, 'PATCH', `/admin/tenants/${t.name}`, { enabled: false });
    await seedLiveSessions(t.id, ada, 1);
    const url = `/admin/tenants/${t.name}?confirm=${t.name}`;

    const live = await call(token, 'DELETE', url);
    expect(live.statusCode).toBe(409);
    expect(live.json<{ type: string; detail: string }>()).toMatchObject({
      type: 'about:blank#sessions-live',
      detail: `sessions still live: 1; disable ${t.name} again to end them and tell their relying parties`,
    });
    expect((await rowsPerTenantTable(t.id)).get('tenants')).toBe(1);

    await call(token, 'PATCH', `/admin/tenants/${t.name}`, { enabled: false });
    expect((await call(token, 'DELETE', url)).statusCode).toBe(204);
  });

  it.each([
    ['spent every attempt', 0],
    ['was abandoned when due again', -60_000],
  ])('goes ahead past a delivery that %s', async (_state, dueOffset) => {
    const t = await signedInTenant();
    const token = await fixture.systemAdminToken(['tenant-admin']);
    await call(token, 'PATCH', `/admin/tenants/${t.name}`, { enabled: false });
    expect(await queuedDeliveriesOf(t.id)).toBe(1);
    await withTenant(fixture.app.db, t.id, (tx) =>
      tx.update(backchannelLogoutDeliveries).set({
        attempts: BACKCHANNEL_LOGOUT_MAX_ATTEMPTS,
        lastError: 'connect ECONNREFUSED',
        nextAttemptAt: new Date(fixture.clock.now().getTime() + dueOffset),
      }),
    );

    const res = await call(token, 'DELETE', `/admin/tenants/${t.name}?confirm=${t.name}`);
    expect(res.statusCode).toBe(204);
  });

  it('refuses a name that is not the tenant’s with 400 naming confirm, and deletes nothing', async () => {
    const t = await fixture.createTenant(`keep-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const wrong = await call(token, 'DELETE', `/admin/tenants/${t.name}?confirm=${t.name}x`);
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe('confirm');
    const missing = await call(token, 'DELETE', `/admin/tenants/${t.name}`);
    expect(missing.statusCode).toBe(400);
    expect((await rowsPerTenantTable(t.id)).get('tenants')).toBe(1);
  });

  it('refuses the system tenant with 409, and a row saying so', async () => {
    const token = await fixture.systemAdminToken(['tenant-admin']);
    const res = await call(
      token,
      'DELETE',
      `/admin/tenants/${SYSTEM_TENANT_NAME}?confirm=${SYSTEM_TENANT_NAME}`,
    );
    expect(res.statusCode).toBe(409);
    const rows = await withTenant(fixture.app.db, SYSTEM_TENANT_ID, (tx) =>
      auditRepository(tx).list({ action: 'tenant.delete', outcome: 'refused', limit: 5 }),
    );
    expect(rows[0]?.detail).toMatchObject({ reason: 'system_tenant_guarded' });
  });

  it('refuses a caller below what the tenant’s administrators hold, with a refused row', async () => {
    const t = await fixture.createTenant(`guarded-${newId()}`);
    await fixture.adminToken(t.name, ['tenant-admin']);
    const token = await fixture.systemAdminToken(['manage-tenants']);
    const res = await call(token, 'DELETE', `/admin/tenants/${t.name}?confirm=${t.name}`);
    expect(res.statusCode).toBe(403);
    expect((await rowsPerTenantTable(t.id)).get('tenants')).toBe(1);
    const rows = await withTenant(fixture.app.db, SYSTEM_TENANT_ID, (tx) =>
      auditRepository(tx).list({ action: 'tenant.delete', resourceId: t.id, limit: 5 }),
    );
    expect(rows[0]).toMatchObject({ outcome: 'refused' });
  });

  it('is refused to a tenant’s own administrator, who holds no manage-tenants', async () => {
    const t = await fixture.createTenant(`self-${newId()}`);
    const token = await fixture.adminToken(t.name, ['tenant-admin']);
    const res = await call(token, 'DELETE', `/admin/tenants/${t.name}?confirm=${t.name}`);
    expect(res.statusCode).toBe(403);
  });
});

describe('deleteTenantRows, probed with a foreign tenant_id', () => {
  it('finds and deletes no tenant from another tenant’s context', async () => {
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: async (tx, tenantId) => {
        const name = `probe-${newId()}`;
        await tx.insert(tenants).values({ id: tenantId, name });
        return { tenantId, name };
      },
      verifySeeded: async (tx, seeded) => {
        expect(await tx.select().from(tenants)).toHaveLength(1);
        expect(seeded.name).toMatch(/^probe-/u);
      },
      attempt: (tx, seeded) =>
        deleteTenantRows(tx, {
          tenantId: seeded.tenantId,
          now: new Date(),
          confirm: seeded.name,
          callerCapabilities: new Set(['tenant-admin']),
          actorSubjectId: newId(),
          actorTenantId: newId(),
          actorClientId: newId(),
        }),
      expectBlocked: (result) => {
        expect(result).toEqual({ kind: 'not_found' });
      },
      verifyTenantAUnaffected: async (tx) => {
        expect(await tx.select().from(tenants)).toHaveLength(1);
      },
    });
  });
});

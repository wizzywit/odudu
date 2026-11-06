import { request as httpRequest } from 'node:http';
import { type AddressInfo } from 'node:net';
import { TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

// The first integer of the capacity lock repository/idempotency.ts takes.
const CAPACITY_LOCK = 20_261_106;

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
let port: number;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture({ poolMax: 3 });
  fixture = fixtureHandle;
  await fixture.http.listen({ port: 0, host: '127.0.0.1' });
  port = (fixture.http.server.address() as AddressInfo).port;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

interface Sent {
  readonly status: Promise<number>;
  readonly abandon: () => void;
}

function sendRole(tenant: string, token: string, name: string): Sent {
  const body = JSON.stringify({ name });
  let abandon: () => void = () => undefined;
  const status = new Promise<number>((resolve) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `/admin/tenants/${tenant}/roles`,
        headers: {
          host: 'localhost:80',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'idempotency-key': `k-${newId()}`,
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', () => {
      resolve(0);
    });
    abandon = () => {
      req.destroy();
    };
    req.end(body);
  });
  return {
    status,
    abandon: () => {
      abandon();
    },
  };
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function rolesNamed(tenantId: string, name: string): Promise<number> {
  const rows = await fixture.owner.db.execute(
    sql`select count(*)::int as n from roles where tenant_id = ${tenantId} and name = ${name}`,
  );
  return (rows as unknown as { n: number }[])[0]?.n ?? 0;
}

describe('a keyed call waiting for a slot', () => {
  it('waits for a caller still connected whose body has been read, and leaves when the caller goes', async () => {
    const t = await fixture.createTenant(`gate-${newId()}`);
    const token = await fixture.adminToken(t.name, [...TENANT_CAPABILITIES]);
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // Holds the capacity lock, so the one call the gate lets in waits on it
    // with its slot taken.
    const blocker = fixture.owner.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${CAPACITY_LOCK}::int, hashtext(${t.id}::text))`,
      );
      locked();
      await released;
    });
    await lockTaken;

    const inside = `inside-${newId()}`;
    const waiting = `waiting-${newId()}`;
    const leaving = `leaving-${newId()}`;
    const first = sendRole(t.name, token, inside);
    await pause(400);
    const second = sendRole(t.name, token, waiting);
    const third = sendRole(t.name, token, leaving);
    await pause(600);
    third.abandon();
    await pause(200);
    release();
    await blocker;

    expect(await first.status).toBe(201);
    expect(await second.status).toBe(201);
    await pause(300);
    expect(await rolesNamed(t.id, waiting)).toBe(1);
    expect(await rolesNamed(t.id, leaving)).toBe(0);
  }, 60_000);
});

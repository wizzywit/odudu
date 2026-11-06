import { withSavepoint, withTenant } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { idempotencyRepository } from '#/repository/idempotency';
import {
  IDEMPOTENCY_MAX_LIVE_KEYS,
  IDEMPOTENCY_WINDOW_SECONDS,
  fingerprintOf,
} from '#/service/idempotency';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import {
  IdempotencyRollback,
  withIdempotency,
  type IdempotencyInput,
  type IdempotentResponse,
  type RunOutcome,
} from '#/usecase/idempotent';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const NOW = new Date('2026-11-05T12:00:00Z');
const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`;
const ROUTE = 'POST /admin/tenants/:tenant/clients';

function ok(body: string, status = 201): RunOutcome {
  return {
    response: { status, body, headers: { 'content-type': 'application/json; charset=utf-8' } },
    withinTransaction: true,
  };
}

async function world() {
  const t = await fixture.createTenant(`idem-${newId()}`);
  const input = (overrides: Partial<IdempotencyInput> = {}): IdempotencyInput => ({
    tenantId: t.id,
    key: `key-${newId()}`,
    route: ROUTE,
    fingerprint: fingerprintOf('POST', '/x', { a: 1 }),
    now: NOW,
    ...overrides,
  });
  const call = (inp: IdempotencyInput, run: () => Promise<RunOutcome>) =>
    withTenant(fixture.app.db, inp.tenantId, (tx) => withIdempotency(tx, inp, run));
  return { t, input, call };
}

async function rowCount(tenantId: string): Promise<number> {
  const rows = await fixture.owner.db.execute(
    sql`select count(*)::int as n from idempotency_keys where tenant_id = ${tenantId}`,
  );
  return (rows as unknown as { n: number }[])[0]?.n ?? 0;
}

describe('withIdempotency', () => {
  it('runs a first call and stores its success', async () => {
    const { t, input, call } = await world();
    const inp = input();
    let runs = 0;
    const result = await call(inp, () => {
      runs += 1;
      return Promise.resolve(ok('{"id":"1"}'));
    });
    expect(runs).toBe(1);
    expect(result).toMatchObject({ kind: 'fresh', stored: true });
    expect(await rowCount(t.id)).toBe(1);
  });

  it('answers a replay with the stored status, body and headers, and does not run again', async () => {
    const { input, call } = await world();
    const inp = input();
    await call(inp, () => Promise.resolve(ok('{"id":"1"}', 201)));
    let runs = 0;
    const replay = await call(inp, () => {
      runs += 1;
      return Promise.resolve(ok('{"id":"2"}'));
    });
    expect(runs).toBe(0);
    expect(replay).toEqual({
      kind: 'stored',
      response: {
        status: 201,
        body: '{"id":"1"}',
        headers: { 'content-type': 'application/json; charset=utf-8' },
      } satisfies IdempotentResponse,
    });
  });

  it('refuses the same key with a different fingerprint, running nothing', async () => {
    const { input, call } = await world();
    const inp = input();
    await call(inp, () => Promise.resolve(ok('{}')));
    let runs = 0;
    const other = await call({ ...inp, fingerprint: fingerprintOf('POST', '/x', { a: 2 }) }, () => {
      runs += 1;
      return Promise.resolve(ok('{}'));
    });
    expect(other).toEqual({ kind: 'reused' });
    expect(runs).toBe(0);
  });

  it('keeps one key apart on two routes', async () => {
    const { input, call } = await world();
    const inp = input();
    await call(inp, () => Promise.resolve(ok('{"a":1}')));
    const elsewhere = await call({ ...inp, route: 'POST /admin/tenants/:tenant/roles' }, () =>
      Promise.resolve(ok('{"b":2}')),
    );
    expect(elsewhere).toMatchObject({ kind: 'fresh', stored: true });
  });

  it('treats another tenant’s identical key as its own', async () => {
    const a = await world();
    const b = await world();
    const key = `shared-${newId()}`;
    await a.call(a.input({ key }), () => Promise.resolve(ok('{"tenant":"a"}')));
    const second = await b.call(b.input({ key }), () => Promise.resolve(ok('{"tenant":"b"}')));
    expect(second).toMatchObject({ kind: 'fresh', response: { body: '{"tenant":"b"}' } });
  });

  it('runs an expired key again, in the same row', async () => {
    const { t, input, call } = await world();
    const inp = input();
    await call(inp, () => Promise.resolve(ok('{"n":1}')));
    const later = new Date(NOW.getTime() + (IDEMPOTENCY_WINDOW_SECONDS + 1) * 1000);
    const again = await call({ ...inp, now: later }, () => Promise.resolve(ok('{"n":2}')));
    expect(again).toMatchObject({ kind: 'fresh', stored: true, response: { body: '{"n":2}' } });
    expect(await rowCount(t.id)).toBe(1);
    const replay = await call({ ...inp, now: later }, () => Promise.resolve(ok('{"n":3}')));
    expect(replay).toMatchObject({ kind: 'stored', response: { body: '{"n":2}' } });
  });

  it('is live for the whole window and not past it', async () => {
    const { input, call } = await world();
    const inp = input();
    await call(inp, () => Promise.resolve(ok('{}')));
    const edge = new Date(NOW.getTime() + IDEMPOTENCY_WINDOW_SECONDS * 1000 - 1);
    expect(await call({ ...inp, now: edge }, () => Promise.resolve(ok('{}')))).toMatchObject({
      kind: 'stored',
    });
    const past = new Date(NOW.getTime() + IDEMPOTENCY_WINDOW_SECONDS * 1000);
    expect(await call({ ...inp, now: past }, () => Promise.resolve(ok('{}')))).toMatchObject({
      kind: 'fresh',
    });
  });

  it('stores nothing when the run throws, so a retry runs again', async () => {
    const { t, input, call } = await world();
    const inp = input();
    await expect(call(inp, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await rowCount(t.id)).toBe(0);
    const retry = await call(inp, () => Promise.resolve(ok('{"ok":true}')));
    expect(retry).toMatchObject({ kind: 'fresh', stored: true });
  });

  it('stores nothing for a refusal, and answers it as the run did', async () => {
    const { t, input, call } = await world();
    const inp = input();
    const refused = await call(inp, () =>
      Promise.resolve({
        response: { status: 409, body: '{"type":"x"}', headers: {} },
        withinTransaction: true,
      }),
    );
    expect(refused).toMatchObject({ kind: 'fresh', stored: false, response: { status: 409 } });
    expect(await rowCount(t.id)).toBe(0);
  });

  it('refuses a duplicate while the first is in flight, and runs it once', async () => {
    const { t, input } = await world();
    const inp = input();
    let release = (): void => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = (): void => undefined;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let runs = 0;
    const first = withTenant(fixture.app.db, t.id, (tx) =>
      withIdempotency(tx, inp, async () => {
        runs += 1;
        entered();
        await hold;
        return ok('{"first":true}');
      }),
    );
    await inside;
    const second = await withTenant(fixture.app.db, t.id, (tx) =>
      withIdempotency(tx, inp, () => {
        runs += 1;
        return Promise.resolve(ok('{"second":true}'));
      }),
    );
    expect(second).toEqual({ kind: 'in_flight' });
    release();
    expect(await first).toMatchObject({ kind: 'fresh', stored: true });
    expect(runs).toBe(1);
    const third = await withTenant(fixture.app.db, t.id, (tx) =>
      withIdempotency(tx, inp, () => Promise.resolve(ok('{"third":true}'))),
    );
    expect(third).toMatchObject({ kind: 'stored', response: { body: '{"first":true}' } });
  });

  it('frees the key when the first call fails while a duplicate waits out its lock', async () => {
    const { input, call } = await world();
    const inp = input();
    let release = (): void => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = (): void => undefined;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = call(inp, async () => {
      entered();
      await hold;
      throw new Error('fails');
    });
    const settled = first.catch(() => undefined);
    await inside;
    expect(await call(inp, () => Promise.resolve(ok('{}')))).toEqual({ kind: 'in_flight' });
    release();
    await settled;
    expect(await call(inp, () => Promise.resolve(ok('{"retry":true}')))).toMatchObject({
      kind: 'fresh',
      stored: true,
    });
  });

  it('undoes a response over the cap, writing no row and keeping what the run wrote', async () => {
    const { t, input } = await world();
    const inp = input();
    const probe = `probe-${newId()}`;
    const attempt = withTenant(fixture.app.db, t.id, (tx) =>
      withIdempotency(tx, inp, async () => {
        await tx.execute(
          sql`insert into idempotency_keys (tenant_id, key, route, fingerprint, status, response_status, response_body, created_at, expires_at)
              values (${t.id}, ${probe}, 'x', ${'0'.repeat(64)}, 'completed', 200, '', ${ts(NOW)}, ${ts(new Date(NOW.getTime() + 1000))})`,
        );
        return ok('x'.repeat(64 * 1024 + 1));
      }),
    );
    await expect(attempt).rejects.toBeInstanceOf(IdempotencyRollback);
    await expect(attempt).rejects.toMatchObject({ result: { kind: 'too_large' } });
    expect(await rowCount(t.id)).toBe(0);
  });

  it('does not undo a run that happened outside the transaction, and stores nothing for it', async () => {
    const { t, input, call } = await world();
    const inp = input();
    const result = await call(inp, () =>
      Promise.resolve({
        response: { status: 201, body: 'x'.repeat(64 * 1024 + 1), headers: {} },
        withinTransaction: false,
      }),
    );
    expect(result).toMatchObject({ kind: 'fresh', stored: false });
    expect(await rowCount(t.id)).toBe(0);
  });

  it('stores a response of exactly the cap', async () => {
    const { input, call } = await world();
    const result = await call(input(), () => Promise.resolve(ok('x'.repeat(64 * 1024))));
    expect(result).toMatchObject({ kind: 'fresh', stored: true });
  });

  it('refuses a new key at the per-tenant ceiling without running it', async () => {
    const { t, input, call } = await world();
    await fixture.owner.db.execute(sql`
      insert into idempotency_keys (tenant_id, key, route, fingerprint, status, response_status,
                                    response_body, created_at, expires_at)
      select ${t.id}, 'fill-' || g, 'r', ${'0'.repeat(64)}, 'completed', 200, '', ${ts(NOW)},
             ${ts(new Date(NOW.getTime() + 3_600_000))}
        from generate_series(1, ${IDEMPOTENCY_MAX_LIVE_KEYS}) g`);
    let runs = 0;
    const result = await call(input(), () => {
      runs += 1;
      return Promise.resolve(ok('{}'));
    });
    expect(result).toEqual({ kind: 'capacity' });
    expect(runs).toBe(0);
    expect(await rowCount(t.id)).toBe(IDEMPOTENCY_MAX_LIVE_KEYS);
  });

  it('still replays a stored key when the tenant is at the ceiling', async () => {
    const { t, input, call } = await world();
    const inp = input();
    await call(inp, () => Promise.resolve(ok('{"kept":true}')));
    await fixture.owner.db.execute(sql`
      insert into idempotency_keys (tenant_id, key, route, fingerprint, status, response_status,
                                    response_body, created_at, expires_at)
      select ${t.id}, 'fill-' || g, 'r', ${'0'.repeat(64)}, 'completed', 200, '', ${ts(NOW)},
             ${ts(new Date(NOW.getTime() + 3_600_000))}
        from generate_series(1, ${IDEMPOTENCY_MAX_LIVE_KEYS - 1}) g`);
    expect(await call(inp, () => Promise.resolve(ok('{}')))).toMatchObject({ kind: 'stored' });
  });

  it('does not count an expired row against the ceiling', async () => {
    const { t, input, call } = await world();
    await fixture.owner.db.execute(sql`
      insert into idempotency_keys (tenant_id, key, route, fingerprint, status, response_status,
                                    response_body, created_at, expires_at)
      select ${t.id}, 'old-' || g, 'r', ${'0'.repeat(64)}, 'completed', 200, '',
             ${ts(new Date(NOW.getTime() - 7_200_000))}, ${ts(new Date(NOW.getTime() - 3_600_000))}
        from generate_series(1, ${IDEMPOTENCY_MAX_LIVE_KEYS}) g`);
    expect(await call(input(), () => Promise.resolve(ok('{}')))).toMatchObject({ kind: 'fresh' });
  });

  it('holds the ceiling when calls with different keys race for the last slot', async () => {
    const { t, input } = await world();
    await fixture.owner.db.execute(sql`
      insert into idempotency_keys (tenant_id, key, route, fingerprint, status, response_status,
                                    response_body, created_at, expires_at)
      select ${t.id}, 'fill-' || g, 'r', ${'0'.repeat(64)}, 'completed', 200, '', ${ts(NOW)},
             ${ts(new Date(NOW.getTime() + 3_600_000))}
        from generate_series(1, ${IDEMPOTENCY_MAX_LIVE_KEYS - 1}) g`);
    const attempts = await Promise.allSettled(
      [1, 2, 3, 4].map(() =>
        withTenant(fixture.app.db, t.id, (tx) =>
          withIdempotency(tx, input(), () => Promise.resolve(ok('{}'))),
        ),
      ),
    );
    const stored = attempts.filter(
      (a) => a.status === 'fulfilled' && a.value.kind === 'fresh' && a.value.stored,
    );
    expect(stored).toHaveLength(1);
    expect(await rowCount(t.id)).toBe(IDEMPOTENCY_MAX_LIVE_KEYS);
  });
});

describe('idempotencyRepository', () => {
  it('reads and writes only the bound tenant’s rows, probed with a foreign tenant_id', async () => {
    const a = await world();
    const b = await world();
    const inp = a.input();
    await a.call(inp, () => Promise.resolve(ok('{"mine":true}')));

    await withTenant(fixture.app.db, b.t.id, async (tx) => {
      const repository = idempotencyRepository(tx);
      expect(await repository.find(a.t.id, inp.key, inp.route, NOW)).toBeNull();
      expect(await repository.countLive(a.t.id, NOW, IDEMPOTENCY_MAX_LIVE_KEYS)).toBe(0);
      await expect(
        withSavepoint(tx, (inner) =>
          idempotencyRepository(inner).insert({
            tenantId: a.t.id,
            key: 'stolen',
            route: inp.route,
            fingerprint: inp.fingerprint,
            response: { status: 200, body: '{}', headers: {} },
            now: NOW,
            expiresAt: new Date(NOW.getTime() + 1000),
          }),
        ),
      ).rejects.toThrow();
    });
    expect(await rowCount(a.t.id)).toBe(1);
  });

  it('takes its locks per tenant, probed with a foreign tenant_id', async () => {
    const a = await world();
    const b = await world();
    const key = `shared-${newId()}`;
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const holder = withTenant(fixture.app.db, a.t.id, async (tx) => {
      const repository = idempotencyRepository(tx);
      expect(await repository.tryLockKey(a.t.id, key, ROUTE)).toBe(true);
      await repository.lockCapacity(a.t.id);
      held();
      await released;
    });
    await holding;

    const slow = <T>(promise: Promise<T>): Promise<T | 'waiting'> =>
      Promise.race([promise, new Promise<'waiting'>((r) => setTimeout(() => r('waiting'), 700))]);
    try {
      await withTenant(fixture.app.db, b.t.id, async (tx) => {
        const repository = idempotencyRepository(tx);
        expect(await repository.tryLockKey(b.t.id, key, ROUTE)).toBe(true);
        expect(await repository.tryLockKey(a.t.id, key, ROUTE)).toBe(false);
        expect(await slow(repository.lockCapacity(b.t.id))).toBeUndefined();
      });
      const sameTenant = withTenant(fixture.app.db, a.t.id, (tx) =>
        idempotencyRepository(tx).lockCapacity(a.t.id),
      );
      expect(await slow(sameTenant)).toBe('waiting');
      release();
      await sameTenant;
    } finally {
      release();
      await holder;
    }
  });

  it('counts at most the limit it is given', async () => {
    const { t } = await world();
    await fixture.owner.db.execute(sql`
      insert into idempotency_keys (tenant_id, key, route, fingerprint, status, response_status,
                                    response_body, created_at, expires_at)
      select ${t.id}, 'c-' || g, 'r', ${'0'.repeat(64)}, 'completed', 200, '', ${ts(NOW)},
             ${ts(new Date(NOW.getTime() + 3_600_000))}
        from generate_series(1, 50) g`);
    const counted = await withTenant(fixture.app.db, t.id, (tx) =>
      idempotencyRepository(tx).countLive(t.id, NOW, 10),
    );
    expect(counted).toBe(10);
  });

  it('refuses a row the table’s own checks forbid', async () => {
    const { t } = await world();
    const insert = (response: IdempotentResponse, fingerprint = '0'.repeat(64)) =>
      withTenant(fixture.app.db, t.id, (tx) =>
        idempotencyRepository(tx).insert({
          tenantId: t.id,
          key: `k-${newId()}`,
          route: 'r',
          fingerprint,
          response,
          now: NOW,
          expiresAt: new Date(NOW.getTime() + 1000),
        }),
      );
    await expect(insert({ status: 500, body: '', headers: {} })).rejects.toThrow();
    await expect(insert({ status: 200, body: 'x'.repeat(65537), headers: {} })).rejects.toThrow();
    await expect(insert({ status: 200, body: '', headers: {} }, 'not-hex')).rejects.toThrow();
  });
});

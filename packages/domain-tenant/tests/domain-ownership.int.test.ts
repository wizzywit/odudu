import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_DOMAINS_PER_TENANT, tenantDomainRepository } from '#/repository/tenant-domains';
import { registerDomain } from '#/usecase/register-domain';
import { type ResolveTxt } from '#/service/tenant-domain';
import { verifyDomain } from '#/usecase/verify-domain';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 8 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

const NOW = new Date('2026-11-04T12:00:00Z');
const BASE = 'https://id.operator.net';

async function newTenant(): Promise<{ id: string; name: string }> {
  const id = newId();
  const name = `t-${id.slice(-12)}`;
  await withTenant(app.db, id, (tx) => tx.insert(tenants).values({ id, name }));
  return { id, name };
}

let counter = 0;
let fill = 0;
const freshHost = (): string => `login${String((counter += 1))}.acme.com`;

function register(tenant: { id: string; name: string }, host: string) {
  return withTenant(app.db, tenant.id, (tx) =>
    registerDomain(
      {
        domains: tenantDomainRepository(tx),
        publicBaseUrl: BASE,
        random: () => Buffer.alloc(32, (fill += 1)),
      },
      tenant,
      host,
    ),
  );
}

async function registered(tenant: { id: string; name: string }, host = freshHost()) {
  const out = await register(tenant, host);
  if (out.kind !== 'registered') throw new Error(`refused: ${out.code}`);
  return out;
}

const publishing =
  (name: string, value: string): ResolveTxt =>
  (asked) =>
    Promise.resolve(asked === name ? [[value]] : []);

function verify(tenantId: string, id: string, resolveTxt: ResolveTxt) {
  return withTenant(app.db, tenantId, (tx) =>
    verifyDomain({ resolveTxt, domains: tenantDomainRepository(tx) }, tenantId, id, NOW),
  );
}

describe('registerDomain against the table', () => {
  it('stores the canonical spelling with a challenge and names the record', async () => {
    const tenant = await newTenant();
    const out = await registered(tenant, 'Shop.ACME.com.:443');
    expect(out.row).toMatchObject({ host: 'shop.acme.com', state: 'pending' });
    expect(out.recordName).toBe('_odudu-challenge.shop.acme.com');
    expect(out.recordValue).toBe(out.row.challenge);
  });

  it('refuses the same host twice and a host past the cap', async () => {
    const tenant = await newTenant();
    const first = await registered(tenant);
    expect(await register(tenant, first.row.host)).toEqual({
      kind: 'refused',
      code: 'domain_already_registered',
    });
    for (let n = 1; n < MAX_DOMAINS_PER_TENANT; n += 1) await registered(tenant);
    expect(await register(tenant, freshHost())).toEqual({ kind: 'refused', code: 'domain_limit' });
  });
});

describe('verifyDomain against the table', () => {
  it('verifies when the record is published and stays pending when it is not', async () => {
    const tenant = await newTenant();
    const { row, recordName, recordValue } = await registered(tenant);
    expect(await verify(tenant.id, row.id, () => Promise.resolve([]))).toBe('pending');
    const checked = await withTenant(app.db, tenant.id, (tx) =>
      tenantDomainRepository(tx).get(tenant.id, row.id),
    );
    expect(checked).toMatchObject({ state: 'pending', failedChecks: 1 });
    expect(await verify(tenant.id, row.id, publishing(recordName, recordValue))).toBe('verified');
    const done = await withTenant(app.db, tenant.id, (tx) =>
      tenantDomainRepository(tx).get(tenant.id, row.id),
    );
    expect(done).toMatchObject({ state: 'verified', failedChecks: 0 });
  });

  it('leaves a row pending when the resolver fails', async () => {
    const tenant = await newTenant();
    const { row } = await registered(tenant);
    const down: ResolveTxt = () => Promise.reject(new Error('ESERVFAIL'));
    expect(await verify(tenant.id, row.id, down)).toBe('pending');
    const after = await withTenant(app.db, tenant.id, (tx) =>
      tenantDomainRepository(tx).get(tenant.id, row.id),
    );
    expect(after).toMatchObject({ state: 'pending', failedChecks: 0 });
  });

  it('gives the host to the first tenant and a typed refusal to the second, tx intact', async () => {
    const a = await newTenant();
    const b = await newTenant();
    const host = freshHost();
    const first = await registered(a, host);
    const second = await registered(b, host);
    expect(await verify(a.id, first.row.id, publishing(first.recordName, first.recordValue))).toBe(
      'verified',
    );
    const { outcome, listed } = await withTenant(app.db, b.id, async (tx) => {
      const domains = tenantDomainRepository(tx);
      const resolveTxt = publishing(second.recordName, second.recordValue);
      const result = await verifyDomain({ resolveTxt, domains }, b.id, second.row.id, NOW);
      return { outcome: result, listed: await domains.page(b.id, { limit: 50 }) };
    });
    expect(outcome).toBe('verified_elsewhere');
    expect(listed).toMatchObject([{ id: second.row.id, state: 'pending' }]);
  });

  it('cannot verify another tenant row, even with the right record', async () => {
    const a = await newTenant();
    const b = await newTenant();
    const mine = await registered(a);
    const resolveTxt = publishing(mine.recordName, mine.recordValue);
    expect(await verify(b.id, mine.row.id, resolveTxt)).toBe('not_found');
    const viaB = await withTenant(app.db, b.id, (tx) =>
      verifyDomain({ resolveTxt, domains: tenantDomainRepository(tx) }, a.id, mine.row.id, NOW),
    );
    expect(viaB).toBe('not_found');
    const still = await withTenant(app.db, a.id, (tx) =>
      tenantDomainRepository(tx).get(a.id, mine.row.id),
    );
    expect(still).toMatchObject({ state: 'pending', failedChecks: 0 });
  });
});

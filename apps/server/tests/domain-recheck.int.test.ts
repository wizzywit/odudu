import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { tenantDomainRepository, tenantDomains, type ResolveTxt } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recheckDomainsLocked, type DomainRecheckOptions } from '#/cli/domains';

let container: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const NOW = new Date('2026-11-04T12:00:00.000Z');
const OPTIONS: DomainRecheckOptions = {
  threshold: 3,
  base: 'https://id.operator.net',
  tls: true,
  pageSize: 2,
  concurrency: 4,
};
const CHALLENGE = 'odudu-domain-verification=int';

beforeAll(async () => {
  container = await startTestDatabase();
  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(container.adminUrl), { max: 6 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await container?.stop();
});

interface Seeded {
  tenantId: string;
  name: string;
  domainId: string;
  host: string;
}

async function seed(label: string, canonical: boolean): Promise<Seeded> {
  const tenantId = newId();
  const name = `rc-${label}-${tenantId.slice(0, 8)}`;
  const domainId = newId();
  const host = `${label}-${tenantId.slice(0, 8)}.acme.com`;
  await owner.db.insert(tenants).values({ id: tenantId, name });
  await owner.db.insert(tenantDomains).values({
    id: domainId,
    tenantId,
    host,
    state: 'verified',
    challenge: CHALLENGE,
    verifiedAt: NOW,
    canonical,
  });
  return { tenantId, name, domainId, host };
}

const failing = (code: string) => () => Promise.reject(Object.assign(new Error(code), { code }));

function answering(missing: readonly string[], broken: readonly string[] = []): ResolveTxt {
  return (name) => {
    if (broken.some((host) => name.endsWith(host))) return failing('ESERVFAIL')();
    if (missing.some((host) => name.endsWith(host))) return failing('ENOTFOUND')();
    return Promise.resolve([[CHALLENGE]]);
  };
}

interface Stored {
  state: string;
  canonical: boolean;
  failed_checks: number;
  xmin: string;
}

async function stored(domainId: string): Promise<Stored> {
  const rows = await owner.db.execute<Stored & Record<string, unknown>>(
    sql`select state, canonical, failed_checks, xmin::text as xmin from tenant_domains where id = ${domainId}`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error('row vanished');
  return row;
}

describe('recheckDomainsLocked', () => {
  it('writes nothing for a domain that still proves ownership', async () => {
    const healthy = await seed('healthy', true);
    const before = await stored(healthy.domainId);
    const outcome = await recheckDomainsLocked(
      { database: app, ownerDatabase: owner, resolveTxt: answering([]) },
      NOW,
      OPTIONS,
    );
    expect(outcome.ran).toBe(true);
    expect(await stored(healthy.domainId)).toEqual(before);
  });

  it('fails a lost domain on the third miss and returns its tenant to the path address', async () => {
    const lost = await seed('lost', true);
    const kept = await seed('kept', true);
    const resolveTxt = answering([lost.host]);
    const deps = { database: app, ownerDatabase: owner, resolveTxt };

    await recheckDomainsLocked(deps, NOW, OPTIONS);
    await recheckDomainsLocked(deps, NOW, OPTIONS);
    expect(await stored(lost.domainId)).toMatchObject({
      state: 'verified',
      canonical: true,
      failed_checks: 2,
    });

    const third = await recheckDomainsLocked(deps, NOW, OPTIONS);
    expect(third).toMatchObject({ ran: true, failed: 1, fellBack: 1 });
    expect(await stored(lost.domainId)).toMatchObject({ state: 'failed', canonical: false });
    expect(await stored(kept.domainId)).toMatchObject({ state: 'verified', canonical: true });

    const retired = await withTenant(app.db, lost.tenantId, (tx) =>
      tenantDomainRepository(tx).listRetired(lost.tenantId, NOW),
    );
    expect(retired.map((r) => r.issuer)).toEqual([`https://${lost.host}`]);

    const audit = await owner.db.execute<
      { action: string; outcome: string; detail: unknown } & Record<string, unknown>
    >(sql`select action, outcome, detail from audit_events where resource_id = ${lost.domainId}`);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'domain.failed',
      outcome: 'failed',
      detail: { host: lost.host, reason: 'ownership_lost', fell_back: true },
    });
  });

  it('counts a resolver outage as nothing', async () => {
    const a = await seed('outage-a', true);
    const b = await seed('outage-b', false);
    await owner.db.execute(
      sql`update tenant_domains set failed_checks = 2 where id in (${a.domainId}, ${b.domainId})`,
    );
    const resolveTxt = answering([], ['.acme.com']);
    const outcome = await recheckDomainsLocked(
      { database: app, ownerDatabase: owner, resolveTxt },
      NOW,
      OPTIONS,
    );
    expect(outcome.ran).toBe(true);
    expect(await stored(a.domainId)).toMatchObject({
      state: 'verified',
      canonical: true,
      failed_checks: 2,
    });
    expect(await stored(b.domainId)).toMatchObject({ state: 'verified', failed_checks: 2 });
  });

  it('skips a pass whose lock another instance holds', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let attempts = 0;
    const winner = recheckDomainsLocked(
      {
        database: app,
        ownerDatabase: owner,
        resolveTxt: answering([]),
        onLockAttempt: async () => {
          attempts += 1;
          await held;
        },
      },
      NOW,
      OPTIONS,
    );
    while (attempts === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    const loser = await recheckDomainsLocked(
      { database: app, ownerDatabase: owner, resolveTxt: answering([]) },
      NOW,
      OPTIONS,
    );
    release();
    expect(loser).toEqual({ ran: false, reason: 'another instance holds the recheck lock' });
    expect((await winner).ran).toBe(true);
  });

  it('refuses a serving connection that bypasses row-level security', async () => {
    await expect(
      recheckDomainsLocked({ database: owner, ownerDatabase: owner }, NOW, OPTIONS),
    ).rejects.toMatchObject({ code: 'domain_recheck_serving_role_bypasses_rls' });
  });
});

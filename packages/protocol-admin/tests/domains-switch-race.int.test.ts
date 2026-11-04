import { withTenant } from '@odudu/db';
import { tenantDomainRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { switchEtag } from '#/service/domain-wire';
import { createVerifyThrottle } from '#/service/domain-throttle';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { activateDomain, type Audit, type DomainsDeps } from '#/usecase/domains';

const BASE = 'https://id.operator.test';

let fixture: AdminFixture | undefined;
function fx(): AdminFixture {
  if (fixture === undefined) throw new Error('fixture not started');
  return fixture;
}

beforeAll(async () => {
  fixture = await startAdminFixture({ domainsBaseUrl: BASE });
}, 180_000);
afterAll(async () => {
  await fixture?.stop();
});

const actor = {
  actorSubjectId: newId(),
  actorTenantId: newId(),
  actorClientId: newId(),
};

function depsWith(audit: Audit): DomainsDeps {
  return {
    audit,
    resolveTxt: () => Promise.reject(new Error('not used')),
    random: () => Buffer.alloc(32, 1),
    publicBaseUrl: BASE,
    tls: true,
    throttle: createVerifyThrottle(),
  };
}

async function verifiedDomain(tenantId: string, host: string): Promise<string> {
  return withTenant(fx().app.db, tenantId, async (tx) => {
    const repository = tenantDomainRepository(tx);
    const row = await repository.insert({ tenantId, host, challenge: 'c' });
    await repository.markVerified(tenantId, row.id, new Date());
    return row.id;
  });
}

async function waitForLockWait(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await fx().owner.sql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock'`;
    if ((rows[0]?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('the second switch never waited on the first');
}

describe('two admins activating two domains at once', () => {
  it('lets the first win and answers the second a conflict, with one canonical row', async () => {
    const tenant = await fx().createTenant(`race-${newId()}`);
    const a = await verifiedDomain(tenant.id, 'a.race-corp.org');
    const b = await verifiedDomain(tenant.id, 'b.race-corp.org');

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held: () => void = () => undefined;
    const firstHoldsTheLock = new Promise<void>((resolve) => {
      held = resolve;
    });
    const slowAudit: Audit = async () => {
      held();
      await gate;
    };

    const first = withTenant(fx().app.db, tenant.id, (tx) =>
      activateDomain(
        tx,
        depsWith(slowAudit),
        { tenant, id: a, ifMatch: switchEtag(null), ...actor },
        new Date(),
      ),
    );
    await firstHoldsTheLock;
    const second = withTenant(fx().app.db, tenant.id, (tx) =>
      activateDomain(
        tx,
        depsWith(() => Promise.resolve()),
        { tenant, id: b, ifMatch: switchEtag(null), ...actor },
        new Date(),
      ),
    );
    await waitForLockWait();
    release();

    expect((await first).kind).toBe('ok');
    expect((await second).kind).toBe('conflict');
    const canonical = await withTenant(fx().app.db, tenant.id, (tx) =>
      tenantDomainRepository(tx).canonical(tenant.id),
    );
    expect(canonical?.id).toBe(a);
  });
});

import { type Database, withTenant } from '@odudu/db';
import { credentialRepository } from '@odudu/domain-identity';
import { assetRepository, themeRepository } from '@odudu/domain-theme';
import {
  canonicalHostOf,
  hostState,
  lookupHost,
  tenantAddressing,
  tenantDomainRepository,
  verifiedDomainPage,
} from '@odudu/domain-tenant';
import { capturingSender, sendPending } from '@odudu/email';
import { loadConfig } from '@odudu/kernel';
import {
  CIMD_CACHE_MAX_ROWS,
  cimdCacheRepository,
  parseCimdDocument,
  persistCimdClient,
  publicExchangeClientsAtRisk,
  tenantCimdRepository,
} from '@odudu/protocol-oidc';
import {
  fingerprintOf,
  idempotencyRepository,
  IDEMPOTENCY_WINDOW_SECONDS,
  withIdempotency,
} from '@odudu/protocol-admin';
import { PgDialect } from 'drizzle-orm/pg-core';
import { type LightMyRequestResponse } from 'fastify';
import { REAP_ORDER, RETENTION_RULES, retentionPolicyFromConfig } from '#/cli/reap';
import { logoutSenderOptionsFromConfig, sendLogoutsAcrossTenants } from '#/cli/send-logouts';
import { outboxOptionsFromConfig } from '#/cli/send-mail';
import { browse, Jar, signIn, startConsoleApp } from '#/testing/console-harness';
import { type Capture, type PathRun } from '#/testing/plan-paths';
import { PUBLIC_BASE_URL, TARGET_TENANT, type PlanWorld } from '#/testing/plan-world';

const WRITE = { origin: PUBLIC_BASE_URL, 'x-odudu-console': '1' };

// The mail and logout senders and the console's own session routes, run as
// the server runs them; the retention rules are not run but planned, since
// running them would delete the volume the rest of the check reads.
export async function driveBackground(world: PlanWorld, capture: Capture): Promise<void> {
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  const now = new Date();
  await world.owner.sql`
    update email_outbox set sent_at = null, attempts = 0, next_attempt_at = now()
     where id in (select id from email_outbox where tenant_id = ${world.tenantId} limit 5)`;
  await capture('send-mail: one pass over every tenant', 'email', () =>
    sendPending(
      {
        database: world.app,
        ownerDatabase: world.owner,
        resolveSender: () => Promise.resolve(capturingSender()),
      },
      now,
      outboxOptionsFromConfig(config),
    ),
  );
  await capture('send-logouts: one pass over every tenant', 'email', () =>
    sendLogoutsAcrossTenants(
      {
        database: world.app,
        ownerDatabase: world.owner,
        transport: () => Promise.resolve({ status: 200 }),
      },
      now,
      logoutSenderOptionsFromConfig(config),
    ),
  );
}

// What the retention pass would send for one tenant, built by the pass's own
// rules and taken as the text and parameters its driver would send.
export function retentionRuns(world: PlanWorld): PathRun[] {
  const tenant = {
    ssoSessionMaxSeconds: 36_000,
    bruteForceFailureResetSeconds: 900,
    auditRetentionDays: 90,
  };
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  const policy = retentionPolicyFromConfig(config);
  const dialect = new PgDialect();
  const now = new Date();
  return REAP_ORDER.map((table) => {
    const { sql, params } = dialect.sqlToQuery(
      RETENTION_RULES[table].statement(now, policy, tenant),
    );
    return {
      path: `reap: ${table}`,
      area: 'reap',
      outputBound: true,
      statements: [{ handle: 'app', tenantId: world.tenantId, query: sql, parameters: params }],
    };
  });
}

export async function driveClientMetadataCache(world: PlanWorld, capture: Capture): Promise<void> {
  const cache = cimdCacheRepository(world.app);
  const now = new Date();
  const url = 'https://plans-5.example.com/client.json';
  await capture('cimd cache: a fresh document', 'oidc', () => cache.find(world.tenantId, url, now));
  await capture('cimd cache: a document nobody fetched', 'oidc', () =>
    cache.find(world.tenantId, 'https://nobody.example.com/client.json', now),
  );
  await capture('cimd cache: store one and trim to the ceiling', 'oidc', () =>
    cache.store(
      world.tenantId,
      'https://plans-new.example.com/client.json',
      { client_name: 'x' },
      now,
      new Date(now.getTime() + 600_000),
      CIMD_CACHE_MAX_ROWS,
    ),
  );
}

// The tenant the volume fills with idempotency keys holds 9,500 live ones and
// 500 past their window: a stored key is one primary key read, a new key is
// refused by a count that stops at the ceiling, and a recorded call is one
// upsert.
export async function driveIdempotency(world: PlanWorld, capture: Capture): Promise<void> {
  const now = new Date();
  const route = 'POST /admin/tenants/:tenant/roles';
  const fingerprint = fingerprintOf('POST', '/x', { a: 1 });
  const call = (key: string) =>
    withTenant(world.app.db, world.tenantId, (tx) =>
      withIdempotency(tx, { tenantId: world.tenantId, key, route, fingerprint, now }, () =>
        Promise.resolve({
          response: { status: 201, body: '{}', headers: {} },
          withinTransaction: true,
        }),
      ),
    );
  await capture('idempotency: a stored key replayed', 'admin', () => call('plans-key-5000'));
  await capture('idempotency: a lapsed key runs again', 'admin', () => call('plans-key-5'));
  await capture('idempotency: a new key counted against the ceiling', 'admin', () =>
    call('plans-key-new'),
  );
  await capture('idempotency: a call recorded', 'admin', () =>
    withTenant(world.app.db, world.tenantId, (tx) =>
      idempotencyRepository(tx).insert({
        tenantId: world.tenantId,
        key: 'plans-key-recorded',
        route,
        fingerprint,
        response: { status: 201, body: '{}', headers: {} },
        now,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_WINDOW_SECONDS * 1000),
      }),
    ),
  );
}

// The stored side of a metadata document client, in the one tenant the volume
// fills to the ceiling of them: a new document is refused by the count alone, a stored
// one is read and left, and the setting /token reads for such a client is one
// row by key.
export async function driveCimdClients(world: PlanWorld, capture: Capture): Promise<void> {
  const now = new Date();
  const [held] = await world.owner.sql<{ tenant_id: string }[]>`
    select tenant_id from clients where registration_origin = 'cimd' limit 1`;
  if (held === undefined) throw new Error('the volume holds no metadata document client');
  const tenantId = held.tenant_id;
  const client = (url: string) => {
    const outcome = parseCimdDocument(url, {
      client_id: url,
      client_name: 'Plans',
      redirect_uris: ['https://app.example.com/cb'],
    });
    if (outcome.kind !== 'ok') throw new Error('the plan document must validate');
    return outcome.client;
  };
  const persist = (url: string) =>
    withTenant(world.app.db, tenantId, (tx) => persistCimdClient(tx, tenantId, client(url), now));
  await capture('cimd client: a stored document, refreshed', 'oidc', () =>
    persist('https://plans-5.example.com/client.json'),
  );
  await capture('cimd client: a new document at the ceiling', 'oidc', () =>
    persist('https://plans-new.example.com/client.json'),
  );
  await capture('cimd client: the tenant setting read at /token', 'oidc', () =>
    withTenant(world.app.db, tenantId, (tx) => tenantCimdRepository(tx).enabled(tenantId)),
  );
}

export async function driveGateway(world: PlanWorld, capture: Capture): Promise<void> {
  const stack = await startConsoleApp(
    { database: world.app, ownerDatabase: world.owner },
    PUBLIC_BASE_URL,
  );
  try {
    const jar = new Jar();
    const signed = await capture('console: sign in, whole', 'gateway', () => signIn(stack, jar));
    const answer = (res: LightMyRequestResponse, what: string): void => {
      if (res.statusCode >= 400)
        throw new Error(`${what}: ${String(res.statusCode)} ${res.body.slice(0, 200)}`);
    };
    const headers = {
      host: stack.base.host,
      'x-odudu-console-subject': signed.subjectId,
      ...jar.header(),
    };
    answer(
      await capture('console: session', 'gateway', () =>
        stack.app.inject({ url: '/console/api/session', headers }),
      ),
      'session',
    );
    answer(
      await capture('console: proxied admin read', 'gateway', () =>
        stack.app.inject({ url: '/console/api/admin/tenants/system/whoami', headers }),
      ),
      'whoami',
    );
    answer(
      await capture('console: discovery', 'gateway', () =>
        stack.app.inject({ url: '/console/api/tenants/plans/discovery', headers }),
      ),
      'discovery',
    );
    await capture('console: logout', 'gateway', () =>
      stack.app.inject({
        method: 'POST',
        url: '/console/auth/logout',
        headers: { ...headers, ...WRITE },
      }),
    );
    await browse(stack, new Jar(), '/console/auth/login?tenant=system');
  } finally {
    await stack.app.close();
  }
}

// Repository methods no route reaches with a realistic subject in one
// request: each is called the way its caller calls it.
export async function driveRepositories(
  world: PlanWorld,
  database: Database,
  subjectId: string,
  capture: Capture,
): Promise<void> {
  await capture('credentials: every kind a subject holds', 'authn', () =>
    withTenant(database, world.tenantId, async (tx) => {
      const credentials = credentialRepository(tx);
      for (const type of ['webauthn', 'recovery-code', 'totp', 'password-history'] as const) {
        await credentials.listFor(subjectId, type);
      }
      await credentials.byLookupKey('lk1');
      await credentials.passwordFor(subjectId);
      await credentials.passwordHistory(subjectId);
      await credentials.countUnspentRecoveryCodes(subjectId);
      await credentials.deleteRecoveryCodes(subjectId);
      await credentials.rotatePassword(subjectId, { from: 'x', to: 'y' }, 3);
    }),
  );
  await capture('themes: what a sign-in render and an asset route read', 'authn', () =>
    withTenant(database, world.tenantId, async (tx) => {
      const themes = themeRepository(tx);
      const tenantScope = { tenantId: world.tenantId, clientId: null };
      const clientScope = { tenantId: world.tenantId, clientId: world.clientDbId };
      for (const scope of [clientScope, tenantScope]) {
        await themes.published(scope);
        await themes.draft(scope);
        await themes.versions(scope, 20);
      }
      const assets = assetRepository(tx);
      await assets.get(world.tenantId, 'f'.repeat(64));
      await assets.bytesUsed(world.tenantId);
      await assets.referencedBy(world.tenantId, world.clientDbId);
    }),
  );
  await capture('domains: host lookup of a canonical host', 'authn', () =>
    lookupHost(world.owner.db, 'plans1.example.com', new Date()),
  );
  await capture('domains: host lookup of a host nobody holds', 'authn', () =>
    lookupHost(world.owner.db, 'nobody.example.com', new Date()),
  );
  await capture('domains: host lookup of another tenant at volume', 'authn', () =>
    lookupHost(world.owner.db, 'o4999.volume.example.com', new Date()),
  );
  await capture('domains: state of a host nobody holds', 'authn', () =>
    hostState(world.owner.db, 'nobody.example.com', new Date()),
  );
  await capture('domains: state of a host that is only pending', 'authn', () =>
    hostState(world.owner.db, 'plans3.example.com', new Date()),
  );
  await capture('domains: the first page of verified domains for a recheck', 'authn', () =>
    verifiedDomainPage(world.owner.db, undefined, 500),
  );
  await capture('domains: a later page of verified domains for a recheck', 'authn', () =>
    verifiedDomainPage(world.owner.db, 'plans1.example.com', 500),
  );
  await capture('domains: where a tenant is addressed, for a path request', 'authn', () =>
    tenantAddressing(
      world.owner.db,
      TARGET_TENANT,
      `${PUBLIC_BASE_URL}/tenants/${TARGET_TENANT}`,
      new Date(),
    ),
  );
  await capture('domains: where a tenant nobody has is addressed', 'authn', () =>
    tenantAddressing(
      world.owner.db,
      'nobody-here',
      `${PUBLIC_BASE_URL}/tenants/nobody-here`,
      new Date(),
    ),
  );
  await capture('domains: what a tenant reads of its domains', 'authn', () =>
    withTenant(database, world.tenantId, async (tx) => {
      const domains = tenantDomainRepository(tx);
      const [first] = await domains.page(world.tenantId, { limit: 50 });
      if (first !== undefined) await domains.get(world.tenantId, first.id);
      await domains.getByHost(world.tenantId, 'plans1.example.com');
      await domains.listRetired(world.tenantId, new Date());
      await canonicalHostOf(tx, world.tenantId);
    }),
  );
  await capture('domains: register, verify, check, fail and delete one', 'authn', () =>
    withTenant(database, world.tenantId, async (tx) => {
      const domains = tenantDomainRepository(tx);
      const now = new Date();
      const row = await domains.insert({
        tenantId: world.tenantId,
        host: 'drive.example.com',
        challenge: 'c',
      });
      await domains.markVerified(world.tenantId, row.id, now);
      await domains.recordCheck(world.tenantId, row.id, false, now);
      await domains.markFailed(world.tenantId, row.id);
      await domains.delete(world.tenantId, row.id);
      await domains.retireIssuer(world.tenantId, 'https://drive-old.example.com', now);
      await domains.clearRetirement(world.tenantId, 'https://drive-old.example.com');
    }),
  );
}

// The read the server makes at boot for public clients the exchange limits
// stopped, across every tenant with the owner connection.
export async function driveExchangeUpgrade(world: PlanWorld, capture: Capture): Promise<void> {
  await capture('boot: public clients holding the exchange grant', 'oidc', () =>
    publicExchangeClientsAtRisk(world.owner.db),
  );
}

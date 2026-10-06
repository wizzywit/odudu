import { type Database, withTenant } from '@odudu/db';
import { credentialRepository } from '@odudu/domain-identity';
import { capturingSender, sendPending } from '@odudu/email';
import { loadConfig } from '@odudu/kernel';
import { PgDialect } from 'drizzle-orm/pg-core';
import { type LightMyRequestResponse } from 'fastify';
import { REAP_ORDER, RETENTION_RULES, retentionPolicyFromConfig } from '#/cli/reap';
import { logoutSenderOptionsFromConfig, sendLogoutsAcrossTenants } from '#/cli/send-logouts';
import { outboxOptionsFromConfig } from '#/cli/send-mail';
import { browse, Jar, signIn, startConsoleApp } from '#/testing/console-harness';
import { type Capture, type PathRun } from '#/testing/plan-paths';
import { PUBLIC_BASE_URL, type PlanWorld } from '#/testing/plan-world';

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
}

import {
  bypassesRowLevelSecurity,
  createDatabase,
  realms,
  withRealm,
  type DatabaseHandle,
} from '@odudu/db';
import { loadConfig, OduduError, type Config } from '@odudu/kernel';
import {
  logoutDeliveryRepository,
  sendLogouts,
  type LogoutDeliveryTransport,
} from '@odudu/protocol-oidc';
import { assertProductionNoPrivateClientUrls } from '#/config-guard';
import { createLogoutDeliveryTransport } from '#/logout-delivery-transport';

export interface LogoutSenderOptions {
  /** Deliveries claimed per realm per pass. */
  readonly batchSize: number;
  /** How long a claim holds a delivery invisible to other passes. */
  readonly leaseSeconds: number;
  /** Bounds one delivery end to end, connect and response together. */
  readonly responseTimeoutMs: number;
}

export function logoutSenderOptionsFromConfig(config: Config): LogoutSenderOptions {
  return {
    batchSize: config.ODUDU_LOGOUT_SENDER_BATCH_SIZE,
    leaseSeconds: config.ODUDU_LOGOUT_SENDER_LEASE_SECONDS,
    responseTimeoutMs: config.ODUDU_LOGOUT_SENDER_RESPONSE_TIMEOUT_MS,
  };
}

export interface LogoutSenderDeps {
  /** The serving, row-level-security-constrained connection: every claim and write. */
  readonly database: DatabaseHandle;
  /**
   * The owner connection, for one thing: listing the realms to visit — the
   * queue is scoped by `app.realm_id`, the same reason `reap` and the
   * outbox sender each keep a connection of their own for it.
   */
  readonly ownerDatabase: DatabaseHandle;
  readonly transport: LogoutDeliveryTransport;
}

/**
 * Why a pass did nothing, distinct from a report of zeros: "delivered
 * nothing" and "found no realm to look at" are different facts, the same
 * distinction `reap` and the outbox sender each draw for their own pass.
 */
export type LogoutSenderReport =
  | { readonly ran: false; readonly reason: 'no realm was enumerated' }
  | { readonly ran: true; readonly delivered: number; readonly failed: number };

// Both halves of the claim's scoping, checked rather than hoped for — the
// same two checks `sendPending` (`@odudu/email`) runs for its own queue,
// copied here because `sendLogouts` itself stays single-realm and leaves
// the cross-realm walk to its caller (Task 18's report).
async function assertRolesAreRight(deps: LogoutSenderDeps): Promise<void> {
  if (!(await bypassesRowLevelSecurity(deps.ownerDatabase))) {
    throw new OduduError(
      'logout_sender_cannot_enumerate_realms',
      'the logout sender must list realms on a connection that bypasses row-level security; ' +
        'ODUDU_DATABASE_URL names a role that is neither SUPERUSER nor BYPASSRLS',
    );
  }
  if (await bypassesRowLevelSecurity(deps.database)) {
    throw new OduduError(
      'logout_sender_serving_role_bypasses_rls',
      'the logout sender claims under the realm policy, so its serving connection must be ' +
        'subject to it; ODUDU_APP_DATABASE_URL names a SUPERUSER or BYPASSRLS role',
    );
  }
}

/**
 * Visits every realm in turn and drains its due deliveries. No lock spans
 * the walk — unlike `reap`'s advisory lock — because `claimDue`'s `FOR
 * UPDATE SKIP LOCKED` already makes two passes over the same realm take
 * different rows (`logoutDeliveryRepository.claimDue`), so overlapping
 * passes cost nothing but a little wasted work, never a duplicate send.
 */
export async function sendLogoutsAcrossRealms(
  deps: LogoutSenderDeps,
  now: Date,
  options: LogoutSenderOptions,
): Promise<LogoutSenderReport> {
  await assertRolesAreRight(deps);

  const rows = await deps.ownerDatabase.db
    .select({ id: realms.id })
    .from(realms)
    .orderBy(realms.id);
  const realmIds = rows.map((row) => row.id);
  if (realmIds.length === 0) {
    return { ran: false, reason: 'no realm was enumerated' };
  }

  let delivered = 0;
  let failed = 0;
  for (const realmId of realmIds) {
    const outcome = await withRealm(deps.database.db, realmId, (tx) => {
      const repository = logoutDeliveryRepository(tx);
      return sendLogouts(
        {
          claimDue: (claimNow) =>
            repository.claimDue({
              now: claimNow,
              limit: options.batchSize,
              leaseSeconds: options.leaseSeconds,
            }),
          markDelivered: (id, at) => repository.markDelivered(id, at),
          markFailed: (id, at, error) => repository.markFailed(id, at, error),
          markAbandoned: (id, at, error) => repository.markAbandoned(id, at, error),
          transport: deps.transport,
          responseTimeoutMs: options.responseTimeoutMs,
        },
        now,
      );
    });
    delivered += outcome.delivered;
    failed += outcome.failed;
  }

  return { ran: true, delivered, failed };
}

// Reads its own configuration and opens its own connections, the way
// `reap` and `send-mail` do, so a scheduler — cron, a Kubernetes Job, or
// an operator at a shell — can invoke it as a one-shot process (ADR 0024).
export async function sendLogoutsCommand(): Promise<LogoutSenderReport> {
  const config = loadConfig();
  // Called here, not only from `main.ts`'s module-scope sequence: the CLI
  // dispatch above that sequence exits before ever reaching it, so this
  // command is the only place guaranteed to run before the transport is
  // built, whichever entry point reached it.
  assertProductionNoPrivateClientUrls(config);
  const appUrl = config.ODUDU_APP_DATABASE_URL;
  // Demanded in every environment, not only production: the claim runs
  // under the realm policy, which the owner role the migrations use
  // escapes — see `reapCommand`'s identical guard.
  if (appUrl === undefined) {
    throw new OduduError(
      'logout_sender_requires_app_database_url',
      'odudu send-logouts requires ODUDU_APP_DATABASE_URL: it claims under the realm policy, ' +
        'which the owner role the migrations use escapes',
    );
  }

  const owner = createDatabase(config.ODUDU_DATABASE_URL);
  const runtime = createDatabase(appUrl);

  try {
    return await sendLogoutsAcrossRealms(
      {
        database: runtime,
        ownerDatabase: owner,
        transport: createLogoutDeliveryTransport({
          allowPrivate: config.ODUDU_ALLOW_PRIVATE_CLIENT_URLS,
        }),
      },
      new Date(),
      logoutSenderOptionsFromConfig(config),
    );
  } finally {
    await runtime.close();
    await owner.close();
  }
}

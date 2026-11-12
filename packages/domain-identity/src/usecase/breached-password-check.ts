import { type TenantScopedDatabase } from '@odudu/db';
import { breachedPasswordRepository } from '#/repository/breached-passwords';
import { judgeBreached, type BreachedVerdict } from '#/service/breached-password';
import {
  concurrencyLimiter,
  REMOTE_BREACHED_CONCURRENCY_PER_TENANT,
  remoteBreachedSource,
  type RangeFetch,
} from '#/service/breached-range-source';

/**
 * Judges a candidate that already passed the tenant's other password rules.
 * Runs inside the transaction the write is in, so it opens no second
 * connection; a remote lookup holds that transaction for at most its timeout.
 */
export type BreachedPasswordCheck = (
  tx: TenantScopedDatabase,
  tenantId: string,
  password: string,
) => Promise<BreachedVerdict>;

export interface BreachedPasswordCheckDeps {
  fetchRange: RangeFetch;
  concurrencyPerTenant?: number;
}

export function createBreachedPasswordCheck(
  deps: BreachedPasswordCheckDeps,
): BreachedPasswordCheck {
  const limiter = concurrencyLimiter(
    deps.concurrencyPerTenant ?? REMOTE_BREACHED_CONCURRENCY_PER_TENANT,
  );
  return async (tx, tenantId, password) => {
    const repository = breachedPasswordRepository(tx);
    return judgeBreached(
      await repository.settings(tenantId),
      {
        dataset: () => repository.datasetSource(),
        remote: () => remoteBreachedSource({ tenantId, fetchRange: deps.fetchRange, limiter }),
      },
      password,
    );
  };
}

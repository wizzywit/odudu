import { type TenantScopedDatabase } from '@odudu/db';
import { idempotencyRepository, type IdempotentResponse } from '#/repository/idempotency';
import {
  atCapacity,
  IDEMPOTENCY_MAX_LIVE_KEYS,
  IDEMPOTENCY_WINDOW_SECONDS,
  requestMatches,
  responseVerdict,
} from '#/service/idempotency';

export type { IdempotentResponse };

export interface IdempotencyInput {
  readonly tenantId: string;
  readonly key: string;
  readonly route: string;
  // Already bound to the caller (principalFingerprint).
  readonly fingerprint: string;
  readonly now: Date;
}

export interface RunOutcome {
  readonly response: IdempotentResponse;
  // Whether everything the run wrote went through the transaction it was
  // given, so undoing that transaction undoes the run.
  readonly withinTransaction: boolean;
}

export type IdempotencyResult =
  | { readonly kind: 'stored'; readonly response: IdempotentResponse }
  | {
      readonly kind: 'fresh';
      readonly response: IdempotentResponse;
      readonly stored: boolean;
    }
  | { readonly kind: 'reused' }
  | { readonly kind: 'in_flight' }
  | { readonly kind: 'capacity' };

/**
 * Thrown to undo the transaction, and the run in it, when its response
 * cannot be kept: nothing ran, no row exists, and a retry behaves as before.
 */
export class IdempotencyRollback extends Error {
  readonly result: { readonly kind: 'too_large' } | { readonly kind: 'capacity' };

  constructor(result: { readonly kind: 'too_large' } | { readonly kind: 'capacity' }) {
    super(`idempotency: ${result.kind}`);
    this.name = 'IdempotencyRollback';
    this.result = result;
  }
}

/**
 * Runs `run` once for a key and answers every later call with its recorded
 * response. `tx` is the transaction `run` writes through: the row goes into
 * it last, so a row exists only for a call that happened, and a call that
 * did not leaves none.
 */
export async function withIdempotency(
  tx: TenantScopedDatabase,
  input: IdempotencyInput,
  run: () => Promise<RunOutcome>,
): Promise<IdempotencyResult> {
  const repository = idempotencyRepository(tx);
  if (!(await repository.tryLockKey(input.tenantId, input.key, input.route))) {
    return { kind: 'in_flight' };
  }

  const existing = await repository.find(input.tenantId, input.key, input.route, input.now);
  if (existing !== null) {
    return requestMatches(existing.fingerprint, input.fingerprint)
      ? { kind: 'stored', response: existing.response }
      : { kind: 'reused' };
  }

  const live = await repository.countLive(input.tenantId, input.now, IDEMPOTENCY_MAX_LIVE_KEYS);
  if (atCapacity(live)) return { kind: 'capacity' };

  const { response, withinTransaction } = await run();
  const verdict = responseVerdict(response.status, response.body, withinTransaction);
  if (verdict === 'skip') return { kind: 'fresh', response, stored: false };
  if (verdict === 'too_large') throw new IdempotencyRollback({ kind: 'too_large' });

  await repository.lockCapacity(input.tenantId);
  const settled = await repository.countLive(input.tenantId, input.now, IDEMPOTENCY_MAX_LIVE_KEYS);
  if (atCapacity(settled)) throw new IdempotencyRollback({ kind: 'capacity' });

  await repository.insert({
    tenantId: input.tenantId,
    key: input.key,
    route: input.route,
    fingerprint: input.fingerprint,
    response,
    now: input.now,
    expiresAt: new Date(input.now.getTime() + IDEMPOTENCY_WINDOW_SECONDS * 1000),
  });
  return { kind: 'fresh', response, stored: true };
}

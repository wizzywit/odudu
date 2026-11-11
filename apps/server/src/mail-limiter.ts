import { createHash } from 'node:crypto';
import { type MailGate, type MailKind } from '@odudu/account';
import { slidingWindow } from '#/throttle';

// Unsolicited mail to one address, whoever asks. At most this many an hour per
// kind, tenant and address, so the form cannot fill somebody's inbox, or cost
// the tenant's relay its reputation, from any number of origins, and a flood of
// one kind (registration links, notices to a held address, password resets,
// proofs of a changed address) cannot silence another.
export const MAIL_LIMIT = 3;
export const MAIL_WINDOW_SECONDS = 3600;
// 100,000 addresses at most for each kind, 3 timestamps each: a few tens of
// megabytes at the ceiling. Past it the coldest address is forgotten and gets a
// fresh budget, as ADR 0023 records for the other limiters; reaching that for
// one target takes about 100,000 accepted requests. The map is per process:
// restarting resets it, and N replicas admit N times the budget.
export const MAIL_MAX_ADDRESSES = 100_000;

export function mailGate(now: () => Date, maxKeys: number = MAIL_MAX_ADDRESSES): MailGate {
  const windows = new Map<MailKind, ReturnType<typeof slidingWindow>>();
  for (const kind of ['registration', 'held', 'reset', 'change'] as const) {
    windows.set(
      kind,
      slidingWindow({ limit: MAIL_LIMIT, windowSeconds: MAIL_WINDOW_SECONDS, now, maxKeys }),
    );
  }
  return (kind, tenantId, address) =>
    windows
      .get(kind)
      ?.check(createHash('sha256').update(`${tenantId}\0${address.toLowerCase()}`).digest('hex'))
      .allowed ?? false;
}

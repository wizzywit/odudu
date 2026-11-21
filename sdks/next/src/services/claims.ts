import { isExpiredForGood, isSessionId, sessionKey } from '@odudu-io/bff/shared';
import type { Session as StoredSession } from '@odudu-io/bff';
import type { Session } from '#/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The signed-in person a cookie's id stands for, read from the store as it is
// and changed in no way: the claims of their ID token, or null. A session that
// ran out with no refresh token to renew it is over. One whose access token is
// stale is not: renewing it is for the route handlers, which share one guard
// against spending a refresh token twice; a render must not race them.
export async function sessionFromStore(
  id: string | undefined,
  lookup: (key: string) => Promise<StoredSession | undefined>,
  now: number,
): Promise<Session | null> {
  if (!isSessionId(id)) return null;
  const record = await lookup(sessionKey(id));
  if (record?.kind !== 'session' || isExpiredForGood(record.tokens, now)) return null;
  const { claims } = record.tokens;
  return isRecord(claims) && typeof claims.sub === 'string' ? { claims } : null;
}

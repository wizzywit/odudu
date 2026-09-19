import { type SessionRecord } from '@odudu/authn-flows';

// decideReuse and decideLogout each decide over one session, while a
// browser may hold several — this is what both stand in with until they
// are widened to decide over the resolved set itself. `liveByIds` carries
// no `ORDER BY`, so the tie-break on `id` (not just `lastActiveAt`) is
// what makes the pick total rather than whatever order Postgres happened
// to return equal timestamps in.
export function mostRecentlyActive(sessions: readonly SessionRecord[]): SessionRecord | null {
  return sessions.reduce<SessionRecord | null>((current, candidate) => {
    if (current === null) return candidate;
    if (candidate.lastActiveAt > current.lastActiveAt) return candidate;
    if (candidate.lastActiveAt < current.lastActiveAt) return current;
    return candidate.id > current.id ? candidate : current;
  }, null);
}

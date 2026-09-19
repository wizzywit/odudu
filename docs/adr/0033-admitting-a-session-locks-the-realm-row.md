# 0033 — Admitting a session locks the realm row

**Status:** Accepted · 2026-09-19

## Context

A browser may hold at most `realms.max_sessions_per_browser` live sessions
(migration `0048_sessions_remembered_and_cap.sql`). Admission has to evict
the least recently active sessions before inserting a new one, and two
logins can arrive at the same cap at once — nothing about the cookie or
the request serialises them.

The obvious remedy — `select ... from sessions where realm_id = $1 for
update`, then evict via `chooseEvictions`, then insert — does not hold the
cap. `SELECT ... FOR UPDATE` takes a row lock, not a predicate lock: under
`READ COMMITTED`, a statement that blocks on a locked row re-qualifies only
the rows its own scan already found once it unblocks. It never re-runs the
scan, so a row the other transaction _inserted_ while it waited stays
invisible.

Worked sequence, cap 3, three sessions already live (`a`, `b`, `c`):

1. Login 1 and login 2 both `SELECT ... FOR UPDATE` on the realm's session
   rows. Both scans find `{a, b, c}`; login 1's statement acquires the
   locks first, login 2's blocks on the same three rows.
2. Login 1 evicts `a` (least recently active) and inserts `d`, then
   commits. Live set is now `{b, c, d}`.
3. Login 2 unblocks. Postgres re-checks only the three rows it originally
   locked — `a`, `b`, `c` — at their latest committed versions. `a` now
   reads as dead; `d` was never part of that scan, so login 2 never learns
   it exists. Its live set is `{b, c}`, two rows.
4. `chooseEvictions({b, c}, cap: 3)` evicts nothing — two is under the
   cap of three, as far as login 2 can see. It inserts `e` and commits.
5. Final live set: `{b, c, d, e}` — four sessions against a cap of three.

## Evidence

An independent reproduction ran three lock modes, five times each, cap 3,
two concurrent admissions racing at the cap:

| Lock mode                           | Live count, five runs |
| ----------------------------------- | --------------------- |
| No lock                             | 4, 4, 4, 4, 4         |
| `for update` on the session rows    | 4, 4, 4, 4, 4         |
| `for update` on the realm row first | 3, 3, 3, 3, 3         |

The session-row lock performs identically to no lock at all — it changes
which transaction blocks, not what either one sees. Reproducible under
plain concurrent execution (`Promise.all` over two `withRealm` calls); no
artificial delay or barrier is needed to trigger the breach.

## Decision

Admission locks the realm's own row first: `select ... from realms where
id = $1 for update`, before reading the session rows at all. The second
transaction then blocks on that single row, and when it unblocks, its
session read is a _new statement_ — a fresh scan, under a fresh snapshot,
taken after the first transaction committed. It sees the first admission's
insert and evicts correctly.

## Consequences

- The cap holds under concurrent admission, proven by the reproduction
  above and by `packages/authn-flows/tests/session-set.int.test.ts`'s
  "holds the cap when two logins arrive at once".
- **Accepted cost:** this serialises every login in a realm on one row
  lock, which is far coarser than the invariant needs — the actual
  contention is per browser, not per realm — and it sits on the hottest
  write path in the server. It is correct today and will not survive load
  as realms grow. Revisit when login latency or lock-wait time under
  concurrent load makes that visible; the candidates are an advisory lock
  keyed to a hash of the browser's own session-id set, or a lock on the
  subject row, either of which narrows contention to the sessions actually
  racing instead of the whole realm.
- The admission logic — realm-row lock, eviction, insert — currently lives
  only in `admitSession`, a test helper inside
  `packages/authn-flows/tests/session-set.int.test.ts`. The usecase that
  replaces it must carry this lock forward and re-point the integration
  test at the real code, deleting the helper.

## Alternatives rejected

- **`SELECT ... FOR UPDATE` on the session rows.** The remedy this ADR
  exists to rule out — see Evidence above.
- **Retry on a detected overage.** Would need a second pass reading the
  live set again after commit, on every admission, to catch a race that a
  lock prevents for free; adds latency and complexity for a case the lock
  already makes impossible.
- **`SERIALIZABLE` isolation instead of an explicit lock.** Would catch
  the conflict, but as a commit-time serialization failure the caller must
  retry — an explicit lock blocks up front instead and needs no retry
  loop, at the same cost of serialising the realm's admissions.

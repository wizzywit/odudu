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

- The lock holds under concurrent admission in the sense the reproduction
  above tests: two transactions racing for the same realm row no longer
  both see room under the cap from a scan that finds everything currently
  live. It does not make a _list_-based cap exact under concurrency — see
  the amendment below for why, and for what is exact instead (sequential
  admissions) and what is bounded (concurrent ones).
- **Accepted cost:** this serialises every login in a realm on one row
  lock, which is far coarser than the invariant needs — the actual
  contention is per browser, not per realm — and it sits on the hottest
  write path in the server. It is correct today and will not survive load
  as realms grow. Revisit when login latency or lock-wait time under
  concurrent load makes that visible; the candidates are an advisory lock
  keyed to a hash of the browser's own session-id set, or a lock on the
  subject row, either of which narrows contention to the sessions actually
  racing instead of the whole realm.
- The admission logic — realm-row lock, eviction, insert — lives in
  `packages/authn-flows/src/usecase/session-admission.ts`'s `admitSession`,
  the only place a session row is created; see the amendment below for how
  it replaced the test helper this bullet originally described.

## Amendment, 2026-09-19 — the usecase, not the helper

`packages/authn-flows/src/usecase/session-admission.ts` is now the only
place a session row is created: the realm-row lock, eviction and insert in
one function, called from `completeLogin`
(`packages/protocol-oidc/src/index.ts`) in place of a bare
`establishSession`. The test helper described above is deleted;
`session-set.int.test.ts` calls the real usecase.

Eviction reads `sessionRepository(tx).liveByIds` against the ids the
browser's own cookies already name (`admitSession`'s `browserSessionIds`),
never a subject- or realm-wide scan. The cap is `max_sessions_per_browser`,
not per subject: a browser can hold sessions for more than one subject at
once — the case `prompt=select_account` (a later increment) exists to
choose among — so a per-subject predicate would let each subject on a
shared browser carry the cap on its own, unbounded in total, which is
exactly the failure this cap exists to prevent. A per-subject read
(`liveBySubject`, tried and reverted during this work) was rejected for
that reason, and for a second: it would let a login on one device evict a
session the same person is actively using on another, two browsers that
share nothing and should not share a budget.

**The lock does not make a list-based cap exact under concurrency, and
that is accepted, not fixed.** It serialises admissions in a realm and
stops two of them from interleaving their own eviction decisions, but a
fixed id list — the browser's cookies, read once, before the lock — can
never contain a session a concurrent admission inserts while the first
holds the lock, no matter how fresh the second admission's read against
that same list is once unblocked. The candidate list is fixed per request
and identical across racers from one browser, so once the first racer
evicts, that same list resolves to at most `cap - 1` live for everyone
behind it: `chooseEvictions`' own `surplus` is `live.length + 1 - cap`,
which is now `≤ 0`, so each of the remaining `k - 1` racers evicts nothing
and inserts unconditionally. The browser can therefore transiently hold
`cap + (k - 1)` sessions rather than exactly `cap` — the worst case, for a
browser already at or above the cap when the race starts; dead sessions in
the candidate list only shrink the total. Measured, not merely derived:
`k = 2` gives `cap + 1`, `k = 3` gives `cap + 2`, `k = 4` gives `cap + 3`,
five trials each, no exception. The next admission from that browser
evicts back down, since its own fresh read of the (by then updated)
cookie sees the surplus. This is tolerable
where a per-subject cap is not: the cap is a size guard on the cookie
(§5.4 — the default sits near a quarter of the measured ~110-id ceiling
before a cookie stops fitting, not a security boundary), the excess
self-corrects at the browser's very next login, and an exact cap needs a
stable per-browser identifier — a `browser_sessions` row — which the
design deliberately does not have; reversing that to close an off-by-`k`
on a size guard is not worth the row.

Verified empirically, not merely reasoned. Sequential admissions from one
browser (past the cap, one login at a time) converge to exactly the cap
every time, with no evicted id surviving in the next request's candidate
list —
`session-set.int.test.ts`'s "converges to exactly the cap across sequential
logins". Concurrent admissions do not hold exactly the cap: with the lock
removed, ten runs of a two-concurrent-admission race against a fixed id
list gave a live count of 4 against a cap of 3 in nine of them (the tenth
held by luck — this is why the test repeats rather than running once);
with the lock restored, the same race held at exactly 4 — `cap + 1`, not
`cap + 2` — in every repetition seen so far, asserted by "bounds two
concurrent logins at cap plus one, over several races", which races five
times per run against a realm-wide live count rather than a query
pre-limited to the ids the test already expects, so a broken eviction has
room to show up as more than `cap + 1` (removing the `endMany` call fails
it immediately, at 5 against a bound of 4). Both numbers matter: unlocked,
the race is unbounded and gets worse with more racers; locked, two racers
cost exactly one extra session, never more.

`packages/protocol-oidc/tests/session-cap.int.test.ts` proves the
sequential case end to end: a browser logging in through the real HTTP
routes, one request at a time, more times than `max_sessions_per_browser`
ends with exactly that many live sessions, and the `Set-Cookie` it
receives names exactly those — confirmed by disabling eviction and
watching that test fail with four cookie-borne ids against a cap of two.

## Alternatives rejected

- **`SELECT ... FOR UPDATE` on the session rows.** The remedy this ADR
  exists to rule out — see Evidence above.
- **Retry on a detected overage.** Would close the `cap + (k - 1)` residual the
  amendment above accepts rather than fixes — the lock does not make the
  case impossible. Rejected on cost, not impossibility: a second read
  after every commit, on every admission, in the realm's hottest write
  path, to correct a size guard that already self-corrects at the
  browser's next login. Worth reopening only if the residual itself
  becomes the problem, not merely once noticed.
- **`SERIALIZABLE` isolation instead of an explicit lock.** Would catch
  the conflict, but as a commit-time serialization failure the caller must
  retry — an explicit lock blocks up front instead and needs no retry
  loop, at the same cost of serialising the realm's admissions.

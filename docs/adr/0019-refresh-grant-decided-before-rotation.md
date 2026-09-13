# 0019 — The refresh grant is decided before rotation, and again after

**Status:** Accepted · 2026-09-13

## Context

Refresh tokens rotate: presenting one marks it used, in one atomic UPDATE,
and issues its successor. Presenting a token already marked used is reuse,
and reuse revokes the whole token family — the standard detection for a
stolen refresh token.

The first implementation rotated first and decided afterwards, from the
rotated record: whether the presenting client owned the token, whether the
subject was still enabled, whether the requested scope had widened. That
order made a refresh token a weapon. Rotation marks the presented token
used and commits, so **any** client able to authenticate at the realm could
present a refresh token belonging to another client, be refused, and still
have burned it. The owner's next legitimate refresh then presented a token
already marked used, was detected as reuse, and revoked the owner's entire
family. One authenticated client could log any other client's users out at
will, with the victim's own reuse detection as the mechanism.

Rotation is also a write that must survive a request ending in
`invalid_grant`, which rolls the enclosing transaction back — so reuse
detection and family revocation commit in their own transaction.

## Decision

Decide the grant twice, against two different reads, either side of the
rotation.

**Before.** `evaluatePresentedRefreshToken`
(`packages/protocol-oidc/src/usecase/token-issuance.ts`) loads the
presented token, its grant and its subject and runs `evaluateRefreshGrant`
on them. It writes nothing: it can refuse the request, never admit it, so a
request that was never going to succeed consumes nothing. Running it ahead
of the atomic single-use consume therefore costs that consume none of its
authority.

**After.** The same decision runs again inside the transaction that rotated
the token, and that read is the one that governs — a family revoked between
the two reads must not still hand back an access token.

The ownership rules themselves stay in `evaluateRefreshGrant`, a pure
service function that runs no queries, so both call sites run the same
rules and the rules have direct unit tests. `rotateRefreshToken`
(`packages/protocol-oidc/src/usecase/refresh-rotation.ts`) decides only
single-use and reuse, and does its detection and family revocation in one
transaction: a reuse detected but not revoked because a later statement
failed would be worse than not detecting it at all.

## Consequences

- The grant is read twice per refresh — three extra queries on the happy
  path. That is the price of the ordering, and it is small against a token
  round trip.
- Two call sites must keep running the same evaluation. They call one
  function to make that true by construction, not by discipline.
- An unknown presented token is refused before rotation; unknown there and
  unknown to the rotation are the same `invalid_grant`, so the two orders
  are indistinguishable to a client, as RFC 6749 §5.2 requires.

## Alternatives rejected

- **Rotate first, decide from the rotated record.** The original order, and
  the defect above.
- **Decide only before rotating.** Cheaper by three queries, and wrong: the
  pre-read cannot see a revocation that lands between it and the rotation,
  so a revoked family could still be handed a live access token.
- **Rotate inside the request transaction.** Reuse detection would be
  rolled back with the `invalid_grant` it produced, which is the one case
  where the write matters most.

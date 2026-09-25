# 0036 — `/userinfo` narrows to the requested claims, and a refresh forgets it

**Status:** Accepted · 2026-09-25

## Context

OIDC Core §5.5 describes the `claims` parameter's `userinfo` member as
requesting Claims to be returned _in addition to_ those the requested
`scope` already grants. Read to the letter, naming `email` there can only
add a Claim, never take one away that `scope` already earned.

`resolveUserinfo` (`packages/protocol-oidc/src/usecase/userinfo.ts`) does
not read it that way. It assembles every Claim the granted `scope` reaches
(`claimMappers.assemble`), then narrows the result to exactly the names the
`claims` parameter's `userinfo` member listed, plus `sub`
(`narrowToRequestedClaims`, `packages/protocol-oidc/src/service/claims.ts`)
— dropping a `profile`-scope Claim nobody named even though `scope` alone
would have returned it. `[ODUDU-CLAIMS-USERINFO-01]`
(`packages/protocol-oidc/tests/claims-parameter.int.test.ts`) pins exactly
this: naming `email` under a wider granted scope still returns only `email`
and `sub`. This was chosen in P3b and never written down.

The parameter reaches `/userinfo` as `requested_userinfo_claims`, an
Odudu-private claim `mintAccessToken` embeds on the access token
(`packages/protocol-oidc/src/usecase/token-issuance.ts`), populated from
the authorization code's own `claims.userinfo` keys
(`issueAuthorizationCodeTokens`). A `refresh_token` redemption
(`issueRefreshTokens`, same file) mints its access token from the rotated
`token_grants` row instead of a code, and that row carries no such column
(`packages/protocol-oidc/src/repository/grants.ts`); `mintAccessToken` is
called there with `requestedUserinfoClaims` left `undefined`. A refreshed
access token therefore carries no `requested_userinfo_claims`, and
`narrowToRequestedClaims` treats an empty requested list as "return
everything" (its own first line) — so the narrowing a client's original
`claims` request imposed disappears the moment it refreshes.

Confirmed by a throwaway integration case rather than by reading: a client
requesting `claims={"userinfo":{"sub":null}}` alongside `scope=openid
email` got back `{ sub }` from `/userinfo` right after redeeming the
authorization code, and `{ sub, email }` from the same call after redeeming
a `refresh_token` for the same grant — the identical client, subject and
scope, differing only in which grant type minted the access token
presented.

## Decision

The narrowing is correct and stays. It is stricter than §5.5's "in
addition to", but deliberately: once a client has stated which Claims it
actually wants at `/userinfo`, returning more than it asked for is
disclosure a client-driven minimization contract exists to prevent, not a
right `scope` alone should reinstate underneath it. `[ODUDU-CLAIMS-USERINFO-01]`
already commits to this reading; reversing it would be reversing a
consent-adjacent property, not just a parsing detail.

The refresh gap is a defect, not a second interpretation of it: nothing
about the narrowing decision changes across a `refresh_token` redemption,
so its disappearance is `requested_userinfo_claims` failing to travel with
the grant it was minted against, not a choice anybody made. The fix is
threading it onto `token_grants` the same way `act_chain` and
`exp_ceiling` already ride a grant through rotation (schema/token-grants.ts,
`issueRefreshTokens`), so a refreshed access token embeds the same value
the original one did. That work is not this task's: `docs/superpowers/
specs/2026-09-24-p4c-admin-api-design.md` §2 has already decided to split
an authentication-and-token-audit-events phase, P4e, out of this one, and
names this exact follow-up as something P4e inherits. Section 11 of the
umbrella spec does not carry a P4e row yet; the split increment that adds
one is where this follows up, not a roadmap edit made in passing here.

## Consequences

- No behaviour changes. This ADR records an existing decision and files
  the one bug its absence let stand unnoticed.
- The refresh gap is not a security defect: nothing returned after a
  refresh exceeds the scope the subject already granted, only more than
  the client's own narrower `claims` request asked for.
- Threading `requested_userinfo_claims` onto `token_grants` is tracked
  against P4e, not against this ADR's own closing.

## Alternatives rejected

- **Read `claims` as additive, per §5.5's letter, and drop the narrowing.**
  Would make `/userinfo` return every scope-granted Claim regardless of
  what a client's `claims` request named, silently widening every
  narrowed response `[ODUDU-CLAIMS-USERINFO-01]` currently pins — a
  behaviour change with no defect driving it, only a stricter reading than
  the shipped one.
- **Fix the refresh gap here, by threading `requested_userinfo_claims`
  onto the rotated grant now.** Correct in isolation, but it touches the
  same `token_grants` row and rotation path P4e's audit-events work is
  about to extend; doing it piecemeal ahead of that phase risks two passes
  over the same column instead of one.

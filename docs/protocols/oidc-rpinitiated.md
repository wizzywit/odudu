# OpenID Connect RP-Initiated Logout 1.0

**Status in Odudu:** `end_session_endpoint` is implemented — the
confirmation page (§2), the exact-match redirect rule (§3), and the
discovery advertisement (§4). What logout revokes, and why access tokens
are not on that list, is README.md's own section rather than a row here:
neither this specification nor RFC 9068 says anything normative about
access tokens, and the rule that does apply — Back-Channel Logout §2.7 —
already has its own file.

## Clause table

| Clause | Level | Requirement                                                                                                                                              | Test ID                 | Status  |
| ------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------- |
| 2      | MUST  | the OP asks the End-User to confirm logout if an `id_token_hint` was not provided, or if the supplied ID Token does not belong to the current OP session | `OIDC-RPINITIATED-2-01` | covered |
| 3      | MUST  | the OP does not perform post-logout redirection unless `post_logout_redirect_uri` exactly matches one of the client's registered values                  | `OIDC-RPINITIATED-3-01` | covered |
| 4      | MAY   | the OP publishes `end_session_endpoint` in its discovery document                                                                                        | `OIDC-RPINITIATED-4-01` | covered |

## Reading note

§2's confirmation MUST reads, at a glance, like it fires only when a hint
is missing. It does not: "the OP MUST ask the End-User this question if an
`id_token_hint` was not provided **or if the supplied ID Token does not
belong to the current OP session**." A hint naming somebody else's session
is not a weaker form of consent than no hint at all — it is a client (or an
attacker holding a stale token) asserting an identity this request cannot
verify without asking. `decideLogout`
(`packages/protocol-oidc/src/usecase/logout.ts`) treats the two triggers as
one condition — `input.session === null`, or the hint fails to match it.

**"Belong to" is compared on the session, not the subject.** A hint's `sid`
claim (Back-Channel Logout §2.1, carried by every ID Token this phase
issues) is compared against the current session's own id whenever the hint
carries one; only a hint minted before `sid` existed falls back to
comparing subjects. The distinction matters for the same End-User signing
in twice in one browser: a stale hint from their first, already-ended
session names the right subject but the wrong session, and a subject-only
comparison would have skipped confirmation for it.

§3's "exactly match" is deliberately not URL-normalized. A trailing slash,
a query string, or a case difference in the host all fail the match —
`decideLogout`'s test cases (`logout.test.ts`) enumerate exactly those,
because each is a plausible "surely this still counts" mistake to make
implementing this clause. The consequence spelled out in the design spec
and worth repeating here: **a refused redirect still ends the session.**
Nothing in §3 says a redirect the OP cannot validate should also keep the
session alive, and treating an untrusted return URL as a reason not to log
out would make the redirect check load-bearing for something it was never
meant to guard.

**§3 forbids redirecting to an unmatched URI; it says nothing against
honouring a matched one with no session to end.** An RP that sends a user
to logout after their session has already idled out would otherwise strand
them on an OP page with no way back — so `decideLogout` still redirects
when `post_logout_redirect_uri` exactly matches the client's own
registration, even with no live session, which is what Keycloak does too.

# OpenID Connect RP-Initiated Logout 1.0

**Status in Odudu:** `end_session_endpoint` is implemented — the
confirmation page (§2), both HTTP methods §2 requires, the `client_id`
cross-check (§2), the exact-match redirect rule (§3), and the discovery
advertisement (§2.1). What logout revokes, and why access tokens
are not on that list, is README.md's own section rather than a row here:
neither this specification nor RFC 9068 says anything normative about
access tokens, and the rule that does apply — Back-Channel Logout §2.7 —
already has its own file.

§1.1 (Requirements Notation) and §7 (IANA Considerations) impose nothing on
a deployment: the first is the notational convention every OpenID
specification opens with, and the second registers `end_session_endpoint`
and `post_logout_redirect_uris` in IANA's registries, stating no behaviour
beyond what §2.1 and §3.1 already do. Neither is rowed. The sentence in §2
that has the OP "notify any RPs logged in as that End-User that they are to
likewise log out" carries no RFC 2119 keyword and is not rowed here either;
the mechanism it points at is Back-Channel Logout 1.0, whose own table
(`docs/protocols/oidc-backchannel.md`) holds those obligations.

## Clause table

| Clause | Level  | Requirement                                                                                                                                              | Test ID                   | Status                                                                                                                                                               |
| ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2      | MUST   | when both `client_id` and `id_token_hint` are present, the OP verifies that the Client Identifier matches the one used when issuing the ID Token         | `OIDC-RPINITIATED-2-04`   | covered                                                                                                                                                              |
| 2      | MUST   | the value of `post_logout_redirect_uri` has been previously registered with the OP                                                                       | `OIDC-RPINITIATED-3-01`   | covered                                                                                                                                                              |
| 2      | SHOULD | `post_logout_redirect_uri` uses the `https` scheme                                                                                                       | —                         | deferred: P3a — nothing constrains the scheme of a value a client registers, and the registration path that would apply such a policy arrives with client management |
| 2      | MAY    | `post_logout_redirect_uri` uses the `http` scheme where the Client Type is confidential and the OP allows it                                             | —                         | gap                                                                                                                                                                  |
| 2      | MAY    | `post_logout_redirect_uri` uses an alternate scheme identifying a callback into a native application                                                     | —                         | gap                                                                                                                                                                  |
| 2      | SHOULD | an `id_token_hint` is included when `post_logout_redirect_uri` is                                                                                        | —                         | n/a: addressed to the RP composing the logout request, not to the OP answering it                                                                                    |
| 2      | SHOULD | no error results when some or all of the locales requested through `ui_locales` are unsupported                                                          | —                         | n/a: `ui_locales` is not read at the Logout Endpoint, whose pages are served in one language, so no requested locale can produce an error                            |
| 2      | MUST   | the OP supports the HTTP `GET` and `POST` methods at the Logout Endpoint                                                                                 | `OIDC-RPINITIATED-2-03`   | covered                                                                                                                                                              |
| 2      | MUST   | when an `id_token_hint` is present, the OP validates that it was the issuer of the ID Token                                                              | `OIDC-RPINITIATED-2-02`   | covered                                                                                                                                                              |
| 2      | SHOULD | the OP accepts an ID Token whose `exp` has passed, where the RP identified by its `aud` and/or `sid` has a current or recent session                     | —                         | gap                                                                                                                                                                  |
| 2      | SHOULD | a logout request whose `sid` does not correspond to a current or recent session is treated as suspect                                                    | `OIDC-RPINITIATED-2-01`   | covered                                                                                                                                                              |
| 2      | MAY    | the OP declines to act on a logout request whose `sid` does not correspond to a current or recent session                                                | —                         | gap                                                                                                                                                                  |
| 2      | SHOULD | at the Logout Endpoint, the OP asks the End-User whether to log out of the OP as well                                                                    | `OIDC-RPINITIATED-2-01`   | covered                                                                                                                                                              |
| 2      | MUST   | the OP asks the End-User to confirm logout if an `id_token_hint` was not provided, or if the supplied ID Token does not belong to the current OP session | `OIDC-RPINITIATED-2-01`   | covered                                                                                                                                                              |
| 2      | MUST   | if the End-User says "yes", the OP logs the End-User out                                                                                                 | `OIDC-RPINITIATED-2-01`   | covered                                                                                                                                                              |
| 2.1    | MUST   | `end_session_endpoint` is included in the OP's discovery response, RP-Initiated Logout and Discovery both being supported                                | `OIDC-RPINITIATED-2.1-01` | covered                                                                                                                                                              |
| 2.1    | MUST   | the advertised `end_session_endpoint` URL uses the `https` scheme                                                                                        | —                         | accepted: "The scheme in the advertised endpoint" — the path and authority are this server's, the scheme is whatever a terminating proxy asserts                     |
| 2.1    | MAY    | the advertised `end_session_endpoint` URL contains port, path and query parameter components                                                             | `OIDC-RPINITIATED-2.1-01` | covered                                                                                                                                                              |
| 3      | SHOULD | an `id_token_hint` carrying an ID Token for the RP is included when post-logout redirection is requested                                                 | —                         | n/a: addressed to the RP composing the logout request, not to the OP answering it                                                                                    |
| 3      | MUST   | with no `id_token_hint` supplied, the OP performs no post-logout redirection unless it has other means of confirming the target's legitimacy             | `OIDC-RPINITIATED-3-01`   | covered                                                                                                                                                              |
| 3      | MUST   | the OP does not perform post-logout redirection unless `post_logout_redirect_uri` exactly matches one of the client's registered values                  | `OIDC-RPINITIATED-3-01`   | covered                                                                                                                                                              |
| 3.1    | SHOULD | registered `post_logout_redirect_uris` use the `https` scheme                                                                                            | —                         | deferred: P3a — the same missing registration-time scheme policy as §2's own row on the request parameter                                                            |
| 3.1    | MAY    | registered `post_logout_redirect_uris` use the `http` scheme where the Client Type is confidential and the OP allows it                                  | —                         | gap                                                                                                                                                                  |
| 4      | MUST   | when a validation procedure fails, any operation requiring the information that failed to validate is aborted                                            | `OIDC-RPINITIATED-3-01`   | covered                                                                                                                                                              |
| 4      | MUST   | information that failed to validate is not used                                                                                                          | `OIDC-RPINITIATED-2-04`   | covered                                                                                                                                                              |
| 4      | MUST   | when the OP detects errors in the logout request, it performs no post-logout redirection to an RP                                                        | `OIDC-RPINITIATED-3-01`   | covered                                                                                                                                                              |
| 4      | MAY    | the OP displays an error message in the page it renders instead                                                                                          | `OIDC-RPINITIATED-3-01`   | covered                                                                                                                                                              |
| 4      | MAY    | the OP asks the End-User whether to log out of the OP in that page                                                                                       | —                         | gap                                                                                                                                                                  |
| 5      | MUST   | every feature this specification lists as REQUIRED or describes with a MUST is implemented                                                               | —                         | n/a: a restatement of every other MUST in this table rather than an obligation of its own; those rows are the record of which hold                                   |
| 6      | SHOULD | the OP obtains explicit confirmation from the End-User before acting on a logout request with no valid `id_token_hint`                                   | `OIDC-RPINITIATED-2-01`   | covered                                                                                                                                                              |

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
claim (Back-Channel Logout §2.1) is compared against the current session's
own id, and a hint with no `sid` is treated as a mismatch rather than
falling back to comparing subjects. `decideLogout` never had a legitimate
case to fall back for: every ID Token a session-backed login mints carries
`sid`, and the one current token that does not is an `offline_access`
grant's — which has no session to name, precisely the case a fallback must
not wave through. (An earlier version of this comparison did fall back to
subjects, reasoning that no current token would ever lack a `sid`; adding
`offline_access` falsified that the moment it shipped, since a grant with
no session mints an ID Token with no `sid` too — see
`docs/protocols/oidc-backchannel.md` §2.7.) The distinction matters for the
same End-User signing in twice in one browser: a stale hint from their
first, already-ended session names the right subject but the wrong
session, and a subject-only comparison would have skipped confirmation for
it.

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

### The exact registration match is §3's "other means"

§3 has two prohibitions, and only one of them is about the value matching.
The first fires when no hint is supplied at all: the OP "MUST NOT perform
post-logout redirection unless the OP has other means of confirming the
legitimacy of the post-logout redirection target." The exact, unnormalized
comparison against the values the client itself registered is that other
means, and it is the only means Odudu has — a redirect target is honoured
because the client registered it, never because a hint vouched for it.
That is why a hintless logout still redirects once the value matches
(`logout.int.test.ts`'s no-session redirect case) and why a mismatching
value is refused whether a hint accompanied it or not.

### The scheme in the advertised endpoint

`end_session_endpoint` is built by the same `realmIssuerFor` the issuer
identifier is (`packages/protocol-oidc/src/view/issuer.ts`), so its
authority and path are this server's own, and §2.1's `https` demand is
unmet in exactly one component: the scheme is whatever the request arrived
under, which behind the TLS-terminating proxy Odudu expects is whatever
that proxy asserts through `X-Forwarded-Proto` with `ODUDU_TRUST_PROXY`
on. `docs/protocols/rfc9207.md`'s own note declines to treat that operator
assertion as proof, and this row takes the same position rather than
closing on a test of the components a test can see. What would close it is
a scheme this process establishes rather than reads off a forwarded
header.

### An expired hint is refused, not accepted

§2 asks the OP to "accept ID Tokens when the RP identified by the ID
Token's `aud` claim and/or `sid` claim has a current session or had a
recent session at the OP, even when the `exp` time has passed."
`subjectOfIdTokenHint` verifies the hint through `verifyJwt`, which
enforces `exp` (RFC 7519 §4.1, `docs/protocols/jose.md`), so an expired
hint resolves to nothing and the request falls to the confirmation page.
The consequence of the gap is a prompt the End-User did not strictly need,
never a session ended on an unproven hint, which is why the row records a
gap rather than a divergence worth accepting: closing it means a second,
narrower verification path that skips `exp` while still checking issuer,
signature and type, and that path does not exist yet.

### One endpoint, two methods, and `session_id` as the discriminator

§2 requires both: "OpenID Providers MUST support the use of the HTTP `GET`
and `POST` methods defined in RFC 7231 at the Logout Endpoint", an RP
being free to Form-Serialize the request parameters into a body instead of
a query string. Two different messages therefore arrive at the same
`POST`: the confirmation form submitting back, and a logout request. The
form's hidden `session_id` is what tells them apart — only the page Odudu
rendered carries it — so a body with that field takes the confirmation
path and a body without it is read as a logout request, through the same
`handleLogoutRequest` a `GET` reaches. `logoutRequestParams`
(`view/routes/logout.ts`) is the one place either method's parameters are
read, because two readers are how the two methods would drift into
answering the same request differently.

Nothing about the CSRF property changes. A forged cross-site `POST` cannot
carry a `session_id` it cannot guess, so it lands on the request path,
where the answer to a hintless request is the confirmation page and
nothing is ended without the End-User saying so. What changes is that the
same request now gets the same answer either way, which is what the
`[OIDC-RPINITIATED-2-03]` tests assert by driving every property — the
confirmation triggers, the exact-match refusal, the ended session, the
cleared cookie — over both methods rather than over `GET` alone.

### A `client_id` that disagrees with the hint is an error, not a tie-break

§2's `client_id` parameter is optional, and the sentence that makes it
load-bearing is: "When both `client_id` and `id_token_hint` are present,
the OP MUST verify that the Client Identifier matches the one used when
issuing the ID Token." `subjectOfIdTokenHint` returns the hint's `aud`
values for exactly this comparison — it still checks no audience of its
own, since an OP reading its own ID Token back is not the principal RFC
7519 §4.1.3 addresses — and `handleLogoutRequest` compares the parameter
against them.

A pair that disagrees is a validation failure, so §4 governs what happens
next: "the information that failed to validate MUST NOT be used", and the
OP "MUST not perform post-logout redirection". Both halves are dropped
together — the hint proves nothing, and the `post_logout_redirect_uri` it
would have authorised is not carried into the confirmation form either,
even where that value is registered to the `client_id` given. Ending the
session on the strength of a disagreeing pair would be worse than
refusing: a client that can quote another client's ID Token is the case
the comparison exists to catch, and the honest answer to it is to ask the
End-User.

A hint carrying no `aud` claim at all reaches the same refusal: `aud`
absent reads as `[]`, which cannot include a `client_id` that was given,
so the comparison is already `true` against it.

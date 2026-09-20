# OpenID Connect Back-Channel Logout 1.0

**Status in Odudu:** started in P2b, scoped for now to §2.1's `sid` claim —
the identifier a Logout Token will later need to name a session by — and
§2.7's revocation rule, which P2b's logout endpoint already has occasion to
follow even without the Logout Token itself. `end_session_endpoint` now
exists (RP-Initiated Logout 1.0, see `docs/protocols/oidc-rpinitiated.md`)
and ends the session `sid` names, but the Logout Token itself and the
back-channel delivery to a client's registered logout URI are still P3b
work. The rest of the specification is tabled all the same, so that what
is owed is countable rather than absent. The split runs through §2.2:
**registering and validating a `backchannel_logout_uri` is P3a's**, which is
where a client first gets to state one, and everything the Logout Token and
its delivery require is `deferred: P3b`, which §11 of the design spec names
("front-channel and back-channel logout against registered per-client
logout URIs"), and the clauses addressed to the RP receiving a Logout
Token are `n/a` — Odudu is the OP that sends one.

§1.1 (Requirements Notation) and §5 (IANA Considerations) impose nothing on
a deployment and are not rowed; §4.1's explicit-typing advice is the same
`typ` recommendation §2.4 already states, and is rowed there once.

## Clause table

| Clause | Level  | Requirement                                                                                                                                           | Test ID                   | Status                                                                                                                                                                                                               |
| ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1    | MAY    | the OP advertises `backchannel_logout_supported` as `true`                                                                                            | —                         | deferred: P3b — no back-channel logout metadata is published yet; the value would claim a capability the OP does not have                                                                                            |
| 2.1    | SHOULD | the OP also registers `backchannel_logout_session_supported`                                                                                          | —                         | deferred: P3b — it arrives with the Logout Token that the `sid` it advertises would travel in                                                                                                                        |
| 2.1    | MUST   | the OP includes a `sid` Claim in the ID Token, identifying the End-User's session, so a Logout Token can later name the same session                  | `OIDC-BACKCHANNEL-2.1-01` | covered                                                                                                                                                                                                              |
| 2.2    | MUST   | a registered back-channel logout URI is an absolute URI                                                                                               | `OIDC-BACKCHANNEL-2.2-01` | covered                                                                                                                                                                                                              |
| 2.2    | MUST   | a query component in a registered back-channel logout URI is retained when further query parameters are added                                         | —                         | deferred: P3b — nothing composes a back-channel logout request yet                                                                                                                                                   |
| 2.2    | MUST   | a registered back-channel logout URI includes no fragment component                                                                                   | `OIDC-BACKCHANNEL-2.2-02` | covered                                                                                                                                                                                                              |
| 2.2    | SHOULD | `backchannel_logout_uri` uses the `https` scheme                                                                                                      | `OIDC-BACKCHANNEL-2.2-03` | covered                                                                                                                                                                                                              |
| 2.2    | MAY    | `backchannel_logout_uri` uses the `http` scheme where the Client Type is confidential and the OP allows it                                            | —                         | accepted: "§2.2's confidential-client `http` exception: declined, not absent" — `isValidBackchannelLogoutUri` refuses `http` unconditionally; the exception is addressable but not worth the surface it would reopen |
| 2.2    | SHOULD | `backchannel_logout_session_required` is registered alongside it, and honoured when the logout URI is used                                            | —                         | deferred: P3b — the OP's half, including a `sid` in the Logout Token when a client demands one, needs the Logout Token first                                                                                         |
| 2.3    | SHOULD | the OP keeps track of the set of logged-in RPs, so that it knows which to contact at their back-channel logout URIs                                   | —                         | deferred: P3b — a session records the grants issued from it but not the clients to notify; that index is part of delivering a Logout Token                                                                           |
| 2.3    | MAY    | logout requests are sent to the logged-in RPs in parallel                                                                                             | —                         | deferred: P3b — nothing sends them yet                                                                                                                                                                               |
| 2.4    | MUST   | a Logout Token carries `iss`, the Issuer Identifier                                                                                                   | `OIDC-BACKCHANNEL-2.4-01` | covered                                                                                                                                                                                                              |
| 2.4    | MUST   | a Logout Token carries `aud`                                                                                                                          | `OIDC-BACKCHANNEL-2.4-02` | covered                                                                                                                                                                                                              |
| 2.4    | MUST   | a Logout Token carries `iat`                                                                                                                          | `OIDC-BACKCHANNEL-2.4-03` | covered                                                                                                                                                                                                              |
| 2.4    | MUST   | a Logout Token carries `exp`                                                                                                                          | `OIDC-BACKCHANNEL-2.4-04` | covered                                                                                                                                                                                                              |
| 2.4    | MUST   | a Logout Token carries `jti`, a unique identifier for the token                                                                                       | `OIDC-BACKCHANNEL-2.4-05` | covered                                                                                                                                                                                                              |
| 2.4    | MAY    | a Logout Token carries `sub`                                                                                                                          | `OIDC-BACKCHANNEL-2.4-07` | covered                                                                                                                                                                                                              |
| 2.4    | MAY    | a Logout Token carries `sid`                                                                                                                          | `OIDC-BACKCHANNEL-2.4-07` | covered                                                                                                                                                                                                              |
| 2.4    | MUST   | a Logout Token carries an `events` Claim whose value is a JSON object containing the member name `http://schemas.openid.net/event/backchannel-logout` | `OIDC-BACKCHANNEL-2.4-06` | covered                                                                                                                                                                                                              |
| 2.4    | MUST   | that member's value is a JSON object                                                                                                                  | `OIDC-BACKCHANNEL-2.4-06` | covered                                                                                                                                                                                                              |
| 2.4    | SHOULD | that member's value is the empty JSON object                                                                                                          | `OIDC-BACKCHANNEL-2.4-06` | covered                                                                                                                                                                                                              |
| 2.4    | MUST   | a Logout Token contains either a `sub` or a `sid` Claim, and may contain both                                                                         | `OIDC-BACKCHANNEL-2.4-07` | covered                                                                                                                                                                                                              |
| 2.4    | MUST   | a `nonce` Claim is not present in a Logout Token                                                                                                      | `OIDC-BACKCHANNEL-2.4-08` | covered                                                                                                                                                                                                              |
| 2.4    | MAY    | a Logout Token contains other Claims                                                                                                                  | —                         | deferred: P3b — `logoutTokenClaims` (`packages/protocol-oidc/src/service/logout-token.ts`) carries only the registered set; nothing yet has a claim of its own to add                                                |
| 2.4    | MUST   | Claims used that are not understood are ignored                                                                                                       | —                         | n/a: addressed to the party reading a Logout Token, which is the RP                                                                                                                                                  |
| 2.4    | MUST   | a Logout Token is signed, and may also be encrypted                                                                                                   | —                         | deferred: P3b — `logoutTokenClaims` assembles the payload; nothing calls `signJwt` on it yet, which is where both signing and any future encryption would happen                                                     |
| 2.4    | SHOULD | an encrypted Logout Token replicates the `iss` claim in its JWT header parameters                                                                     | —                         | deferred: P3b — Odudu encrypts no tokens at all; there is no JWE anywhere in this repository until a later increment builds it, and nothing has asked for an encrypted logout token                                  |
| 2.4    | SHOULD | Logout Tokens are explicitly typed, with a `typ` header parameter of `logout+jwt`                                                                     | `OIDC-BACKCHANNEL-2.4-09` | covered                                                                                                                                                                                                              |
| 2.5    | MUST   | the back-channel logout request's `POST` body includes a `logout_token` parameter containing a Logout Token for the RP                                | —                         | deferred: P3b — nothing sends a back-channel logout request yet                                                                                                                                                      |
| 2.5    | MAY    | the `POST` body contains other values alongside `logout_token`                                                                                        | —                         | deferred: P3b — nothing sends a back-channel logout request yet                                                                                                                                                      |
| 2.5    | MUST   | values in the request that the implementation does not understand are ignored                                                                         | —                         | n/a: addressed to the party reading a back-channel logout request, which is the RP                                                                                                                                   |
| 2.5    | SHOULD | retransmission is delayed an appropriate amount of time when a previous transmission may have failed recoverably                                      | —                         | deferred: P3b — nothing sends a back-channel logout request yet                                                                                                                                                      |
| 2.5    | SHOULD | in every other case, a back-channel logout request is not retransmitted                                                                               | —                         | deferred: P3b — nothing sends a back-channel logout request yet                                                                                                                                                      |
| 2.6    | MUST   | the Logout Token is validated as this section's numbered procedure sets out, on receipt at the back-channel logout URI                                | —                         | n/a: the validation is the RP's; Odudu holds the mirror-image obligations in §2.4, which say what such a token must contain                                                                                          |
| 2.7    | SHOULD | refresh tokens issued without the `offline_access` property to a session being logged out are revoked                                                 | `OIDC-BACKCHANNEL-2.7-01` | covered                                                                                                                                                                                                              |
| 2.7    | SHOULD | refresh tokens issued with the `offline_access` property are not revoked when the session that issued them is logged out                              | `OIDC-BACKCHANNEL-2.7-02` | covered                                                                                                                                                                                                              |
| 2.8    | MUST   | a successful logout is answered with HTTP 200 OK                                                                                                      | —                         | n/a: the response is the RP's to send; Odudu sends no back-channel logout request to be answered                                                                                                                     |
| 2.8    | MUST   | an invalid or failed logout is answered with HTTP 400 Bad Request                                                                                     | —                         | n/a: the response is the RP's to send                                                                                                                                                                                |
| 2.8    | MUST   | `error` is present when a response body is present                                                                                                    | —                         | n/a: the response is the RP's to send                                                                                                                                                                                |
| 2.8    | MAY    | the error response carries a JSON body with `error` and `error_description`                                                                           | —                         | n/a: the response is the RP's to send                                                                                                                                                                                |
| 2.8    | SHOULD | the response carries `Cache-Control: no-store`                                                                                                        | —                         | n/a: the response is the RP's to send                                                                                                                                                                                |
| 3      | MUST   | every feature this specification lists as REQUIRED or describes with a MUST is implemented                                                            | —                         | n/a: a restatement of every other MUST in this table rather than an obligation of its own; those rows are the record of which hold                                                                                   |
| 4      | SHOULD | the implementation makes clear which kinds of Relying Party it can log out                                                                            | —                         | deferred: P3b — there is nothing to describe until a Logout Token is delivered                                                                                                                                       |
| 4      | SHOULD | Logout Tokens are given short expiration times, preferably at most two minutes                                                                        | `OIDC-BACKCHANNEL-2.4-04` | covered                                                                                                                                                                                                              |

## Reading note

### §2.1 states the `sid` obligation conditionally, and Odudu takes it unconditionally

The `sid` Claim's own definition in §2.1 is marked OPTIONAL, and what makes
it compulsory is the metadata value beside it:
`backchannel_logout_session_supported`, of which §2.1 says "If supported,
the `sid` Claim is also included in ID Tokens issued by the OP." An OP that
will one day pass a `sid` in a Logout Token therefore owes `sid` in its ID
Tokens, and the row is levelled MUST on that reading rather than on a
keyword the sentence does not contain. Odudu mints `sid` into every ID
Token a session-backed login produces before advertising anything, because
the claim is what RP-Initiated Logout §2's confirmation rule compares a
hint against (`docs/protocols/oidc-rpinitiated.md`) — the ID Token side is
already load-bearing without the Logout Token, which is why it is the one
row of this file that is closed rather than deferred.

### §2.7's two SHOULDs are one sentence, and Odudu keeps both halves

> Refresh tokens issued without the `offline_access` property to a session
> being logged out SHOULD be revoked. Refresh tokens issued with the
> `offline_access` property normally SHOULD NOT be revoked.

`handleLogoutRequest`'s `endSession` (`packages/protocol-oidc/src/index.ts`)
revokes every grant whose `session_id` names the session being ended
(`tokenGrantRepository(tx).revokeForSession`) — the first sentence. It
reaches no further, because a grant's `session_id` is `NULL` exactly when
it was issued for the `offline_access` scope
(`packages/domain-realm/src/usecase/provision-defaults.ts`,
`packages/protocol-oidc/src/usecase/token-issuance.ts`): SQL equality never
matches `NULL`, so the same `UPDATE` that revokes every session-bound grant
leaves an offline one untouched by construction, not by a second check
written to exempt it — the second sentence follows from the first without
extra code. `packages/protocol-oidc/tests/grant-session-link.int.test.ts`
pins that at the repository layer; `logout.int.test.ts` and
`offline-access.int.test.ts` pin it end to end, through a real logout and a
real subsequent refresh.

### §2.2's confidential-client `http` exception: declined, not absent

`isValidBackchannelLogoutUri`
(`packages/protocol-oidc/src/service/client-metadata.ts`) requires `https`
for every `backchannel_logout_uri`, with no branch on Client Type. The
obligation is Odudu's own — the OP is who validates a URI a client
registers — and nothing about it is unaddressable: a Client Type is already
recorded (`token_endpoint_auth_method`), so the exception could be wired in
without any further design work. It is left out because a back-channel
logout URI is a second, unauthenticated inbound surface the OP calls at a
time of its own choosing, and `http` widens that surface for the one Client
Type — public — that also cannot keep a `client_secret_basic` challenge
private end to end; the confidentiality the exception is conditioned on
buys nothing back for the risk `http` reopens. Revisiting this is cheap
(remove the scheme check's `https:` literal and thread Client Type through),
so the row is `accepted:`, not `deferred:` to a phase that would do the
work — there is none.

### §2.4's payload and its "is signed" row are two different claims

`logoutTokenClaims` (`packages/protocol-oidc/src/service/logout-token.ts`)
assembles every claim §2.4 requires — the payload is what the rows above
now cite. `OIDC-BACKCHANNEL-2.4-09` goes further and signs one, with
`signJwt(claims, { key, kek, typ: LOGOUT_TOKEN_TYP })`, then verifies that
`logout+jwt` came back on the protected header rather than the payload —
which is what closes the `typ` row. That test proves the pairing works;
it does not discharge "a Logout Token is signed," which stays deferred.
No production code calls `signJwt` on these claims yet — the delivery
queue (`packages/protocol-oidc/src/schema/logout-deliveries.ts`) stores an
already-signed `logout_token` column, and nothing populates it. The
encrypted-token row beside it, and the `iss`-header-replication row that
only applies to an encrypted token, stay deferred for the same reason
`docs/protocols/` gives everywhere else JWE is absent: there is no JWE
anywhere in this repository until a later increment builds it, and
nothing has asked for an encrypted logout token.

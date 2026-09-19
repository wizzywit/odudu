# OpenID Connect Front-Channel Logout 1.0

**Status in Odudu:** registering a `frontchannel_logout_uri` is P3a's, which
is where a client first gets to state one — `isValidLogoutUri`
(`packages/protocol-oidc/src/service/client-metadata.ts`) applies the same
https/absolute/no-fragment policy already given to its back-channel twin
(`docs/protocols/oidc-backchannel.md`). Everything downstream of
registration — rendering the iframe, adding `iss` and `sid`, and the
`frontchannel_logout_session_required` metadata that says whether an RP
demands them — is `deferred: P3b`, which §11 of the design spec names.

A spike ran before this table was written, because §4.1's third-party
cookie warning is exactly the kind of claim about browser behaviour that
`CLAUDE.md`'s P0 rule requires evidence for rather than documentation
prose: `docs/superpowers/p3b-spike-frontchannel.md`, run against Chromium
152.0.7977.76 (the browser embedded in the Claude Code browser tool),
2026-09-20. Its finding is stated here because it decides how several rows
below are worded: a cookie with the ordinary `SameSite=Lax` default is
never sent on the framed cross-site request the OP issues, in every
browser; a cookie explicitly marked `SameSite=None; Secure` was sent in the
one browser tested, but is denied in browsers and configurations that block
third-party cookies by default (Safari, Firefox) or by user or
administrator choice (Chrome). **An OP can attempt front-channel logout;
it cannot promise a framed URI's request is ever seen by a live RP
session, or that a `Set-Cookie` it sends back is honoured.** The table
below states delivery-dependent clauses as attempts for that reason.

§1 (Introduction, its own Requirements Notation subsection, and
Terminology) and §6 (IANA Considerations) impose nothing on a deployment
and are not rowed; §4's restatement that every MUST is implemented is the
same self-referential clause `oidc-backchannel.md` §3 already carries and
adds nothing new to row. §3's restatement of the `sid` Claim's definition
and of "if supported, the `sid` Claim is also included in ID Tokens" is the
same obligation `oidc-backchannel.md`'s §2.1 already rows and closes —
`sid` is minted into every ID Token today, for the same reason Back-Channel
Logout needs it, and duplicating that row here would double-count one
closed obligation rather than name a second one.

## Clause table

| Clause | Level  | Requirement                                                                                                                     | Test ID                           | Status                                                                                                                                                                                           |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2      | MUST   | a registered front-channel logout URI's domain, port and scheme match those of a registered redirect URI                        | —                                 | deferred: P3b — nothing cross-checks a front-channel logout URI's origin against the client's registered redirect_uris yet                                                                       |
| 2      | MUST   | the front-channel logout URI is an absolute URI                                                                                 | `OIDC-FRONTCHANNEL-2-ABSOLUTE-01` | covered                                                                                                                                                                                          |
| 2      | MUST   | a query component in the front-channel logout URI is retained when the OP adds further query parameters                         | —                                 | deferred: P3b — nothing composes a front-channel logout request yet                                                                                                                              |
| 2      | MUST   | the front-channel logout URI includes no fragment component                                                                     | `OIDC-FRONTCHANNEL-2-FRAGMENT-01` | covered                                                                                                                                                                                          |
| 2      | SHOULD | `frontchannel_logout_uri` uses the `https` scheme                                                                               | `OIDC-FRONTCHANNEL-2-SCHEME-01`   | covered                                                                                                                                                                                          |
| 2      | MAY    | `frontchannel_logout_uri` uses the `http` scheme where the Client Type is confidential and the OP allows it                     | —                                 | accepted: "§2's confidential-client `http` exception: declined, not absent" — `isValidLogoutUri` refuses `http` unconditionally, the same policy and the same reasoning as its back-channel twin |
| 2      | MAY    | the OP adds `iss` and `sid` query parameters when rendering the registered logout URI in an iframe                              | —                                 | deferred: P3b — nothing renders a front-channel logout iframe yet                                                                                                                                |
| 2      | MUST   | if either `iss` or `sid` is added, both are added                                                                               | —                                 | deferred: P3b — nothing composes the query yet                                                                                                                                                   |
| 2      | MAY    | the RP verifies `iss` and `sid` against the Claims of a current or recent ID Token and ignores the request if they do not match | —                                 | n/a: addressed to the party receiving a front-channel logout request, which is the RP                                                                                                            |
| 2      | SHOULD | the RP's response carries `Cache-Control: no-store`                                                                             | —                                 | n/a: the response is the RP's to send                                                                                                                                                            |
| 2      | SHOULD | `frontchannel_logout_session_required` is also registered                                                                       | —                                 | deferred: P3b — neither the column nor the metadata field exists yet; adding both is this increment's own next step                                                                              |
| 3      | SHOULD | the OP keeps track of the set of logged-in RPs for a session, so it knows which to contact at their logout URIs                 | —                                 | deferred: P3b — `token_grants` already carries `session_id` and `client_id` (migration 0026), indexed, which is where this lands; nothing reads it for front-channel delivery yet                |
| 3      | MAY    | the OP contacts logged-in RPs in parallel, using a dynamically constructed page of `<iframe>` tags                              | —                                 | deferred: P3b — nothing renders a front-channel logout page yet                                                                                                                                  |
| 3      | MAY    | the OP advertises `frontchannel_logout_supported` as `true`                                                                     | —                                 | deferred: P3b — no front-channel logout metadata is published yet; the value would claim a capability the OP does not have                                                                       |
| 3      | SHOULD | the OP also registers `frontchannel_logout_session_supported`                                                                   | —                                 | deferred: P3b — it arrives with the same `iss`/`sid` delivery the §2 rows above defer                                                                                                            |
| 5      | SHOULD | Session ID values carry sufficient entropy that collisions and guessing are impractical                                         | —                                 | gap                                                                                                                                                                                              |

## Reading note

### §2's confidential-client `http` exception: declined, not absent

The reasoning is identical to `oidc-backchannel.md`'s own row of the same
shape: a front-channel logout URI is a second, unauthenticated inbound
surface an OP invokes at a time of its own choosing (via the End-User's
browser rather than a server-to-server call, which if anything widens who
can trigger it), and `http` widens that surface for exactly the Client Type
— public — that also cannot keep any other channel confidential end to
end. `isValidLogoutUri` makes no branch on Client Type for either logout
URI, so revisiting this exception costs the same small, well-understood
change in both places, and neither is done because neither buys back
anything for the risk `http` reopens.

### The spike changes what "implemented" can mean here

Because delivery is never guaranteed even once every row above is
"covered", this table's own exit condition is not "the RP's session ends"
but "the OP made the correct, complete attempt": the iframe is rendered
against the exact URI the client registered, and `iss`/`sid` are present
together whenever the client's own
`frontchannel_logout_session_required` asked for them. Nothing in this
document should be read as promising more than that — see
`docs/superpowers/p3b-spike-frontchannel.md` for the browser evidence.

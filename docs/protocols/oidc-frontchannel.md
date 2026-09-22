# OpenID Connect Front-Channel Logout 1.0

**Status in Odudu:** registering a `frontchannel_logout_uri` is P3a's, which
is where a client first gets to state one — `isValidLogoutUri`
(`packages/protocol-oidc/src/service/client-metadata.ts`) applies the same
https/absolute/no-fragment policy already given to its back-channel twin
(`docs/protocols/oidc-backchannel.md`), and `sharesOriginWithRegisteredRedirectUri`
in the same file now refuses one whose domain, port or scheme does not match
a registered redirect URI. `frontchannel_logout_session_required` is also
registration metadata now, stored and echoed the same way its back-channel
twin already was. P3b builds everything downstream of registration: reading
the session's own set of relying parties (`tokenGrantRepository(tx)
.clientsForSession`, `packages/protocol-oidc/src/repository/grants.ts`),
building each one's logout URL (`frontChannelLogoutUrl`,
`packages/protocol-oidc/src/service/frontchannel-logout.ts`), and rendering
the logout page's iframes (`renderLoggedOutPage`,
`packages/protocol-oidc/src/view/logout-html.ts`). Discovery now advertises
`frontchannel_logout_supported` and `frontchannel_logout_session_supported`,
closing §11 of the design spec's own name for this row.

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

| Clause | Level  | Requirement                                                                                                                     | Test ID                                   | Status                                                                                                                                                                                           |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2      | MUST   | a registered front-channel logout URI's domain, port and scheme match those of a registered redirect URI                        | `OIDC-FRONTCHANNEL-2-ORIGIN-01`           | covered                                                                                                                                                                                          |
| 2      | MUST   | the front-channel logout URI is an absolute URI                                                                                 | `OIDC-FRONTCHANNEL-2-ABSOLUTE-01`         | covered                                                                                                                                                                                          |
| 2      | MUST   | a query component in the front-channel logout URI is retained when the OP adds further query parameters                         | `OIDC-FRONTCHANNEL-2-QUERY-01`            | covered                                                                                                                                                                                          |
| 2      | MUST   | the front-channel logout URI includes no fragment component                                                                     | `OIDC-FRONTCHANNEL-2-FRAGMENT-01`         | covered                                                                                                                                                                                          |
| 2      | SHOULD | `frontchannel_logout_uri` uses the `https` scheme                                                                               | `OIDC-FRONTCHANNEL-2-SCHEME-01`           | covered                                                                                                                                                                                          |
| 2      | MAY    | `frontchannel_logout_uri` uses the `http` scheme where the Client Type is confidential and the OP allows it                     | —                                         | accepted: "§2's confidential-client `http` exception: declined, not absent" — `isValidLogoutUri` refuses `http` unconditionally, the same policy and the same reasoning as its back-channel twin |
| 2      | MAY    | the OP adds `iss` and `sid` query parameters when rendering the registered logout URI in an iframe                              | `OIDC-FRONTCHANNEL-3-IFRAME-01`           | covered                                                                                                                                                                                          |
| 2      | MUST   | if either `iss` or `sid` is added, both are added                                                                               | `OIDC-FRONTCHANNEL-3-IFRAME-01`           | covered                                                                                                                                                                                          |
| 2      | MAY    | the RP verifies `iss` and `sid` against the Claims of a current or recent ID Token and ignores the request if they do not match | —                                         | n/a: addressed to the party receiving a front-channel logout request, which is the RP                                                                                                            |
| 2      | SHOULD | the RP's response carries `Cache-Control: no-store`                                                                             | —                                         | n/a: the response is the RP's to send                                                                                                                                                            |
| 2      | SHOULD | `frontchannel_logout_session_required` is also registered                                                                       | `OIDC-FRONTCHANNEL-2-SESSION-REQUIRED-01` | covered                                                                                                                                                                                          |
| 3      | SHOULD | the OP keeps track of the set of logged-in RPs for a session, so it knows which to contact at their logout URIs                 | `OIDC-FRONTCHANNEL-3-TRACKING-01`         | covered                                                                                                                                                                                          |
| 3      | MAY    | the OP contacts logged-in RPs in parallel, using a dynamically constructed page of `<iframe>` tags                              | `OIDC-FRONTCHANNEL-3-IFRAME-01`           | covered                                                                                                                                                                                          |
| 3      | MAY    | the OP advertises `frontchannel_logout_supported` as `true`                                                                     | `OIDC-FRONTCHANNEL-3-01`                  | covered                                                                                                                                                                                          |
| 3      | SHOULD | the OP also registers `frontchannel_logout_session_supported`                                                                   | `OIDC-FRONTCHANNEL-3-01`                  | covered                                                                                                                                                                                          |
| 5      | SHOULD | Session ID values carry sufficient entropy that collisions and guessing are impractical                                         | —                                         | gap                                                                                                                                                                                              |

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

### What "covered" reads through, for the rows P3b closed

`tokenGrantRepository(tx).clientsForSession` (§3's tracking row) reads
`token_grants`' own `(tenant_id, session_id)` index; nothing separate is
kept, because the grants already are the record. `frontChannelLogoutUrl`
(§2's `iss`/`sid` rows, `packages/protocol-oidc/src/service/frontchannel-logout.ts`)
sets `iss` unconditionally before it ever considers `sid`, so the MUST that
either both appear or neither does follows from the order of two
statements rather than needing a check of its own.

### The spike changes what "implemented" can mean here

Because delivery is never guaranteed even once every row above is
"covered", this table's own exit condition is not "the RP's session ends"
but "the OP made the correct, complete attempt": the iframe is rendered
against the exact URI the client registered, and `iss`/`sid` are present
together whenever the client's own
`frontchannel_logout_session_required` asked for them. Nothing in this
document should be read as promising more than that — see
`docs/superpowers/p3b-spike-frontchannel.md` for the browser evidence.

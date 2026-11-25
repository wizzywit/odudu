# OpenID Connect Client-Initiated Backchannel Authentication Flow 1.0 (CIBA)

**Status in Odudu:** poll mode only. A confidential client that holds the
`urn:openid:params:grant-type:ciba` grant (a public client is refused with
`unauthorized_client`, at both endpoints and when it is registered; so is a client
registered over the wire, anonymously or from a metadata document, at both
endpoints, and anonymous Dynamic Client Registration refuses the grant with
`invalid_client_metadata`) asks `POST /tenants/:tenant/protocol/openid-connect/bc-authorize`
for an approval by a named person, receives an `auth_req_id`, and polls the token
endpoint with it. The person decides on a channel the client has no part in: the
approval is an `agent_approvals` row (ADR 0059) and only `decideApproval`
(`packages/protocol-oidc/src/usecase/approvals.ts`) moves it out of `pending`.
Ping and push delivery, `user_code`, signed authentication requests and
`login_hint_token` are not built, and discovery says so by leaving them out.

§1.1, §2, §3, §6, §12 (push), §14 and §15 impose nothing a deployment can be held
to and are not rowed, apart from the enumeration passage of §14, rowed at §7.2.

## Clause table

| Clause | Level  | Requirement                                                                                                     | Test ID               | Status                                                                                  |
| ------ | ------ | --------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------- |
| 4      | MUST   | the OP publishes `backchannel_token_delivery_modes_supported`, naming the modes it serves                       | `OIDC-CIBA-4-01`      | covered                                                                                 |
| 4      | MUST   | the OP publishes `backchannel_authentication_endpoint`                                                          | `OIDC-CIBA-4-02`      | covered                                                                                 |
| 4      | MAY    | the OP publishes `backchannel_authentication_request_signing_alg_values_supported`; omitted, it supports none   | `OIDC-CIBA-4-03`      | covered                                                                                 |
| 4      | MAY    | the OP publishes `backchannel_user_code_parameter_supported`, which is false when omitted                       | `OIDC-CIBA-4-04`      | covered                                                                                 |
| 4      | SHOULD | an OP serving poll lists the CIBA grant type in `grant_types_supported`                                         | `OIDC-CIBA-4-05`      | covered                                                                                 |
| 5      | MAY    | the OP serves the ping and push delivery modes                                                                  | —                     | accepted: "Ping and push delivery, user codes, signed requests and login hint tokens"   |
| 7.1    | MUST   | the request is an HTTP POST with a form-encoded UTF-8 body                                                      | `OIDC-CIBA-7.1-01`    | covered                                                                                 |
| 7.1    | MUST   | the client authenticates with the method registered for its `client_id`                                         | `OIDC-CIBA-7.1-02`    | covered                                                                                 |
| 7.1    | MUST   | the OP accepts its issuer, token endpoint or backchannel endpoint as the audience of a client assertion         | `OIDC-CIBA-7.1-07`    | covered                                                                                 |
| 7.1    | MUST   | `scope` is present and holds `openid`                                                                           | `OIDC-CIBA-7.1-03`    | covered                                                                                 |
| 7.1    | MUST   | exactly one of `login_hint_token`, `id_token_hint` and `login_hint` is sent                                     | `OIDC-CIBA-7.1-04`    | covered                                                                                 |
| 7.1    | MAY    | the OP accepts `login_hint_token`                                                                               | —                     | accepted: "Ping and push delivery, user codes, signed requests and login hint tokens"   |
| 7.1    | MAY    | the OP honours `acr_values`                                                                                     | —                     | accepted: "acr_values is ignored"                                                       |
| 7.1    | SHOULD | `binding_message` is acceptable only when the OP can show it as written                                         | `OIDC-CIBA-7.1-05`    | covered                                                                                 |
| 7.1    | MAY    | `requested_expiry` asks for a lifetime, which the OP may shorten                                                | `OIDC-CIBA-7.1-06`    | covered                                                                                 |
| 7.1.1  | MAY    | the OP accepts a signed authentication request in `request`                                                     | —                     | accepted: "Ping and push delivery, user codes, signed requests and login hint tokens"   |
| 7.1.1  | SHOULD | a parameter the OP does not support that would change what it does is refused, not ignored                      | `OIDC-CIBA-7.1.1-01`  | covered                                                                                 |
| 7.1.2  | MAY    | the OP accepts `user_code`                                                                                      | `OIDC-CIBA-7.1.2-01`  | covered                                                                                 |
| 7.2    | MUST   | the OP authenticates the client                                                                                 | `OIDC-CIBA-7.2-01`    | covered                                                                                 |
| 7.2    | MUST   | a request with more than one hint is refused with `invalid_request`                                             | `OIDC-CIBA-7.2-02`    | covered                                                                                 |
| 7.2    | SHOULD | a hint that identifies no person is refused                                                                     | —                     | accepted: "An unknown person is answered as a known one is"                             |
| 7.2    | MUST   | the OP validates the hint, and an `id_token_hint` it did not issue for this client is refused                   | `OIDC-CIBA-7.2-03`    | covered                                                                                 |
| 7.2    | MUST   | a request from a client that lacks the CIBA grant is refused with `unauthorized_client`                         | `OIDC-CIBA-7.2-04`    | covered                                                                                 |
| 7.2    | MUST   | parameters the OP does not recognise are ignored                                                                | `OIDC-CIBA-7.2-05`    | covered                                                                                 |
| 7.3    | MUST   | the acknowledgement is HTTP 200 with a JSON body carrying `auth_req_id` and `expires_in`                        | `OIDC-CIBA-7.3-01`    | covered                                                                                 |
| 7.3    | MUST   | `auth_req_id` holds at least 128 bits of entropy                                                                | `OIDC-CIBA-7.3-02`    | covered                                                                                 |
| 7.3    | MUST   | `auth_req_id` uses only letters, digits, `.`, `-` and `_`                                                       | `OIDC-CIBA-7.3-02`    | covered                                                                                 |
| 7.3    | MAY    | `interval` names the least wait between polls, five seconds when absent                                         | `OIDC-CIBA-7.3-03`    | covered                                                                                 |
| 8      | MUST   | the OP obtains the person's authorization out of band before it issues tokens                                   | `OIDC-CIBA-8-01`      | covered                                                                                 |
| 8      | MUST   | no credential the client holds can give that authorization in the person's place                                | `OIDC-CIBA-8-02`      | covered                                                                                 |
| 9      | MAY    | the OP calls a client notification endpoint                                                                     | —                     | accepted: "Ping and push delivery, user codes, signed requests and login hint tokens"   |
| 10.1   | MUST   | the token request carries `grant_type` and `auth_req_id`, and a request without `auth_req_id` is refused        | `OIDC-CIBA-10.1-01`   | covered                                                                                 |
| 10.1   | MUST   | the client authenticates at the token endpoint as it does elsewhere                                             | `OIDC-CIBA-10.1-02`   | covered                                                                                 |
| 10.1   | MUST   | the `auth_req_id` was issued to the client making the request                                                   | `OIDC-CIBA-10.1-03`   | covered                                                                                 |
| 10.1   | MUST   | after a successful redemption the `auth_req_id` is no longer valid                                              | `OIDC-CIBA-10.1-04`   | covered                                                                                 |
| 10.1   | SHOULD | the OP does not take longer than 30 seconds to answer a poll                                                    | —                     | n/a: a poll is answered from one read and never held open, so there is no wait to bound |
| 10.1.1 | MUST   | a successful response carries `access_token`, `token_type`, `expires_in` and `id_token`                         | `OIDC-CIBA-10.1.1-01` | covered                                                                                 |
| 10.1.1 | MAY    | a successful response carries a `refresh_token`                                                                 | —                     | accepted: "No refresh token from a CIBA grant"                                          |
| 11     | MUST   | `authorization_pending` while the person has not yet decided                                                    | `OIDC-CIBA-11-01`     | covered                                                                                 |
| 11     | MUST   | `slow_down` for a poll sooner than the interval, and the interval is raised by at least five seconds            | `OIDC-CIBA-11-02`     | covered                                                                                 |
| 11     | MUST   | `expired_token` once the request has expired                                                                    | `OIDC-CIBA-11-03`     | covered                                                                                 |
| 11     | MUST   | `access_denied` when the person refused                                                                         | `OIDC-CIBA-11-04`     | covered                                                                                 |
| 11     | MUST   | `invalid_grant` for an `auth_req_id` that is unknown, spent or issued to another client                         | `OIDC-CIBA-11-05`     | covered                                                                                 |
| 11     | MAY    | `invalid_request` for excessive polling                                                                         | —                     | accepted: "Excessive polling is slowed, not refused"                                    |
| 13     | MUST   | an authentication error is a JSON body with `error`, HTTP 400, or 401 for `invalid_client`, 403 `access_denied` | `OIDC-CIBA-13-01`     | covered                                                                                 |

## Reading note

### Ping and push delivery, user codes, signed requests and login hint tokens

Poll needs nothing from the client but the token endpoint it already calls. Ping
and push need a client-hosted endpoint the OP calls with a bearer token, and with
it a notification-security story (the endpoint is a second inbound surface, as
the back-channel logout URI is: `docs/protocols/oidc-backchannel.md`) that
nothing here asks for. A signed request, a `user_code` and a `login_hint_token`
each add a path through which a request names a person, and each is declined in
the same way: `bc-authorize` refuses a request carrying `request`, `request_uri`,
`user_code`, `client_notification_token` or `login_hint_token` with
`invalid_request`, and discovery omits the metadata that would advertise them
(`backchannel_user_code_parameter_supported` is `false`). ADR 0059 records the
decision.

### An unknown person is answered as a known one is

§7.2 says the OP SHOULD return an error when it cannot identify the person. An
error that exists only for a person who does not exist lets a client list who
does. `bc-authorize` resolves `login_hint` as the sign-in form does (a
username, or a verified address where the tenant accepts one) and, whether or
not that finds anyone, runs the same statements, writes a `ciba_requests` row
and answers `200` with an `auth_req_id` of the same shape. The request of an
unknown person has no approval and can only run to `expired_token`, polled as
`authorization_pending` until then, and nothing is sent anywhere.
`tests/ciba.int.test.ts` asserts the same status, body shape and, statement by
statement, the same verb and table for a known person, a known person at the
per-person limit and an unknown one. Timing is not claimed to be equal.

### How the person is told

§7.3 leaves the channel to the OP. A real approval queues one mail to the
person's verified address, linking `/tenants/<tenant>/approval/<id>` on the
tenant's canonical address (the configured base URL, never the request's
`Host`), and nothing else: not the `auth_req_id`, which is the client's poll
secret. The mail is part of what a request does, so a request for nobody, one
for a person at the limit and one for a person with no verified address read
the same rows and insert into `email_outbox`, the insert matching nothing and
no mail written (`ODUDU-CIBA-UNKNOWN-01` and `-05`). The page answers one `404`
for every approval that is not the signed-in owner's and pending (ADR 0059).

### Two limits, one visible and one silent

The visible limit is per authenticated client and hint: a client holds at most
20 live requests (`expires_at` in the future) for one hint, and the 21st answers
`access_denied` (HTTP 403, §13) with its own `error_description`. The count
reads `ciba_requests` alone and treats a request for a person and one for nobody
alike, so it says nothing about whom a hint names. The hint is digested after the
fold the account lookup applies (an address is compared without regard to case),
so spellings of one address share one counter, for a known and an unknown hint
alike. `invalid_request` would say the request is malformed, which it is not.

The silent limit is per person: 20 pending approvals from any source
(`PENDING_APPROVALS_PER_SUBJECT`). A person at it still gets a `ciba_requests`
row and the ordinary `200`, but no approval is made, and the request then runs
as one for nobody does: `authorization_pending`, then `expired_token`. Nothing
a client can see tells it the person is busy, because that would reveal that
the person exists and what else is asking of them. `requested_expiry` shortens
the request and its approval alike.

### acr_values is ignored

§7.1 makes `acr_values` OPTIONAL and leaves the OP free to ignore it. No
authentication happens at `bc-authorize` for an `acr` to describe: the person
decides in a session of their own. The parameter is read as an unrecognised
parameter and ignored (§7.2).

### No refresh token from a CIBA grant

§10.1.1 lets the response carry a `refresh_token`. The grant issues an access
token and an ID token for the approving person and none beyond, so each further
action by an agent asks again and the person sees it again. A client that wants
a longer-lived credential asks for one through a grant that was made for it.

### Excessive polling is slowed, not refused

§11 lets the OP answer `invalid_request` to a client that polls too often. The
client is answered `slow_down` instead and the request's interval is raised by
five seconds each time, as the specification asks for that error. The limit on
polls per `auth_req_id` is the same answer, so a client cannot turn polling into
a load generator and is never told its request is dead while it is not.

### Binding message

`binding_message` is at most 140 characters, counted in code points (§7.1 leaves
the limit to the OP), and holds no control, bidirectional, zero-width or line
separator character. It is stored as the validated text and escaped by the page
that shows it, never interpreted. A message that fails is refused with
`invalid_binding_message`.

### Audience of a client assertion

§7.1 asks the OP to accept its issuer, its token endpoint or the endpoint itself
as the audience of a `private_key_jwt` assertion. `bc-authorize` accepts all
three; the other endpoints that authenticate a client keep accepting the token
endpoint.

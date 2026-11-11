# P4f — Self-service: the "me" API and application-initiated actions

Phase spec. The umbrella spec's section 11, row P4f, fixes the scope; this
document fixes the decisions that row leaves open, the increments, and where
each item of the row is closed. Read section 11 first.

## 1. Intent

An application that adopts Odudu usually has its own settings pages. What it
cannot do alone is run a credential ceremony: WebAuthn binds a passkey to
Odudu's origin, and relaying a TOTP seed or recovery codes through an
application's backend puts secrets where they should not be. So P4f has two
halves, in the way Keycloak (application-initiated actions) and Auth0 (My
Account API) each have one:

- a **"me" API**, authorised by the person's own access token, through which
  an application reads and amends what the person owns that holds no secret;
- **application-initiated actions**, through which an application sends the
  person to Odudu to do what must happen on Odudu's origin, and gets them
  back.

After P4f an application can adopt Odudu with every session endable and the
account lifecycle in the person's own hands.

## 2. Goals, non-goals, anti-goals

**Goals.** Everything in the P4f row of section 11, closed in section 6 below
with nothing left to a later phase that the row names. Each path stated at the
volume of ADR 0041. Pages written against the catalogue and theming rules.

**Non-goals.** A hosted account console (P4d's brainstorm found the adopters
do not want one, and the umbrella spec records that). An SDK for the "me" API
(P4i wraps it). Device trust, risk scoring and adaptive authentication.
Native-app passkeys through an app's own origin.

**Anti-goals.** An enrolment, secret or recovery code that passes through an
application's backend. A redirect parameter an application can strip or forge
that a client treats as proof. A credential change that needs no fresh
authentication. A "me" token that works at the admin API, the MCP endpoint or
`/userinfo`, or the reverse.

## 3. Standards and what established products do

Researched 2026-11-10 against primary sources where reachable. Where a source
could not be read it is marked.

| Source                                 | Takeaway used here                                                                                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keycloak application-initiated actions | The action rides the authorization request; the redirect reports `success`, `cancelled` or `error`; the docs warn the parameter can be stripped, so a client verifies through a claim, not the parameter |
| Auth0 My Account API                   | A user-scoped API with its own audience and scope per operation; a step-up policy before enrolment; start then confirm for each method                                                                   |
| Okta MyAccount API                     | Start then complete for passkeys; updates to an enrolment limited to renaming or removing                                                                                                                |
| Microsoft Entra                        | Registering security information is its own protected action, so a tenant can demand a stronger proof for it                                                                                             |
| RFC 9470                               | A resource answers `401` with `acr_values` and/or `max_age`; the client re-authorizes; `max_age` is enforceable and needs `auth_time`, `acr_values` is advisory                                          |
| NIST SP 800-63B-4 section 4.6          | Notify the subscriber when an authenticator is bound (read only through secondary snippets; the full text was not reachable)                                                                             |
| OWASP ASVS 4.0.3                       | 3.7.1 re-authenticate before a sensitive account change; 3.3.3 offer to end other sessions after a password change (version 5.0 numbering not verified)                                                  |
| WebAuthn                               | The origin is fixed by the browser or platform, which is why a ceremony cannot be relayed through a backend (inference, not stated by the sources read)                                                  |

## 4. Approaches considered

Two contested calls were put to the owner on 2026-11-10 and decided.

**A. How an application names an action.** (1) A custom `/authorize`
parameter, in the shape of Keycloak's `kc_action`, reusing the four existing
required-action names; (2) Rich Authorization Requests (RFC 9396), the standard
route but with no plumbing in the server and no client support to lean on; (3) a
pre-registration endpoint returning a short-lived handle, safer against URL
tampering but a new endpoint and table for little gain. **Chosen: 1.** The
redirect carries only a hint; the authority is the "me" API (section 5.3).

**B. How the "me" API asks for fresh authentication.** (1) `401` with an RFC 9470
challenge carrying `max_age` and, where a second factor is wanted, `acr_values`;
(2) a `403` naming a private condition. **Chosen: 1.** `auth_time` is already
stored with every authorization code.

**C. Where the API lives (builder's call, to settle in the plan).** A new
package beside the admin API and the MCP package, sitting above `protocol-oidc`
the way ADR 0051 places `mcp`, with its own ADR and boundary rules, or a route
group inside `protocol-oidc`. The first keeps deletion of the surface from
touching OIDC; the second avoids a package. Recommended: the new package, with
the ADR written before its first route.

**Sequencing.** The "me" API and the actions are the spine (increments 1 to
4); the rest are independent of each other and follow in the order of section
7, so a pause between increments leaves the server whole.

## 5. Decisions

### 5.1 The "me" API

- **Audience and scope.** Its own audience, derived from the issuer the way
  `mcpAudienceOfIssuer` derives the MCP one, and its own scopes, `me:read` and
  `me:write`, allowed only at that audience (the rule `mcp-scopes.ts` applies
  to `mcp:*`, per ADR 0040's ceiling). A client opts in by registering for the
  scope; Dynamic Registration cannot grant it unless the tenant's registration
  policy already allows the scope.
- **Subject.** The token's own subject is the only subject any route acts on.
  No path names a subject. Every repository call carries the tenant and is
  probed with a foreign `tenant_id`.
- **Reads (`me:read`).** Profile; the credential list (type, label, created,
  last used) with the count of recovery codes left; sessions with the device
  each belongs to; consents. Collection reads are bounded under `MAX_LIMIT`
  and a list makes a constant number of queries.
- **Writes (`me:write`).** Edit profile fields the tenant lets a person edit;
  end one session or all others; revoke a consent; rename a credential; remove
  a credential.
- **No secret crosses it.** Nothing here sets a password, enrols a factor or
  returns a seed, a code or a key. Those are actions (5.3).
- **Never a second door.** A token with the "me" audience is refused at the
  admin API, the MCP endpoint and `/userinfo`, and the reverse, with a test per
  pair.

### 5.2 The freshness gate

Removing a credential, ending sessions in bulk, revoking a consent and editing
the address or username are gated. When the token's session `auth_time` is
older than the tenant's window (default 300 s, the figure Keycloak uses, set by
the tenant within a bound), the API answers `401` with
`WWW-Authenticate: Bearer error="insufficient_user_authentication"`, carrying
`max_age` and, for a credential removal, `acr_values` naming a second factor
where the subject has one. The application sends the person through
`/authorize` with those values; the new token carries the fresh `auth_time`.

_assumption:_ `/authorize` already forces a new login for `max_age=0` and for an
expired `max_age`, and `prompt=login` does the same. The plan's first spike
runs both against a live session before the gate is written.

### 5.3 Application-initiated actions

- **Request.** `/authorize` accepts one more parameter naming an action:
  `update-password`, `configure-totp`, `configure-passkey` or
  `generate-recovery-codes`, the names the server already uses. An action
  request is gated like 5.2: it forces a new sign-in only when the session's
  `auth_time` is older than the tenant's window, and the `update-password`
  page asks for the current password whatever the age (my call).
- **Page.** Odudu renders the page it already has for that required action and
  returns to the client's registered `redirect_uri` with the standard response
  plus `action_status` of `success`, `cancelled` or `error`. The page is the
  same one a required action shows, so it is themed and translated already.
- **Authority.** `action_status` is a hint and a client must not act on it
  alone. The documented way to learn the outcome is the "me" API's credential
  list and recovery-code count. The docs and the guide say so beside the
  parameter, as Keycloak's do.
- **A client may only start an action it is allowed.** The client's settings
  say which actions it may start; the default is none.
- **Audit.** Every action requested, completed, cancelled and failed writes an
  audit row of the existing kinds with the client named.

### 5.4 Recovery codes

A person can ask for a fresh set through the `generate-recovery-codes` action
before the old set is spent. The tenant sets a threshold; below it the sign-in
page and the "me" API's count both say so. The re-issue is bounded: the
`generate-recovery-codes` action costs ten Argon2id hashes, so a person may
request one per hour and the limit is recorded in the audit trail; this closes
the bound the row asks a decision on and replaces the per-origin throttle as
the only control.

### 5.5 Notice mail

When a subject's own enrolment, removal or new recovery set changes their
authenticators, a mail goes to the subject, as the admin API's removal and
revoke already send one. **The unverified-address rule is revisited:** a notice
is sent only to a verified address; if the address is unverified the change is
still allowed but the notice goes to no one and the audit row says so, since a
notice to an unverified address can reach a stranger who registered with it.
The mail takes its look through `resolveMailBranding` in the transaction that
queues it, and its text is catalogue entries with an Arabic twin.

### 5.6 Per-tenant authenticator policy

Per tenant: TOTP algorithm, digits and period; WebAuthn user verification and
resident key; recovery-code count. **Each enrolment stores the parameters it
was made under**, so a policy change strands nobody; existing enrolments keep
working, and a changed policy applies to the next enrolment only. A tenant-wide
switch asks everyone to enrol a passkey: a subject without one gets the
`configure-passkey` required action at the next sign-in. Per-step authenticator
configuration is the same settings applied per sign-in step; the settings live
in the tenant's flow configuration and appear in the admin API and the console.

### 5.7 Session and device

A session is shown against the device it belongs to, which needs the stable
browser identifier ADR 0033 derives and the umbrella spec's decision 1 defers.
This phase amends ADR 0033 to state the identifier, and closes the orphan that
ADR admits: under `k` concurrent logins the cap admits `cap + (k - 1)` and
orphans one. The amendment decides whether the cap becomes exact or stays
bounded, with the measurement the ADR asks for.

### 5.8 The rest of the account lifecycle

- **A new verification mail.** A route sends one when a link has expired or been
  used, since the page that reports it says to and nothing sends it. Bounded by
  the per-address limiter.
- **A place to return to** for a mailed link an administrator issued: the
  action-initiated model gives such a link a client to return to; the link
  names the client and the page returns there when it finishes.
- **After a password change or reset,** the page offers to end the subject's
  other sessions (ASVS 3.3.3), default on.
- **Registration confirmation** asks for more than one click: a page that names
  the address and the tenant and needs a submitted form, so a mail the person
  did not ask for does not complete an account.
- **Accounts that differ only by case** are reconciled by an operator-run
  command, then a partial unique index is added on `(tenant_id, email_search)`.
  The command reports what it merged and refuses to guess between two accounts
  that both have sign-ins.
- **More required actions:** verify email, update profile, accept terms.
- **Several sign-in flows with a per-client override.**
- **A breached-password check** at password set and change, against an
  operator-loaded dataset by default or an opt-in remote range lookup (10b); a
  tenant that disables it is shown as such. No password leaves the server.

### 5.9 The MCP endpoint and the "me" API (decided 2026-11-11)

P4f offers no MCP tool. The MCP server acts for a person administering a tenant
(ADR 0050); the "me" API is the End-User's own, and the MCP design already
withholds a subject's profile and credential metadata from agents
(`AGENT_DENIED_READS`). Credential changes are P5b's class C, behind a
confirmation step an agent cannot answer for itself, and an application-initiated
action is that step's natural carrier (MCP elicitation's URL mode sends the person
to an out-of-band page). P4f guards the seam so P5b can build on it:

1. **An agent-marked token never writes.** Every "me" write and every action
   request refuses a token carrying `act`.
2. **A coverage test in the injection suite.** A "me" token is refused at every
   MCP route and an MCP token at every "me" route, both route tables read by the
   test so a new route cannot be missed.
3. **The question is placed on P5b**: whether an agent may read the "me" API,
   and a tool that hands the person the link to an action page. The roadmap,
   section 11 and the roadmap test carry it.

## 6. Where each item of the P4f row closes

Every phrase below is a phrase in section 11's P4f row. The increments are in
section 7; `tests/docs/roadmap-section-11.test.ts` holds the mapping.

| Item of the row                                                                          | Closed in            |
| ---------------------------------------------------------------------------------------- | -------------------- |
| "me" API over the End-User's token, own audience                                         | 5.1; increments 1, 2 |
| read and amend profile; credentials with recovery-code count; sessions; consents         | 5.1; increments 1, 2 |
| application-initiated actions, four of them, never leaving Odudu's origin                | 5.3; increment 3     |
| a fresh set of recovery codes before the old is spent; a warning below a number          | 5.4; increment 5     |
| a decision on bounding the re-issue of recovery codes                                    | 5.4; increment 5     |
| owner notice by mail on a subject's own enrolment or new set; the address rule revisited | 5.5; increment 6     |
| per-tenant TOTP, WebAuthn and recovery-code policy, parameters stored per enrolment      | 5.6; increment 7     |
| a tenant-wide switch asking everyone to enrol a passkey                                  | 5.6; increment 7     |
| per-step authenticator configuration                                                     | 5.6; increment 7     |
| a session against its device; ADR 0033 amended, orphan closed                            | 5.7; increment 8     |
| the option to end other sessions after a password change or reset                        | 5.8; increment 9     |
| a breached-password check                                                                | 5.8; increment 9     |
| a new verification email                                                                 | 5.8; increment 10    |
| a registration confirmation that asks for more than one click                            | 5.8; increment 10    |
| a place to return to for an administrator-issued link                                    | 5.8; increment 4     |
| accounts differing only by case reconciled, then the unique index                        | 5.8; increment 11    |
| more required actions                                                                    | 5.8; increment 12    |
| several sign-in flows with a per-client override                                         | 5.8; increment 13    |
| cross-tenant RLS probes green                                                            | every increment      |
| pages written against the catalogue in ADR 0043's order                                  | every increment      |

## 7. Increments

Each is mergeable alone and ends green on a pushed commit. The plan sizes them
at 2 to 6 hours each, splitting any that run over.

1. The "me" audience, scopes, token verification, and the read endpoints.
2. The freshness gate and the write endpoints.
3. Application-initiated actions: the `/authorize` parameter, return and
   `action_status`, per-client allowance.
4. The return place for an administrator-issued link.
5. Recovery codes: early re-issue, the warning, the bound.
6. Notice mail on a factor change.
7. Per-tenant authenticator policy, stored parameters, the passkey switch,
   per-step configuration.
8. Session device identity and the ADR 0033 amendment.
9. Password change: end other sessions, breached-password check.
10. Verification resend and the confirmation that asks more than a click.
11. Reconcile same-address accounts, then the unique index.
12. More required actions.
13. Several sign-in flows with a per-client override.
14. Close: docs, transcripts re-run, roadmap and section 11 reconciled,
    `CHANGELOG.md`, the six checks of "The pass that closes a phase".

If budget runs short, 12 and 13 split into their own phase; that is a
deliberate re-planning with the roadmap test updated, never a silent drop.

## 8. Performance and scale (ADR 0041)

At 1,000,000 subjects, 10,000 clients per tenant and 100,000,000 audit events:
every "me" read is by subject id on an existing index and returns at most
`MAX_LIMIT` rows, with a constant number of queries per request; the sessions
list reads one index on `(tenant_id, user_id)`. The breached-password lookup is
bounded by a timeout and a per-tenant concurrency limit, and fails open or
closed by an explicit tenant setting. The unique index on `email_search` is
built without a table rewrite beyond the ones the migration table already
records. The reconcile command is chunked. Each increment's plan adds the
query-plan check where it adds a query.

## 9. Constraints from the repository

- Layering: five layers, no business logic in a usecase or repository; every
  rule, message and mapping is a pure `service` function.
- No `any`, no `void` statements, tests first, integration tests on real
  PostgreSQL, `SET LOCAL` for tenant context.
- A page is a `*-html.ts` in a `view` layer with its kind in `page-kinds.ts`;
  every string a catalogue entry with an Arabic twin; every origin from
  `TenantAddress`.
- A new HTTP route owns a transcript re-run on a live stack; a new
  configuration variable owns its documentation; a changed behaviour owns a
  line under `## [Unreleased]`.
- Comments carry nothing about the process that produced the code.

## 10. Assumptions to verify before the plan relies on them

Each gets a one-line spike, with its command in the plan.

- `/authorize` honours `max_age` and `prompt=login` as forced re-login.
- The `acr` computed for a session reflects a second factor, so `acr_values`
  can be satisfied.
- Where the admin API verifies its tokens, and whether the same verifier
  serves a second audience.
- That a mailed administrator-issued link has no client today, and what the
  action-token table stores.
- That the stable browser identifier exists on the session row and what
  ADR 0033's amendment must add.
- The next free migration number and the free names of any table a plan adds.

## 10a. Calls made after the builder check

My calls, marked so they can be overruled:

- **Where `auth_time` comes from.** `auth_time` is an ID-token claim today
  (`token-issuance.ts`), not an access-token one. The gate reads the session
  the token's `sid` names, one indexed read, on gated requests only; plain
  reads stay stateless. A token whose session has ended is refused with `401`
  and no challenge, since a fresh sign-in is a new session. _assumption:_ the
  access token carries `sid`; the spike confirms it, and if not, the token
  gains it in increment 1.
- **Ending the caller's own session** is allowed and ends the token's use; the
  response says so.
- **An action request issues a normal authorization response** (a code) with
  `action_status` added. `cancelled` is produced by the page's own cancel
  control; an abandoned tab produces nothing, which is why the status is only a
  hint. A client without `me:read` cannot check the outcome, so a client's
  allowed actions are accepted only together with `me:read`.
- **Allowed actions** are a client setting in the admin API, the console, the
  CLI and the seed command, like any other client setting.
- **Recovery-code bound.** One re-issue per subject per hour, read from a
  column on the subject's recovery set (a `last_issued_at`), never from the
  audit table. It does not apply to the first generation or to a set that is
  used up. The low-count warning is shown after sign-in on the next page the
  person sees, never mid-login.
- **Increments 7 and 13 are planned as several increments each**, one per
  settings group (TOTP, WebAuthn, recovery count; the passkey switch;
  per-step) and one for the flow model, its admin surface and its override.
  Their number in section 7 stays; the plan numbers the parts.
- **Case reconciliation** keeps one account: the one with a verified address,
  then the oldest. It moves credentials, sessions, grants and consents to the
  survivor in one transaction per pair and rewrites nothing in the audit trail.
  It refuses a pair where both have sign-ins (cannot say which is the person).
  Rollout order: the command ships in one release, the unique index in a later
  one, so an operator has run it first.
- **Administrator-issued links in scope:** reset, verify and required-action
  links. The admin API gains an optional `client_id` on the request that issues
  one; absent, the link returns to the tenant's own account page.

## 10b. Decisions the owner made (2026-11-11)

- **Removing a credential.** Refused whenever it would leave the person with no
  way to sign in. Where the tenant requires a second factor, the last second
  factor is refused too. The last passkey may go while a password remains; with
  the tenant's passkey switch on, the next sign-in asks for a new one. A
  person locked out recovers through an administrator or a reset. The refusal
  is a stable error code with its own catalogue message.
- **Breached-password check.** Two sources behind one interface: an
  operator-loaded hash dataset, the default, which needs no egress, and a
  remote k-anonymity range lookup, off by default and enabled per tenant. The
  remote source is bounded as the client-supplied-URL rule of ADR 0028 bounds a
  fetch (fixed host, timeout, response size, per-tenant concurrency) and fails
  per an explicit tenant setting, open or closed. Section 5.8's "offline" is
  therefore true of the default only. No password and no full hash leaves the
  server on either path.

## 11. Left to the builder

Package and file names, the exact route paths and OpenAPI shapes, the window's
bound, the breached-password data source, the order of 12 and 13, and the
size of each increment.

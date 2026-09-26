# Odudu

> ## ⚠️ Not production ready — do not put this in front of real users
>
> Odudu is an identity provider under active construction. Credential
> handling, session management, and the token pipeline are incomplete and
> have not been security reviewed. A working `docker compose up` exists so
> the project can be developed and tested; it is **not** evidence that any
> part of this is safe to deploy. Use Keycloak, Ory, or Zitadel for anything
> real.
>
> This notice will be removed only after a deliberate hardening pass, and
> its removal will be announced in the changelog.

_Odudu_ — power, authority. Ibibio, Akwa Ibom, Nigeria.

An identity and access management platform: an OAuth 2.1 / OpenID Connect
provider with Keycloak feature parity, plus a first-class agent identity
layer for delegated authority, guardrails, and machine-readable
administration.

Self-hostable as one container plus PostgreSQL.

## Status

**The OAuth 2.1 / OpenID Connect core is built.** A tenant serves discovery,
JWKS, `/authorize` with a password login, `/token` and `/userinfo`, and
answers the `authorization_code` (PKCE mandatory, no exception),
`refresh_token` (rotating, with reuse detection that revokes the family) and
`client_credentials` grants. That sits on the P0 foundation: the monorepo and
its single `pnpm verify` gate, machine-checked architectural boundaries, the
kernel primitives, one ordered migration timeline with PostgreSQL row-level
security, and a container CI builds and boots on every pull request and on
every merge to `main` — a branch push with no pull request open runs
nothing, by design (`.github/workflows/verify.yml`).

**P3a** adds clients, dynamic registration (RFC 7591) and a consent screen.
**P4a** adds `/token`'s fourth grant, RFC 8693 token exchange, and the
`config.grantTypes` allowlist that gates which grant a client may use at
all. **P4c** adds the admin API — tenants, clients, subjects, roles,
groups, scopes, signing keys, the authentication flow, per-tenant SMTP and
an audit trail, under `/admin/tenants/{tenant}/`, described in
[docs/admin-paths.md](docs/admin-paths.md) and published as OpenAPI at
`/admin/openapi.json`. The roadmap's second and third phases are each two. **P2a** is the
identity model — roles, groups, client scopes, per-client web origins,
email — and **P2b** is credentials, MFA and the session lifecycle. **P3a**
is clients, registration and consent, and **P3b** is sessions, logout and
the token surface.

**P4e** fills that audit trail beyond admin mutations. `GET
/admin/tenants/{tenant}/audit?event_type=…` takes one of six event types:
`admin_mutation`; `admin_access` (a `403` to an authenticated caller, a
genuine token from another tenant); `authentication` (every password,
one-time-code, recovery-code and passkey answer, a second factor offered, a
lockout tripped, a refused client authentication); `session` (created, and
ended by logout, by an admin or by eviction); `token` (issue, refresh,
exchange, revoke, and a grant revoked on refresh-token reuse or code
replay); and `credential` (registration, email verification, password reset
and change, TOTP and passkey enrolment, recovery codes issued). Every row
carries the request's `request_id` and `ip`, and none carries a secret, a
code, a token or an attempted username; a login step names its
`authentication_session` by the sha256 of its `auth_session_id`, which
still joins one login's steps and cannot continue it. `ip` is the address
the server saw, a proxy's report only under `ODUDU_TRUST_PROXY`, while
`request_id` is the caller's own `x-request-id` whenever it sends one: it
correlates rows and proves nothing about who sent them (ADR 0037's
third amendment). A refusal is a row only where the
principal it names bounds it; a refusal nothing bounds — an unregistered
`client_id`, an admin `401`, a forged foreign-issuer token — goes to a
`warn` log line instead
([ADR 0037](docs/adr/0037-refusal-rows-are-bounded-by-the-principal-they-name.md)).
Refresh rows dominate the table's growth, and each tenant's
`audit_retention_days` is what bounds them (see
[`odudu reap`](#running-it) below).

A role reaches a token only when it is mapped to a scope the client is
assigned, because `clients.full_scope_allowed` is off by default — a client
sees the tenant's entire role vocabulary only once that is switched on for
it.

`/token` and `/userinfo` now enforce CORS from a client's own `web_origins`
(a preflight from the tenant's union of every client's, since it carries no
client identity to check against one) — see
[the CORS section of docs/request-paths.md](docs/request-paths.md#cors-the-preflight-and-the-request-differ).
`seed client --web-origin` registers them as it creates a client, and
`PATCH /admin/tenants/{tenant}/clients/{id}` amends the list afterwards —
`seed client` itself refuses an existing client rather than widening a
registered list on a re-run.

`seed client --grant-type` names the grants a client is registered for,
repeatable, and validates each one against the same list the
`client_oidc_config_grant_types_check` CHECK constraint enforces. Omitted,
a confidential client still gets `authorization_code`, `refresh_token` and
`client_credentials`, and a public one still gets the first two — the
flag's addition changes nothing for an invocation that does not use it.

`email_verified` is now a claim about something that happened: a mailed
`GET /tenants/{tenant}/login-actions/action-token?key=…` link, redeemed once,
flips it. A tenant carries three settings for the account lifecycle this
begins — `registration_allowed`, `verify_email` and `reset_password_allowed`
— each defaulting off, so upgrading a tenant never silently grants it public
registration or mailed verification. `odudu seed tenant --set` changes them,
and every other tenant setting, by the column name the schema uses:
`odudu seed tenant --name demo --set registration_allowed=true`, repeatable.
`GET`/`PATCH /admin/tenants/{tenant}/settings` changes the same set through
the admin API, by the same column names; the ranges the numeric ones accept
are CHECK constraints either way, so neither door has a way past a policy
the database enforces. Outgoing mail goes through `ODUDU_SMTP_HOST`,
`ODUDU_SMTP_PORT` (default `587`), `ODUDU_SMTP_FROM`, `ODUDU_SMTP_USERNAME`,
`ODUDU_SMTP_PASSWORD` and `ODUDU_SMTP_STARTTLS`; leave `ODUDU_SMTP_HOST`
unset and the server logs every message instead of sending it, which is what
the compose stack does. A tenant can override all of it with its own
transport — `PUT /admin/tenants/{tenant}/smtp`, whose password is stored
under the same key-encryption envelope a signing key's private half uses —
and `POST /admin/tenants/{tenant}/smtp/test` sends one message through it
before a user's verification mail depends on it. A tenant's configuration
that carries a username or a password is refused unless `starttls` is on,
and its `host` is held to ADR 0028's address rules before any connection —
`ODUDU_ALLOW_PRIVATE_SMTP_HOSTS` re-admits the private ranges where a
relay genuinely is internal, and loopback stays refused regardless. See
[the address verification section of docs/request-paths.md](docs/request-paths.md#address-verification)
for that walkthrough, captured message included.

`registration_allowed` now has a reader: `GET`/`POST
/tenants/{tenant}/login-actions/registration` lets a user create their own
account — subject, user row, password credential and the tenant's default
roles, all in one transaction — instead of an administrator seeding one in.
When the tenant's `verify_email` is also on, a self-registered address
cannot complete a login until it is verified: no authorization code is
issued, which is the property that made verification ship before
registration rather than alongside it. See
[the self-registration section of docs/request-paths.md](docs/request-paths.md#self-registration)
for the walkthrough.

`reset_password_allowed` now has a reader too: `GET`/`POST
/tenants/{tenant}/login-actions/reset-password` lets a user request a mailed
link that sets a new password, and the `reset_password` branch of `GET`/`POST
/tenants/{tenant}/login-actions/action-token` redeems it. The request answers
identically whether or not the address has an account — same status, same
body — and sends mail only for the one that does, so **this endpoint**
cannot be used to enumerate who has registered; a send failure (a down or
rate-limiting SMTP server) is absorbed and logged rather than surfaced, for
the same reason. A redemption that sets the password already in force is
refused, for the reason the password-policy section below gives. Completing
one reset also retires every other outstanding reset-password link for the
same subject, and turning `reset_password_allowed` off closes redemption as
well as the request form.
See [the password reset section of docs/request-paths.md](docs/request-paths.md#password-reset)
for the walkthrough.

A tenant's `otp_required` turns TOTP into a real second factor. It defaults
off, and off does not mean nobody is asked: a subject who has enrolled a
TOTP credential is always asked for a code after their password, in any
tenant. What the switch adds is everybody else — a subject with no credential
is given the `configure-totp` required action at their next login, and
`POST /tenants/{tenant}/login-actions/required-action?action=configure-totp`
enrols one. The enrolment page renders the `otpauth://` URI as text and as a
QR code, and the credential is written only by a submission that proves a
correct code, never by the page that offers a secret. The algorithm is
RFC 6238 as `@odudu/crypto` implements it — six digits, SHA-1, a 30-second
step, a ±1-step window and a stored last-accepted step, so a code cannot be
used twice. A two-factor login's ID token carries `amr: ["otp", "pwd"]` and
`acr: "2"`. Turning it on is
`odudu seed tenant --name <tenant> --set otp_required=true`, the same command
the account-lifecycle settings above use.
See [the TOTP section of docs/request-paths.md](docs/request-paths.md#two-factor-authentication-with-totp)
for the walkthrough.

**Enrolling a second factor also asks for ten recovery codes**, because a
second factor with no recovery path is a locked-out account the first time a
phone is lost. Completing `configure-totp` or `configure-passkey` adds the
`generate-recovery-codes` required action to a subject who holds no codes
already — one who does is not asked again, since a new factor does not
invalidate a list they have saved. The page that renders the codes is the
only place they are ever shown: each is Argon2id-hashed with the same
parameters as a password, one credential row per code, so no later page and
no administrator can print them again, and reloading that page issues a
fresh ten and retires the set it just displayed — at ten Argon2id hashes and
eleven row writes per reload, which nothing rate-limits: the per-account
lockout counts failures, and this path takes a login that works. Reaching
that page at all takes a **completed** login, not merely a correct password:
the codes on it stand in for the second factor, so a session that has passed
only the first one is refused there, and so is one already spent on a
sign-in. They are ten characters
from Crockford's 32-character base32 alphabet — 2^50 each, printed as
`XXXXX-XXXXX` — and the alphabet's excluded letters (`I`, `L`, `O`) are
folded onto the digits they resemble, so a code read off paper works either
way.

**A recovery code then stands in for the second factor, once.** The code
form carries a second field beside the one asking for the authenticator's
code, and a submission that fills it spends one code and finishes the login
(`amr: ["pwd"]`, `acr: "2"` — [the reading
note](docs/protocols/oidc-core.md) explains why RFC 8176 has no accurate
value for a recovery code). The spent row is kept and marked used rather
than deleted, which is what lets the same code presented again be refused
_as spent_ — a distinction that is safe to make only because a recovery code
is a second factor, so the attempt is already bound to the subject being
told about their own credential. Consumption is a single conditional
`UPDATE`, so two submissions racing the same code produce one login and one
refusal.

**A subject can also enrol a passkey.** A pending `configure-passkey`
required action renders a page that calls `navigator.credentials.create()`
and posts the result back to `POST
/tenants/{tenant}/login-actions/required-action?action=configure-passkey`.
Registration is verified by `@simplewebauthn/server` and the credential is
written only after that — its `lookup_key` is the credential id, and
`secret_data` carries the COSE public key, the authenticator's signature
counter at registration, and its transports. The challenge lives on the
authentication session, not in the page: it is cleared by the same
statement that reads it, so replaying a response finds nothing to match.
A subject with a passkey can enrol a second one, on a different
authenticator.

**A passkey then signs that subject in with no username at all.** The login
page offers a "Sign in with a passkey" button beside the password fields; it
asks `POST /tenants/{tenant}/login-actions/passkey-challenge` for request
options — which name no credentials, so the browser offers every
discoverable passkey it holds — calls `navigator.credentials.get()`, and
posts the assertion back to the same login endpoint in an `assertion` field.
Who is signing in comes from the assertion: the credential id it carries is
the `lookup_key` a tenant-scoped read resolves to a subject, and that read
happens before any signature is checked, because verification needs the
stored public key as an input. The authenticator's signature counter must
have advanced, or the credential looks cloned and the login is refused —
except for an authenticator that reports zero and always has, which
WebAuthn §6.1.1 permits. A passkey counts as **two** factors (`amr:
["hwk", "user"]`, `acr: "2"`), since enrolment demands user verification, so
a tenant with `otp_required` on does not ask for a code on top of one.

Every tenant also carries a password policy — `password_min_length` (default
`8`, floored there by a `CHECK`; a tenant cannot configure its way below it),
`password_require_digit`, `password_require_uppercase`,
`password_require_lowercase` and `password_require_special` (all off by
default), and `password_not_username`/`password_not_email` (both on by
default, refusing a password that contains the account's own username, or
the local part of its email address — matched independently, so a
password containing both is refused for both). A password is also capped at
**256 characters**, which is the one rule no tenant configures: it exists to
bound work rather than to shape passwords, and 256 is double the length
ASVS 2.1.2 says a server may start refusing, so no passphrase anybody would
type reaches it. An over-long password is refused, never truncated, and it
is refused where the form is read — including at the sign-in form, which
verifies a password rather than evaluating it against the policy, and so is
the one route where "no maximum" would mean an Argon2id verification for
input of any length (ADR 0023). The policy is read from the
tenant, never defaulted in code, and the same `evaluatePassword` call binds
every writer of a password: registration, reset redemption, the seed CLI's
`--password` and `user` subcommand, and the change-password required
action. A rejected password answers `400` with every violated rule listed
at once, not just the first.

**Five consecutive wrong passwords lock an account**, and this is the one
credential setting that ships on: RFC 6749 §2.3.1's brute-force protection is
a MUST, and a MUST that defaults off is not held. `brute_force_max_failures`
(default `5`) is the threshold, `brute_force_lockout_seconds` (default `60`)
the first wait, doubling per further failure up to
`brute_force_max_lockout_seconds` (default `900`), and
`brute_force_failure_reset_seconds` (default `43200`) is how long an account
must go unattacked for counting to start again from one. The counter is a row
per subject (`login_failures`), so it survives a restart and holds across
replicas, and it is keyed by **subject** rather than by the name submitted —
a lockout following a username could be aimed at a name the account no longer
answers to, and would miss an attacker arriving by email.

A locked account is refused with the response a wrong password gets: same
status, same page, same headers, and the refusal is decided _after_ the
Argon2id verification a wrong password pays for, so neither the page nor the
timing distinguishes a locked account from a wrong password or from a
username nobody holds. An attempt made during a lockout still counts, which
is what keeps those costs equal — and means retrying extends the wait. A
correct password accepted by an unlocked account deletes the row — which,
with waiting the window out, is the whole of how a lockout ends: the admin
API has no route that clears a `login_failures` row, so an operator still
waits the window out or reaches for SQL.
See [the brute-force section of docs/request-paths.md](docs/request-paths.md#brute-force-lockout)
for the walkthrough.

**What the lockout cannot see is answered by a per-origin throttle.** One
password tried against a thousand accounts leaves every counter at one, and
registration needs no account at all, so the three unauthenticated routes
that each cost an Argon2id hash or a mail send — the sign-in submission,
registration and the reset request — share a budget per client address:
`ODUDU_THROTTLE_LIMIT` (default `10`) requests per
`ODUDU_THROTTLE_WINDOW_SECONDS` (default `60`). Over budget answers `429`
with `Retry-After` and an empty body, decided before the body is parsed or
any account looked up, so a refusal cannot say whether the address or the
account existed. There is no value that switches it off; a deployment
putting many users behind one address raises the limit.

Two limitations, stated because neither is visible from the outside.
**The throttle is per instance**: it is a window in the process's memory, so
N replicas behind a load balancer admit up to N times the budget. That is
the accepted shape rather than an oversight — the throttle protects this
process's CPU, while the property that must hold globally (an account locks
after five consecutive failures, wherever they arrive) is the one in
Postgres — and it is the reasoning in ADR 0023. **It cannot be demonstrated
here**: there is no load balancer in this repository and no second replica
to put behind one, so this paragraph is a statement rather than a
transcript. Running more than one instance is **unsupported**, for an
unrelated reason ([Deploying](#deploying)) — but nothing refuses it: that
is an instruction, not a boot check, so a deployment that runs replicas
anyway gets N times the budget and no warning. And the key is `request.ip`, so
behind a proxy the proxy must **overwrite** `X-Forwarded-For` rather than
append to it; a proxy that appends leaves the key client-controlled and the
throttle decorative.

`/token` is deliberately outside it: the lockout is keyed by subject and a
client is not one, and a budget per address is one address for every
request a server-side client will ever make. RFC 6749 §2.3.1's protection
for a client's password is a third budget instead — a `client_secret_basic`
or `client_secret_post` attempt at `/token` that fails spends a window keyed
by `client_id`, five attempts per sixty seconds by default. A healthy
client is never throttled: only a failed attempt is counted, so a client
that finally presents its real secret succeeds regardless of the failure
count on record — the opposite trade from the account lockout above, which
refuses a correct password once locked. An unknown `client_id` spends the
same budget a wrong secret against a real one does and is refused in the
same bytes — but not in the same time: it pays no Argon2id comparison, so
the two are indistinguishable by response and by budget, not by timing.
ADR 0023's amendment says why that gap is accepted rather than closed.
This limiter is per instance for the same reason the throttle above is,
which is likewise unshown here for want of a second replica; [the
walkthrough is in
docs/request-paths.md](docs/request-paths.md#the-client_secret-budget-at-token).

`password_max_age_days` (default `0`, the feature off) ages a password out.
An expired password is **not** refused: the login authenticates as it
always did and the `update-password` required action blocks it from
completing, so a tenant that turns this on moves accounts along rather than
locking them out. `password_history_depth` (default `0`, also off) is how
many retired passwords a tenant remembers; above zero, the change-password
action refuses a candidate matching any of them or the password in force,
and rotation retires the displaced hash as a `password-history` credential.
Those rows are never a login's input, and the ones past the depth are
deleted — the one place anything in this codebase deletes a credential
rather than marking it (ADR 0021), because no decision can read them.

**A required action blocks a login's completion, never its factors.**
`POST /tenants/{tenant}/login-actions/required-action` carries no credentials
of its own, so it acts only for a session whose authentication has actually
finished — every factor the tenant's flow asks of that subject passed, and
the session not yet spent on a sign-in — and only for the action owed
**next**, in the order `update-password`, `configure-totp`,
`configure-passkey`, `generate-recovery-codes`. Both halves carry weight: a
password alone binds a session to a subject while a second factor is still
outstanding, and one of these actions prints ten recovery codes that stand
in for that factor; and the order is what stops an expired password being
used to enrol one.

**What the two settings guarantee, exactly.** Every writer of a password
resets the clock on it, which is what stops an expired password being owed
forever — and also what makes the guarantee narrower than
`password_max_age_days` alone suggests, because a reset link is a password
write. So reset redemption refuses a candidate matching **the password
currently in force**, which closes the evasion of setting the same password
straight back. It does **not** consult `password_history_depth`: a password
retired more than one change ago can be restored through a reset, and its
age then starts again. Only the change-password action reads history and
only it writes any. Closing that would mean threading the depth and the
stored hashes into `@odudu/account`, which depends on neither the
required-action machinery nor `apps/server`.

**No mail is sent on the request path.** Every flow that mails — address
verification, self-registration and password reset — writes the message to
`email_outbox` in the same transaction that mints the token it carries, and
answers. A sender claims batches of due messages with `FOR UPDATE SKIP
LOCKED`, one tenant at a time, and runs either on the server's own schedule
(`ODUDU_OUTBOX_INTERVAL_SECONDS`) or as `odudu send-mail`
([ADR 0024](docs/adr/0024-a-scheduled-pass-is-a-command-first.md)). That is
what makes the two reset paths indistinguishable in time as well as in
content: an address with an account costs one `INSERT` more than one
without, not an SMTP round trip more. A refused message is retried with a
doubling backoff and, once its attempts are spent, kept with its last error
for an operator to read. A transport failure therefore cannot reach a
caller or change a status: it happens after the response, and no code
reachable from a request holds a mail transport at all.

**Known limitation, tenant-wide:** the reset endpoint's enumeration safety
does not make the tenant itself un-enumerable. With `registration_allowed`
also on, the registration form (below) answers "that email address is
already registered" with a 400 — a universal trade-off for a self-service
registration form, and the one Keycloak makes too — so an address's
presence in the tenant is discoverable through that door even though the
reset flow closes this one. Accepted, not fixed: honestly naming a
trade-off beats implying a property the tenant does not actually have.

A mailed verification link is built from `ODUDU_PUBLIC_BASE_URL`, never
from the request that triggered it — a request's `Host` header is
client-controlled, and trusting it would let an attacker choose where a
link Odudu mails to someone else points. `ODUDU_PUBLIC_BASE_URL` must be an
absolute `http`/`https` origin with no path; when it is unset, a tenant with
`verify_email` on refuses to register rather than guessing a base some
other way (`compose.yaml` sets it for the local stack).

The same value is the only source of the **WebAuthn relying party id** a
passkey is registered against — its host, without the port. A passkey is
bound to that id, and a browser silently never offers one whose id does not
match the page it is on, so a value taken from `Host` or `X-Forwarded-Host`
would let a request decide what a credential is for. That host must be a
domain: an address literal is refused at boot, because WebAuthn relying
party ids are domains and `https://127.0.0.1:3000` would enrol credentials
no browser can ever offer back. **With
`NODE_ENV=production` the server refuses to boot until
`ODUDU_PUBLIC_BASE_URL` is set**, since `configure-passkey` is reachable in
every tenant; outside production the variable stays optional, and without it
passkey enrolment reports itself unavailable and the login page offers no
passkey button, because there would be nothing behind one.

A registered `jwks_uri` is validated for shape only at registration —
`https`, no embedded credentials, no DNS lookup
(`assertFetchableUrl`) — and deliberately **not** dereferenced there: a
registration's success must not depend on a key host being reachable at
that instant, and never again ([docs/phases/p3a.md](docs/phases/p3a.md)
records the reverted attempt and why). The
pieces that dereference it at request time now: the address guard and
the socket transport (`apps/server/src/client-key-transport.ts`), which
pins the connection to the address the guard already checked rather than
letting Node resolve the hostname a second time, refuses a private,
loopback, link-local or otherwise non-public address, and carries a
connect timeout, a total timeout and a body-size cap enforced as the
response streams — are called by `private_key_jwt` client authentication
at `/token`, their first and so far only caller.
`ODUDU_ALLOW_PRIVATE_CLIENT_URLS` is read and enforced at boot — **with
`NODE_ENV=production` the server refuses to boot if it is set to
`true`** — so the development and conformance stacks can let it resolve a
private or loopback address, which the OIDF conformance suite's own
registration module does, without production doing the same.

**Operational trap:** turning `verify_email` on locks out every existing
user with no email address on file — including one seeded without
`--email` — since there is no address for them to verify. The login page
tells them so rather than claiming a mail it never sent, and the way out is
`PATCH /admin/tenants/{tenant}/subjects/{id}`, which amends `email`: the
recovery path is an administrator's, not the locked-out user's. Give every
user an address before enabling `verify_email` on a tenant that already has
some.

**The SSO session is read as well as written, and it has two clocks.** The
`{tenant}-session` cookie the login POST sets is now what lets a second
authorization request from the same browser complete without the form:
`/authorize` resolves it, and `prompt` decides whether that is allowed —
`prompt=none` succeeds where a request with no session gets
`login_required`, and `prompt=login` forces the form past a live session.
A session is live until the earlier of `sso_session_idle_seconds`
(default `1800`) measured from its last use and `sso_session_max_seconds`
(default `36000`) from when it was established; both are per tenant, both
bounded by a `CHECK`, and an idle window longer than the ceiling is refused
rather than clamped. A reused session issues a code carrying the
**original** login's `auth_time`, not the moment of reuse, which is the fact
a client's own `max_age` check depends on — and `max_age` is honoured, so a
client can demand a fresher authentication than the cookie represents. The
email-verified gate guards this second door into completing a login exactly
as it guards the password form. The cookie now holds a **list** of session
entries, not one, and a fresh login joins a browser's existing set rather
than replacing it.

**A session cookie is not its session's id.** Each entry is
`<session id>:<secret>`, the secret 32 random bytes in base64url that the
server keeps only as a sha256 hash (`sessions.secret_hash`), compared in
constant time. The id half is public — it is the `sid` claim of every ID
token and access token — so presenting it alone, or with any other secret,
authenticates nobody, and costs the same statements as an id no session
has. A cookie the server writes back carries the entries the browser
presented, never entries rebuilt from ids. A session created before
migration `0071_session_secret.sql` has no hash and is never live.

**A tenant can now offer "remember me."** Three settings gate it:
`remember_me_allowed` (off by default), and the pair
`remember_me_idle_seconds`/`remember_me_max_seconds` (defaults 7 and 30
days) a remembered login is measured against instead of
`sso_session_idle_seconds`/`sso_session_max_seconds`. When the setting is
on, the login form offers a `remember_me` checkbox; ticking it writes the
new session's entry into the `{tenant}-session-persistent` cookie, carrying
`Max-Age=remember_me_max_seconds`, instead of the ephemeral
`{tenant}-session` cookie. **The tenant setting is the authority, not the
field**: a tenant with `remember_me_allowed` off ignores a ticked box
entirely, and the session lands in the ephemeral list exactly as an
ordinary login would.

**A browser's session count is capped, and the cap is enforced.**
`tenants.max_sessions_per_browser` (1–32, default 25) is the ceiling
`admitSession` evicts a browser's own least recently active sessions down
to — read from the entries its cookies already prove, never by subject, since
one browser can hold sessions for more than one — in the same transaction
it creates a new one. A lock on the tenant's own row serialises logins
arriving at once, but does not make the cap exact under concurrency: `k`
racing from the same browser can transiently exceed it by up to `k - 1`,
corrected at that browser's next login (ADR 0033's accepted residual).

**More than one live session in a browser gets a chooser, not a guess.**
When `/authorize` resolves several live sessions at once — or the client
asks with `prompt=select_account` — it renders an account picker instead of
either reusing one unasked or falling back to the login form; picking one
posts to `login-actions/select-account` and completes the authorization the
same way an ungated reuse does. The posted session id is a claim the
browser makes, honoured only when it names a member of the set that
request's own cookies resolve to — never merely because it names some live
session in the tenant — which is what stops it from being a way to continue
as somebody else's account. `prompt=none` with no account resolvable
answers `account_selection_required` rather than showing any UI, and
choosing "use another account" falls through to the ordinary login form on
the same parked request. See [docs/request-paths.md's "Choosing among
sessions"](docs/request-paths.md#choosing-among-sessions) for a full
transcript.

**A tenant can now end a session.** `GET`/`POST
/tenants/{tenant}/protocol/openid-connect/logout` implements OpenID Connect
RP-Initiated Logout 1.0 over both methods §2 requires, the parameters
arriving in the query string or a form body: it asks the End-User to
confirm before ending anything unless an `id_token_hint` names the session
actually being ended — and a `client_id` sent beside a hint has to name the
client that hint was issued to, or neither is used — and it redirects to
`post_logout_redirect_uri` only when that value is an
exact, unnormalized match against the client's own registered list —
refusing the redirect never keeps the session alive, since the two are
decided independently. **Logout revokes the session row and every grant
tied to it.** Odudu's access tokens are self-contained `at+jwt` JWTs that a
resource server can verify without a round trip to anywhere, so a resource
server that only checks the signature locally keeps accepting a logged-out
user's token until its own `exp`, at most
`client_oidc_config.access_token_ttl_seconds` (capped at one hour) after it
was issued — nothing about the token itself changes. A resource server that
instead calls `POST /tenants/{tenant}/protocol/openid-connect/token/introspect`
(RFC 7662), authenticating with its own client credentials, sees the
revocation immediately: introspection checks the grant's `revoked_at` and
the session's own liveness, not merely the token's signature, which is what
makes a logout real inside an access token's hour. **`GET`/`POST
/tenants/{tenant}/protocol/openid-connect/userinfo` makes the same two checks
on the OP's own behalf** — it is itself a resource server, and the one a
client asks first — so a token presented there after a logout or a
deliberate `/revoke` is refused with `invalid_token` rather than answering
with the End-User's claims. A client can also end a
grant deliberately with `POST
/tenants/{tenant}/protocol/openid-connect/revoke` (RFC 7009) — revoking a
refresh token invalidates every access token introspection reports for its
grant, and revoking an access token revokes the refresh token beside it,
whatever rotation it has since gone through, because both name the same
`token_grants` row. A grant issued with no session — `offline_access` — is
untouched by a logout, per Back-Channel Logout 1.0 §2.7's second sentence,
but is reached by `/revoke` the same way any other grant is. **Either page
a logout renders — the logged-out page, and the page a refused
`post_logout_redirect_uri` gets instead — frames each relying party's
`frontchannel_logout_uri`**, per OpenID Connect Front-Channel Logout 1.0
§3 — an attempt, not a guarantee: the iframe's response is never read
back, and a browser may never deliver the framed request to a live RP
session at all (third-party-cookie policy;
`docs/superpowers/p3b-spike-frontchannel.md` has the measured evidence).
Back-channel logout ships too: a session that ends enqueues one Logout
Token per client that registered a `backchannel_logout_uri`, and the
`send-logouts` pass delivers them off the request path — see below. See
[the logout section of
docs/request-paths.md](docs/request-paths.md#rp-initiated-logout) for the
walkthrough, and [its front-channel logout
section](docs/request-paths.md#front-channel-and-back-channel-logout) for a real transcript
of the framed page.

> ### → [docs/request-paths.md](docs/request-paths.md)
>
> **Every request this server answers, and every branch each one can take,
> as commands you can paste.** Discovery, `/authorize`, the login form,
> `/token` for all three grants, `/userinfo` — each with the real response,
> each refusal with the reason it is that refusal and not another, and what
> a client does next from wherever it has landed. Every command in it was
> run against the stack these instructions build.
>
> Read it once [Running it](#running-it) below has handed you a token.

- [Design specification](docs/superpowers/specs/2026-09-10-odudu-design.md) —
  what this is, and every phase with its exit criterion
- [Architecture decision records](docs/adr/) — the decisions, several with
  dated corrections recording what turned out wrong
- [Decision log](docs/superpowers/p0-decision-log.md) — judgement calls made
  during P0, each with what it would cost if wrong
- [What to do next](docs/NEXT.md) — including what has been deliberately
  deferred, and to when

## Running it

Requires Node 24, pnpm and Docker. `pnpm install` first.

Two credential files, each read by a different thing, neither committed:

```bash
cp infra/docker/.env.example infra/docker/.env   # the compose stack
cp .env.example .env                             # the server, run on your host
```

Neither is created for you: the stack refuses to start without its own
(ADR 0015), so nothing can be lifted and run by accident.

`infra/docker/.env.example` carries a throwaway `ODUDU_KEK` for the compose
stack. The root `.env.example` deliberately leaves it empty, and the server
refuses to boot until it holds 32 base64-encoded bytes, so generate one
before the host run below:

```bash
node -e "console.log('ODUDU_KEK=' + require('node:crypto').randomBytes(32).toString('base64'))" >> .env
```

Changing this value later makes every private signing key already wrapped
with the old one unreadable.

That has a consequence worth knowing before you hit it. The two files hold
**different** keys — the compose stack's throwaway one, and the one you just
generated — and both point at the same database. Seed a tenant under one and
serve it under the other, and discovery, JWKS and `/authorize` keep working,
while `/token` returns a 500 reading `Unsupported state or unable to
authenticate data`: that is the private key failing to unwrap, and it says
nothing about why. If you intend to move between the two ways of running,
copy the `ODUDU_KEK` line from `infra/docker/.env` into the root `.env` so
both processes hold the same key.

**Everything in Docker** — server and Postgres, closest to how it deploys:

```bash
cd infra/docker && docker compose up --build
curl http://localhost:3000/health/ready
```

**Postgres in Docker, server on your host** — the actual development loop,
with watch mode:

```bash
cd infra/docker && docker compose up -d postgres
cd ../.. && pnpm --filter @odudu/server dev
curl http://localhost:3000/health/ready
```

Both print `{"status":"ok","checks":{"database":"ok"}}`. The server applies
migrations on boot, so there is no separate migrate step.

Do not run both at once: each wants port 3000. Postgres is published on
**5442**, not 5432, because a host commonly already has one there.

**Everything on your host** — your own Postgres, no Docker at all. Needs one
bootstrap statement, because the restricted serving role is normally created
by the compose stack's init scripts:

```sql
CREATE DATABASE odudu;
CREATE USER odudu_svc LOGIN PASSWORD 'choose-one';
```

The owner role in `ODUDU_DATABASE_URL` must be able to `CREATE ROLE` —
migrations create `odudu_app` and grant `odudu_svc` membership in it, which
is what puts the serving connection under row-level security.

**It must also be `SUPERUSER` or `BYPASSRLS`, and that is a real
constraint, not a convenience.** Every tenant table carries `FORCE ROW LEVEL
SECURITY`, which removes the _owner's_ exemption — owning a table stops
being enough to read it. The owner connection has exactly one job at
request time: resolving `{tenant}` from the path, which happens before any
tenant id exists to `SET LOCAL app.tenant_id` into (ADR 0009's amendment of
2026-09-13). Under a plain owner that read returns zero rows and **every
request answers "unknown tenant"**, whatever is in the database.
`packages/authn-flows/tests/migrate-backfill.int.test.ts` asserts exactly
that, against a container, so the requirement is recorded rather than
folklore. A least-privilege owner is what this deployment shape wants and
cannot have yet; closing it means resolving a tenant without the bypass.

The same property is what a **migration** that reads or writes across tenants
has to be written for: under a role without the exemption it sees nothing,
writes nothing, and raises no error doing it.
`0040_recovery_code_execution.sql` is the worked example — it lifts `FORCE`
for its one statement rather than assuming the privilege — and the suite
above runs the whole migration set as a non-exempt owner so a migration that
only works for a superuser fails in CI.

Point both URLs at your own port (5432 by default, not 5442) and start the
server:

```bash
pnpm --filter @odudu/server dev
```

Which of the three you picked changes one thing past starting the server:
how the seed command is invoked, because the container runs a built bundle
and a host run has the source. The guide defines both once, as a shell
function every command in it then uses —
[Pick how you are running it](docs/request-paths.md#pick-how-you-are-running-it).
The endpoints are on `http://localhost:3000` either way.

**Check the whole thing works**, including that row-level security is
genuinely enforced in the container:

```bash
./infra/docker/smoke.sh
```

That drives a full authorization-code-with-PKCE exchange against the
container — seed a tenant and client, request `/authorize`, submit the login
form the way a browser would, redeem the code at `/token` — and then tears
the stack down, volumes included.

**Sign somebody in yourself.** The first tenant, client, user and signing
key come from the server's seed command — the admin API needs an
administrator, who needs a tenant, so something has to create the first row
without a token. The run below is the all-Docker one:

```bash
cd infra/docker && docker compose up -d --build
until curl -fsS http://localhost:3000/health/ready; do sleep 2; done
```

Wait for that, rather than seeding straight after `up -d`. The container is
started before it has finished applying migrations, the seed command runs
none of its own, and a seed run in the gap fails with `relation "tenants" does
not exist`. A host run needs the same wait, for the same reason.

```bash
docker compose exec -T odudu node dist/main.js seed \
  --tenant demo --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
```

With the server on your host it is the same command through the source
instead, run from the repository root, reading the root `.env` that the `dev`
script reads:

```bash
node --env-file=.env apps/server/src/main.ts seed \
  --tenant demo --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
```

Whichever of the two you run first answers:

```json
{
  "created": true,
  "tenant": "demo",
  "tenantId": "01a096f4-…",
  "clientId": "demo-spa",
  "userSubjectId": "01a096f4-…"
}
```

That tenant now serves the protocol. The discovery document is the one
request every client makes first, and every URL below comes out of it:

```bash
curl -sS http://localhost:3000/tenants/demo/.well-known/openid-configuration
```

```json
{
  "issuer": "http://localhost:3000/tenants/demo",
  "authorization_endpoint": "http://localhost:3000/tenants/demo/protocol/openid-connect/auth",
  "token_endpoint": "http://localhost:3000/tenants/demo/protocol/openid-connect/token",
  "userinfo_endpoint": "http://localhost:3000/tenants/demo/protocol/openid-connect/userinfo",
  "jwks_uri": "http://localhost:3000/tenants/demo/protocol/openid-connect/certs"
}
```

(Five of the twenty-eight members it returns; the other twenty-three, and
what a client does with each, are in the guide.)

And this signs ada in and comes back with tokens — the whole
authorization-code-with-PKCE flow, with `curl` standing in for the browser,
whose only job in it is to follow a redirect and submit a form:

```bash
BASE=http://localhost:3000/tenants/demo/protocol/openid-connect
VERIFIER=$(openssl rand -hex 32)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 \
  | openssl base64 | tr '+/' '-_' | tr -d '=')

AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid profile email' --data-urlencode 'state=xyz-123' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "$BASE/auth" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p')

CODE=$(curl -sS -D - -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' --data-urlencode 'password=correct-horse-battery' \
  http://localhost:3000/tenants/demo/login-actions/authenticate \
  | sed -n 's/.*[?&]code=\([^&[:space:]]*\).*/\1/p' | tr -d '\r')

curl -sS --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' --data-urlencode "code_verifier=$VERIFIER" \
  "$BASE/token"
```

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs…",
  "id_token": "eyJhbGciOiJSUzI1NiIs…",
  "refresh_token": "oXh8ADRkl4m7eVdblQ3r…",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "openid profile email"
}
```

(Token values truncated; they differ every run.)

**Give ada a role.** `seed` has one subcommand per piece of the identity
model — `role`, `group`, `scope`, `assign-scope`, `map-role`, `grant-role`,
`map-group-role` and `join-group` — reachable the same way as `seed` itself
(swap in the `docker compose exec` or `node --env-file=.env` prefix from
above):

```bash
node --env-file=.env apps/server/src/main.ts seed role --tenant demo --name reviewer
node --env-file=.env apps/server/src/main.ts seed grant-role \
  --tenant demo --username ada --role reviewer
node --env-file=.env apps/server/src/main.ts seed map-role \
  --tenant demo --scope roles --role reviewer
```

```json
{ "command": "role", "tenant": "demo", "tenantId": "01a0a1a7-…", "roleId": "01a0a1a7-…", "name": "reviewer", "clientId": null }
{ "command": "grant-role", "tenant": "demo", "tenantId": "01a0a1a7-…", "username": "ada", "role": "reviewer" }
{ "command": "map-role", "tenant": "demo", "tenantId": "01a0a1a7-…", "scope": "roles", "role": "reviewer" }
```

Re-request a token with `scope=openid roles` instead of `scope=openid
profile email` — swap that one value into the `/auth` call above — and the
access token's payload carries it:

```json
{
  "roles": ["reviewer"],
  "iss": "http://localhost:3000/tenants/demo",
  "sub": "01a0a1a7-…",
  "client_id": "demo-spa",
  "scope": "openid roles"
}
```

(Trimmed to the claims this section is about; `aud`, `iat`, `exp`, `jti`,
`sid` and `grant_id` are on it too, and
[docs/request-paths.md](docs/request-paths.md#roles-once-a-scope-reaches-it)
shows the whole payload.)

**"I created a role and it is not in my token."** Three things gate a role
onto a token, independently: it must be granted to the subject
(`grant-role`), mapped to a scope (`map-role`), and that scope must both be
assigned to the client and actually requested (`scope=` at `/authorize`, or
`clients.full_scope_allowed`). `seed client` already assigns every
tenant-default scope — `roles` and `groups` included — so the third
condition is usually already met; `seed assign-scope` is for a scope added
to the tenant afterwards. [docs/request-paths.md](docs/request-paths.md#roles-once-a-scope-reaches-it)
walks through all of it, including a client-scoped role qualified as
`clientId:roleName`.

**An initial access token is an operator's authorization for a client to
exist.** `POST /tenants/{tenant}/clients-registrations/openid-connect` is
RFC 7591 dynamic client registration — open to every tenant whose
`client_registration_policy` is `open` or `token`, and refused outright
while it is the default, `disabled` — `seed client` and
`POST /admin/tenants/{tenant}/clients` are then the two ways to create a
client in that tenant, neither of which the policy governs, since both
require an operator already.
A tenant whose policy is `token` needs a way to mint the
credential a registering client presents, and `seed registration-token`
is that command: `--tenant`, `--uses` (a token is good for that many
registrations, never zero) and `--ttl` in seconds.

```bash
node --env-file=.env apps/server/src/main.ts seed registration-token \
  --tenant demo --uses 1 --ttl 3600
```

```
PB0YxVF5Rj4P1kbXM4oXLBL1RjMCczPq6vu4dD3T4rg
```

Unlike every other seed subcommand this prints nothing but the token
itself — no JSON, no trailing newline content beyond it — so a shell can
capture it directly: `TOKEN=$(odudu seed registration-token --tenant demo
--uses 1 --ttl 3600)`. It is stored as its SHA-256 digest
(`packages/domain-tenant/src/repository/client-registration-tokens.ts`,
copied from the action-token pattern `docs/request-paths.md` already
documents), found by that digest rather than compared, and spent by one
`UPDATE … RETURNING` so two concurrent registrations against a one-use
token cannot both win.

**A `redirect_uris` entry with no `http`/`https` scheme has to look like a
native-app deep link, not just carry one.** RFC 7591 §5 permits "a non-HTTP
application-specific URL", and RFC 8252 §7.1's reverse-DNS convention is
what that looks like in practice: `com.example.app:/cb` registers,
`myapp://cb` is refused with `invalid_redirect_uri` even though dotless
custom schemes are common and otherwise harmless — `javascript:`, `data:`
and `file:` are the values this rule exists to close off, and none of them
carries a `.` in its own scheme name the way every reverse-DNS scheme does
([ADR 0032](docs/adr/0032-a-non-http-redirect-uri-scheme-must-look-custom.md)).
`frontchannel_logout_uri` is validated the same way its `backchannel_logout_uri`
twin already was — `https`, absolute, no fragment — because the logout page
renders it into an iframe, and a `javascript:` or bare-`http:` value would
reach that sink unchecked otherwise.

**Bootstrap the first administrator.** `odudu seed admin` creates the
`system` tenant the first time it runs — idempotently, so a second run with
a different username reuses the same tenant, client and roles rather than
duplicating them — provisions its `odudu-admin` client and signing key, and
grants the subject it creates `tenant-admin`, the composite that carries
every capability role plus `manage-tenants`, which is what reaches every
tenant rather than just this one. Like every other seed subcommand it talks to the
database directly and needs no running server, only migrations already
applied:

```bash
node --env-file=.env apps/server/src/main.ts seed admin --username ada
```

The generated password is printed once, on its own line, followed by a
sentence saying so:

```
Kx3f…redacted…9Q
This password is shown once and cannot be retrieved again.
```

There is nowhere it is stored in the clear and nothing that mails it, so a
lost password means seeding a new administrator, not recovering the old
one. The account's first login is forced through a password change —
`update-password` is queued as a required action the moment the subject is
created.

The `odudu-admin` client is provisioned as a public client authorised with
`authorization_code` and `refresh_token`, carrying the tenant's default
scopes, the admin API's resource identifier `urn:odudu:params:admin-api` as
its registered audience, and one redirect URI, `http://127.0.0.1:8080/callback`. There is no
administration console yet, so that loopback address (RFC 8252 §7.3) is
the only place a code can be delivered: an administrator obtains a token by
running a listener on that exact port and completing the flow with PKCE.
Redirect matching is exact, and no command or endpoint can add a second
URI to this client yet, so a console will need one before it can log in.

**One pass deletes everything that expires.** Every login writes an
`authentication_sessions` row, every redemption an `authorization_codes`
row, and every refresh rotation a `refresh_tokens` row; no repository in the
codebase issues a `DELETE`. `reap` is the pass that does, and the server
runs it itself every `ODUDU_REAP_INTERVAL_SECONDS` (default `3600`) plus up
to a tenth of that as jitter. `ODUDU_REAP_ENABLED=false` turns the schedule
off for a deployment that would rather run the same pass as a cron entry or
a Kubernetes CronJob, which is the other supported arrangement
([ADR 0024](docs/adr/0024-a-scheduled-pass-is-a-command-first.md)) — and
the command is the same one:

```bash
node --env-file=.env apps/server/src/main.ts reap
```

```
{"ran":true,"deleted":{"refresh_tokens":0,"authorization_codes":0,"token_grants":0,"authentication_sessions":0,"action_tokens":0,"client_registration_tokens":0,"login_failures":0,"email_outbox":0,"backchannel_logout_deliveries":0,"client_assertion_jti":0,"sessions":0,"audit_events":0}}
```

Those zeros on a freshly used stack are the design, not a bug. A row is
retained until no detection can still need it — for a code or a refresh
token, the life of the **grant family**, which is far longer than the
credential's own expiry — because deleting it earlier would break
refresh-token reuse detection and authorization-code revocation while
leaving every client-visible response identical. The windows, the
`ODUDU_RETENTION_*` variables that set them, and why the obvious
implementation is wrong are in
[ADR 0021](docs/adr/0021-retention-is-bounded-by-the-detection-window.md);
[docs/request-paths.md](docs/request-paths.md#retention-what-odudu-reap-removes)
has a pass with work to do. Running it from two places at once is safe —
replicas on their own schedules included: the pass takes a Postgres
advisory lock and whoever loses the tick skips it rather than duplicating
the work.

`audit_events` is the exception to the grant-family windows: it keeps each
tenant's own `audit_retention_days` (90 by default). Refresh rows dominate
its growth, one `token.refresh` per `refresh_token` redemption, so that
setting is the one to size against a tenant's refresh traffic.

**Without `ODUDU_APP_DATABASE_URL` nothing is reaped, on a schedule or
otherwise.** The pass deletes under the row-level-security policy that the
owner role the migrations use escapes, so it refuses rather than running
unscoped. Outside production — where the server refuses to boot without
that variable at all — the schedule declines to start and logs one warning
naming it, rather than failing the same way every hour.

**The mail sender is the same shape of thing.** Queued mail is sent by a
second pass, `send-mail`, which the server runs every
`ODUDU_OUTBOX_INTERVAL_SECONDS` (default `15`) plus a tenth as jitter, and
which an operator can run instead:

```bash
node --env-file=.env apps/server/src/main.ts send-mail
```

```
{"ran":true,"sent":1,"failed":0}
```

[docs/request-paths.md](docs/request-paths.md#sending-queued-mail-odudu-send-mail)
has the queue before and after that run. Unlike the retention pass it takes
no lock: two senders that meet claim different messages (`FOR UPDATE SKIP
LOCKED`) and both make progress. It needs `ODUDU_APP_DATABASE_URL` for the
same reason, and declines to start without it in the same way — and **with
`ODUDU_OUTBOX_ENABLED=false` and nothing scheduling the command, queued
mail is never sent at all**: no verification link, no reset link, and a
growing table to show for it.

It answers three things that are not a report of rows, and
[says which each is](docs/request-paths.md#when-the-pass-refuses-or-finds-nothing-to-look-at):
`{"ran":false,"reason":"no tenant was enumerated"}` on a database nobody has
seeded yet, and — exiting non-zero — a refusal to run at all when
`ODUDU_APP_DATABASE_URL` is unset or names a role that escapes row-level
security, since either way the policy that scopes its deletes would not
apply. It refuses rather than warning: a retention pass whose isolation is
inert is no better than one that never ran.

**Ending a session tells the relying parties that were part of it.** A
session that ends enqueues one back-channel Logout Token per client that
registered a `backchannel_logout_uri` and used the session, and a third
pass, `send-logouts`, delivers them — every `ODUDU_LOGOUT_SENDER_INTERVAL_SECONDS`
(default `15`) plus a tenth as jitter, or as a one-shot command:

```bash
node --env-file=.env apps/server/src/main.ts send-logouts
```

It reports the same shape `send-mail` does: `{"ran":true,"delivered":N,"failed":N}`,
or `{"ran":false,"reason":"no tenant was enumerated"}` on a database nobody
has seeded yet.

Like the outbox it takes no lock and needs `ODUDU_APP_DATABASE_URL` for the
same reason, declining to start without it the same way — and **with
`ODUDU_LOGOUT_SENDER_ENABLED=false` and nothing scheduling the command, an
ended session's relying parties are never told**, the way `frontchannel_logout_uri`
already isn't when a redirect fires instead of the logout page rendering
(ADR 0034). A relying party that accepts the connection and never answers
costs one delivery, not the queue: `ODUDU_LOGOUT_SENDER_RESPONSE_TIMEOUT_MS`
(default `5000`) bounds each one independently, and every 4xx response
except 429 — the relying party rejecting the token outright, or refusing
it for a reason retrying will not fix — is abandoned rather than retried;
429 and anything else recoverable is retried, up to the source's own
`BACKCHANNEL_LOGOUT_MAX_ATTEMPTS` ceiling, which has no environment
variable of its own.

**[docs/request-paths.md](docs/request-paths.md) takes it from there** — what
each of those tokens is for, what `/userinfo` does with them, how a refresh
rotates, and every way each request above can be refused, with the response
each refusal actually returns.

Enable the repo's git hooks once per clone. They hold a commit message to
`tools/commit-message`: a subject of at most 72 characters, a blank line
after it, a body that reads as at most 8 lines, and no tool-attribution
trailer. CI runs the same
checker over every commit a branch adds, so a clone that skips this is
caught anyway:

```bash
git config core.hooksPath .githooks
```

**The gate** everything must pass — formatting, types, lint, architectural
boundaries, and tests including container-backed integration ones. Needs
Docker running:

```bash
pnpm verify
```

## Why not Keycloak

Keycloak has no notion of an agent as an identity. A service account is
shared, coarse, and permanent; there is no way to say "this agent, acting
for this person, with strictly less authority than they have, for the next
ten minutes, within this budget, revocable independently."

Odudu makes that the centre of the design rather than an afterthought, and
does it with standard mechanisms — RFC 8693 token exchange, `act` and
`may_act` claims, CIBA for out-of-band approval — so relying parties need
no special knowledge.

## Conformance, and what is not claimed

The OpenID Foundation's **Config OP** plan passes, unattended, in CI, against
the stack in `infra/conformance/` — a real TLS-terminating proxy in front of
the server, because the suite demands `https` unconditionally.

Odudu does **not** claim OIDF **Basic OP** certification, and will not. Basic
OP is written against OpenID Connect Core 1.0, which predates PKCE being
mandatory anywhere, so every module in it but the dedicated PKCE one sends an
authorization request carrying no `code_challenge`. Odudu requires PKCE of
every client with no exception and no per-client opt-out, and refuses those
requests. The run is kept reproducible and every divergence individually
confirmed — 28 of 35 modules, each checked rather than sampled — so the
evidence says exactly what stands between this server and that profile.
ADR 0016 records the ruling and the two alternatives rejected;
`infra/conformance/README.md` carries the module-by-module inventory.

The trade is real and worth stating plainly: a relying party that cannot do
PKCE cannot use Odudu.

## Deploying

**The deployable artifact is the container image, not `infra/docker/compose.yaml`.**
That compose file is development-only and says so at the top: its credentials
are committed and publicly known, and both ports bind to loopback. Do not
`docker compose up` it in production.

A real deployment today looks like:

1. Build the image from `infra/docker/Dockerfile`. It is multi-stage, runs as
   a non-root user, and carries a `HEALTHCHECK` against `/health/ready`.
2. Provide a PostgreSQL 17 you operate, with two roles: an owner that can
   `CREATE ROLE`, own the schema and bypass row-level security (see
   [Running it](#running-it) for why the last of those is not optional yet),
   and a restricted login role for serving.
3. Set `ODUDU_DATABASE_URL` (owner, used for migrations) and
   `ODUDU_APP_DATABASE_URL` (restricted, used to serve). **The server refuses
   to boot with `NODE_ENV=production` if the second is unset** — the owner can
   switch row-level security off on its own tables, and escapes it outright
   where it is a superuser (as the compose stack's owner is), so that failure
   is deliberate.
4. Terminate TLS in front of it. The server speaks plain HTTP. **With
   `NODE_ENV=production` it refuses to boot until `ODUDU_TLS=true` says
   something in front of it is doing that** — every credential it issues
   travels as plaintext over the connection, so the assertion is demanded
   rather than assumed. Set `ODUDU_TRUST_PROXY=true` only behind a proxy
   that overwrites `X-Forwarded-*`, or `request.ip` becomes
   client-controlled — and with it the key the per-origin throttle counts
   on, which a spoofed `X-Forwarded-For` then bypasses a header at a time.
   Appending is not enough: the value must be replaced. The same flag now
   also gates `tls_client_auth` client authentication at `/token`: with it
   on, the server reads the client certificate's subject from the header
   named by `ODUDU_TLS_CLIENT_CERT_HEADER` (default `x-ssl-client-s-dn`;
   the name is not standardized — Envoy, Apache and HAProxy each use a
   different one, so set this to whatever the proxy actually emits). **The
   proxy must strip this header from every inbound request before adding
   its own** — a deployment that trusts the header without stripping it
   lets any caller assert any client's identity, since nothing downstream
   of the proxy can otherwise tell its own header from one the proxy
   appended. **The proxy must also actually verify the certificate**
   (nginx's `ssl_verify_client on`, not `optional_no_ca`) — a client
   authentication method is not optional-if-presented, and an unverified
   certificate is just a header a caller wrote into its own request. When
   no certificate is presented, the header must be absent or empty, never
   a literal placeholder like `(null)` or `-`: either of those would be
   read as a real, if unmatched, subject and refuse every ordinary
   `client_secret_basic` or `client_secret_post` request from that proxy
   too, since it would then look like a certificate was always presented.
   With the flag off, `tls_client_auth` is unavailable end to end:
   discovery does not advertise it and dynamic client registration refuses
   to register a client for it, not only `/token`'s own refusal to
   authenticate one.
5. Set `ODUDU_PUBLIC_BASE_URL` to the origin users reach the server on.
   **With `NODE_ENV=production` the server refuses to boot without it** — it
   is the base of every mailed link and the WebAuthn relying party id every
   passkey is bound to, and neither may come from a request header.
6. Run one instance. Migrations run on boot from every process and take no
   advisory lock, so concurrent replicas would race — and the per-origin
   throttle is a window in one process's memory, so replicas would each
   allow the full budget.
7. **Leave the retention schedule on.** The server reaps hourly by
   default; without it `authentication_sessions`, `authorization_codes` and
   `refresh_tokens` grow without bound and login metadata is kept for no
   stated period. Set `ODUDU_REAP_INTERVAL_SECONDS` to shorten it, or
   `ODUDU_REAP_ENABLED=false` and schedule `node dist/main.js reap` as a
   cron entry or a CronJob instead — one or the other, and doing both is
   harmless, since the pass takes a Postgres advisory lock and whoever
   loses a tick skips it. **It holds one transaction for the whole tick** —
   every tenant, every table — which is what makes one lock and one report
   cover the lot, and what to watch if a deployment ever has many tenants
   and very large tables. Either way it requires `ODUDU_APP_DATABASE_URL`,
   because its deletes are scoped by the row-level-security policy that the
   owner role escapes.
8. **Leave the outbox schedule on too**, or schedule
   `node dist/main.js send-mail` instead. Nothing else sends mail: with the
   schedule off and no command running, every verification and reset link
   sits in `email_outbox` unsent, and the flows that queued them still
   answer exactly as they do when mail is going out — by design, since the
   reset endpoint must not answer differently for an address that exists.

### What is not built yet

Being straight about this, because "self-hostable" should mean something.
Every row says where it stands, and every row has a phase:

|                                                                                                        | Where it stands |
| ------------------------------------------------------------------------------------------------------ | --------------- |
| A consent screen — `consent_required` is recorded per client, nothing reads it yet                     | P3a             |
| An account console for self-service credential management, and an operator unlock for a locked account | P4d             |
| An admin **console** — the admin API exists, nothing drives it but `curl`                              | P4d             |
| Published images and a release process                                                                 | P12             |
| Secret management beyond environment variables                                                         | P12             |
| Backup and restore guidance                                                                            | P12             |
| Multi-replica support: migration locking, shared session cache, HA                                     | P11             |
| Helm chart or Kubernetes manifests                                                                     | P11             |

The three P12 rows had no phase at all until 2026-09-14. They are
operational rather than protocol work, and the roadmap — written outward
from the specifications — had named nobody to do it, so P12, Operational
readiness, was appended for them. The credentials the server reads today
come from the environment by decision (ADR 0015), which settles where they
live and not how a deployment manages them.

**P12 being last in the table does not mean deployment waits on everything
before it.** Publishing a versioned image depends on no other phase and is
the prerequisite for anybody running this at all; it should be pulled
forward as soon as there is something worth tagging. Sourcing secrets from
something other than the environment is nearly as free — the key-encryption
key is already behind an interface a KMS adapter can replace. Backup and
restore guidance is the one worth waiting on, and not on clustering: it is
cheap to write once the data that must be restored consistently has stopped
changing shape.

The single-container-plus-Postgres shape is a deliberate design decision
(ADR 0002) and the image is built for it. There is now a protocol surface to
serve, and users can be authenticated against it — with a second factor, a
password policy, an account lockout and a per-origin throttle, each of which
has an adversarial test behind it rather than a paragraph. What has not
happened is a hardening pass over the whole: credentials are still seeded
from a command line, no deployment has been reviewed end to end, and the full
list of what each endpoint does not yet do is in
[docs/request-paths.md](docs/request-paths.md). The notice at the top of this
file is not boilerplate.

## License

[Apache-2.0](LICENSE). The patent grant is deliberate: identity
infrastructure is exactly the kind of thing an organisation's legal team
asks about before adopting.

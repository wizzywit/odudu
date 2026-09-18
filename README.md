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

**The OAuth 2.1 / OpenID Connect core is built.** A realm serves discovery,
JWKS, `/authorize` with a password login, `/token` and `/userinfo`, and
answers the `authorization_code` (PKCE mandatory, no exception),
`refresh_token` (rotating, with reuse detection that revokes the family) and
`client_credentials` grants. That sits on the P0 foundation: the monorepo and
its single `pnpm verify` gate, machine-checked architectural boundaries, the
kernel primitives, one ordered migration timeline with PostgreSQL row-level
security, and a container CI builds and boots on every pull request and on
every merge to `main` — a branch push with no pull request open runs
nothing, by design (`.github/workflows/verify.yml`).

There is still no consent screen, no admin API and no
token exchange — P3a onwards. The roadmap's second and third phases are each
two. **P2a** is the identity model — roles, groups, client scopes,
per-client web origins, email — and **P2b** is credentials, MFA and the
session lifecycle. **P3a** is clients, registration and consent, and **P3b**
is sessions, logout and the token surface.

A role reaches a token only when it is mapped to a scope the client is
assigned, because `clients.full_scope_allowed` is off by default — a client
sees the realm's entire role vocabulary only once that is switched on for
it.

`/token` and `/userinfo` now enforce CORS from a client's own `web_origins`
(a preflight from the realm's union of every client's, since it carries no
client identity to check against one) — see
[the CORS section of docs/request-paths.md](docs/request-paths.md#cors-the-preflight-and-the-request-differ).
`seed client --web-origin` registers them as it creates a client; changing
one on a client that already exists means updating
`client_oidc_config.web_origins` directly, because `seed client` refuses an
existing client rather than widening a registered list on a re-run.

`email_verified` is now a claim about something that happened: a mailed
`GET /realms/{realm}/login-actions/action-token?key=…` link, redeemed once,
flips it. A realm carries three settings for the account lifecycle this
begins — `registration_allowed`, `verify_email` and `reset_password_allowed`
— each defaulting off, so upgrading a realm never silently grants it public
registration or mailed verification. `odudu seed realm --set` changes them,
and every other realm setting, by the column name the schema uses:
`odudu seed realm --name demo --set registration_allowed=true`, repeatable.
There is no admin **API** for them yet — that is P4 — and the ranges the
numeric ones accept are CHECK constraints, so the CLI has no way past a
policy the database enforces. Outgoing mail goes through `ODUDU_SMTP_HOST`,
`ODUDU_SMTP_PORT` (default `587`), `ODUDU_SMTP_FROM`, `ODUDU_SMTP_USERNAME`,
`ODUDU_SMTP_PASSWORD` and `ODUDU_SMTP_STARTTLS`; leave `ODUDU_SMTP_HOST`
unset and the server logs every message instead of sending it, which is what
the compose stack does. See
[the address verification section of docs/request-paths.md](docs/request-paths.md#address-verification)
for that walkthrough, captured message included.

`registration_allowed` now has a reader: `GET`/`POST
/realms/{realm}/login-actions/registration` lets a user create their own
account — subject, user row, password credential and the realm's default
roles, all in one transaction — instead of an administrator seeding one in.
When the realm's `verify_email` is also on, a self-registered address
cannot complete a login until it is verified: no authorization code is
issued, which is the property that made verification ship before
registration rather than alongside it. See
[the self-registration section of docs/request-paths.md](docs/request-paths.md#self-registration)
for the walkthrough.

`reset_password_allowed` now has a reader too: `GET`/`POST
/realms/{realm}/login-actions/reset-password` lets a user request a mailed
link that sets a new password, and the `reset_password` branch of `GET`/`POST
/realms/{realm}/login-actions/action-token` redeems it. The request answers
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

A realm's `otp_required` turns TOTP into a real second factor. It defaults
off, and off does not mean nobody is asked: a subject who has enrolled a
TOTP credential is always asked for a code after their password, in any
realm. What the switch adds is everybody else — a subject with no credential
is given the `configure-totp` required action at their next login, and
`POST /realms/{realm}/login-actions/required-action?action=configure-totp`
enrols one. The enrolment page renders the `otpauth://` URI as text and as a
QR code, and the credential is written only by a submission that proves a
correct code, never by the page that offers a secret. The algorithm is
RFC 6238 as `@odudu/crypto` implements it — six digits, SHA-1, a 30-second
step, a ±1-step window and a stored last-accepted step, so a code cannot be
used twice. A two-factor login's ID token carries `amr: ["otp", "pwd"]` and
`acr: "2"`. Turning it on is
`odudu seed realm --name <realm> --set otp_required=true`, the same command
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
/realms/{realm}/login-actions/required-action?action=configure-passkey`.
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
asks `POST /realms/{realm}/login-actions/passkey-challenge` for request
options — which name no credentials, so the browser offers every
discoverable passkey it holds — calls `navigator.credentials.get()`, and
posts the assertion back to the same login endpoint in an `assertion` field.
Who is signing in comes from the assertion: the credential id it carries is
the `lookup_key` a realm-scoped read resolves to a subject, and that read
happens before any signature is checked, because verification needs the
stored public key as an input. The authenticator's signature counter must
have advanced, or the credential looks cloned and the login is refused —
except for an authenticator that reports zero and always has, which
WebAuthn §6.1.1 permits. A passkey counts as **two** factors (`amr:
["hwk", "user"]`, `acr: "2"`), since enrolment demands user verification, so
a realm with `otp_required` on does not ask for a code on top of one.

Every realm also carries a password policy — `password_min_length` (default
`8`, floored there by a `CHECK`; a realm cannot configure its way below it),
`password_require_digit`, `password_require_uppercase`,
`password_require_lowercase` and `password_require_special` (all off by
default), and `password_not_username`/`password_not_email` (both on by
default, refusing a password that contains the account's own username, or
the local part of its email address — matched independently, so a
password containing both is refused for both). A password is also capped at
**256 characters**, which is the one rule no realm configures: it exists to
bound work rather than to shape passwords, and 256 is double the length
ASVS 2.1.2 says a server may start refusing, so no passphrase anybody would
type reaches it. An over-long password is refused, never truncated, and it
is refused where the form is read — including at the sign-in form, which
verifies a password rather than evaluating it against the policy, and so is
the one route where "no maximum" would mean an Argon2id verification for
input of any length (ADR 0023). The policy is read from the
realm, never defaulted in code, and the same `evaluatePassword` call binds
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
with waiting the window out, is the whole of how a lockout ends: there is no
operator unlock and no admin surface to clear one, since there is no admin
API yet.
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

`/token` is deliberately outside it, so the protection RFC 6749 §2.3.1 asks
for around a client's password is still unanswered: the lockout is keyed by
subject and a client is not one, and a budget per address is one address for
every
request a server-side client will ever make. A limit keyed by client is
`deferred: P3a` in [docs/protocols/rfc6749.md](docs/protocols/rfc6749.md),
where client authentication is reworked.

`password_max_age_days` (default `0`, the feature off) ages a password out.
An expired password is **not** refused: the login authenticates as it
always did and the `update-password` required action blocks it from
completing, so a realm that turns this on moves accounts along rather than
locking them out. `password_history_depth` (default `0`, also off) is how
many retired passwords a realm remembers; above zero, the change-password
action refuses a candidate matching any of them or the password in force,
and rotation retires the displaced hash as a `password-history` credential.
Those rows are never a login's input, and the ones past the depth are
deleted — the one place anything in this codebase deletes a credential
rather than marking it (ADR 0021), because no decision can read them.

**A required action blocks a login's completion, never its factors.**
`POST /realms/{realm}/login-actions/required-action` carries no credentials
of its own, so it acts only for a session whose authentication has actually
finished — every factor the realm's flow asks of that subject passed, and
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
LOCKED`, one realm at a time, and runs either on the server's own schedule
(`ODUDU_OUTBOX_INTERVAL_SECONDS`) or as `odudu send-mail`
([ADR 0024](docs/adr/0024-a-scheduled-pass-is-a-command-first.md)). That is
what makes the two reset paths indistinguishable in time as well as in
content: an address with an account costs one `INSERT` more than one
without, not an SMTP round trip more. A refused message is retried with a
doubling backoff and, once its attempts are spent, kept with its last error
for an operator to read. A transport failure therefore cannot reach a
caller or change a status: it happens after the response, and no code
reachable from a request holds a mail transport at all.

**Known limitation, realm-wide:** the reset endpoint's enumeration safety
does not make the realm itself un-enumerable. With `registration_allowed`
also on, the registration form (below) answers "that email address is
already registered" with a 400 — a universal trade-off for a self-service
registration form, and the one Keycloak makes too — so an address's
presence in the realm is discoverable through that door even though the
reset flow closes this one. Accepted, not fixed: honestly naming a
trade-off beats implying a property the realm does not actually have.

A mailed verification link is built from `ODUDU_PUBLIC_BASE_URL`, never
from the request that triggered it — a request's `Host` header is
client-controlled, and trusting it would let an attacker choose where a
link Odudu mails to someone else points. `ODUDU_PUBLIC_BASE_URL` must be an
absolute `http`/`https` origin with no path; when it is unset, a realm with
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
every realm; outside production the variable stays optional, and without it
passkey enrolment reports itself unavailable and the login page offers no
passkey button, because there would be nothing behind one.

A client that registers a `jwks_uri` has it dereferenced over HTTPS, and the
address it resolves to is checked before the server connects to it — a
private, loopback, link-local or otherwise non-public address is refused, so
a client cannot point the server at its own network. `ODUDU_ALLOW_PRIVATE_CLIENT_URLS`
lifts that check; it exists so the development and conformance stacks can
register a client whose `jwks_uri` resolves to a private or loopback
address, which the OIDF conformance suite's own registration module does.
**With `NODE_ENV=production` the server refuses to boot if it is set to
`true`** — off is the only production-safe value.

**Operational trap:** turning `verify_email` on locks out every existing
user with no email address on file — including one seeded without
`--email` — since there is no address for them to verify and, for now, no
way to add one after the fact. The login page tells them so rather than
claiming a mail it never sent, but there is no recovery path yet; give
every user an address before enabling `verify_email` on a realm that
already has some.

**The SSO session is read as well as written, and it has two clocks.** The
`{realm}-session` cookie the login POST sets is now what lets a second
authorization request from the same browser complete without the form:
`/authorize` resolves it, and `prompt` decides whether that is allowed —
`prompt=none` succeeds where a request with no session gets
`login_required`, and `prompt=login` forces the form past a live session.
A session is live until the earlier of `sso_session_idle_seconds`
(default `1800`) measured from its last use and `sso_session_max_seconds`
(default `36000`) from when it was established; both are per realm, both
bounded by a `CHECK`, and an idle window longer than the ceiling is refused
rather than clamped. A reused session issues a code carrying the
**original** login's `auth_time`, not the moment of reuse, which is the fact
a client's own `max_age` check depends on — and `max_age` is honoured, so a
client can demand a fresher authentication than the cookie represents. The
email-verified gate guards this second door into completing a login exactly
as it guards the password form. What is not there: **one session per
browser**, since the cookie holds one id, which is why
`prompt=select_account` renders the ordinary form and is P3b's.

**A realm can now end a session.** `GET`/`POST
/realms/{realm}/protocol/openid-connect/logout` implements OpenID Connect
RP-Initiated Logout 1.0 over both methods §2 requires, the parameters
arriving in the query string or a form body: it asks the End-User to
confirm before ending anything unless an `id_token_hint` names the session
actually being ended — and a `client_id` sent beside a hint has to name the
client that hint was issued to, or neither is used — and it redirects to
`post_logout_redirect_uri` only when that value is an
exact, unnormalized match against the client's own registered list —
refusing the redirect never keeps the session alive, since the two are
decided independently. **Logout revokes the session row and every grant
tied to it — not access tokens.** Odudu's access tokens are self-contained
`at+jwt` JWTs that a resource server verifies without a round trip to
anywhere, so nothing exists to tell one it has been logged out; a
logged-out user's access token keeps working until its own `exp`, at most
`client_oidc_config.access_token_ttl_seconds` (capped at one hour) after it
was issued. A grant issued with no session — `offline_access` — is
untouched by a logout, per Back-Channel Logout 1.0 §2.7's second sentence.
A deployment that needs revocation inside an
access token's own lifetime is what RFC 7662 introspection is for, landing
in P3b. See [the logout section of
docs/request-paths.md](docs/request-paths.md#rp-initiated-logout) for the
walkthrough.

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
generated — and both point at the same database. Seed a realm under one and
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
request time: resolving `{realm}` from the path, which happens before any
realm id exists to `SET LOCAL app.realm_id` into (ADR 0009's amendment of
2026-09-13). Under a plain owner that read returns zero rows and **every
request answers "unknown realm"**, whatever is in the database.
`packages/authn-flows/tests/migrate-backfill.int.test.ts` asserts exactly
that, against a container, so the requirement is recorded rather than
folklore. A least-privilege owner is what this deployment shape wants and
cannot have yet; closing it means resolving a realm without the bypass.

The same property is what a **migration** that reads or writes across realms
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
container — seed a realm and client, request `/authorize`, submit the login
form the way a browser would, redeem the code at `/token` — and then tears
the stack down, volumes included.

**Sign somebody in yourself.** There is no admin API yet, so the first realm,
client, user and signing key come from the server's seed command. The run
below is the all-Docker one:

```bash
cd infra/docker && docker compose up -d --build
until curl -fsS http://localhost:3000/health/ready; do sleep 2; done
```

Wait for that, rather than seeding straight after `up -d`. The container is
started before it has finished applying migrations, the seed command runs
none of its own, and a seed run in the gap fails with `relation "realms" does
not exist`. A host run needs the same wait, for the same reason.

```bash
docker compose exec -T odudu node dist/main.js seed \
  --realm demo --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
```

With the server on your host it is the same command through the source
instead, run from the repository root, reading the root `.env` that the `dev`
script reads:

```bash
node --env-file=.env apps/server/src/main.ts seed \
  --realm demo --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
```

Whichever of the two you run first answers:

```json
{
  "created": true,
  "realm": "demo",
  "realmId": "01a096f4-…",
  "clientId": "demo-spa",
  "userSubjectId": "01a096f4-…"
}
```

That realm now serves the protocol. The discovery document is the one
request every client makes first, and every URL below comes out of it:

```bash
curl -sS http://localhost:3000/realms/demo/.well-known/openid-configuration
```

```json
{
  "issuer": "http://localhost:3000/realms/demo",
  "authorization_endpoint": "http://localhost:3000/realms/demo/protocol/openid-connect/auth",
  "token_endpoint": "http://localhost:3000/realms/demo/protocol/openid-connect/token",
  "userinfo_endpoint": "http://localhost:3000/realms/demo/protocol/openid-connect/userinfo",
  "jwks_uri": "http://localhost:3000/realms/demo/protocol/openid-connect/certs"
}
```

(Five of the sixteen members it returns; the other eleven, and what a client
does with each, are in the guide.)

And this signs ada in and comes back with tokens — the whole
authorization-code-with-PKCE flow, with `curl` standing in for the browser,
whose only job in it is to follow a redirect and submit a form:

```bash
BASE=http://localhost:3000/realms/demo/protocol/openid-connect
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
  http://localhost:3000/realms/demo/login-actions/authenticate \
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
node --env-file=.env apps/server/src/main.ts seed role --realm demo --name reviewer
node --env-file=.env apps/server/src/main.ts seed grant-role \
  --realm demo --username ada --role reviewer
node --env-file=.env apps/server/src/main.ts seed map-role \
  --realm demo --scope roles --role reviewer
```

```json
{ "command": "role", "realm": "demo", "realmId": "01a0a1a7-…", "roleId": "01a0a1a7-…", "name": "reviewer", "clientId": null }
{ "command": "grant-role", "realm": "demo", "realmId": "01a0a1a7-…", "username": "ada", "role": "reviewer" }
{ "command": "map-role", "realm": "demo", "realmId": "01a0a1a7-…", "scope": "roles", "role": "reviewer" }
```

Re-request a token with `scope=openid roles` instead of `scope=openid
profile email` — swap that one value into the `/auth` call above — and the
access token's payload carries it:

```json
{
  "roles": ["reviewer"],
  "iss": "http://localhost:3000/realms/demo",
  "sub": "01a0a1a7-…",
  "client_id": "demo-spa",
  "scope": "openid roles"
}
```

(Trimmed to the claims this section is about; `aud`, `iat`, `exp`, `jti` and
`sid` are on it too, and
[docs/request-paths.md](docs/request-paths.md#roles-once-a-scope-reaches-it)
shows the whole payload.)

**"I created a role and it is not in my token."** Three things gate a role
onto a token, independently: it must be granted to the subject
(`grant-role`), mapped to a scope (`map-role`), and that scope must both be
assigned to the client and actually requested (`scope=` at `/authorize`, or
`clients.full_scope_allowed`). `seed client` already assigns every
realm-default scope — `roles` and `groups` included — so the third
condition is usually already met; `seed assign-scope` is for a scope added
to the realm afterwards. [docs/request-paths.md](docs/request-paths.md#roles-once-a-scope-reaches-it)
walks through all of it, including a client-scoped role qualified as
`clientId:roleName`.

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
{"ran":true,"deleted":{"refresh_tokens":0,"authorization_codes":0,"token_grants":0,"authentication_sessions":0,"action_tokens":0,"login_failures":0,"email_outbox":0,"sessions":0}}
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
`{"ran":false,"reason":"no realm was enumerated"}` on a database nobody has
seeded yet, and — exiting non-zero — a refusal to run at all when
`ODUDU_APP_DATABASE_URL` is unset or names a role that escapes row-level
security, since either way the policy that scopes its deletes would not
apply. It refuses rather than warning: a retention pass whose isolation is
inert is no better than one that never ran.

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
   Appending is not enough: the value must be replaced.
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
   every realm, every table — which is what makes one lock and one report
   cover the lot, and what to watch if a deployment ever has many realms
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
| A consent screen, and dynamic client registration                                                      | P3a             |
| Several sessions in one browser, and the `prompt=select_account` that needs them                       | P3b             |
| A rate limit on `client_secret` attempts at `/token`                                                   | P3a             |
| An account console for self-service credential management, and an operator unlock for a locked account | P4              |
| An admin API — seeding is the only administrative surface                                              | P4              |
| Signing-key rotation — the shape exists, the operation does not                                        | P4              |
| Front-channel and back-channel logout                                                                  | P3b             |
| Token introspection and revocation                                                                     | P3b             |
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

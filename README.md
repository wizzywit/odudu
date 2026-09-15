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

There is still no consent screen, no admin API, no second factor, and no
token exchange — P2a onwards. The roadmap's second phase is two: **P2a** is
the identity model — roles, groups, client scopes, per-client web origins,
email — and **P2b** is credentials, MFA and the session lifecycle.

A role reaches a token only when it is mapped to a scope the client is
assigned, because `clients.full_scope_allowed` is off by default — a client
sees the realm's entire role vocabulary only once that is switched on for
it.

`/token` and `/userinfo` now enforce CORS from a client's own `web_origins`
(a preflight from the realm's union of every client's, since it carries no
client identity to check against one) — see
[the CORS section of docs/request-paths.md](docs/request-paths.md#cors-the-preflight-and-the-request-differ).
The seed command has no flag for it yet, so setting one means updating
`client_oidc_config.web_origins` directly until it grows one.

`email_verified` is now a claim about something that happened: a mailed
`GET /realms/{realm}/login-actions/action-token?key=…` link, redeemed once,
flips it. A realm carries three settings for the account lifecycle this
begins — `registration_allowed`, `verify_email` and `reset_password_allowed`
— each defaulting off, so upgrading a realm never silently grants it public
registration or mailed verification. There is no admin surface to change
them yet, so flipping one means an `UPDATE realms SET …` against the
database directly. Outgoing mail goes through `ODUDU_SMTP_HOST`,
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
the same reason. Completing one reset also retires every other outstanding
reset-password link for the same subject, and turning
`reset_password_allowed` off closes redemption as well as the request form.
See [the password reset section of docs/request-paths.md](docs/request-paths.md#password-reset)
for the walkthrough.

**Known limitation:** the reset-request endpoint still has a timing
oracle — mailing an address that exists takes an SMTP round trip longer
than the single `SELECT` a nonexistent one costs, so a network observer can
distinguish the two by response time even though the response body and
status cannot. Closing it needs sending off the request path entirely (an
outbox table and a background sender), which P2a's design spec rejected: it
would have been the first background loop in the codebase and a second table
nothing deletes from. Stated here rather than fixed, on the judgment that an
honest limitation beats an accidental one.

**P2b owns closing it**, as of 2026-09-15. P2b builds that background loop
anyway, to reap expired state, so the outbox costs a table and a sender
rather than new infrastructure; this paragraph goes away in the increment
that lands it, and not before.

**Known limitation, realm-wide:** the reset endpoint's enumeration safety
does not make the realm itself un-enumerable. With `registration_allowed`
also on, the registration form (below) answers "that email address is
already registered" with a 400 — a universal trade-off for a self-service
registration form, and the one Keycloak makes too — so an address's
presence in the realm is discoverable through that door even though the
reset flow closes this one. Accepted, not fixed, for the same reason the
timing oracle above is: honestly naming a trade-off beats implying a
property the realm does not actually have.

A mailed verification link is built from `ODUDU_PUBLIC_BASE_URL`, never
from the request that triggered it — a request's `Host` header is
client-controlled, and trusting it would let an attacker choose where a
link Odudu mails to someone else points. `ODUDU_PUBLIC_BASE_URL` must be an
absolute `http`/`https` origin with no path; when it is unset, a realm with
`verify_email` on refuses to register rather than guessing a base some
other way (`compose.yaml` sets it for the local stack).

**Operational trap:** turning `verify_email` on locks out every existing
user with no email address on file — including one seeded without
`--email` — since there is no address for them to verify and, for now, no
way to add one after the fact. The login page tells them so rather than
claiming a mail it never sent, but there is no recovery path yet; give
every user an address before enabling `verify_email` on a realm that
already has some.

**A realm can now end a session.** `GET`/`POST
/realms/{realm}/protocol/openid-connect/logout` implements OpenID Connect
RP-Initiated Logout 1.0: it asks the End-User to confirm before ending
anything unless an `id_token_hint` names the session actually being ended,
and it redirects to `post_logout_redirect_uri` only when that value is an
exact, unnormalized match against the client's own registered list —
refusing the redirect never keeps the session alive, since the two are
decided independently. **Logout revokes the session row and every grant
tied to it — not access tokens.** Odudu's access tokens are self-contained
`at+jwt` JWTs that a resource server verifies without a round trip to
anywhere, so nothing exists to tell one it has been logged out; a
logged-out user's access token keeps working until its own `exp`, at most
`client_oidc_config.access_token_ttl_seconds` (capped at one hour) after it
was issued. A grant issued with no session — `offline_access`, once that
scope exists — is untouched by a logout, per Back-Channel Logout 1.0
§2.7's second sentence. A deployment that needs revocation inside an
access token's own lifetime is what RFC 7662 introspection is for, landing
in P3. See [the logout section of
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
is what puts the serving connection under row-level security. Point both URLs
at your own port (5432 by default, not 5442) and start the server:

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

**[docs/request-paths.md](docs/request-paths.md) takes it from there** — what
each of those tokens is for, what `/userinfo` does with them, how a refresh
rotates, and every way each request above can be refused, with the response
each refusal actually returns.

Enable the repo's git hooks once per clone — they reject commit messages
carrying tool-attribution trailers, which CI also enforces:

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
   `CREATE ROLE` and own the schema, and a restricted login role for serving.
3. Set `ODUDU_DATABASE_URL` (owner, used for migrations) and
   `ODUDU_APP_DATABASE_URL` (restricted, used to serve). **The server refuses
   to boot with `NODE_ENV=production` if the second is unset** — serving as
   the owner would bypass row-level security, so that failure is deliberate.
4. Terminate TLS in front of it. The server speaks plain HTTP. **With
   `NODE_ENV=production` it refuses to boot until `ODUDU_TLS=true` says
   something in front of it is doing that** — every credential it issues
   travels as plaintext over the connection, so the assertion is demanded
   rather than assumed. Set `ODUDU_TRUST_PROXY=true` only behind a proxy
   that overwrites `X-Forwarded-*`, or `request.ip` becomes
   client-controlled.
5. Run one instance. Migrations run on boot from every process and take no
   advisory lock, so concurrent replicas would race.

### What is not built yet

Being straight about this, because "self-hostable" should mean something.
Every row says where it stands, and every row has a phase:

|                                                                                                              | Where it stands |
| ------------------------------------------------------------------------------------------------------------ | --------------- |
| Self-service registration and password reset — address verification exists; the flows that trigger it do not | P2a             |
| A consent screen, and dynamic client registration                                                            | P3              |
| An admin API — seeding is the only administrative surface                                                    | P4              |
| Signing-key rotation — the shape exists, the operation does not                                              | P4              |
| Front-channel and back-channel logout                                                                        | P3              |
| Token introspection and revocation                                                                           | P3              |
| Published images and a release process                                                                       | P12             |
| Secret management beyond environment variables                                                               | P12             |
| Backup and restore guidance                                                                                  | P12             |
| Multi-replica support: migration locking, shared session cache, HA                                           | P11             |
| Helm chart or Kubernetes manifests                                                                           | P11             |

The last three of those had no phase at all until 2026-09-14. They are
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
serve, and users can be authenticated against it — but credentials are
seeded from a command line, nothing has had a hardening pass, and the full
list of what each endpoint does not yet do is in
[docs/request-paths.md](docs/request-paths.md). The notice at the top of this
file is not boilerplate.

## License

[Apache-2.0](LICENSE). The patent grant is deliberate: identity
infrastructure is exactly the kind of thing an organisation's legal team
asks about before adopting.

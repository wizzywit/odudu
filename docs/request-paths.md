# Request paths

Every endpoint Odudu serves today, what a client does with each answer, and
what happens on each way a request can go wrong. Every command below was run
and every response is the one that came back. Unless a block says otherwise
the run was against the compose stack (`infra/docker/compose.yaml`); the
bootstrap and a full authorization-code exchange were additionally run in
each of the other two ways of running the server, which
[Pick how you are running it](#pick-how-you-are-running-it) sets out.

Values that change on every run — authorization codes, tokens, `jti`,
session ids, timestamps — are shortened or truncated where they appear, and
that is said each time. Nothing here is reconstructed from what the code
looks like it should do.

Three conventions that keep that promise checkable. A fenced block holding a
response **carries no language tag**, because a tagged one is reformatted by
Prettier and what a reader then sees is the formatter's markup rather than
the server's — the bytes below are the bytes served, line breaks included.
Node prints two `ExperimentalWarning` lines about its Web Crypto API on
every CLI invocation; they are on `stderr` and are trimmed from every
transcript here. And a section whose output depends on the state of the
stack it ran against **says which state** — [Retention](#retention-what-odudu-reap-removes),
the second [lockout](#brute-force-lockout) run and
[the throttle](#the-per-origin-throttle) each do. Everything else was run in
the order it appears, front to back, against one stack started with
`ODUDU_THROTTLE_LIMIT=1000`: a scripted walkthrough of a whole document
sends more requests a minute than the budget a person needs
([the per-origin throttle](#the-per-origin-throttle)), and every transcript
past the tenth would otherwise be a `429`.

## The shape of it

A **realm** is a tenant: its own users, clients, signing keys and sessions,
isolated in the database by PostgreSQL row-level security (ADR 0009). Every
protocol endpoint lives under `/realms/{realm}/`, so the realm is chosen by
the URL and never by a header or a parameter.

| Method | Path                                                   | What it is                                                  |
| ------ | ------------------------------------------------------ | ----------------------------------------------------------- |
| `GET`  | `/realms/{realm}/.well-known/openid-configuration`     | Discovery document                                          |
| `GET`  | `/realms/{realm}/protocol/openid-connect/certs`        | JWKS (public signing keys)                                  |
| `GET`  | `/realms/{realm}/protocol/openid-connect/auth`         | Authorization endpoint                                      |
| `POST` | `/realms/{realm}/protocol/openid-connect/auth`         | Authorization endpoint (form)                               |
| `POST` | `/realms/{realm}/login-actions/authenticate`           | Login form submission                                       |
| `POST` | `/realms/{realm}/login-actions/consent`                | Consent screen submission (allow/deny)                      |
| `POST` | `/realms/{realm}/login-actions/select-account`         | Account chooser submission                                  |
| `POST` | `/realms/{realm}/login-actions/required-action`        | Complete a pending required action (enrolment, password)    |
| `POST` | `/realms/{realm}/login-actions/passkey-challenge`      | Request options for a usernameless passkey assertion        |
| `GET`  | `/realms/{realm}/login-actions/registration`           | Self-registration form                                      |
| `POST` | `/realms/{realm}/login-actions/registration`           | Self-registration submission                                |
| `GET`  | `/realms/{realm}/login-actions/action-token`           | Redeem a mailed action token (verify email, reset password) |
| `POST` | `/realms/{realm}/login-actions/action-token`           | Submit a new password against a reset-password token        |
| `GET`  | `/realms/{realm}/login-actions/reset-password`         | Password reset request form                                 |
| `POST` | `/realms/{realm}/login-actions/reset-password`         | Password reset request submission                           |
| `POST` | `/realms/{realm}/protocol/openid-connect/token`        | Token endpoint                                              |
| `GET`  | `/realms/{realm}/protocol/openid-connect/userinfo`     | UserInfo                                                    |
| `POST` | `/realms/{realm}/protocol/openid-connect/userinfo`     | UserInfo (form)                                             |
| `GET`  | `/realms/{realm}/protocol/openid-connect/logout`       | RP-initiated logout (`end_session_endpoint`)                |
| `POST` | `/realms/{realm}/protocol/openid-connect/logout`       | RP-initiated logout (form-serialized), confirmation form    |
| `POST` | `/realms/{realm}/clients-registrations/openid-connect` | Dynamic client registration (RFC 7591)                      |
| `GET`  | `/health/live`, `/health/ready`                        | Liveness, readiness                                         |

`/login-actions/authenticate` is deliberately outside the
`/protocol/openid-connect/` namespace: that namespace is the OIDC wire
protocol, and the login form is Odudu's own UI, which no specification
describes and no client library calls.

Three grant types reach `/token`: `authorization_code`, `refresh_token` and
`client_credentials`. They share almost everything. Client authentication,
scope resolution, access-token minting and the response envelope are one
path for all three; only one stage — deciding whether this client may have
this grant, and what subject it names — is grant-specific. That is why the
error vocabulary is so uniform below: most refusals come from shared code.

## Bootstrap

There is no admin API yet, so a realm, its first user and its signing key
are created by the server's seed command — the only way to create the
first of anything. A client is the one exception once a realm opens
registration to it: `seed client` still works, but
[dynamic client registration](#dynamic-client-registration) is a second
door, open to whoever the realm's `client_registration_policy` admits.

### Pick how you are running it

[README.md](../README.md) describes three ways to run this: everything in
Docker, Postgres in Docker with the server on your host, and everything on
your host against a PostgreSQL you operate. They differ in exactly one thing
this document depends on — **how the seed command is invoked** — because the
container runs a built bundle and a host run has the source.

So the rest of this document calls the CLI through a shell function named
`odudu`. Define it once for the way you are running, from the repository
root, and every command below is the same command in all three.

**Everything in Docker.** The CLI is the bundle inside the running
container, and the configuration both it and the server read is
`infra/docker/.env`; the repository-root `.env` plays no part.

```bash
cd infra/docker && docker compose up -d --build
until curl -fsS http://localhost:3000/health/ready; do sleep 2; done
cd ../..
odudu() { docker compose -f infra/docker/compose.yaml exec -T odudu node dist/main.js "$@"; }
```

```
{"status":"ok","checks":{"database":"ok"}}
```

**Server on your host**, against either Postgres. Node runs the TypeScript
source directly, and `--env-file` hands it the repository-root `.env` — the
same file the `dev` script loads, so the CLI and the server it is seeding
for read one configuration.

```bash
pnpm --filter @odudu/server dev            # leave running in another terminal
until curl -fsS http://localhost:3000/health/ready; do sleep 2; done

odudu() { node --env-file=.env apps/server/src/main.ts "$@"; }
```

```
{"status":"ok","checks":{"database":"ok"}}
```

What else the choice settles:

| What it settles                                | Everything in Docker              | Server on your host                               |
| ---------------------------------------------- | --------------------------------- | ------------------------------------------------- |
| What the CLI executes                          | the bundle built into the image   | `apps/server/src/main.ts`, types stripped by Node |
| Configuration the server and the CLI both read | `infra/docker/.env`               | the repository-root `.env`                        |
| Base URL of every endpoint                     | `http://localhost:3000`           | `http://localhost:3000`                           |
| PostgreSQL                                     | compose's, published on port 5442 | compose's on 5442, or one you run yourself        |

The base URL is the same in all three, so no URL below is mode-specific:
compose publishes `127.0.0.1:3000:3000`, and a host run defaults to the same
port. Run only one of them at a time — they compete for it.

The readiness loop is not decoration, in either mode. `docker compose up -d`
returns when the container has started, which is before it has finished
applying migrations, and the `dev` script returns the shell immediately for
the same reason. **The seed command does not run migrations**; it expects a
schema the server put there on boot, and a seed run in that gap fails with
`relation "realms" does not exist`.

Running everything on your host needs the database and the restricted
serving role to exist before any of this — one `CREATE DATABASE` and one
`CREATE USER`, in [README.md](../README.md#running-it), against a PostgreSQL
whose owner role can `CREATE ROLE`. Nothing after that bootstrap differs from
the second column above. The run behind this document used a throwaway
cluster made for it — `initdb -D /tmp/odudu-pg -U postgres`, started with
`pg_ctl` on port 5433, PostgreSQL 18.6 — rather than the compose stack, so
that "no Docker at all" meant it.

### The key that has to be the same on both sides

`ODUDU_KEK` wraps each realm's private signing key. It is read from whichever
configuration the process holds, so **the thing that seeded a realm and the
thing serving it must hold the same value** — and the two files ship
_different_ ones: `infra/docker/.env.example` carries a throwaway key, and
the root `.env.example` leaves it empty for you to generate.

Seeding under compose and then serving from your host is the easy accident:
both processes are pointed at the same database, and only the key differs.
It does not fail where you would look for it. Discovery and JWKS answer `200`,
`/authorize` renders the login form, the login POST returns a code — and
then:

```
HTTP/1.1 500 Internal Server Error
content-type: application/json; charset=utf-8

{"statusCode":500,"error":"Internal Server Error","message":"Unsupported state or unable to authenticate data"}
```

(That response is from a host run serving the realm the compose stack had
seeded, with the root `.env` holding a key generated for it rather than the
stack's.)

That is the private key failing to unwrap, and it names neither the key nor
the reason. Before seeding anything, copy the `ODUDU_KEK` line from
`infra/docker/.env` into the root `.env` if you intend to move between the
two. Changing the value afterwards strands every key already wrapped with
the old one — a realm seeded under one key cannot be served under another,
and there is no rotation path yet.

### A public client, with a user

A public client has no secret. It proves itself with PKCE alone, which is
what a browser or mobile application should be.

```bash
odudu seed \
  --realm demo --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
```

```json
{
  "created": true,
  "realm": "demo",
  "realmId": "01a09678-…",
  "clientId": "demo-spa",
  "userSubjectId": "01a09678-…"
}
```

(`realmId` and `userSubjectId` are generated identifiers; shortened here.
`userSubjectId` is present whenever `--user` names one, whether this run
created it or found it already seeded — [Address verification](#address-verification)
below is what it is for.)

`--redirect-uri` may be repeated. It is matched by exact string comparison
when a request arrives — no trailing-slash tolerance, no case folding, no
ignoring the query string, because every normalization widens what an
attacker can aim at. `--email` is optional; without it the `email` and
`email_verified` claims are omitted together rather than an empty address
being asserted with a verification status.

Seeding asserts a whole desired state, so a re-run with identical arguments
reports that it changed nothing:

```bash
odudu seed \
  --realm demo --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
```

```json
{
  "created": false,
  "realm": "demo",
  "realmId": "01a09678-…",
  "clientId": "demo-spa",
  "userSubjectId": "01a09678-…"
}
```

while a re-run that disagrees with what is stored refuses rather than
overwriting or silently ignoring the difference:

```bash
odudu seed \
  --realm demo --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password wrong-password --email ada@example.com
```

```
OduduError: user ada already exists with a different password
  code: 'seed_conflict'
```

(exit status 1; the Node stack trace between those two lines is elided.)

### A confidential client

A confidential client has a secret and is registered for exactly one way of
presenting it. `--token-endpoint-auth-method` picks that way; omitted, it is
`client_secret_basic`.

```bash
odudu seed \
  --realm demo --client demo-backend --client-secret demo-backend-secret \
  --token-endpoint-auth-method client_secret_basic \
  --redirect-uri http://localhost:8080/callback
```

```json
{ "created": true, "realm": "demo", "realmId": "01a09678-…", "clientId": "demo-backend" }
```

```bash
odudu seed \
  --realm demo --client demo-post --client-secret demo-post-secret \
  --token-endpoint-auth-method client_secret_post \
  --redirect-uri http://localhost:8080/callback
```

```json
{ "created": true, "realm": "demo", "realmId": "01a09678-…", "clientId": "demo-post" }
```

A confidential client is also given a service-account subject, which is what
makes `client_credentials` possible for it (Path C). A public client gets
none, and asking for that grant with one is refused.

The method is registered, not negotiated: `demo-post` must send its secret
in the body and `demo-backend` must send it in the `Authorization` header.
Each is refused if it uses the other's method, even with the right secret —
see the `/token` table in [The branches](#the-branches).

Both seed runs above create the realm's first signing key if it has none.
`--user` and `--password` go together or not at all, and `--email` needs a
user to belong to. Seeding never adds a user to a client that already
exists — it would exit 0 having done nothing, which is worse than refusing.

Two caveats on the command itself. `--client-secret` and `--password` are
plain command-line flags, so they land in `ps` output and shell history:
that is acceptable for a local bootstrap run by an operator who already
controls the machine, and is not something to carry into CI. And the seeded
values above are demonstration values in this document; choose your own.

### The shell variables the rest of this document uses

Every command below is a real command, and several need a value produced by
an earlier one — `$CODE`, `$VERIFIER`, `$ACCESS_TOKEN`. Paste this into the
shell you are working in and they are all defined. It is Path A, run
without a browser: the browser's only job in that flow is to follow a
redirect and submit a form, and `curl` does both.

```bash
BASE=http://localhost:3000/realms/demo/protocol/openid-connect
LOGIN=http://localhost:3000/realms/demo/login-actions/authenticate

VERIFIER=$(openssl rand -hex 32)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 \
  | openssl base64 | tr '+/' '-_' | tr -d '=')

AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid profile email' \
  --data-urlencode 'state=xyz-123' \
  --data-urlencode 'nonce=n-0S6_WzA2Mj' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "$BASE/auth" | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

CODE=$(curl -sS -D - -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  "$LOGIN" | sed -n 's/.*[?&]code=\([^&[:space:]]*\).*/\1/p' | tr -d '\r')

TOKENS=$(curl -sS \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode "code_verifier=$VERIFIER" "$BASE/token")

ACCESS_TOKEN=$(printf '%s' "$TOKENS" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
ID_TOKEN=$(printf '%s' "$TOKENS" | sed -n 's/.*"id_token":"\([^"]*\)".*/\1/p')
REFRESH_TOKEN=$(printf '%s' "$TOKENS" | sed -n 's/.*"refresh_token":"\([^"]*\)".*/\1/p')
```

Two things to know before reusing it. A `$CODE` is spent by the successful
redemption above and lives only 60 seconds anyway, so every experiment on
`/token` that needs an unspent one needs the first three blocks run again.
And `$AUTH_SESSION_ID` is consumed by a successful login, so the same goes
for experiments on the login form.

`infra/docker/smoke.sh` is the same sequence with assertions after each
step; read it if you would rather have something that fails loudly. It
brings the compose stack up and tears it down again, volumes included, so it
is the all-Docker way of running whichever one you picked above — and it
will take port 3000 and the stack's database with it.

### Dynamic client registration

`client_registration_policy` is `disabled` on every realm by default (ADR
0026). Registering before it is opened, or against a realm that does not
exist, answers the same way — an enumeration oracle costs nothing to close
here, the same reasoning discovery and JWKS already apply to a disabled
realm:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  http://localhost:3000/realms/reg-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"]}'
```

```
404
```

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  http://localhost:3000/realms/no-such-realm/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"]}'
```

```
404
```

Opening it is a realm setting like any other:

```bash
odudu seed realm --name reg-demo --set client_registration_policy=open
```

```json
{
  "command": "realm",
  "created": false,
  "realm": "reg-demo",
  "realmId": "01a0b605-…",
  "settings": ["client_registration_policy"]
}
```

Discovery now advertises the endpoint, and any request registers a client —
the `open` policy is RFC 7591 §3.1's anonymous case. The server assigns
`client_id`; a `client_secret` is generated for a confidential client (the
default — `token_endpoint_auth_method` defaults to `client_secret_basic`)
and returned **exactly once, in this response**. `clients.secret_hash`
stores its Argon2id hash; there is no way to retrieve the plaintext again.

```bash
curl -sS -X POST http://localhost:3000/realms/reg-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"],"client_name":"Example RP"}'
```

```json
{
  "client_id": "01a0b605-7708-…",
  "client_id_issued_at": 1789760206,
  "client_secret": "bvHXg71rJLarigim4vtlUMm5KwV9QmAmxDSx-Mfz76U",
  "client_secret_expires_at": 0,
  "redirect_uris": ["https://rp.example/cb"],
  "grant_types": ["authorization_code"],
  "token_endpoint_auth_method": "client_secret_basic",
  "client_name": "Example RP"
}
```

This registration presented no credential, so `registration_origin` is
`'anonymous'` and `consent_required` defaults `true` on the row it wrote
(ADR 0027) — an anonymous registrant is not the operator vouching for a
client the way `seed client` or a token-authorized registration is.

The `token` policy is stricter: a request with no bearer credential is
refused before anything is validated, with `WWW-Authenticate` naming the
scheme and no `error` parameter (RFC 6750 §3.1's distinction between an
absent credential and a rejected one).

```bash
odudu seed realm --name reg-demo --set client_registration_policy=token
```

```bash
curl -sS -D - -o /dev/null -X POST \
  http://localhost:3000/realms/reg-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' -d '{"redirect_uris":["https://rp.example/cb"]}' \
  | grep -iE '^HTTP|www-authenticate'
```

```
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer realm="client-registration"
```

`seed registration-token` mints the credential a registrant presents:
`--uses` bounds how many registrations it is good for, `--ttl` its lifetime
in seconds, and both are required since the schema has no default for
either. Every other seed subcommand answers with a line of JSON; this one
answers with the token alone, so `TOKEN=$(odudu seed registration-token …)`
captures exactly the credential and nothing else.

```bash
TOKEN=$(odudu seed registration-token --realm reg-demo --uses 1 --ttl 3600)
```

```
w0aDvT8i3ajvn00gKiCGMwHjeSujSS2LBbn0H_xRy6U
```

It is stored as its SHA-256 digest, the same shape
`packages/account/src/repository/action-tokens.ts` uses, and spent by one
`UPDATE … RETURNING`
(`packages/domain-realm/src/repository/client-registration-tokens.ts`) so
two concurrent registrations against a one-use token cannot both win —
answering the request and consuming the token happen in the one transaction
that inserts the client, never earlier. Presenting it registers a client
whose `registration_origin` is `'token'`, with `consent_required` defaulting
`false`: an initial access token is an operator's own authorization, as
much as `seed client` naming a client directly is.

```bash
curl -sS -X POST http://localhost:3000/realms/reg-demo/clients-registrations/openid-connect \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp2.example/cb"],"token_endpoint_auth_method":"none"}'
```

```json
{
  "client_id": "01a0b605-9e5d-…",
  "client_id_issued_at": 1789760216,
  "redirect_uris": ["https://rp2.example/cb"],
  "grant_types": ["authorization_code"],
  "token_endpoint_auth_method": "none"
}
```

`token_endpoint_auth_method: "none"` names a public client, so no secret is
generated or returned — RFC 6749 §10.1 gives no client that cannot keep one
confidential a credential to keep.

A realm at its `max_clients` cap refuses further registration with 403 and
`invalid_client_metadata`, taken under `SELECT … FOR UPDATE` on the realm
row before the count so two concurrent registrations cannot both observe
room that only one of them will actually get
(`packages/domain-realm/src/repository/clients.ts`'s `lockCapacity`,
exercised concurrently in
`packages/protocol-oidc/tests/client-registration.int.test.ts`).

A registered `backchannel_logout_uri` is stored, echoed back in the
registration response, and now read: discovery advertises
`backchannel_logout_supported` and its front-channel twin for every realm
(see [discovery](#1-discovery) above), and ending a session delivers to it
(see [front-channel and back-channel logout](#front-channel-and-back-channel-logout)
below). `userinfo_signed_response_alg` is stored and echoed the same way,
but `userinfo_signing_alg_values_supported` stays absent from discovery and
nothing signs a `/userinfo` response — that capability is still P3b's to
build.

A non-HTTP `redirect_uri` has to look like RFC 8252 §7.1's reverse-DNS
custom scheme (ADR 0032): the scheme names at least one `.`, which is what
tells `com.example.app:/cb` apart from `javascript:`, `data:` and `file:`
without an enumerable denylist of dangerous ones. A dotless custom scheme —
common in the wild, and otherwise harmless — is refused all the same:

```bash
curl -sS -X POST http://localhost:3000/realms/reg-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' -d '{"redirect_uris":["myapp://cb"]}'
```

```json
{
  "error": "invalid_redirect_uri",
  "error_description": "redirect_uris entry myapp://cb is not valid"
}
```

```bash
curl -sS -X POST http://localhost:3000/realms/reg-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' -d '{"redirect_uris":["com.example.app:/cb"]}'
```

```json
{
  "client_id": "01a0b707-…",
  "client_id_issued_at": 1789777116,
  "client_secret": "Iv4li0N-PWbQ0hno_SR04d6sEZnkxvUlI9RWaDYCW6k",
  "client_secret_expires_at": 0,
  "redirect_uris": ["com.example.app:/cb"],
  "grant_types": ["authorization_code"],
  "token_endpoint_auth_method": "client_secret_basic"
}
```

`frontchannel_logout_uri` gets the same https/absolute/no-fragment policy
`backchannel_logout_uri` already had — it is destined for an iframe `src`
once P3b renders it, the sink a bare `http:` or `javascript:` value would
otherwise reach:

```bash
curl -sS -X POST http://localhost:3000/realms/reg-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"],"frontchannel_logout_uri":"http://rp.example/fc"}'
```

```json
{
  "error": "invalid_client_metadata",
  "error_description": "frontchannel_logout_uri must be an absolute https URI with no fragment"
}
```

Front-Channel Logout 1.0 §2 also requires a registered `frontchannel_logout_uri`'s
domain, port and scheme to match one of the client's own `redirect_uris` —
an unauthenticated inbound surface is only as trustworthy as an origin the
client already proved it controls. Matching any one of several registered
redirect URIs satisfies it; a client with none registered has nothing to
match against and is refused the same way:

```bash
curl -sS -X POST http://localhost:3000/realms/reg-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"],"frontchannel_logout_uri":"https://evil.example/fc"}'
```

```json
{
  "error": "invalid_client_metadata",
  "error_description": "frontchannel_logout_uri must share its domain, port and scheme with a registered redirect_uri"
}
```

`frontchannel_logout_session_required` is accepted alongside it, stored and
echoed back the same way `backchannel_logout_session_required` already is,
defaulting to `false`:

```bash
curl -sS -X POST http://localhost:3000/realms/reg-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"],"frontchannel_logout_uri":"https://rp.example/fc","frontchannel_logout_session_required":true}'
```

```json
{
  "client_id": "01a0bbd5-5d46-…",
  "client_id_issued_at": 1789857717,
  "client_secret": "YkEhHefxvt6UTSiXLhdYVr3nPd42kK5R588HAqEai-Y",
  "client_secret_expires_at": 0,
  "redirect_uris": ["https://rp.example/cb"],
  "grant_types": ["authorization_code"],
  "token_endpoint_auth_method": "client_secret_basic",
  "frontchannel_logout_uri": "https://rp.example/fc",
  "frontchannel_logout_session_required": true
}
```

## Path A: authorization code with PKCE

The full interactive flow. Every client uses PKCE, public and confidential
alike, with no exception and no per-client opt-out (ADR 0016).

### 1. Discovery

```bash
curl -sS http://localhost:3000/realms/demo/.well-known/openid-configuration
```

```json
{
  "issuer": "http://localhost:3000/realms/demo",
  "authorization_endpoint": "http://localhost:3000/realms/demo/protocol/openid-connect/auth",
  "token_endpoint": "http://localhost:3000/realms/demo/protocol/openid-connect/token",
  "userinfo_endpoint": "http://localhost:3000/realms/demo/protocol/openid-connect/userinfo",
  "jwks_uri": "http://localhost:3000/realms/demo/protocol/openid-connect/certs",
  "end_session_endpoint": "http://localhost:3000/realms/demo/protocol/openid-connect/logout",
  "response_types_supported": ["code"],
  "response_modes_supported": ["query"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256", "ES256"],
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "none"],
  "authorization_response_iss_parameter_supported": true,
  "backchannel_logout_supported": true,
  "backchannel_logout_session_supported": true,
  "frontchannel_logout_supported": true,
  "frontchannel_logout_session_supported": true,
  "scopes_supported": [
    "address",
    "email",
    "groups",
    "offline_access",
    "openid",
    "phone",
    "profile",
    "roles"
  ],
  "claims_supported": [
    "sub",
    "name",
    "given_name",
    "family_name",
    "middle_name",
    "nickname",
    "preferred_username",
    "profile",
    "picture",
    "website",
    "gender",
    "birthdate",
    "zoneinfo",
    "locale",
    "updated_at",
    "email",
    "email_verified",
    "roles",
    "groups",
    "address",
    "phone_number",
    "phone_number_verified"
  ]
}
```

**What the client does next:** everything else in this document comes from
this document. `response_modes_supported` is stated rather than omitted
because omitting it would default to `["query", "fragment"]` (OIDC Discovery
§3) and promise a delivery mode `/authorize` refuses.
`code_challenge_methods_supported` lists `S256` and never `plain`.
`end_session_endpoint` is RP-Initiated Logout 1.0's own discovery member —
see [RP-initiated logout](#rp-initiated-logout) below. The four
`backchannel_logout_*` and `frontchannel_logout_*` members are fixed `true`
for every realm — see
[back-channel logout](#front-channel-and-back-channel-logout) below for what
reads them.

`scopes_supported` is the realm's own scope vocabulary, read from the
database rather than compiled in: these eight are what `odudu seed` gives a
new realm, and a realm that is given another scope advertises it here the
moment it exists. A scope is seeded only once a claim mapper can answer for
it, or — `offline_access`'s own exception — once it asks for a grant shape
rather than for data (see [offline access](#offline-access) below), so this
list never promises claims nothing returns.

Being advertised is only half of what `/authorize` needs, though — **a scope
is granted only when the realm defines it _and_ the client is assigned it**,
and either failure is `invalid_scope`. `odudu seed` assigns all eight to each
client it creates. The walk-through below asks for three of them — `openid`,
`profile` and `email` — which is why it is answered; `roles`, `groups`,
`address` and `phone` reach a token the same way, added to a request's
`scope` like any other.

The issuer is derived from the request, so it is `http://` on this
plain-HTTP local stack. A deployment terminates TLS in front of the server
and the issuer becomes `https://` — see
[What is not implemented](#what-is-not-implemented).

The public keys are a separate fetch, and are what a client verifies an ID
token against:

```bash
curl -sS http://localhost:3000/realms/demo/protocol/openid-connect/certs
```

```json
{
  "keys": [
    {
      "kty": "RSA",
      "n": "tLwjOBJotzhf9hx9_b1CYHgZHFQu…",
      "e": "AQAB",
      "kid": "01a0ae6a-1e60-…",
      "alg": "RS256",
      "use": "sig"
    }
  ]
}
```

(`n` and `kid` truncated.) `kid` is what a client matches against the `kid`
in a token's header; `alg` and `use` say which algorithm the key is for and
that it is a signature key rather than an encryption one. One realm has one
active key, so this array has one member.

### 2. `/authorize`

PKCE first — the client generates a verifier and derives the challenge:

```bash
VERIFIER=$(openssl rand -hex 32)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 \
  | openssl base64 | tr '+/' '-_' | tr -d '=')
```

Then the authorization request. A browser would follow a link; this is the
same request without one:

```bash
curl -sS -D - --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid profile email' \
  --data-urlencode 'state=xyz-123' \
  --data-urlencode 'nonce=n-0S6_WzA2Mj' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/auth'
```

```
HTTP/1.1 200 OK
content-type: text/html
content-length: 2369

<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in</title></head>
<body>
<form method="post" action="/realms/demo/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a09678-5455-…">
  <label>Username <input type="text" name="username" autocomplete="username"></label>
  <label>Password <input type="password" name="password" autocomplete="current-password"></label>
  <button type="submit">Sign in</button>
</form>
<form method="post" action="/realms/demo/login-actions/authenticate" id="passkey-form">
  <input type="hidden" name="auth_session_id" value="01a09678-5455-…">
  <input type="hidden" name="assertion" id="passkey-assertion">
  <button type="submit" id="passkey-submit">Sign in with a passkey</button>
</form>
<p id="passkey-error" hidden></p>
<noscript><p>Signing in with a passkey needs JavaScript, because only the browser can talk to your authenticator. Use your username and password above.</p></noscript>
<script nonce="Q2tArwm1PPmjG9DGWoq76g==">
const form = document.getElementById('passkey-form');
const field = document.getElementById('passkey-assertion');
const failure = document.getElementById('passkey-error');
const fromBase64Url = (value) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
form.addEventListener('submit', async (event) => {
  if (field.value !== '') return;
  event.preventDefault();
  failure.hidden = true;
  try {
    const offered = await fetch('/realms/demo/login-actions/passkey-challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ auth_session_id: form.auth_session_id.value }),
    });
    if (!offered.ok) throw new Error('this server is not offering passkeys');
    const options = await offered.json();
    const assertion = await navigator.credentials.get({
      publicKey: { ...options, challenge: fromBase64Url(options.challenge) },
    });
    field.value = JSON.stringify(assertion.toJSON());
    form.submit();
  } catch (caught) {
    failure.textContent =
      'Your device did not finish signing in — ' + (caught && caught.message ? caught.message : 'the request was cancelled') + '. You can try again.';
    failure.hidden = false;
  }
});
</script>
</body>
</html>
```

(`auth_session_id`, the script's `nonce`, and the `x-request-id` and `Date`
headers differ per run. The `Content-Security-Policy` and `X-Frame-Options`
headers are elided above and shown below.)

The second form is the passkey one, and it has no username field of its
own: see [Signing in with a passkey](#signing-in-with-a-passkey-and-no-username).
It appears only where `ODUDU_PUBLIC_BASE_URL` is set, and only beside the
password — a passkey is an alternative to a first factor, not to a code
asked for after one, so the code form further down carries no script and no
`script-src` with it.

The script is inline because only a script can reach an authenticator. This
page and the passkey enrolment page are the two whose policy is not
`default-src 'none'` alone (ADR 0018's amendment); this one also carries
`connect-src 'self'`, since its script fetches the challenge:

```
content-security-policy: default-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; script-src 'nonce-Q2tArwm1PPmjG9DGWoq76g=='; connect-src 'self'
```

That `nonce` is the one on the `<script>` element in the body above, minted
per response by whatever renders the page, so the header and the element
cannot name different values. `'unsafe-inline'` is deliberately absent: an
injected script on this page still runs nowhere. `connect-src 'self'` is
there for the one request the script makes — the passkey enrolment page,
which is handed its options inline and fetches nothing, is sent no
`connect-src` at all.

**What the client does next:** nothing. The user-agent is now on Odudu's own
page. The client waits at its redirect URI.

The hidden `auth_session_id` is the whole of this form's CSRF defence, and
it is also where the request is parked: the scope, `redirect_uri`, `state`,
`nonce` and `code_challenge` are stored server-side against it and read back
from there, never from the form submission. Resubmitting a wider scope or a
different redirect URI with the login POST changes nothing. The
authentication session lives 30 minutes.

`POST` is accepted at the same endpoint with the parameters form-encoded
(OIDC Core §3.1.2.1), and answers identically:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  --data 'response_type=code&client_id=demo-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&state=xyz-123&code_challenge=hUGit6EJl__NDqDG80Q49rMU-3qeOri8dH1TTe49hmI&code_challenge_method=S256' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/auth'
```

```
200
```

(The `code_challenge` shown is one run's value; any well-formed S256
challenge behaves the same.) Everything past "where do the parameters come
from" is one shared code path, so the two methods cannot drift apart.

### 3. The login POST

```bash
curl -sS -D - -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  'http://localhost:3000/realms/demo/login-actions/authenticate'
```

```
HTTP/1.1 302 Found
set-cookie: demo-session=01a09678-7150-…; HttpOnly; SameSite=Lax; Path=/
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: http://localhost:8080/callback?code=g7v4W3JWm05w…&state=xyz-123&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Fdemo
content-length: 0
```

(Session id and code truncated.)

Two `set-cookie` headers, not one: the ephemeral `demo-session` this login
just established, and `demo-session-persistent` cleared to empty with
`Max-Age=0` because this submission carried no `remember_me` field. Both
are always sent so a browser holding a stale persistent cookie from before
this pair existed loses it on the next login rather than carrying it
forward unnoticed. [A remembered login](#a-remembered-login) below shows
the other case.

Three things in that response:

- **`code`** — 32 random bytes, base64url. Only its SHA-256 hash is stored.
  It lives **60 seconds** and can be redeemed once.
- **`state`** — echoed back exactly as sent. The client compares it to what
  it sent and abandons the response if it differs.
- **`iss`** — RFC 9207 §2. The client checks it names the server it started
  with. Without it, a client talking to several providers cannot tell which
  one answered, which is the opening a mix-up attack needs.

The cookie is the SSO session, and it has two clocks rather than one: the
realm's `sso_session_idle_seconds` (default `1800`) from its last use, and
`sso_session_max_seconds` (default `36000`) from when it was established,
whichever comes first. It carries `Secure` and the `__Host-` prefix when the
server is told TLS terminates in front of it (`ODUDU_TLS=true`); on this
plain-HTTP stack it does not, and the name is `demo-session` rather than
`__Host-demo-session`. **`/authorize` reads it** — a second authorization
request from the same browser completes without the form, and `prompt`
decides whether that is allowed: see
[Signing in again from an existing session](#signing-in-again-from-an-existing-session).

**What the client does next:** verify `state` and `iss`, then redeem the
code. Immediately: it expires in a minute.

#### A remembered login

The login form renders a `remember_me` checkbox whenever the realm's
`remember_me_allowed` setting is on (off by default):

```
<input type="checkbox" name="remember_me" id="remember-me" value="true"> Remember me
```

`demo`'s setting was turned on for this run —
`odudu seed realm --name demo --set remember_me_allowed=true` — since it is
off for every other transcript in this document. Ticking the box and
submitting the same form puts the new session's id in the **persistent**
cookie instead:

```bash
curl -sS -D - -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  --data-urlencode 'remember_me=true' \
  'http://localhost:3000/realms/demo/login-actions/authenticate'
```

```
HTTP/1.1 302 Found
set-cookie: demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-session-persistent=01a0ba39-8997-…; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000
location: http://localhost:8080/callback?code=r5SsanuPHH-…&state=xyz-123&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Fdemo
content-length: 0
```

(Session id and code truncated.) The two cookies swap roles from the
ordinary case above: `demo-session` is now the one cleared with
`Max-Age=0`, and `demo-session-persistent` carries this session's id with
`Max-Age=2592000` — the realm's `remember_me_max_seconds` (default 30
days), not `sso_session_max_seconds`. The session this establishes is also
measured against a different idle window while it lives,
`remember_me_idle_seconds` (default 7 days) rather than
`sso_session_idle_seconds`.

**The realm setting is the authority, the field is only a request.** A
realm with `remember_me_allowed` off ignores `remember_me` outright: the
session it establishes lands in the ephemeral cookie exactly as the
ordinary transcript above shows, with the persistent cookie still sent but
cleared, `Max-Age=0` — ticking a box the login page never even offered
(since the checkbox itself is gated on the same setting) changes nothing.

### 4. `/token`

```bash
curl -sS -D - \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode "code_verifier=$VERIFIER" \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

```
HTTP/1.1 200 OK
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{
  "access_token": "eyJhbGciOiJSUzI1NiIs…",
  "id_token": "eyJhbGciOiJSUzI1NiIs…",
  "refresh_token": "oXh8ADRkl4m7eVdblQ3r…",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "openid profile email"
}
```

(All three token values truncated.)

`redirect_uri` must be the one the code was issued against and
`code_verifier` must hash to the challenge that was parked with it. A
public client sends `client_id` and no secret; a confidential client
authenticates as well, in the one way it is registered for.

The access token, decoded:

```json
{ "alg": "RS256", "kid": "01a0a6cd-e3c9-…", "typ": "at+jwt" }
{
  "iss": "http://localhost:3000/realms/demo",
  "sub": "01a0a6cd-e3cb-…",
  "aud": ["http://localhost:3000/realms/demo"],
  "client_id": "demo-spa",
  "scope": "openid profile email",
  "iat": 1789504919,
  "exp": 1789505219,
  "jti": "01a0a6ce-17ac-…",
  "sid": "01a0a6ce-1788-…"
}
```

`typ: at+jwt` (RFC 9068) is what stops an ID token being presented in its
place at `/userinfo`. The issuer is always in `aud`, added to whatever
resource audiences the client is configured for, because a token that
cannot be used at the issuer's own endpoints would be unusable for what
OIDC promised the client.

**A `resource` at `/token` narrows what the code already carries, and can
never widen it.** The same `resource` `/authorize` resolves and stores on
the code (see its own bullet under
[What is not implemented](#what-is-not-implemented)) is what `/token`
derives `aud` from — a `resource` on the token request itself may select
one value out of what the code carries, but naming one the code does not
carry refuses with `invalid_target` rather than being ignored, on a public
client with no secret to authenticate the request. `$CODE` above is
already spent by the successful redemption, so this needs a fresh one —
the first three blocks under
[The shell variables](#the-shell-variables-the-rest-of-this-document-uses),
run again with a distinct `state`/`nonce` so the two login forms are not
confused for one:

```bash
AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid profile email' \
  --data-urlencode 'state=xyz-124' \
  --data-urlencode 'nonce=n-0S6_WzA2Mk' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "$BASE/auth" | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

CODE=$(curl -sS -D - -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  "$LOGIN" | sed -n 's/.*[?&]code=\([^&[:space:]]*\).*/\1/p' | tr -d '\r')

curl -sS -w '\nHTTP %{http_code}\n' \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode "code_verifier=$VERIFIER" \
  --data-urlencode 'resource=https://reports.example' \
  "$BASE/token"
```

```
{"error":"invalid_target"}
HTTP 400
```

Redeeming `$CODE` above with the _same_ `resource` a second time, or
without minting a fresh one first, does not reproduce this: the code is
already single-use spent by then, and the answer is `invalid_grant`, not
`invalid_target` — the two are easy to conflate by output shape alone, and
only a fresh code isolates which one actually fired.

`demo-spa` has no registered `audiences` — every client seeded by this
document does not, `odudu seed` has no flag for one yet — so its code's
stored `resource` is `[]`, and no `resource` named at `/token` is ever
found in it; the ordinary redemption above, naming none, still succeeds
with `aud` the issuer alone, exactly as it did before this existed. A
client registered for at least one audience — `audiences`, set directly on
`client_oidc_config` today, since no seed flag or registration field
exposes it — would see `resource` narrow `aud` to that one value instead;
`packages/protocol-oidc/tests/resource-token.int.test.ts` is where that
case, and the refresh grant's own derivation, are exercised. The refresh
path narrows from the grant that the original redemption already
resolved, not from the client's current configuration, so a
narrowing made when the code was redeemed survives every later refresh; a
`resource` named on a refresh request itself narrows only that one
response and is not written back to the grant, so the refresh after it
returns to the grant's own (already-resolved) audience rather than
whatever the previous refresh asked for.

Requesting `profile` and `email` grants them (they are in `scope` above)
without putting `name`, `email` or `email_verified` on this token: an
access token goes to whatever's named in `aud`, not the browser, and
`client_scopes.include_in_access_token` defaults to `false` for
`openid`/`profile`/`email` for exactly that reason — the [`roles` section
below](#roles-once-a-scope-reaches-it) shows the symmetric flag that admits
`roles`/`groups` here by default instead.

The ID token, decoded:

```json
{ "alg": "RS256", "kid": "01a0a6cd-e3c9-…" }
{
  "sub": "01a0a6cd-e3cb-…",
  "name": "ada",
  "preferred_username": "ada",
  "email": "ada@example.com",
  "email_verified": false,
  "iss": "http://localhost:3000/realms/demo",
  "aud": "demo-spa",
  "iat": 1789504919,
  "exp": 1789505219,
  "auth_time": 1789504919,
  "nonce": "n-0S6_WzA2Mj",
  "sid": "01a0a6ce-1788-…",
  "amr": ["pwd"],
  "acr": "1"
}
```

The member order is the server's own and is worth not tidying: the claim
mappers write first and the registered claims are merged over them, so
`sub` and the profile claims precede `iss` in the encoded payload. JSON
member order carries no meaning to any client, but a transcript that
reorders it has stopped being the response that came back.

Its `aud` is the client, not the issuer: an ID token is a statement to the
client about who signed in, and an access token is a credential for an API.
`nonce` appears exactly when the request carried one, and the client must
compare it to what it sent. An ID token is issued only when the granted
scope includes `openid`. `amr` and `acr` describe what actually
authenticated this login — `pwd` (RFC 8176) and a single factor — never
what the subject could have used instead.

**What the client does next:** verify the ID token's signature against the
JWKS, its `iss`, `aud`, `exp` and `nonce`; take `sub` as the user's
identifier; keep the access token for API calls and the refresh token
somewhere it can be used once.

### `roles`, once a scope reaches it

RFC 9068 §2.2.3.1 names `roles` as an access token claim, and Odudu adds it
to the same registry that assembles the ID token and `/userinfo` — but only
for the roles a granted scope actually reaches. `odudu seed` now has
subcommands for the whole identity model this needs, run against the same
realm and user the [Bootstrap](#bootstrap) section above already seeded:

```bash
odudu seed role --realm demo --name reviewer
```

```json
{
  "command": "role",
  "realm": "demo",
  "realmId": "01a0a1a7-5917-7905-aed4-e278951d1acf",
  "roleId": "01a0a1a7-7121-7bc5-945f-723c237be90f",
  "name": "reviewer",
  "clientId": null
}
```

```bash
odudu seed grant-role --realm demo --username ada --role reviewer
odudu seed map-role --realm demo --scope roles --role reviewer
```

```json
{ "command": "grant-role", "realm": "demo", "realmId": "01a0a1a7-5917-7905-aed4-e278951d1acf", "username": "ada", "role": "reviewer" }
{ "command": "map-role", "realm": "demo", "realmId": "01a0a1a7-5917-7905-aed4-e278951d1acf", "scope": "roles", "role": "reviewer" }
```

That gives `ada` a `reviewer` role, mapped to the `roles` scope
`provisionRealmDefaults` already seeded for the realm — `demo-spa` already
carries `roles` among the default scopes `seed client` assigned it, so no
`assign-scope` call is needed here; see [`assign-scope` and `default` versus
`optional`](#assign-scope-and-default-versus-optional) below for when one
is. Requesting `scope=openid roles` instead of `scope=openid profile email`
and redeeming the code through Path A's usual steps produces an access
token that carries it:

```json
{
  "roles": ["reviewer"],
  "iss": "http://localhost:3000/realms/demo",
  "sub": "01a0a6cd-e3cb-…",
  "aud": ["http://localhost:3000/realms/demo"],
  "client_id": "demo-spa",
  "scope": "openid roles",
  "iat": 1789505061,
  "exp": 1789505361,
  "jti": "01a0a6d0-445f-…",
  "sid": "01a0a6d0-4425-…"
}
```

The ID token issued alongside it carries no `roles`, though the same
`reviewer` role reached the same scope:

```json
{
  "sub": "01a0a6cd-e3cb-…",
  "iss": "http://localhost:3000/realms/demo",
  "aud": "demo-spa",
  "iat": 1789505061,
  "exp": 1789505361,
  "auth_time": 1789505061,
  "nonce": "n-0S6_WzA2Mj",
  "sid": "01a0a6d0-4425-…",
  "amr": ["pwd"],
  "acr": "1"
}
```

`client_scopes.include_in_id_token` is what decides that, and the `roles`
and `groups` scopes ship with it off: an ID token reaches the browser, and a
full role list has no place there. The access token has the symmetric
`include_in_access_token` column, defaulting the other way: `true` for
`roles`/`groups`, `false` for `openid`/`profile`/`email` — see [the access
token in step 4](#4-token) for what that keeps off it. `/userinfo` reads
the same role gate as the access token, not the ID token's, so it returns
the role the access token carries it presented:

```bash
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
  http://localhost:3000/realms/demo/protocol/openid-connect/userinfo
```

```json
{ "sub": "01a0a6cd-e3cb-76de-badb-9191bba04d13", "roles": ["reviewer"] }
```

A role reaches a token only when it is mapped, this way, to a scope the
client is assigned — a role held but never mapped to any scope is left out
of the token entirely, and so is every role once `client_scope_roles` maps
nothing at all. The one way around the intersection is
`clients.full_scope_allowed`, which defaults to `false`: set it and a
client's tokens carry every role the subject holds, unfiltered.

### `assign-scope`, and `default` versus `optional`

A client-scoped role — one qualified as `clientId:roleName` — needs the
client it is scoped to seeded first, because `roles_client_fk`
(`packages/db/drizzle/0017_roles.sql`) is a real foreign key: a role naming
a client that does not exist cannot be inserted, let alone granted.

```bash
odudu seed client \
  --realm demo --client-id reports-api --client-secret reports-api-secret \
  --redirect-uri http://localhost:9000/cb
odudu seed role --realm demo --name reader --client-id reports-api
odudu seed grant-role --realm demo --username ada --role reports-api:reader
odudu seed map-role --realm demo --scope roles --role reports-api:reader
```

```json
{ "command": "client", "created": true, "realm": "demo", "realmId": "01a0a1a7-5917-7905-aed4-e278951d1acf", "clientId": "reports-api", "clientDbId": "01a0a1a8-5ef5-78ec-98b5-d4a76a9eb112" }
{ "command": "role", "realm": "demo", "realmId": "01a0a1a7-5917-7905-aed4-e278951d1acf", "roleId": "01a0a1a8-6128-7224-bb1f-817f9d6a29fa", "name": "reader", "clientId": "reports-api" }
{ "command": "grant-role", "realm": "demo", "realmId": "01a0a1a7-5917-7905-aed4-e278951d1acf", "username": "ada", "role": "reports-api:reader" }
{ "command": "map-role", "realm": "demo", "realmId": "01a0a1a7-5917-7905-aed4-e278951d1acf", "scope": "roles", "role": "reports-api:reader" }
```

A token requested with `scope=openid roles` for `demo-spa` now carries
`"roles": ["reports-api:reader", "reviewer"]` — the qualified name is
exactly `clientId:roleName`, which is unambiguous only because
`roles_name_has_no_colon` refuses a `:` inside a role name itself; naming a
role with two colons (`a:b:c`) is refused by `grant-role`/`map-role` rather
than guessed at, since the client half could not contain one either.

`seed client` assigns every realm-default scope — `roles` and `groups`
among them — to a client the moment it is created, with assignment kind
`default`. `seed assign-scope` exists for the scope a realm defines
_afterwards_ — a resource server's own `reports:read`, say — that a client
needs added explicitly:

```bash
odudu seed scope --realm demo --name reports:read
odudu seed assign-scope \
  --realm demo --client-id demo-spa --scope reports:read --assignment optional
```

```json
{ "command": "scope", "realm": "demo", "realmId": "01a0a1a7-5917-7905-aed4-e278951d1acf", "scopeId": "01a0a1a8-b176-71db-b143-86b395a7b439", "name": "reports:read" }
{ "command": "assign-scope", "realm": "demo", "realmId": "01a0a1a7-5917-7905-aed4-e278951d1acf", "clientId": "demo-spa", "scope": "reports:read", "assignment": "optional" }
```

`assign-scope` is safe to run against a scope a client already carries — it
narrows or widens the existing assignment rather than colliding with it,
which matters because every realm-default scope is already assigned by the
time a client exists to run it against.

**"I created a role and it is not in my token."** Three things gate it,
independently: the role must be granted to the subject (`grant-role`), the
role must be mapped to a scope (`map-role`), and the client must be assigned
that scope and the token request must actually include it (`scope=` at
`/authorize`, or `clients.full_scope_allowed`). Missing any one of the
three is indistinguishable from the outside — the claim is simply absent —
so when it is missing, check the three in that order rather than guessing
which one it was.

### Groups, and role inheritance

A role can also reach a token through a group rather than a direct grant.
`seed map-group-role` is the only path from the CLI to that: it maps a role
to a group the way `map-role` maps one to a client scope, and effective
role resolution then walks a subject's groups and their ancestors, not just
its direct assignments, in the same recursive CTE `groupRepository.mapRole`
was built for.

```bash
odudu seed group --realm demo --name engineering
odudu seed group --realm demo --name backend --parent /engineering
odudu seed join-group --realm demo --username ada --group /engineering/backend
odudu seed role --realm demo --name engineering-lead
odudu seed map-group-role --realm demo --group /engineering --role engineering-lead
odudu seed map-role --realm demo --scope roles --role engineering-lead
```

```json
{ "command": "group", "realm": "demo", "realmId": "01a0a215-1fbe-7b78-b0cc-ecd3b246658d", "groupId": "01a0a215-56ff-70be-ab80-652eabc3a340", "path": "/engineering" }
{ "command": "group", "realm": "demo", "realmId": "01a0a215-1fbe-7b78-b0cc-ecd3b246658d", "groupId": "01a0a215-5890-7110-b875-db31b1c6673c", "path": "/engineering/backend" }
{ "command": "join-group", "realm": "demo", "realmId": "01a0a215-1fbe-7b78-b0cc-ecd3b246658d", "username": "ada", "group": "/engineering/backend" }
{ "command": "role", "realm": "demo", "realmId": "01a0a215-1fbe-7b78-b0cc-ecd3b246658d", "roleId": "01a0a215-5b7b-7477-a72d-4237651a4f6e", "name": "engineering-lead", "clientId": null }
{ "command": "map-group-role", "realm": "demo", "realmId": "01a0a215-1fbe-7b78-b0cc-ecd3b246658d", "group": "/engineering", "role": "engineering-lead" }
{ "command": "map-role", "realm": "demo", "realmId": "01a0a215-1fbe-7b78-b0cc-ecd3b246658d", "scope": "roles", "role": "engineering-lead" }
```

`ada` is joined only to `/engineering/backend`, the _child_; the role is
mapped only to `/engineering`, the _parent_. Requesting `scope=openid roles
groups` and redeeming the code carries both `reviewer` (granted directly,
[above](#roles-once-a-scope-reaches-it)) and `engineering-lead` (reached
through the group) onto the same access token:

```json
{
  "roles": ["engineering-lead", "reviewer"],
  "groups": ["/engineering/backend"],
  "iss": "http://localhost:3000/realms/demo",
  "sub": "01a0a215-204a-75a9-b3b1-89bf08b1c76b",
  "aud": ["http://localhost:3000/realms/demo"],
  "client_id": "demo-spa",
  "scope": "openid roles groups",
  "iat": 1789425720,
  "exp": 1789426020,
  "jti": "01a0a215-9c86-…",
  "sid": "01a0a215-9c61-…"
}
```

`groups` carries only the paths a subject directly belongs to — `ada`'s
own membership is `/engineering/backend`, not `/engineering` too — but
`roles` carries what those memberships and their ancestors reach, which is
why `engineering-lead` appears even though nothing ever joined `ada` to
`/engineering` itself.

### 5. `/userinfo`

```bash
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
  http://localhost:3000/realms/demo/protocol/openid-connect/userinfo
```

```json
{
  "sub": "01a09678-07c1-…",
  "name": "ada",
  "preferred_username": "ada",
  "email": "ada@example.com",
  "email_verified": false
}
```

`POST` with the token as a form field works too, and answers 200 the same
way:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  --data-urlencode "access_token=$ACCESS_TOKEN" \
  http://localhost:3000/realms/demo/protocol/openid-connect/userinfo
```

```
200
```

The claims come from the same registry the ID token's claims came from, so
one can never carry a claim the other omits for the same subject and scope.
The client must check that `sub` here matches the ID token's `sub`.

## Path A, as a confidential client

Path A ran `demo-spa`, which is public. The other common deployment shape is
a server-side web application that holds a secret, and a reader who is
building one needs to see it walked rather than inferred.

It is the same journey. Discovery, `/authorize`, the login POST and
`/userinfo` are what Path A showed, with `client_id=demo-backend` in place of
`demo-spa` and nothing else changed — the same PKCE pair, the same login
form, the same authorization code. One hop differs: at `/token` the client
authenticates, in the one way it is registered for.

### PKCE is not a public-client concern here

A reader arriving from another provider will expect `code_challenge` to be
optional for a client that has a secret, and will leave it out. Most
providers make it a per-client setting; RFC 7636 introduced it for clients
that cannot keep a secret, and OpenID Connect Core does not ask for it at
all.

Odudu requires it of every client on every `authorization_code` request,
with no exception and no per-client opt-out, following OAuth 2.1
(`draft-ietf-oauth-v2-1-15` §4.1.1). That is not a small divergence: it is
the entire reason the OpenID Foundation's Basic OP certification plan cannot
pass here. Every module of that plan but its one dedicated PKCE module sends
an authorization request carrying no `code_challenge`, and Odudu refuses each
one — 28 of 35 modules, each failure individually confirmed to be this and
nothing else. [ADR 0016](adr/0016-mandatory-pkce-over-basic-op.md) records
the decision and what was given up for it.

Omitting the challenge does not fall back to proving yourself with the
secret instead. The request is refused at `/authorize`, before a secret
would ever be presented:

```bash
curl -sS -D - -o /dev/null --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-backend' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid profile email' \
  --data-urlencode 'state=xyz-123' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/auth'
```

```
HTTP/1.1 302 Found
location: http://localhost:8080/callback?error=invalid_request&state=xyz-123&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Fdemo
content-length: 0
```

The refusal travels back to the client as a redirect rather than a rendered
page because `client_id` and `redirect_uri` were both good — the boundary is
in [`/authorize`: the render-versus-redirect boundary](#authorize-the-render-versus-redirect-boundary).
`state` comes back so the client can match the answer to its request, and
`iss` (RFC 9207) so it can tell which issuer refused.

### Redeeming the code with `client_secret_basic`

`demo-backend` is registered for `client_secret_basic`, so the secret goes in
the `Authorization` header. `curl -u` builds it. There is no `client_id`
parameter: the header already names the client.

```bash
curl -sS -D - -u demo-backend:demo-backend-secret \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode "code_verifier=$VERIFIER" \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

```
HTTP/1.1 200 OK
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{
  "access_token": "eyJhbGciOiJSUzI1NiIs…",
  "id_token": "eyJhbGciOiJSUzI1NiIs…",
  "refresh_token": "P4dFlaaDHPJDK9sKMYF3…",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "openid profile email"
}
```

(All three token values truncated.) `$CODE` and `$VERIFIER` are the ones
[The shell variables the rest of this document uses](#the-shell-variables-the-rest-of-this-document-uses)
produces, with `client_id=demo-backend` substituted in the first two blocks.

The response is Path A's response, and so are the tokens inside it, except
where they name the client:

```json
{
  "iss": "http://localhost:3000/realms/demo",
  "sub": "01a0a6cd-e3cb-…",
  "aud": ["http://localhost:3000/realms/demo"],
  "client_id": "demo-backend",
  "scope": "openid profile email",
  "iat": 1789505125,
  "exp": 1789505425,
  "jti": "01a0a6d1-3d61-…",
  "sid": "01a0a6d1-3d1f-…"
}
```

```json
{
  "sub": "01a0a6cd-e3cb-…",
  "name": "ada",
  "preferred_username": "ada",
  "email": "ada@example.com",
  "email_verified": false,
  "iss": "http://localhost:3000/realms/demo",
  "aud": "demo-backend",
  "iat": 1789505125,
  "exp": 1789505425,
  "auth_time": 1789505125,
  "nonce": "n-0S6_WzA2Mj",
  "sid": "01a0a6d1-3d1f-…",
  "amr": ["pwd"],
  "acr": "1"
}
```

(`sub`, `kid` and `jti` shortened; the headers are as Path A's.) `sub` is
ada's, the same identifier `demo-spa` was given for her — a subject belongs
to the realm, not to the client that asked. The service-account subject a
confidential client also carries is a different one, and only
[`client_credentials`](#path-c-client_credentials) mints tokens for it.

**A refresh token, unlike `client_credentials`.** A user authenticated here
and is not going to stay at the keyboard, which is the situation refresh
exists for; it rotates exactly as [Path B](#path-b-refresh-rotation)
describes, with the client authenticating on each refresh as it did here.

### The same redemption with `client_secret_post`

`demo-post` is registered for `client_secret_post`, so the same two values go
in the form body instead, and `client_id` is sent because nothing else names
the client:

```bash
curl -sS -D - \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-post' \
  --data-urlencode 'client_secret=demo-post-secret' \
  --data-urlencode "code_verifier=$VERIFIER" \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

```
HTTP/1.1 200 OK
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{
  "access_token": "eyJhbGciOiJSUzI1NiIs…",
  "id_token": "eyJhbGciOiJSUzI1NiIs…",
  "refresh_token": "a730HWinJoMIqYtxVjr5…",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "openid profile email"
}
```

(Truncated as above. The tokens differ from the block before only in naming
`demo-post`.)

Which of the two a client may use is registered, not chosen per request, and
sending the other is `invalid_client` even with the right secret — the matrix
is in
[Client authentication is by the registered method and no other](#client-authentication-is-by-the-registered-method-and-no-other).

Presenting no secret at all is refused the same way. A confidential client
cannot redeem a code as though it were public, however good the code and the
verifier are:

```bash
curl -sS -D - \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-backend' \
  --data-urlencode "code_verifier=$VERIFIER" \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

```
HTTP/1.1 401 Unauthorized
www-authenticate: Basic realm="token"
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{"error":"invalid_client"}
```

**What the client does next:** what Path A's client does, with one
difference that matters operationally — the secret is held by the server, so
the access and refresh tokens never need to reach the browser at all. That
is the reason to be a confidential client.

### Address verification

`email_verified` is a stored claim, but until now nothing could set it
truthfully — every ID token and UserInfo response above for `ada` carries
`"email_verified": false`, and that is still real: nothing verifies an
address until this section. `GET /realms/{realm}/login-actions/action-token?key=…`
is the other half: consuming the link a verification email carries.
[Self-registration](#self-registration) below is one way to trigger that
mail, for an address that does not exist yet; `odudu seed
--send-verification-email` is the other, standing in for the admin
console's "Send verification email" action against a user who already
exists — `ada`, seeded back in [Bootstrap](#bootstrap). A realm's `verify_email` is turned on
with `seed realm --set`, the same way
[Self-registration](#self-registration) turns on the other two:

```bash
odudu seed realm --name demo --set verify_email=true
```

```
{"command":"realm","created":false,"realm":"demo","realmId":"01a0af71-71ad-7759-bf73-acaa420d812a","settings":["verify_email"]}
```

```bash
odudu seed \
  --realm demo --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com \
  --send-verification-email
```

The command queues the message and returns; nothing is sent on its way out.
The stack's own mail pass picks it up within
`ODUDU_OUTBOX_INTERVAL_SECONDS` ([Sending queued mail](#sending-queued-mail-odudu-send-mail)),
so the capture below appears in `docker compose logs odudu` a moment later
rather than in the seed command's own output. And with `ODUDU_SMTP_HOST`
unset — true of the compose stack and of every way this document runs the
server — nothing is actually delivered either: `capturingSender` logs the
message it would have sent, which is how a reader without a mail server
gets the link:

```json
{
  "level": 30,
  "to": "ada@example.com",
  "subject": "Verify your demo account",
  "text": "Confirm your email address for demo by visiting this link:\n\nhttp://localhost:3000/realms/demo/login-actions/action-token?key=FZDLhOiE8AXyz6zzuGlRy4OkoK7ihPSIBoicxqaMWVM\n\nIf you did not request this, you can ignore this message.",
  "html": "<p>Confirm your email address for demo by visiting <a href=\"…\">…</a>.</p><p>If you did not request this, you can ignore this message.</p>",
  "msg": "captured email — no SMTP host configured"
}
```

(One line of a larger pino JSON object, reduced to the fields that matter
here; the key is shortened nowhere else in this document because a reader
needs the whole thing to follow the link.)

Before following it, `ada`'s ID token still reads the way every one earlier
in this document does:

```json
{ "email": "ada@example.com", "email_verified": false }
```

Following the link once verifies it:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  'http://localhost:3000/realms/demo/login-actions/action-token?key=FZDLhOiE8AXyz6zzuGlRy4OkoK7ihPSIBoicxqaMWVM'
```

```
200
```

and a fresh ID token for `ada` now carries `"email_verified": true` —
nothing else about the token changes, since email and its verification
status are the only claims this touches:

```json
{ "email": "ada@example.com", "email_verified": true }
```

Following the same link again is refused — it was minted for one
redemption, and `action_tokens.consumed_at` is now set:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  'http://localhost:3000/realms/demo/login-actions/action-token?key=FZDLhOiE8AXyz6zzuGlRy4OkoK7ihPSIBoicxqaMWVM'
```

```
400
```

The same 400 answers a key that never existed, one presented to the wrong
realm, one past its 12-hour lifespan, or one whose address the user has
since changed — consumption compares the token's stored `email` against the
user's current one and refuses on any mismatch, so a verification cannot
outlive the address it was proving. None of those four are told apart in
the response: the page a browser lands on has no way to use the difference,
and telling a prober "this exact key existed" is a smaller leak than it
looks, but not one worth taking for free.

`--send-verification-email` needs `--email`, and needs the named user to
already exist — seeded in this same run or a previous one — or the command
refuses with `seed_invalid_options` before touching the database.

Every `ada` token or UserInfo response captured **above** this section in
this document was captured before this run — that is why they read `false`
and this section's own capture reads `true`: the account whose Bootstrap
this document shares was verified here, not earlier.

## Self-registration

`GET`/`POST /realms/{realm}/login-actions/registration` is the first way a
user reaches a realm without an administrator seeding them in. It answers
only when the realm's `registration_allowed` is on — off by default, like
`verify_email` and `reset_password_allowed` — so a realm serves nothing at
all here until an operator turns it on:

```bash
odudu seed \
  --realm register-demo --client register-spa \
  --redirect-uri http://localhost:8080/callback
curl -sS -o /dev/null -w '%{http_code}\n' \
  http://localhost:3000/realms/register-demo/login-actions/registration
```

```
404
```

Both settings this flow needs are realm settings, so one `seed realm --set`
turns them on — repeatable, and applied in one statement:

```bash
odudu seed realm --name register-demo \
  --set registration_allowed=true --set verify_email=true
```

```
{"command":"realm","created":false,"realm":"register-demo","realmId":"01a0b044-8f5b-74ec-b550-49e9292e0de9","settings":["registration_allowed","verify_email"]}
```

With both on, posting the form creates the account and, because
`verify_email` is on, sends a mail instead of leaving the address usable
right away:

```bash
curl -sS -X POST http://localhost:3000/realms/register-demo/login-actions/registration \
  --data-urlencode 'username=ada' \
  --data-urlencode 'email=ada@example.com' \
  --data-urlencode 'password=correct-horse-battery'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Account created</title></head>
<body>
<h1>Account created</h1>
<p>Check your email for a link to verify your address before you can sign in.</p>
</body>
</html>
```

The subject, the `users` row, the password credential and the realm's
default roles are all created in one transaction, and the `verify_email`
token is issued inside that same transaction — the mail goes out only after
it commits, the same ordering [Address verification](#address-verification)
establishes. With `ODUDU_SMTP_HOST` unset, the link lands in the container's
log instead of an inbox:

```json
{
  "level": 30,
  "to": "ada@example.com",
  "subject": "Verify your register-demo account",
  "text": "Confirm your email address for register-demo by visiting this link:\n\nhttp://localhost:3000/realms/register-demo/login-actions/action-token?key=T-KtGmS4CxncUMHktuxL4EVHtBzBQ7fDqL6NzVz05BA\n\nIf you did not request this, you can ignore this message.",
  "msg": "captured email — no SMTP host configured"
}
```

That link's host, `localhost:3000`, comes from `ODUDU_PUBLIC_BASE_URL`
(`compose.yaml` sets it to match the port published above) — never from the
request that reached the registration endpoint. A request's `Host` header
is client-controlled, and building a mailed link from it would let an
attacker who registers someone else's address choose where that link
points, capture the key when the victim (or a spam filter, or a link
preview) follows it, and verify an address they do not control against an
account they hold the password to. Posting the same form again with a
forged `Host` proves the header is ignored:

```bash
curl -sS -X POST http://localhost:3000/realms/register-demo/login-actions/registration \
  -H 'Host: evil.example' \
  --data-urlencode 'username=grace' \
  --data-urlencode 'email=grace@example.com' \
  --data-urlencode 'password=correct-horse-battery'
```

```json
{
  "level": 30,
  "to": "grace@example.com",
  "subject": "Verify your register-demo account",
  "text": "Confirm your email address for register-demo by visiting this link:\n\nhttp://localhost:3000/realms/register-demo/login-actions/action-token?key=PNY_QHSdYzzRHsHBUbRs2PtPZyo0JhIENMOAMdJ3q74\n\nIf you did not request this, you can ignore this message.",
  "msg": "captured email — no SMTP host configured"
}
```

Still `localhost:3000`, never `evil.example`. When `ODUDU_PUBLIC_BASE_URL`
is unset and a realm's `verify_email` is on, registration refuses outright
(500, logged as a misconfiguration) rather than falling back to the
request in any way.

**This is the property the whole account-lifecycle build exists for**: an
unverified self-registered address must not be able to complete a login, and
the assertion is that no code is issued, not that a page says something.
Requesting `/authorize` and submitting the login form with the password just
set answers 200, not the usual 302:

```bash
AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=register-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid email' \
  --data-urlencode 'state=xyz123' \
  --data-urlencode 'nonce=abc123' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  'http://localhost:3000/realms/register-demo/protocol/openid-connect/auth' \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

curl -sS -i -X POST http://localhost:3000/realms/register-demo/login-actions/authenticate \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
```

```
HTTP/1.1 200 OK
content-type: text/html

<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Verify your email</title></head>
<body>
<h1>Can't sign in yet</h1>
<p>You need to verify your email address before you can sign in. We sent a link to the address on this account — follow it, then sign in again.</p>
</body>
</html>
```

No `location` and no `set-cookie` header are on that response — nothing was
established and nothing was issued, which is the part a passing status code
alone could not prove. Following the mailed link, the same login now
completes:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  'http://localhost:3000/realms/register-demo/login-actions/action-token?key=T-KtGmS4CxncUMHktuxL4EVHtBzBQ7fDqL6NzVz05BA'
```

```
200
```

```bash
AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=register-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid email' \
  --data-urlencode 'state=xyz123' \
  --data-urlencode 'nonce=abc123' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  'http://localhost:3000/realms/register-demo/protocol/openid-connect/auth' \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

curl -sS -i -X POST http://localhost:3000/realms/register-demo/login-actions/authenticate \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
```

```
HTTP/1.1 302 Found
set-cookie: register-demo-session=01a0a14e-…; HttpOnly; SameSite=Lax; Path=/
set-cookie: register-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: http://localhost:8080/callback?code=tGYl5seSh4jl2tU7-0s2eXNgYDVBDrSjT72wXB_X0FQ&state=xyz123&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Fregister-demo
```

`users.email` is unique per realm, not globally — `email` alone would be a
tenancy bug — so a second registration for an address already held **in
this realm** is refused:

```bash
curl -sS -X POST http://localhost:3000/realms/register-demo/login-actions/registration \
  --data-urlencode 'username=carol' \
  --data-urlencode 'email=ada@example.com' \
  --data-urlencode 'password=another-password'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Can&#39;t create this account</title></head>
<body>
<h1>Can't create this account</h1>
<ul>
<li>That email address is already registered.</li>
</ul>
</body>
</html>
```

(400; the same address remains free to register again in a different realm,
since the uniqueness `packages/db/drizzle/0023_users_email_unique.sql` adds
is `(realm_id, email)`, not `email` alone.) A duplicate **username** and a
malformed address are both refused the same way — 400, with a message
naming which — rather than an unhandled error.

Every realm also carries a password policy, and registration is one of its
writers. The default policy only floors the length at 8, so a short
password is refused with every violation the candidate has, not just the
first:

```bash
curl -sS -X POST http://localhost:3000/realms/register-demo/login-actions/registration \
  --data-urlencode 'username=ada' \
  --data-urlencode 'email=ada@example.com' \
  --data-urlencode 'password=short'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Can&#39;t create this account</title></head>
<body>
<h1>Can't create this account</h1>
<ul>
<li>Password must be at least 8 characters long.</li>
</ul>
</body>
</html>
```

With `password_require_digit` and `password_require_uppercase` also turned
on for the realm, the same short password now lists all three:

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Can&#39;t create this account</title></head>
<body>
<h1>Can't create this account</h1>
<ul>
<li>Password must be at least 8 characters long.</li>
<li>Password must contain a digit.</li>
<li>Password must contain an uppercase letter.</li>
</ul>
</body>
</html>
```

`password_not_username` and `password_not_email` (both on by default)
refuse a password containing the account's own username, or the local part
of its email address, case-insensitively — matched independently, so a
password tripping both lists both:

```bash
curl -sS -X POST http://localhost:3000/realms/register-demo/login-actions/registration \
  --data-urlencode 'username=ada' \
  --data-urlencode 'email=ada@example.com' \
  --data-urlencode 'password=myADApassword'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Can&#39;t create this account</title></head>
<body>
<h1>Can't create this account</h1>
<ul>
<li>Password must not contain the username.</li>
<li>Password must not contain the email address.</li>
</ul>
</body>
</html>
```

A username and an email local part that differ show each rule on its own —
here `carol`'s password contains no part of her own username, but does
contain the local part of the email address given for the account:

```bash
curl -sS -X POST http://localhost:3000/realms/register-demo/login-actions/registration \
  --data-urlencode 'username=carol' \
  --data-urlencode 'email=ada@example.com' \
  --data-urlencode 'password=myADApassword'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Can&#39;t create this account</title></head>
<body>
<h1>Can't create this account</h1>
<ul>
<li>Password must not contain the email address.</li>
</ul>
</body>
</html>
```

400 in every case above; no subject, user row or credential is created.

A realm with `verify_email` off skips the mail and the gate above entirely:
the account created is usable at the next login, the same way a
seeded user always has been.

## Two-factor authentication with TOTP

A realm's `otp_required` decides whether every subject in it is expected to
hold a second factor. It is off by default, like the three account-lifecycle
settings above: a realm does not acquire a second factor because it was
upgraded. Off does not mean "no second factor" — a subject who has enrolled
one is always asked for it. What `otp_required` adds is everybody else: a
subject with no TOTP credential is given the `configure-totp` required
action at their next login, and the login does not complete until they have
enrolled.

Every command and response below was executed against the compose stack,
and the HTML bodies are the bytes it served: line breaks, indentation and
all. They were line-wrapped for readability until 2026-09-17, which turned
out to mean Prettier had been rewriting them — `<meta charset="utf-8">`
became `<meta charset="utf-8" />`, and the markup a reader saw was the
formatter's rather than the server's. A fenced response block carries no
language tag for that reason.

`otp_required` is a realm setting, which `seed realm --set` applies:

```bash
odudu seed \
  --realm otp-demo --client otp-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery
odudu seed realm --name otp-demo --set otp_required=true
```

```
{"created":true,"realm":"otp-demo","realmId":"01a0aa5f-…","clientId":"otp-spa","userSubjectId":"01a0aa5f-…"}
{"command":"realm","created":false,"realm":"otp-demo","realmId":"01a0b044-9629-7e64-8020-b7dd099afa39","settings":["otp_required"]}
```

`created` is `false` because the line above it made the realm: `seed realm`
resolves one or creates it, and `--set` then applies to whichever it found.
The settings are echoed as they were given.

### The password is right, and the login still does not finish

`/authorize` parks the request and renders the same password form
[Path A](#path-a-authorization-code-with-pkce) shows — nothing about a
second factor is decided before somebody has said who they are, because
which account a code belongs to is not knowable until then.

```bash
curl -sS 'http://localhost:3000/realms/otp-demo/protocol/openid-connect/auth?response_type=code&client_id=otp-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
```

The `auth_session_id` in that form — `01a0ae6e-d754-722b-832f-046df4afaf34`
in this run — is what every request below carries. Posting the correct
password answers 200 with an enrolment page rather than 302 with a code:
the password was accepted, and the pending action is what stops the login
from completing (no `set-cookie`, no `code`).

```bash
curl -sS -X POST http://localhost:3000/realms/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0ae6e-d754-722b-832f-046df4afaf34' \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Set up your authenticator</title></head>
<body>
<h1>Set up your authenticator</h1>
<p>Scan this with your authenticator app, or enter the key by hand.</p>
<svg …>…</svg>
<p><code>otpauth://totp/otp-demo:ada?secret=BKZJGOJBKZZKQTPLAUMI25NSOZW2XDXT&amp;issuer=otp-demo&amp;algorithm=SHA1&amp;digits=6&amp;period=30</code></p>
<p>Key: <code>BKZJGOJBKZZKQTPLAUMI25NSOZW2XDXT</code></p>
<form method="post" action="/realms/otp-demo/login-actions/required-action?action=configure-totp">
  <input type="hidden" name="auth_session_id" value="01a0ae6e-d754-722b-832f-046df4afaf34">
  <input type="hidden" name="secret" value="BKZJGOJBKZZKQTPLAUMI25NSOZW2XDXT">
  <label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
  <button type="submit">Confirm</button>
</form>
</body>
</html>
```

(the QR image is a 28 KB inline `<svg>`, elided here; it encodes the same
`otpauth://` URI printed underneath it, so an app with a camera and an app
without reach the same secret.)

The secret travels in a hidden field and **nothing is stored yet**. A
credential written before its first correct code would lock the account out
of its own second factor if the app never actually scanned it, so the
credential is created by the submission that proves a code, not by the page
that offers a secret. An abandoned enrolment leaves no row behind at all.

### Confirming the secret enrols it

```bash
curl -sS -X POST \
  'http://localhost:3000/realms/otp-demo/login-actions/required-action?action=configure-totp' \
  --data-urlencode 'auth_session_id=01a0ae6e-d754-722b-832f-046df4afaf34' \
  --data-urlencode 'secret=BKZJGOJBKZZKQTPLAUMI25NSOZW2XDXT' \
  --data-urlencode 'code=761342'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in</title></head>
<body>
<form method="post" action="/realms/otp-demo/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a0ae6e-d754-722b-832f-046df4afaf34">
  <label>Username <input type="text" name="username" autocomplete="username"></label>
  <label>Password <input type="password" name="password" autocomplete="current-password"></label>
  <button type="submit">Sign in</button>
</form>
<form method="post" action="/realms/otp-demo/login-actions/authenticate" id="passkey-form">
  <input type="hidden" name="auth_session_id" value="01a0ae6e-d754-722b-832f-046df4afaf34">
  <input type="hidden" name="assertion" id="passkey-assertion">
  <button type="submit" id="passkey-submit">Sign in with a passkey</button>
</form>
<p id="passkey-error" hidden></p>
<noscript><p>Signing in with a passkey needs JavaScript, because only the browser can talk to your authenticator. Use your username and password above.</p></noscript>
<script nonce="qT07bPZdP0HnQWKs2Fc/vw==">
const form = document.getElementById('passkey-form');
const field = document.getElementById('passkey-assertion');
const failure = document.getElementById('passkey-error');
const fromBase64Url = (value) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
form.addEventListener('submit', async (event) => {
  if (field.value !== '') return;
  event.preventDefault();
  failure.hidden = true;
  try {
    const offered = await fetch('/realms/otp-demo/login-actions/passkey-challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ auth_session_id: form.auth_session_id.value }),
    });
    if (!offered.ok) throw new Error('this server is not offering passkeys');
    const options = await offered.json();
    const assertion = await navigator.credentials.get({
      publicKey: { ...options, challenge: fromBase64Url(options.challenge) },
    });
    field.value = JSON.stringify(assertion.toJSON());
    form.submit();
  } catch (caught) {
    failure.textContent =
      'Your device did not finish signing in — ' + (caught && caught.message ? caught.message : 'the request was cancelled') + '. You can try again.';
    failure.hidden = false;
  }
});
</script>
</body>
</html>
```

The parked request survives the detour — same `auth_session_id` — and the
login form comes back, passkey button and all
([Signing in with a passkey](#signing-in-with-a-passkey-and-no-username));
the `nonce` differs per run. The password is asked for again because nothing
was
written down for it: a factor that finishes a login is deliberately not
recorded, so that a login refused after authentication (an `id_token_hint`
naming somebody else, an unverified address) cannot be retried with the
factor already ticked off.

This run generated its codes with the algorithm's own implementation rather
than a phone:

```bash
node --input-type=module -e "
import { totpCode, totpCounter } from './packages/crypto/src/service/totp.ts';
console.log(totpCode('BKZJGOJBKZZKQTPLAUMI25NSOZW2XDXT', totpCounter(new Date())));
"
```

```
761342
```

### The same password now answers with a code form

```bash
curl -sS -X POST http://localhost:3000/realms/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0ae6e-d754-722b-832f-046df4afaf34' \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in</title></head>
<body>
<form method="post" action="/realms/otp-demo/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a0ae6e-d754-722b-832f-046df4afaf34">
  <label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
  <label>Or a recovery code <input type="text" name="recovery_code" autocomplete="off"></label>
  <button type="submit">Sign in</button>
</form>
</body>
</html>
```

The second field is the way back in for somebody whose authenticator is
gone — [Recovery codes](#recovery-codes) below. It is beside the app's code
rather than behind a page of its own, because anybody reaching for it has
already lost what the first field asks for.

There is no username field on it. Which account the code is checked against
comes from the authentication session, which the password step bound to
ada; a code says which secret produced it, never who is signing in, so a
form that named the account would let a second factor answer for somebody
who never passed the first one.

Submitting the code that confirmed the enrolment does **not** work — it
answers with the same form again:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  http://localhost:3000/realms/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0ae6e-d754-722b-832f-046df4afaf34' \
  --data-urlencode 'code=761342'
```

```
200
```

RFC 6238 §5.2: a verifier must not accept an OTP twice. The credential
stores the time step of the last code it accepted, and the enrolment's own
code spent that step when it created the credential. The next one is
accepted — and the login still does not finish, because enrolling the
factor owed a recovery path for it:

```bash
curl -sS -i -X POST http://localhost:3000/realms/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0ae6e-d754-722b-832f-046df4afaf34' \
  --data-urlencode 'code=312444'
```

```
HTTP/1.1 200 OK
content-type: text/html
content-security-policy: default-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
content-length: 1077
```

That page is [Recovery codes](#recovery-codes), which is the rest of this
walkthrough. Acknowledging it puts the parked login back where it was —
waiting for a code, with the password it already accepted not asked for
again — and the next code finishes it:

```bash
curl -sS -i -X POST http://localhost:3000/realms/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0ae6e-d754-722b-832f-046df4afaf34' \
  --data-urlencode 'code=112990'
```

```
HTTP/1.1 302 Found
set-cookie: otp-demo-session=01a0ae70-c638-7675-9aee-f74d8702bdb7; HttpOnly; SameSite=Lax; Path=/
set-cookie: otp-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: http://localhost:8080/callback?code=n9kNA0HuUqyrNgWAOFiP9rmxsCr9beOHKx_6RYPZgqY&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Fotp-demo
```

### What two factors do to the ID token

```bash
curl -sS -X POST http://localhost:3000/realms/otp-demo/protocol/openid-connect/token \
  -d grant_type=authorization_code \
  -d code=n9kNA0HuUqyrNgWAOFiP9rmxsCr9beOHKx_6RYPZgqY \
  -d client_id=otp-spa \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  -d code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

The ID token's payload (decoded; `id_token` itself is the usual three
base64url segments):

```json
{
  "sub": "01a0ae6e-a7b2-7709-a51d-1704e4c07460",
  "iss": "http://localhost:3000/realms/otp-demo",
  "aud": "otp-spa",
  "iat": 1789633021,
  "exp": 1789633321,
  "auth_time": 1789633021,
  "sid": "01a0ae70-c638-7675-9aee-f74d8702bdb7",
  "amr": ["otp", "pwd"],
  "acr": "2"
}
```

`amr` names both factors, in RFC 8176's registry spellings rather than this
server's internal authenticator names, and `acr` is `"2"` — a statement
about this login, recorded on the session when it was established, not
re-derived at issuance from what the subject happens to have enrolled by
then.

## Recovery codes

Enrolling a second factor creates a way to be locked out: lose the phone and
the password alone no longer signs anybody in. So completing `configure-totp`
— or `configure-passkey` — adds the `generate-recovery-codes` required
action to a subject who holds no codes already, and that is the page the
walkthrough above landed on. A subject who _does_ already hold codes is not
asked again: a new factor does not invalidate a list they have saved, and
re-issuing would silently retire the copy on their paper.

Every command and response below was executed against the compose stack,
continuing the same `otp-demo` realm and the same `auth_session_id`.

### The one time the codes are shown

```bash
curl -sS -X POST http://localhost:3000/realms/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0ae6e-d754-722b-832f-046df4afaf34' \
  --data-urlencode 'code=312444'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Save your recovery codes</title></head>
<body>
<h1>Save your recovery codes</h1>
<p>Each of these signs you in once, in place of your second factor, if you lose it. <strong>This is the only time they are shown.</strong> Print them or put them in a password manager before you continue — nobody, including an administrator, can show them to you again.</p>
<ol>
  <li><code>YXZ6X-TDJNC</code></li>
  <li><code>B440Z-WSMPW</code></li>
  <li><code>J1Z5M-6BMKN</code></li>
  <li><code>KWNBQ-ZEDN2</code></li>
  <li><code>4SRQ7-B3J85</code></li>
  <li><code>WHM1Q-EP5VY</code></li>
  <li><code>PGVGV-D36JZ</code></li>
  <li><code>HKBDM-9SPV9</code></li>
  <li><code>CSW28-1W468</code></li>
  <li><code>ZWTGZ-5F6BB</code></li>
</ol>
<form method="post" action="/realms/otp-demo/login-actions/required-action?action=generate-recovery-codes">
  <input type="hidden" name="auth_session_id" value="01a0ae6e-d754-722b-832f-046df4afaf34">
  <button type="submit">I have saved these codes</button>
</form>
</body>
</html>
```

Ten characters each from Crockford's 32-character base32 alphabet, printed
as two groups of five: 32^10, which is 2^50 per code. The alphabet's
excluded letters — `I`, `L` and `O` — are the ones a reader confuses with
`1` and `0`, and a code typed with them is folded onto the digits rather
than refused (the replay below does exactly that).

**The page is not re-renderable, and that is the whole security property.**
What the database holds is one credential row per code, carrying an Argon2id
hash with the same parameters as a password — nothing anywhere holds the
plaintext, so no later page and no administrator can print these again:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT type, left(secret_data->>'hash', 30) AS hash_prefix,
          secret_data->>'usedAt' AS used_at
     FROM user_credentials WHERE type = 'recovery-code' LIMIT 3;"
```

```
     type      |          hash_prefix           | used_at
---------------+--------------------------------+---------
 recovery-code | $argon2id$v=19$m=19456,t=2,p=1 |
 recovery-code | $argon2id$v=19$m=19456,t=2,p=1 |
 recovery-code | $argon2id$v=19$m=19456,t=2,p=1 |
(3 rows)
```

Reloading the page is therefore not a way to see them twice: the render is a
`POST` result, and repeating it issues a _different_ ten and retires the set
it just displayed. Whatever was on the screen the first time is gone either
way.

That reload is not free, and the cost is worth naming: each one is ten
Argon2id hashes (about 40 ms, run together), a delete and ten inserts, and it
is repeatable for as long as the action is owed by anybody holding a valid
password for the account. It is bounded — a password gets past the first
factor, and acknowledging the page ends it — but it is a heavier multiplier
than verification's, and the per-account lockout does not reach it: that
counts failures, and this path needs a password that works
([what is not implemented](#what-is-not-implemented)). Re-serving the same
set instead would cost less and be worse: a second render of a live secret
is the one thing this page must not do.

The acknowledgement carries no code back — only the session id. It says the
page was read, and it is what completes the action:

```bash
curl -sS -X POST \
  'http://localhost:3000/realms/otp-demo/login-actions/required-action?action=generate-recovery-codes' \
  --data-urlencode 'auth_session_id=01a0ae6e-d754-722b-832f-046df4afaf34'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in</title></head>
<body>
<form method="post" action="/realms/otp-demo/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a0ae6e-d754-722b-832f-046df4afaf34">
  <label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
  <label>Or a recovery code <input type="text" name="recovery_code" autocomplete="off"></label>
  <button type="submit">Sign in</button>
</form>
</body>
</html>
```

The password is not asked for again, unlike the return from the TOTP
enrolment page above: that enrolment finished the login's first factor and a
factor that finishes a login is not written down, whereas here the password
had a second factor after it and therefore was.

### Signing in with one, in place of the second factor

A fresh attempt, and this time the authenticator is gone. The request is
parked and the password form rendered exactly as
[Path A](#path-a-authorization-code-with-pkce) shows, for a new
`auth_session_id`:

```bash
curl -sS 'http://localhost:3000/realms/otp-demo/protocol/openid-connect/auth?response_type=code&client_id=otp-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256' \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}'
```

```
01a0ae70-fed7-700e-bff3-7d7640225cf1
```

The password step runs as always, and answers with the code form — the same
two fields, because nothing about this submission says the authenticator is
gone:

```bash
curl -sS -X POST http://localhost:3000/realms/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0ae70-fed7-700e-bff3-7d7640225cf1' \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in</title></head>
<body>
<form method="post" action="/realms/otp-demo/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a0ae70-fed7-700e-bff3-7d7640225cf1">
  <label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
  <label>Or a recovery code <input type="text" name="recovery_code" autocomplete="off"></label>
  <button type="submit">Sign in</button>
</form>
</body>
</html>
```

The second field is what gets filled:

```bash
curl -sS -i -X POST http://localhost:3000/realms/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0ae70-fed7-700e-bff3-7d7640225cf1' \
  --data-urlencode 'recovery_code=YXZ6X-TDJNC'
```

```
HTTP/1.1 302 Found
set-cookie: otp-demo-session=01a0ae70-ff5f-784a-8a6a-adf79abfba55; HttpOnly; SameSite=Lax; Path=/
set-cookie: otp-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: http://localhost:8080/callback?code=OUzqSEyTjeest7rUe87XGaCgFBYYNy4oEFVgqhkZ_gw&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Fotp-demo
```

The same success a password-and-code login gets: a session cookie and a code
on the redirect. No code from the app was ever submitted, and the login was
not asked for one — the OTP step stands down for the rest of an attempt that
presented a recovery code, since somebody who reached for the list cannot
then produce a code from the authenticator they lost.

The ID token says less about this login than the two-factor one above:

```json
{
  "sub": "01a0ae6e-a7b2-7709-a51d-1704e4c07460",
  "iss": "http://localhost:3000/realms/otp-demo",
  "aud": "otp-spa",
  "iat": 1789633036,
  "exp": 1789633336,
  "auth_time": 1789633036,
  "sid": "01a0ae70-ff5f-784a-8a6a-adf79abfba55",
  "amr": ["pwd"],
  "acr": "2"
}
```

`acr` is `"2"` — two factors ran — and `amr` names only one of them.
Deliberately: RFC 8176's registry has no value that describes a
pre-generated code off a printed list, and reporting it as `otp` would
mislead a relying party that reads that value as a live generator. The
reading note in [docs/protocols/oidc-core.md](protocols/oidc-core.md) has
the full argument, including why an omission is recoverable where a
mislabelling is not.

### The same code again is refused _as_ a used code

A third attempt, opened the same way as the one above — a `/authorize` that
parks the request, then the password, which answers 200 with the code form.
Both were run; only the session id differs from the two responses just
shown, so they are not repeated here.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  http://localhost:3000/realms/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0ae71-2606-741c-a5f2-57a2281c49b1' \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
```

```
200
```

Then the code that already signed somebody in — typed in lower case with a
space where the hyphen was:

```bash
curl -sS -X POST http://localhost:3000/realms/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0ae71-2606-741c-a5f2-57a2281c49b1' \
  --data-urlencode 'recovery_code=yxz6x tdjnc'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in</title></head>
<body>
<p><strong>You have already used that recovery code. Try another one from your list.</strong></p>
<form method="post" action="/realms/otp-demo/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a0ae71-2606-741c-a5f2-57a2281c49b1">
  <label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
  <label>Or a recovery code <input type="text" name="recovery_code" autocomplete="off"></label>
  <button type="submit">Sign in</button>
</form>
</body>
</html>
```

Two things in one response. The code was typed in lower case with a space
where the hyphen was, and it was still recognised as the same code —
normalisation folds case, drops anything outside the alphabet, and maps the
confusable letters onto digits. And the refusal _says_ the code is spent,
which a wrong code does not:

```bash
curl -sS -X POST http://localhost:3000/realms/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0ae71-2606-741c-a5f2-57a2281c49b1' \
  --data-urlencode 'recovery_code=ZZZZZ-ZZZZZ'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in</title></head>
<body>
<form method="post" action="/realms/otp-demo/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a0ae71-2606-741c-a5f2-57a2281c49b1">
  <label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
  <label>Or a recovery code <input type="text" name="recovery_code" autocomplete="off"></label>
  <button type="submit">Sign in</button>
</form>
</body>
</html>
```

The same form, and no message: which codes a list holds is not something a
wrong guess gets told. The distinction is safe in the other direction
because a recovery code is a _second_ factor — by the time one is presented
the attempt is already bound to a subject, so "you have used that one"
tells that subject about their own credential and nobody else anything at
all. It is also the difference between trying the next code and concluding
the whole list is worthless.

What makes the refusal possible is that the row survives its use, marked
rather than deleted:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT count(*) AS codes, count(secret_data->>'usedAt') AS spent
     FROM user_credentials WHERE type = 'recovery-code';"
```

```
 codes | spent
-------+-------
    10 |     1
(1 row)
```

Ten rows, one spent, nine still usable. Spending one is a single conditional
`UPDATE` — it sets `usedAt` only where no `usedAt` is set — so two
submissions racing the same code serialize on the row and exactly one of
them signs in; the other is refused, because a read-then-write pair is how
both would succeed.

### The last code, and the set that replaces it

A list that runs out is the lockout recovery codes exist to prevent, so
spending the last one owes `generate-recovery-codes` again — in the login
that spent it, not the next one. The section below was captured against a
realm of its own, `rc8-demo`, with a fresh set of ten spent one login at a
time; the numbers above belong to `otp-demo` and are untouched by it.

The ninth code signs in the way every earlier one did, with one still
unspent behind it:

```bash
curl -sS -i -X POST http://localhost:3000/realms/rc8-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0affe-4505-72fb-af5d-801eec7c84a7' \
  --data-urlencode 'recovery_code=D5DPE-F80P0'
```

```
HTTP/1.1 302 Found
set-cookie: rc8-demo-session=01a0affe-4593-74f9-8f9f-47a787713750; HttpOnly; SameSite=Lax; Path=/
set-cookie: rc8-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: http://localhost:8080/callback?code=nUko6-JCypR4FzMWkdnBJybv3iTYZU-cnYKrArKSEVk&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Frc8-demo
content-length: 0
```

The tenth authenticates just as well, and does not redirect:

```bash
curl -sS -i -X POST http://localhost:3000/realms/rc8-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0affe-bd14-7674-b020-ec82770e9521' \
  --data-urlencode 'recovery_code=V79VD-MDVJ3'
```

The codes themselves are elided here — the set shown above is the one this
document prints, and `tests/docs/recovery-codes.test.ts` holds it to exactly
one:

```
HTTP/1.1 200 OK
content-type: text/html
content-security-policy: default-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
content-length: 1165

<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Save your recovery codes</title></head>
<body>
<h1>Save your recovery codes</h1>
<p>Each of these signs you in once, in place of your second factor, if you lose it. <strong>This is the only time they are shown.</strong> Print them or put them in a password manager before you continue — nobody, including an administrator, can show them to you again.</p>
<p>These replace the codes issued to this account before now, which no longer work.</p>
<ol>
  …ten of them…
</ol>
<form method="post" action="/realms/rc8-demo/login-actions/required-action?action=generate-recovery-codes">
  <input type="hidden" name="auth_session_id" value="01a0affe-bd14-7674-b020-ec82770e9521">
  <button type="submit">I have saved these codes</button>
</form>
</body>
</html>
```

It is the same page the enrolment showed, carrying the extra line it renders
when it is replacing a set rather than issuing a first one. Acknowledging it
finishes the login, exactly as it did there.

What the two responses did to the account, read either side of the last
code:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT count(*) FILTER (WHERE secret_data->>'usedAt' IS NULL) AS unspent
     FROM user_credentials
    WHERE type = 'recovery-code'
      AND realm_id = (SELECT id FROM realms WHERE name = 'rc8-demo');"
```

After the ninth that is `1`, and the login redirected. After the tenth it is
`10` — the page had already issued the replacement set by the time the query
ran — and `user_required_actions` holds `generate-recovery-codes` until the
acknowledgement clears it.

The guard behind this counts **unspent** rows rather than rows, and that
distinction is the whole of it. Spent codes are kept so a replay can be
refused as spent, so a subject who has used all ten still holds ten: a guard
reading the row count finds them provided for and owes nothing, which is a
locked-out account with no page to show it. Keycloak re-presents its own
setup at the same moment, for the same reason.

Two ways out that this does not provide, both needing a page this server does
not have yet: asking for a fresh set _before_ running out, and a warning as
the list gets short. Both are the account console, which is **P4**'s.

### Where the step sits in the flow

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT index, authenticator, requirement FROM authentication_executions e
     JOIN realms r ON r.id = e.realm_id WHERE r.name = 'otp-demo' ORDER BY index;"
```

```
 index | authenticator | requirement
-------+---------------+-------------
     0 | passkey       | alternative
     1 | password      | alternative
     2 | otp           | conditional
     3 | recovery-code | conditional
(4 rows)
```

Last, and conditional. It is applicable only to a submission that actually
carries a code, which is what keeps it out of the way of the OTP step it
substitutes for rather than competing with it — the same shape as the
passkey step, which is applicable only to a submission carrying an
assertion. A realm provisioned before this step existed gets the row from
migration `0040_recovery_code_execution.sql`, appended so no realm's
existing indexes shift.

## Enrolling a passkey

`POST /realms/{realm}/login-actions/required-action?action=configure-passkey`
enrols a WebAuthn credential for the subject the authentication session is
bound to, the same way the `configure-totp` submission above enrols a TOTP
one. Nothing yet asks for the action on its own — there is no realm switch
for passkeys, the way `otp_required` exists for TOTP — so it becomes pending
only when something adds it (today: a row in `user_required_actions`).
Signing in _with_ the credential this enrols is
[Signing in with a passkey](#signing-in-with-a-passkey-and-no-username).

**No transcript here was executed, and this document does not show output
for it.** Every other command in this file was run against a running stack;
this one cannot be. A registration response can only be produced by
`navigator.credentials.create()` inside a browser, talking to a real
authenticator or a virtual one in the browser's own devtools — `curl` cannot
sign an attestation, and inventing a response body would make this section a
claim dressed as evidence. What is verified instead is
`packages/authn-flows/tests/passkey-enrolment.int.test.ts`, which drives the
enrolment against real PostgreSQL with a software authenticator producing
`none`-format attestations, and checks the stored credential, the challenge
being spent, and each refusal below.

What the flow is, stated rather than shown:

1. A login that discovers `configure-passkey` pending renders the enrolment
   page. The page carries the creation options the server generated —
   relying party, user handle, challenge, and the ids of any passkeys this
   subject already has, so the browser steers them to a different
   authenticator rather than replacing one.
2. **The challenge is on the authentication session, not in the page's
   form.** The response gives back a challenge of its own choosing; only the
   server's copy decides anything.
3. The page posts the response JSON back in the `credential` field, with
   `auth_session_id` and an optional `label`.
4. The server reads and clears the challenge in one statement, verifies the
   response against it with `@simplewebauthn/server`, and only then writes
   the credential: `lookup_key` is the credential id, and `secret_data`
   holds the COSE public key, the authenticator's signature counter at
   registration, and its transports. The `configure-passkey` action is
   cleared last, so a refused ceremony leaves it owed.
5. The page's script is inline, because only a script can reach an
   authenticator. The response's `Content-Security-Policy` names a
   per-response `nonce` and that script carries it — not `unsafe-inline`, so
   an injected script on this page still runs nowhere. No `connect-src`:
   this page is handed its options inline and fetches nothing, unlike the
   login page's passkey script.

Refused, each for its own reason:

- A response replayed after a successful enrolment — the challenge it
  answered no longer exists, so there is nothing for it to match.
- A response answering a challenge this server never issued.
- A response produced against another relying party or origin.
- A submission for an action the subject does not owe **next**: the
  required-action route refuses any action that is not the head of their
  pending set in the order `update-password`, `configure-totp`,
  `configure-passkey`, `generate-recovery-codes`, whatever the form says.
- A submission against a session whose authentication has not finished — a
  password passed and a second factor still outstanding — or one already
  spent on a sign-in. A required action blocks a login's completion, not its
  factors.
- Any enrolment at all on a deployment with no `ODUDU_PUBLIC_BASE_URL`. The
  relying party id comes from that value and nowhere else, and the page
  reports the action as one that cannot be completed rather than binding a
  credential to a guessed domain. With `NODE_ENV=production` the server
  refuses to boot in that state.

## Signing in with a passkey, and no username

An enrolled passkey is a first factor on its own. The login page offers it
beside the password fields, and pressing it asks for nothing typed:

```
<form method="post" action="/realms/demo/login-actions/authenticate" id="passkey-form">
  <input type="hidden" name="auth_session_id" value="01a0ae6a-b69a-…">
  <input type="hidden" name="assertion" id="passkey-assertion">
  <button type="submit" id="passkey-submit">Sign in with a passkey</button>
</form>
<p id="passkey-error" hidden></p>
<noscript><p>Signing in with a passkey needs JavaScript, because only the browser can talk to your authenticator. Use your username and password above.</p></noscript>
```

That button is on the `/authorize` response shown in
[`/authorize`](#2-authorize) — it is part of the same page
as the username and password, so a realm offers both and the person chooses.
It is rendered only where `ODUDU_PUBLIC_BASE_URL` is set; without it there
is no relying party id and nothing behind the button, so there is no button.

The `<noscript>` is not decoration. The `assertion` field is empty until a
script fills it, and a browser with JavaScript off can still press that
button — so an empty field is treated as **no attempt at all** rather than a
failed one, and the login falls through to the password exactly as if the
button had not been pressed. Reading it as an attempt would hand the
ALTERNATIVE group to a factor nobody could satisfy.

**No transcript here was executed, and this document does not show output
for it.** The same limit applies as to
[Enrolling a passkey](#enrolling-a-passkey), for the same reason: only
`navigator.credentials.get()` inside a browser, talking to an authenticator,
can produce an assertion — `curl` cannot sign one, and inventing a response
body would make this section a claim dressed as evidence. What is verified
instead is `packages/authn-flows/tests/passkey-login.int.test.ts`, which
drives the whole journey against real PostgreSQL with a software
authenticator producing real ES256 assertions, and checks each step and each
refusal below. The steps are that test's steps, and the server-side
behaviour is what it asserts.

What the flow is, stated rather than shown:

1. The page posts `auth_session_id` to `POST
/realms/{realm}/login-actions/passkey-challenge` and gets request options
   back as JSON. They carry a challenge and **no `allowCredentials`**, which
   is what tells the browser to offer every discoverable credential it holds
   rather than a list the server would have needed a username to build.
2. **The challenge is on the authentication session, not in the page.** It
   is issued per press rather than with the page, so a form left open
   overnight still gets a live one, and a rejected attempt can try again
   with no re-render.
3. The page posts the assertion JSON back to
   `/realms/{realm}/login-actions/authenticate` in an `assertion` field,
   with the same `auth_session_id` — the same endpoint the password uses.
4. **Who is signing in comes from the assertion, before anything is
   verified.** The credential id it carries is what enrolment stored as
   `lookup_key`, and reading that back is realm-scoped by RLS, so a
   credential from another realm resolves to nothing rather than to somebody
   else's subject. Resolution has to come first because verification needs
   the stored public key and counter as inputs.
5. The server reads and clears the challenge in one statement, then verifies
   the assertion against it — origin, relying party id, signature, and the
   authenticator's user-verified flag, which is required rather than
   preferred.
6. The signature counter must have advanced past the stored one, or the
   credential is answering from two places at once. The write is a
   compare-and-swap, so two assertions replaying one counter value cannot
   both pass, and it happens only after the login is confirmed to be for the
   subject this attempt is already bound to.
7. The session records `passkey` alone, and the ID token says `amr: ["hwk",
"user"]`, `acr: "2"`. **A realm with `otp_required` on does not ask for a
   code after a passkey, and does not make the subject enrol one either** —
   enrolment demands a discoverable credential with user verification, so an
   assertion is possession of a key plus a check of who held it. That is two
   factors, and `otp_required` is a floor rather than a tax.

Refused, each for its own reason:

- An assertion whose counter did not increase. One that reports zero from a
  credential whose stored counter is also zero **is** accepted: WebAuthn
  §6.1.1 permits an authenticator that never counts, and refusing it would
  refuse a conformant device rather than catch a clone.
- An assertion replayed after a successful login — the challenge it answered
  was cleared by the statement that read it, so there is nothing left to
  verify against.
- An assertion for a credential enrolled in another realm.
- An assertion the authenticator did not verify anybody for.
- An assertion whose credential id names nothing in this realm, which
  answers exactly as a wrong password does: `invalid_credentials`.

## Password reset

`GET`/`POST /realms/{realm}/login-actions/reset-password` is the third
account-lifecycle setting, `reset_password_allowed` — off by default, like
`registration_allowed` and `verify_email` — so a realm serves nothing here
until an operator turns it on:

```bash
odudu seed \
  --realm reset-off-demo --client reset-off-spa \
  --redirect-uri http://localhost:8080/callback
curl -sS -o /dev/null -w '%{http_code}\n' \
  http://localhost:3000/realms/reset-off-demo/login-actions/reset-password
```

```
404
```

A separate realm has it on, and a user seeded to reset:

```bash
odudu seed \
  --realm reset-demo --client reset-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
```

The third account-lifecycle setting, turned on the same way as the other two:

```bash
odudu seed realm --name reset-demo --set reset_password_allowed=true
```

```
{"command":"realm","created":false,"realm":"reset-demo","realmId":"01a0b044-9968-7dec-ab3b-7141bb9595a0","settings":["reset_password_allowed"]}
```

The token a request mints is valid for five minutes
(`RESET_PASSWORD_TTL_SECONDS`, `packages/account/src/usecase/verify-email.ts`
— Keycloak's own default for a password-reset action token, chosen because
the window it opens is an account-takeover window). Run the rest of this
section within that window, or the link expires and every `curl` past that
point answers `400` for a different reason than the ones named here.

**This is the property the whole flow exists for**: the response to a
request naming an address that has an account and one naming an address
that does not must be indistinguishable — same status, same body — while
mail goes out only for the one that exists. Requesting both proves it:

```bash
curl -sS -X POST http://localhost:3000/realms/reset-demo/login-actions/reset-password \
  --data-urlencode 'email=ada@example.com'
echo
curl -sS -X POST http://localhost:3000/realms/reset-demo/login-actions/reset-password \
  --data-urlencode 'email=nobody@example.com'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Check your email</title></head>
<body>
<h1>Check your email</h1>
<p>If that address has an account, we've sent a link to reset its password.</p>
</body>
</html>
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Check your email</title></head>
<body>
<h1>Check your email</h1>
<p>If that address has an account, we've sent a link to reset its password.</p>
</body>
</html>
```

Identical, character for character — and in the same time, which is the
half of this property that the response body cannot carry. Neither request
waits for a mail server: the one that matched an address queued its message
in the transaction that minted the token and answered, so the difference
between the two paths is one `INSERT`, not an SMTP round trip
([Sending queued mail](#sending-queued-mail-odudu-send-mail)). Only the
first produced mail at all, and `ODUDU_SMTP_HOST` is unset, so the
container's log carries it instead of an inbox — logged by the mail pass a
moment after both answers had gone out, and there exactly once:

```json
{
  "level": 30,
  "to": "ada@example.com",
  "subject": "Reset your reset-demo password",
  "text": "Reset your password for reset-demo by visiting this link:\n\nhttp://localhost:3000/realms/reset-demo/login-actions/action-token?key=NnBkF0L3rKPh1cuzEi8yMK-tzUnMHxKxk3Sfy-8USEk\n\nIf you did not request this, you can ignore this message.",
  "html": "<p>Reset your password for reset-demo by visiting <a href=\"…\">…</a>.</p><p>If you did not request this, you can ignore this message.</p>",
  "msg": "captured email — no SMTP host configured"
}
```

(Reduced to the fields that matter, the same way
[Address verification](#address-verification) reduces its own capture; the
key is shortened nowhere in this section because a reader needs the whole
thing to follow the link.) The link's host is `ODUDU_PUBLIC_BASE_URL`, never
the request's `Host` header — the same rule and the same reasoning
[Self-registration](#self-registration) establishes for the verification
link, and unset it refuses the request the same way: 500, logged as a
misconfiguration, for every address alike, so a missing configuration never
becomes a way to tell addresses apart either.

`GET`ting the link does not reset anything by itself — a reset-password
token needs a password to consume it with, unlike a verify-email link, so
the same `/login-actions/action-token` endpoint answers with a form instead
of completing an action:

```bash
curl -sS 'http://localhost:3000/realms/reset-demo/login-actions/action-token?key=NnBkF0L3rKPh1cuzEi8yMK-tzUnMHxKxk3Sfy-8USEk'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Choose a new password</title></head>
<body>
<form method="post" action="/realms/reset-demo/login-actions/action-token">
  <input type="hidden" name="key" value="NnBkF0L3rKPh1cuzEi8yMK-tzUnMHxKxk3Sfy-8USEk">
  <label>New password <input type="password" name="password" autocomplete="new-password"></label>
  <button type="submit">Reset password</button>
</form>
</body>
</html>
```

The same realm password policy that binds registration binds this
submission too. A password that fails it is refused, and the link is left
alone rather than spent — it is still the same unconsumed token, so trying
again with a compliant password on the very same link works:

```bash
curl -sS -X POST http://localhost:3000/realms/reset-demo/login-actions/action-token \
  --data-urlencode 'key=NnBkF0L3rKPh1cuzEi8yMK-tzUnMHxKxk3Sfy-8USEk' \
  --data-urlencode 'password=weak'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Can&#39;t reset your password</title></head>
<body>
<h1>Can't reset your password</h1>
<ul>
<li>Password must be at least 8 characters long.</li>
</ul>
</body>
</html>
```

A candidate that satisfies every rule above and is **the password already
in force** is refused too, by the one rule no candidate decides on its own.
Every writer of a password resets the realm's `password_max_age_days` clock
on it — which is what stops an expired password being owed forever — so
without this, anybody who can read the account's mail could clear an
expiry without ever changing a password.

This one check ran against a second realm, `reset2-demo`, because the link
above had already been spent by the time it was added; everything else about
the flow is identical.

```bash
curl -sS -i -X POST http://localhost:3000/realms/reset2-demo/login-actions/action-token \
  --data-urlencode 'key=-1TjjIsV5S88pdO7TquzWplbcirrq-al_JyRDnKV8Hk' \
  --data-urlencode 'password=correct-horse-battery'
```

```
HTTP/1.1 400 Bad Request
content-type: text/html
content-length: 233

<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Can&#39;t reset your password</title></head>
<body>
<h1>Can't reset your password</h1>
<ul>
<li>Password must not be one you have used before.</li>
</ul>
</body>
</html>
```

This is **only** the password in force, not the realm's
`password_history_depth`: reset redemption keeps no history and reads none,
so a password retired more than one change ago can be restored through a
reset and its age starts again. [Password expiry, and changing a
password](#password-expiry-and-changing-a-password) is where history is
read and written.

Submitting a compliant password on the `reset-demo` link above sets it:

```bash
curl -sS -X POST http://localhost:3000/realms/reset-demo/login-actions/action-token \
  --data-urlencode 'key=NnBkF0L3rKPh1cuzEi8yMK-tzUnMHxKxk3Sfy-8USEk' \
  --data-urlencode 'password=a brand new password'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Password reset</title></head>
<body>
<h1>Your password has been reset</h1>
<p>You can close this page and sign in with your new password.</p>
</body>
</html>
```

The old password no longer authenticates — `/login-actions/authenticate`
answers 200, the login form again, not the 302 a successful attempt gets:

```bash
AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=reset-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid email' \
  --data-urlencode 'state=xyz123' \
  --data-urlencode 'nonce=abc123' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  'http://localhost:3000/realms/reset-demo/protocol/openid-connect/auth' \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

curl -sS -i -X POST http://localhost:3000/realms/reset-demo/login-actions/authenticate \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
```

```
HTTP/1.1 200 OK
content-type: text/html
```

The new one does, with a fresh authorization session (the one above is
spent, the same way every login attempt consumes its `auth_session_id`):

```bash
AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=reset-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid email' \
  --data-urlencode 'state=xyz123' \
  --data-urlencode 'nonce=abc123' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  'http://localhost:3000/realms/reset-demo/protocol/openid-connect/auth' \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

curl -sS -i -X POST http://localhost:3000/realms/reset-demo/login-actions/authenticate \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=a brand new password'
```

```
HTTP/1.1 302 Found
set-cookie: reset-demo-session=01a0a184-8d8c-…; HttpOnly; SameSite=Lax; Path=/
set-cookie: reset-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: http://localhost:8080/callback?code=GKAk-hPPPzrge0CYcPOL4VV-K7327epL7ce6UtqfCBw&state=xyz123&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Freset-demo
```

The same link a second time is refused — minted for one redemption, the
same as a verify-email token, and `action_tokens.consumed_at` is now set:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/realms/reset-demo/login-actions/action-token \
  --data-urlencode 'key=NnBkF0L3rKPh1cuzEi8yMK-tzUnMHxKxk3Sfy-8USEk' \
  --data-urlencode 'password=another password'
```

```
400
```

A completed reset also retires every other outstanding reset-password link
for the same subject, not only the one just spent — a second mailed link
from an earlier request the user forgot about, or one an attacker
triggered, dies the moment the legitimate one is redeemed rather than
staying valid for its own five minutes. And turning `reset_password_allowed`
off closes redemption as well as the request form: an outstanding link
minted while it was on answers `400` from `/login-actions/action-token`
once it is off, the kill switch an operator reaches for during an incident
covering both halves of the flow.

## Password expiry, and changing a password

A realm's `password_max_age_days` ages a password out. An expired password
is **not** refused: the login authenticates exactly as it always did, and
the `update-password` required action is what stops it from completing —
the gate that could rescue a refused login sits downstream of a success, so
refusing the factor would lock out precisely the accounts the policy exists
to move along.

The policy is two realm settings, so `seed realm --set` carries both. The
`psql` that follows has no alternative and never will: nothing can make a
password ninety days old in less than ninety days.

```bash
odudu seed \
  --realm expiry-demo --client expiry-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
odudu seed realm --name expiry-demo \
  --set password_max_age_days=90 --set password_history_depth=2
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "UPDATE user_credentials SET created_at = now() - interval '100 days'
     WHERE type = 'password'
       AND realm_id = (SELECT id FROM realms WHERE name = 'expiry-demo');"
```

```
{"created":true,"realm":"expiry-demo","realmId":"01a0aa95-…","clientId":"expiry-spa","userSubjectId":"01a0aa95-…"}
{"command":"realm","created":false,"realm":"expiry-demo","realmId":"01a0b044-9ccd-788b-bc5b-5ed0f6235f89","settings":["password_max_age_days","password_history_depth"]}
UPDATE 1
```

`/authorize` parks the request and renders the ordinary password form; the
`auth_session_id` in it — `01a0ae72-968d-7973-8e13-139f8614177b` in this
run — is what every request below carries. The correct password answers
`200` with a change-password form rather than `302` with a code: it was
accepted, and the pending action is what holds the login (no `set-cookie`,
no `code`).

```bash
curl -sS -X POST http://localhost:3000/realms/expiry-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0ae72-968d-7973-8e13-139f8614177b' \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Change your password</title></head>
<body>
<h1>Change your password</h1>
<p>This account needs a new password before you can continue.</p>
<form method="post" action="/realms/expiry-demo/login-actions/required-action?action=update-password">
  <input type="hidden" name="auth_session_id" value="01a0ae72-968d-7973-8e13-139f8614177b">
  <label>New password <input type="password" name="password" autocomplete="new-password"></label>
  <button type="submit">Update password</button>
</form>
</body>
</html>
```

The candidate is judged by the realm's own policy, the same
`evaluatePassword` call registration, reset redemption and the seed CLI are
bound by — `400`, with every rule it broke:

```bash
curl -sS -X POST \
  'http://localhost:3000/realms/expiry-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a0ae72-968d-7973-8e13-139f8614177b' \
  --data-urlencode 'password=short'
```

```
<h1>Change your password</h1>
<p>This account needs a new password before you can continue.</p>
<ul>
<li>Password must be at least 8 characters long.</li>
</ul>
```

Above a `password_history_depth` of zero, a realm also remembers that many
retired passwords and refuses the one in force. This is the only rule that
cannot be decided from the candidate alone — it is up to
`password_history_depth` Argon2id verifications against stored hashes — and
it is reported as a policy violation like the rest:

```bash
curl -sS -X POST \
  'http://localhost:3000/realms/expiry-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a0ae72-968d-7973-8e13-139f8614177b' \
  --data-urlencode 'password=correct-horse-battery'
```

```
<h1>Change your password</h1>
<p>This account needs a new password before you can continue.</p>
<ul>
<li>Password must not be one you have used before.</li>
</ul>
```

(both refusals re-render the whole form, elided to its top here; the hidden
`auth_session_id` comes back with it, so the same parked login survives a
wrong answer.)

A candidate that satisfies the policy replaces the password, retires the
one it displaces as a `password-history` credential, and completes the
action — which sends the browser back to the login form, because nothing
was persisted for the factor that authenticated the parked attempt and it
has to run again:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  'http://localhost:3000/realms/expiry-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a0ae72-968d-7973-8e13-139f8614177b' \
  --data-urlencode 'password=a-brand-new-passphrase'
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT type, created_at FROM user_credentials
     WHERE realm_id = (SELECT id FROM realms WHERE name = 'expiry-demo')
     ORDER BY type;"
```

```
200
       type       |          created_at
------------------+-------------------------------
 password         | 2026-09-17 08:19:09.965794+00
 password-history | 2026-09-17 08:19:09.965794+00
(2 rows)
```

`created_at` moved with the hash. One row holds a subject's password for
the life of the account, so it dates the password rather than the row —
left alone, the new password would still be a hundred days old and the
action would be owed again on the very next login. The same session now
completes:

```bash
curl -sS -D - -o /dev/null -X POST http://localhost:3000/realms/expiry-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0ae72-968d-7973-8e13-139f8614177b' \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=a-brand-new-passphrase'
```

```
HTTP/1.1 302 Found
set-cookie: expiry-demo-session=01a0ae72-bd69-710f-9411-cab81252891d; HttpOnly; SameSite=Lax; Path=/
set-cookie: expiry-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: http://localhost:8080/callback?code=nwsvY1PSYQ1TgHC03s8D_o0vTxt7JpxLnIDZBi3S3zg&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Fexpiry-demo
```

Reset redemption shares only half of this. It refuses the password in
force — otherwise a mailed link would restart the clock on an expired
password without changing it — but it consults no history, so a password
retired more than one change ago can be restored that way. Only this action
reads history, and only this action writes any.

A retired hash is never a login's input. The password credential read at
authentication filters on `type = 'password'`, so the row above answers
nothing but a reuse check — the old password is simply wrong now, against a
fresh authentication session:

```bash
curl -sS -D - -o /dev/null -X POST http://localhost:3000/realms/expiry-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0aa96-23f2-793d-901e-10a35c97c847' \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
```

```
HTTP/1.1 200 OK
```

No `set-cookie` and no `location`: the login form again, exactly as any
wrong password renders it. History rows past the realm's depth are deleted
outright rather than kept and marked, which is the one exception to
[ADR 0021](adr/0021-retention-is-bounded-by-the-detection-window.md)'s default in this codebase —
a retired password nothing will ever compare against is a stored hash that
answers no decision.

## Brute-force lockout

Five consecutive wrong passwords lock an account, and the realm ships that
way: the four columns behind it are on in every realm, unlike every other
credential setting on this page.

```bash
docker compose exec -T postgres psql -U odudu -d odudu -c \
  "select brute_force_max_failures, brute_force_lockout_seconds,
          brute_force_max_lockout_seconds, brute_force_failure_reset_seconds
     from realms where name = 'demo';"
```

```
 brute_force_max_failures | brute_force_lockout_seconds | brute_force_max_lockout_seconds | brute_force_failure_reset_seconds
--------------------------+-----------------------------+---------------------------------+-----------------------------------
                        5 |                          60 |                             900 |                             43200
(1 row)
```

The fifth failure locks for a minute, and each failure after that for twice
as long, up to fifteen minutes; twelve hours with no failure forgets the run
and counting starts again from one.

**The refusal says nothing.** A page reading "account locked" would confirm
both that the account exists and that somebody is attacking it — a worse
oracle than the username enumeration the rest of this document works to
close. So a locked account is refused with the response a wrong password
gets. Below, eight submissions against one parked request: five wrong
passwords, a sixth after the lockout has begun, the _right_ password, and a
username nobody holds. The hash is of the whole response — status line,
headers and body — with four per-response values normalised out: `date`,
`x-request-id`, the CSP script nonce the login page mints for its passkey
button (which appears both in the header and in the markup), and the
`auth_session_id` the re-rendered form carries, so the digest is the same
value for any parked request rather than one nobody else can reproduce.

`$SID` is the `auth_session_id` the rendered form carries, taken from the
`/authorize` response the way [the login POST](#3-the-login-post) does.

One thing about reproducing it: eight submissions in a minute from one
address is past the [per-origin throttle](#the-per-origin-throttle) below,
so the runs in this section were captured against a stack started with
`ODUDU_THROTTLE_LIMIT=1000 docker compose up -d` — at the default of ten,
the later submissions answer `429` and never reach the lockout at all.

```bash
post() {
  curl -sS -D /tmp/h.txt -o /tmp/b.txt \
    --data-urlencode "auth_session_id=$SID" \
    --data-urlencode "username=$1" --data-urlencode "password=$2" \
    'http://localhost:3000/realms/demo/login-actions/authenticate' >/dev/null
  cat /tmp/h.txt /tmp/b.txt | tr -d '\r' \
    | grep -iv '^date:' | grep -iv '^x-request-id:' \
    | sed 's/nonce-[A-Za-z0-9+/=]*/nonce-NONCE/; s/nonce="[^"]*"/nonce="NONCE"/
           s/auth_session_id" value="[^"]*"/auth_session_id" value="SID"/g' \
    | shasum -a 256 | cut -c1-32
}

for n in 1 2 3 4 5 6; do echo "$n  wrong password    $(post ada wrong-password)"; done
echo "7  right password    $(post ada correct-horse-battery)"
echo "8  unknown username  $(post nobody wrong-password)"
```

```
1  wrong password    e90eba8ff7fcad29b7543b3c005a0090
2  wrong password    e90eba8ff7fcad29b7543b3c005a0090
3  wrong password    e90eba8ff7fcad29b7543b3c005a0090
4  wrong password    e90eba8ff7fcad29b7543b3c005a0090
5  wrong password    e90eba8ff7fcad29b7543b3c005a0090
6  wrong password    e90eba8ff7fcad29b7543b3c005a0090
7  right password    e90eba8ff7fcad29b7543b3c005a0090
8  unknown username  e90eba8ff7fcad29b7543b3c005a0090
```

The four normalised values vary between responses — `date`, the request id
and the nonce between any two, the session id between any two parked
requests — so none of them distinguishes an account that exists from one
that does not, or a locked account from a wrong password.
The counter is keyed by **subject**, never by the submitted name — a name
the account no longer answers to would otherwise lock it out, and one it
answers to by email would miss it — which is why the eighth submission above
recorded nothing at all:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -x -c \
  "select subject_id, failure_count, first_failure_at, last_failure_at, locked_until
     from login_failures f join realms r on r.id = f.realm_id
     where r.name = 'demo';"
```

```
-[ RECORD 1 ]----+-------------------------------------
subject_id       | 01a0ae6a-1e63-7725-8c7e-bc5ec8910743
failure_count    | 7
first_failure_at | 2026-09-17 08:19:41.626+00
last_failure_at  | 2026-09-17 08:19:42.109+00
locked_until     | 2026-09-17 08:23:42.109+00
```

One row for `ada`, none for the username nobody holds — and seven failures,
not eight. `locked_until` is four minutes past the last of them, because the
count reached seven: a minute at five, two at six, four at seven.

The realm in that `where` clause is not decoration either. `login_failures`
holds a row per subject across every realm, and the sections above this one
leave their own behind — the password expiry walkthrough ends on a
deliberately wrong password, and nothing clears a row but a successful login
or the [retention pass](#retention-what-odudu-reap-removes). An unscoped
`select` here would print whatever the rest of this document happened to
do first, which is not a claim about the lockout.

**An attempt made during a lockout is still an attempt**, which is what
keeps a locked account the same cost as an unlocked one — the same read and
the same write, so nothing can be learned from how quickly the refusal comes
back. It also means retrying extends the wait. Five wrong passwords, then
the right one refused, then the same right password once the second lockout
has run out.

**This run needs an account with no failures behind it**, so it was captured
against a realm of its own — `lockout-demo`, seeded exactly as
[Bootstrap](#bootstrap) seeds `demo` — rather than continuing the eight
submissions above. Those left `ada` at seven failures in `demo`, and five
more would take the count to twelve and the wait to the fifteen-minute
ceiling: the arithmetic this transcript demonstrates is the arithmetic of a
run that starts from zero.

```bash
LOGIN='http://localhost:3000/realms/lockout-demo/login-actions/authenticate'
for n in 1 2 3 4 5; do
  curl -sS -o /dev/null -w "attempt $n: %{http_code}\n" \
    --data-urlencode "auth_session_id=$SID" \
    --data-urlencode 'username=ada' --data-urlencode 'password=wrong-password' "$LOGIN"
done
echo '--- the right password, while locked ---'
curl -sS -o /dev/null -w "status %{http_code}, location '%{redirect_url}'\n" \
  --data-urlencode "auth_session_id=$SID" \
  --data-urlencode 'username=ada' --data-urlencode 'password=correct-horse-battery' "$LOGIN"
sleep 125
echo '--- the same password, 125 seconds later ---'
# A fresh parked request, because the one above has been re-rendered five
# times and this is the submission that completes it.
curl -sS -D - -o /dev/null \
  --data-urlencode "auth_session_id=$(sid)" \
  --data-urlencode 'username=ada' --data-urlencode 'password=correct-horse-battery' "$LOGIN" \
  | tr -d '\r' | grep -iE '^(HTTP|location|set-cookie)'
```

```
attempt 1: 200
attempt 2: 200
attempt 3: 200
attempt 4: 200
attempt 5: 200
--- the right password, while locked ---
status 200, location ''
--- the same password, 125 seconds later ---
HTTP/1.1 302 Found
set-cookie: lockout-demo-session=01a0ae75-c738-7d3c-aca7-8e3240e94e59; HttpOnly; SameSite=Lax; Path=/
set-cookie: lockout-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: http://localhost:8080/callback?code=0xnA-pWgF0pNhoe2f7rVhx5kW8Du6sVsM6avD30z2YY&state=xyz-123&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Flockout-demo
```

(`sid` is the `/authorize` request above with the hidden field read out of
the page it renders, against `lockout-demo`. The wait is 125 seconds rather
than 60 because the refused right password counted as the sixth failure and
re-locked for two minutes.)

A correct password accepted by an **unlocked** account deletes the row, so a
run of failures ends when the account is signed into rather than decaying.
What none of this bounds is an attacker working through many accounts at one
password apiece — every counter stays at one — which is what the throttle
below is for.

### The per-origin throttle

Three unauthenticated submissions each cost real work: the sign-in POST runs
an Argon2id verification, registration runs an Argon2id **hash**, and the
reset request does a lookup and a mail send. They share one budget per
client address — `ODUDU_THROTTLE_LIMIT` (default `10`) requests per
`ODUDU_THROTTLE_WINDOW_SECONDS` (default `60`) — and nothing else on this
page is throttled. ADR 0023 is why it is a window in this process's memory
rather than a row.

Two things about the run below, since it is the one section that needs the
default budget rather than the raised one every other transcript here was
captured with. It was captured against a stack started plainly
(`docker compose up -d`), and `demo`'s `reset_password_allowed` was turned
on for it — the route answers `404` in a realm that has it off, and a `404`
is not what the ten `200`s below are demonstrating:

```bash
odudu seed realm --name demo --set reset_password_allowed=true
```

```bash
RESET='http://localhost:3000/realms/demo/login-actions/reset-password'
for n in $(seq 1 10); do
  curl -sS -o /dev/null -w "request $n: %{http_code}\n" \
    --data-urlencode 'email=ada@example.test' "$RESET"
done
echo '--- the eleventh, from the same address ---'
curl -sS -D - -o /dev/null --data-urlencode 'email=ada@example.test' "$RESET" \
  | tr -d '\r' | grep -iE '^(HTTP|retry-after|content-length)'
echo '--- an address this realm has never seen, still throttled ---'
curl -sS -D - -o /dev/null --data-urlencode 'email=nobody@example.test' "$RESET" \
  | tr -d '\r' | grep -iE '^(HTTP|retry-after|content-length)'
```

```
request 1: 200
request 2: 200
request 3: 200
request 4: 200
request 5: 200
request 6: 200
request 7: 200
request 8: 200
request 9: 200
request 10: 200
--- the eleventh, from the same address ---
HTTP/1.1 429 Too Many Requests
retry-after: 60
content-length: 0
--- an address this realm has never seen, still throttled ---
HTTP/1.1 429 Too Many Requests
retry-after: 60
content-length: 0
```

Empty body, and the same one either way: the refusal is decided before the
body is parsed or any account looked up, so it cannot say whether the
address was one this realm knows. The budget is shared across the three
routes rather than one per route, the rendered forms are not throttled, and
neither is `/token` — this one, by origin, is not where `/token`'s own
budget lives; [the client_secret budget](#the-client_secret-budget-at-token)
below is:

```bash
echo '--- the sign-in submission shares the same budget ---'
curl -sS -D - -o /dev/null \
  --data-urlencode 'username=ada' --data-urlencode 'password=correct-horse-battery' \
  'http://localhost:3000/realms/demo/login-actions/authenticate' \
  | tr -d '\r' | grep -iE '^(HTTP|retry-after)'
echo '--- the form it submits to is not throttled ---'
curl -sS -o /dev/null -w "GET the reset form: %{http_code}\n" \
  'http://localhost:3000/realms/demo/login-actions/reset-password'
echo '--- and /token is not ---'
for n in 1 2 3; do
  curl -sS -o /dev/null -w "token request $n: %{http_code}\n" \
    --data-urlencode 'grant_type=authorization_code' --data-urlencode 'code=nope' \
    --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
    --data-urlencode 'client_id=demo-spa' --data-urlencode 'code_verifier=x' \
    'http://localhost:3000/realms/demo/protocol/openid-connect/token'
done
```

```
--- the sign-in submission shares the same budget ---
HTTP/1.1 429 Too Many Requests
retry-after: 60
```

```
--- the form it submits to is not throttled ---
GET the reset form: 200
--- and /token is not ---
token request 1: 400
token request 2: 400
token request 3: 400
```

`retry-after` is what is left of the oldest counted request's minute,
rounded up to a second — `60` after a burst this fast, and lower after a
slower one, since the window slides rather than resetting. The three `400`s
are `invalid_grant` on a code that never existed — an OAuth refusal, which
is the point.

**A `429` is the throttle and nothing else.** A lockout refusal is `200`
with the sign-in form, byte-identical to a wrong password, so the two
mechanisms are never confusable from a response — and a burst of wrong
passwords big enough to lock an account is also big enough to exhaust the
budget, which is why the transcripts above this section were captured with
`ODUDU_THROTTLE_LIMIT` raised.

Two limits this cannot show. The window lives in one process's memory, so
**it is per instance**: N replicas behind a load balancer would each allow
the full budget, and there is no load balancer and no second replica in this
repository to demonstrate that against — so this is a statement, not a
transcript. And the key is `request.ip`, which with `ODUDU_TRUST_PROXY=true`
comes from `X-Forwarded-For`: a proxy that appends rather than overwrites
that header leaves the key client-controlled. Both are in
[README.md](../README.md) as deployment requirements.

### The `client_secret` budget at `/token`

RFC 6749 §2.3.1's brute-force MUST is client authentication too, and the
lockout and the throttle above don't reach it: the lockout is keyed by
subject, which a client is not, and the throttle's key is one address for
every request a server-side client will ever make. `/token` gets a third,
separate budget instead — a `slidingWindow` of its own, keyed by
`client_id` — consulted only when a `client_secret_basic` or
`client_secret_post` attempt fails. `ODUDU_CLIENT_SECRET_THROTTLE` has no
env var yet; the default is five attempts per sixty seconds, mirroring the
account lockout's own defaults. ADR 0023's amendment has the design.

A client of its own for this run, so its budget starts clean regardless of
what earlier sections in this document did to `demo-backend`'s:

```bash
odudu seed \
  --realm demo --client demo-limited --client-secret demo-limited-secret \
  --token-endpoint-auth-method client_secret_basic \
  --redirect-uri http://localhost:8080/callback
```

```bash
for n in 1 2 3 4 5; do
  curl -sS -o /dev/null -w "attempt $n: %{http_code}\n" \
    -u demo-limited:wrong-secret \
    --data-urlencode 'grant_type=client_credentials' \
    'http://localhost:3000/realms/demo/protocol/openid-connect/token'
done
echo '--- the sixth, over budget ---'
curl -sS -D - -o /dev/null -u demo-limited:wrong-secret \
  --data-urlencode 'grant_type=client_credentials' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token' \
  | tr -d '\r' | grep -iE '^(HTTP|retry-after|content-length)'
echo '--- the right secret, while the budget is spent ---'
curl -sS -D - -o /dev/null -u demo-limited:demo-limited-secret \
  --data-urlencode 'grant_type=client_credentials' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token' \
  | tr -d '\r' | grep -iE '^HTTP'
```

```
attempt 1: 401
attempt 2: 401
attempt 3: 401
attempt 4: 401
attempt 5: 401
--- the sixth, over budget ---
HTTP/1.1 429 Too Many Requests
retry-after: 60
content-length: 0
--- the right secret, while the budget is spent ---
HTTP/1.1 200 OK
```

Failures only: the right secret above succeeds anyway, same as the fifth
wrong one did — a healthy client is never throttled, whatever the failure
count on record. That is the trade this budget makes against the account
lockout, deliberately the opposite way: the lockout refuses a correct
password once an account is locked, because it is protecting a credential
from someone who does not hold it; this budget protects the ability to
keep guessing, so someone who finally presents the real secret is let in
regardless.

Unlike the per-origin throttle above — an `onRequest` hook that refuses
before the body is even parsed — this limiter is consulted from inside
`authenticateClient`, in the `catch` after `verifyClientCredentials` has
already run the full comparison. The sixth wrong secret above pays the
Argon2id verification the first five did, and only then is turned into a
`429` instead of a `401`. This budget bounds _guesses_, not CPU: it stops
the seventh, eighth and every later attempt in this window from having a
chance of being right, but it does not save the sixth one's own cost. The
per-origin throttle already covers the CPU case for the routes where an
attacker needs no credential at all; this one is answering a different
question — how many guesses a given client gets — for an endpoint where
skipping the comparison on the exhausting attempt would save one Argon2id
call and nothing more.

An unknown `client_id` spends the same budget a wrong secret against a real
one does, and is refused in the same bytes:

```bash
for n in 1 2 3 4 5; do
  curl -sS -o /dev/null -w "attempt $n: %{http_code}\n" \
    -u nobody-here:anything \
    --data-urlencode 'grant_type=client_credentials' \
    'http://localhost:3000/realms/demo/protocol/openid-connect/token'
done
echo '--- the sixth, a client_id nobody registered ---'
curl -sS -D - -o /dev/null -u nobody-here:anything \
  --data-urlencode 'grant_type=client_credentials' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token' \
  | tr -d '\r' | grep -iE '^(HTTP|retry-after|content-length)'
```

```
attempt 1: 401
attempt 2: 401
attempt 3: 401
attempt 4: 401
attempt 5: 401
--- the sixth, a client_id nobody registered ---
HTTP/1.1 429 Too Many Requests
retry-after: 60
content-length: 0
```

Same status, same headers, same empty body as `demo-limited`'s own sixth
attempt above, and the same budget: five attempts either way before the
sixth is refused. What this does not claim is that the two are
indistinguishable in general — an unknown `client_id` is refused at the
client lookup, before `verifyClientSecret` runs, while a wrong secret
against a real client pays the Argon2id comparison first, so the two paths
differ in latency even though their response bytes and budget consumption
match. ADR 0023's amendment records why that gap is accepted rather than
closed with a dummy hash. Like the throttle above, this one **is per
instance** for the same reason — a window in one process's memory — and
that limitation is [README.md](../README.md)'s to state.

## Path B: refresh rotation

Refresh tokens rotate: every successful refresh consumes the presented
token and returns a new one. Presenting a consumed token is treated as
evidence of theft, and revokes the entire family.

```bash
curl -sS --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$R1" \
  --data-urlencode 'client_id=demo-spa' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs…",
  "refresh_token": "zQMXz6L0kPWtQiJbbFrg…",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "openid profile email"
}
```

No `id_token`: nobody authenticated during a refresh, and reissuing one
would assert a fresh authentication that did not happen. Refresh tokens live
14 days; the access token they mint lives 300 seconds, like any other.

Scope may narrow, never widen. Sending `scope=openid` against a grant of
`openid profile email` returns `"scope": "openid"`; sending a scope not in
the grant is `invalid_scope`, run below.

### Replaying a refresh token

Presenting `R1` again, after it has already been rotated into `R2`:

```bash
curl -sS --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$R1" \
  --data-urlencode 'client_id=demo-spa' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

```json
{ "error": "invalid_grant" }
```

and now `R2` — the legitimate, current, never-used token — is dead as well:

```bash
curl -sS --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$R2" \
  --data-urlencode 'client_id=demo-spa' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

```json
{ "error": "invalid_grant" }
```

That is the point. One of the two holders of `R1` is a thief and the server
cannot tell which, so the grant is revoked and both are forced back through
authentication. The client's response to `invalid_grant` on a refresh is to
discard its tokens and restart Path A.

### What a replay does not do

Because reuse detection is this destructive, it must not be reachable by
anybody but the token's holder. A different client presenting somebody
else's refresh token is refused **without** consuming it:

```bash
curl -sS -u demo-backend:demo-backend-secret \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$RT" \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

```json
{ "error": "invalid_grant" }
```

So is a request from the rightful client asking for more scope than it was
granted:

```bash
curl -sS --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$RT" \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'scope=openid profile email admin' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

```json
{ "error": "invalid_scope" }
```

and the owner's token still works afterwards — neither attempt burned it:

```bash
curl -sS --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$RT" \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'scope=openid' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

```json
{
  "access_token": "eyJhbGciOiJS…",
  "refresh_token": "g3Gt1Rvhb8qi…",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "openid"
}
```

If the grant were evaluated only after rotation, either of those two
refusals would have marked the presented token used, the owner's next
legitimate refresh would have looked like reuse, and the family would have
been revoked — reuse detection turned into a weapon against the client it
exists to protect. The grant is therefore evaluated on both sides of the
rotation: before, as a gate that can only refuse, and again afterwards
against the grant the rotating transaction itself read.

### Replaying an authorization code

The same reasoning applies one hop earlier. A code can be redeemed once; a
second redemption revokes the grant the first one produced (RFC 6749
§4.1.2):

```bash
curl -sS --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' --data-urlencode "code_verifier=$VERIFIER" \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

```json
{ "error": "invalid_grant" }
```

and the refresh token issued from the first, successful redemption is now
refused too:

```json
{ "error": "invalid_grant" }
```

A redemption that fails for any other reason — wrong verifier, wrong
`redirect_uri`, wrong client — leaves the code usable, because the whole
attempt is rolled back. Verified: after all three failures above, the
correct redemption of the same code still returned 200.

## Retention: what `odudu reap` removes

Everything above leaves rows behind, and nothing in any repository deletes
one. `odudu reap` is the pass that does, on a stated window per table
([ADR 0021](adr/0021-retention-is-bounded-by-the-detection-window.md)).

**The counts in this section are the whole point of it, so they were
captured against a stack driven only as far as
[Path A](#path-a-authorization-code-with-pkce) plus one refresh rotation** —
a freshly built compose stack, `demo` seeded as [Bootstrap](#bootstrap)
seeds it, one login, one code redeemed, one refresh rotated, and nothing
else. Following this document end to end instead leaves dozens of sessions
and grants behind, and a pass over those reports numbers that say nothing
about which rule kept which row. Run against that minimal stack, the pass
removes nothing at all:

```bash
odudu reap
```

```
{"ran":true,"deleted":{"refresh_tokens":0,"authorization_codes":0,"token_grants":0,"authentication_sessions":0,"action_tokens":0,"client_registration_tokens":0,"login_failures":0,"email_outbox":0,"backchannel_logout_deliveries":0,"sessions":0}}
```

Those zeros are the point. By this stage the database holds a consumed
authorization code, a used refresh token and an expired authentication
session — every one of them past its own `expires_at`, and every one of
them still required. The consumed code is what the replay two sections up
revoked a grant through; the used refresh token is what told reuse from an
unknown token. A pass keyed on expiry would have taken all three and left
both replays answering `invalid_grant` with nothing revoked behind them.

`email_outbox` and `backchannel_logout_deliveries` are the two tables here
with two windows of their own, and the same two windows for the same
reason. A delivered message is bounded from its delivery
(`ODUDU_RETENTION_EMAIL_SENT_SECONDS`, a week). One that never arrived has
no failure timestamp to bound it from — a spent attempt budget
(`ODUDU_OUTBOX_MAX_ATTEMPTS`) is the only durable record that it will never
be attempted again — so it is kept for `ODUDU_RETENTION_EMAIL_FAILED_SECONDS`
(thirty days) measured from the last attempt, which is how long an operator
has to read it. A message still inside its retry schedule, and one never
attempted at all, are not this pass's business at any age.

A back-channel logout delivery is bounded from its own delivery the same
way (`ODUDU_RETENTION_LOGOUT_DELIVERED_SECONDS`, a week), and one that
spent every attempt (`BACKCHANNEL_LOGOUT_MAX_ATTEMPTS`, fixed at 5, with no
environment variable of its own) is kept for
`ODUDU_RETENTION_LOGOUT_FAILED_SECONDS` (thirty days) measured from the
last attempt. A delivery still inside its retry schedule is not this
pass's business at any age either.

`client_registration_tokens` is on the same footing as `action_tokens`: a
spent or expired one carries no detection value — a replayed unknown token
and a replayed spent one are refused identically — so
`ODUDU_RETENTION_REGISTRATION_TOKEN_SECONDS` (a week, like
`ODUDU_RETENTION_ACTION_TOKEN_SECONDS`) is a courtesy window for an operator
to read, not a bound ADR 0021's detection-window argument requires.

What makes a row deletable is the **grant family** being past retention,
which is seven days for a session-bound family and thirty for an offline
one. Backdating the stack by forty days is the fastest way to see a pass
with work to do:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -q -c "
UPDATE authentication_sessions SET created_at = created_at - interval '40 days', expires_at = expires_at - interval '40 days', consumed_at = consumed_at - interval '40 days';
UPDATE authorization_codes SET auth_time = auth_time - interval '40 days', expires_at = expires_at - interval '40 days', consumed_at = consumed_at - interval '40 days';
UPDATE token_grants SET created_at = created_at - interval '40 days';
UPDATE refresh_tokens SET issued_at = issued_at - interval '40 days', expires_at = expires_at - interval '40 days', used_at = used_at - interval '40 days';
UPDATE sessions SET created_at = created_at - interval '40 days', expires_at = expires_at - interval '40 days', last_active_at = last_active_at - interval '40 days';
"
odudu reap
```

```
{"ran":true,"deleted":{"refresh_tokens":2,"authorization_codes":1,"token_grants":1,"authentication_sessions":1,"action_tokens":0,"client_registration_tokens":0,"login_failures":0,"email_outbox":0,"backchannel_logout_deliveries":0,"sessions":1}}
```

Both refresh tokens of the family, the code that produced it, the grant
itself, the authentication session the login consumed, and the SSO session.
The counts are the pass's own: `refresh_tokens` reports 2 rather than 0
because the pass deletes them itself rather than leaving them to the
`ON DELETE CASCADE` from `token_grants`, and the SSO session goes only after
the last grant referencing it — a session with a live grant is refused outright, because
nulling `token_grants.session_id` would promote a session-bound grant to an
offline one.

A second run has nothing left:

```bash
odudu reap
```

```
{"ran":true,"deleted":{"refresh_tokens":0,"authorization_codes":0,"token_grants":0,"authentication_sessions":0,"action_tokens":0,"client_registration_tokens":0,"login_failures":0,"email_outbox":0,"backchannel_logout_deliveries":0,"sessions":0}}
```

### When the pass refuses, or finds nothing to look at

Three answers are not a report of rows, and each says which it is. Before
any realm exists there is nothing to enumerate, and the pass says so rather
than reporting a clean sweep of zeros — captured on a stack that had been
migrated and not yet seeded, so it is the one command in this document that
answers differently once [Bootstrap](#bootstrap) has been followed:

```bash
odudu reap
```

```
{"ran":false,"reason":"no realm was enumerated"}
```

That is an outcome, not an error: it exits 0, the way a lost lock does.
`reap` also **refuses to run at all** in two configurations, exiting
non-zero, because in both the row-level-security policy that scopes its
deletes would be inert:

- The variable is unset. The compose stack sets it, so seeing this takes
  taking it back off the command's own environment — `env -u`, rather than
  `-e ODUDU_APP_DATABASE_URL=`, which is a different refusal: an empty
  string is an unparseable URL and the configuration schema rejects it
  before this check is reached.

```bash
docker compose exec -T odudu env -u ODUDU_APP_DATABASE_URL node dist/main.js reap
```

```
reap requires ODUDU_APP_DATABASE_URL: its deletes run under the realm policy, which the owner role the migrations use escapes
```

The server's own boot guard demands it only in production; this command
demands it always, because there is no deployment where reaping with the
policy switched off is the intention. The schedule inside the server is
the one place that does not refuse per attempt: outside production it
declines to start at all, warning
`not reaping: ODUDU_APP_DATABASE_URL is unset` once, rather than throwing
this every hour for the life of the process.

- The serving connection's role is a `SUPERUSER` or holds `BYPASSRLS`, so the
  policy does not apply to it. Pointing `ODUDU_APP_DATABASE_URL` at the owner
  is the way to reach it:

```bash
docker compose exec -e ODUDU_APP_DATABASE_URL=postgres://odudu:odudu@postgres:5432/odudu \
  -T odudu node dist/main.js reap
```

```
reap deletes under the realm policy, so its serving connection must be subject to it; ODUDU_APP_DATABASE_URL names a SUPERUSER or BYPASSRLS role
```

And symmetrically, `reap must list realms on a connection that bypasses
row-level security; ODUDU_DATABASE_URL names a role that is neither
SUPERUSER nor BYPASSRLS` — the realms to visit are read on the owner
connection, `realms` carries `FORCE ROW LEVEL SECURITY`, and a listing role
without the escape reads none of them. Checked against `pg_roles` rather
than guessed at from an empty result, which is the same fact arriving too
late to act on.

The server also runs this pass itself, every `ODUDU_REAP_INTERVAL_SECONDS`
(default `3600`) plus up to a tenth of that as jitter, which is why the
counts above are reproducible only if the backdating and the command follow
each other inside one interval. `ODUDU_REAP_ENABLED=false` switches the
schedule off for a deployment that runs the command on its own timetable
([ADR 0024](adr/0024-a-scheduled-pass-is-a-command-first.md)) — and, as of
2026-09-17, `compose.yaml` passes that variable through, which it did not
before: `ODUDU_REAP_ENABLED=false docker compose up -d` left it out of the
container's environment entirely and the schedule ran anyway. The first
tick is one interval away rather than immediate, which is why the counts
above survived that gap.

Running it from more than one place at once is safe, whether the other
place is a cron entry or another replica's own schedule: the pass takes a
Postgres advisory lock for the whole tick, and whoever finds it held does
nothing rather than duplicating the work. Holding the same key from a psql
session is enough to see it:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -q -c \
  'begin; select pg_advisory_xact_lock(20260915); select pg_sleep(12); commit;' &
sleep 3
odudu reap
```

```
{"ran":false,"reason":"another instance holds the retention lock"}
```

A skipped pass is reported as a skipped pass, not as a report of zeros: a
scheduled job that conflated the two would claim success for work nobody
did.

## Sending queued mail: `odudu send-mail`

No request in this document sends mail. Address verification,
self-registration and password reset each write the message to
`email_outbox` in the transaction that mints the token it carries, and
answer; a second pass hands it to the transport. That is what keeps an SMTP
round trip out of a response — and out of the _timing_ of one, which is
what the two indistinguishable answers in [Password reset](#password-reset)
would otherwise have leaked.

The server runs this pass itself every `ODUDU_OUTBOX_INTERVAL_SECONDS`
(default `15`) plus up to a tenth as jitter, which is why the captures
above appear in `docker compose logs odudu` a moment after the request
rather than in the response. `ODUDU_OUTBOX_ENABLED=false` switches that
schedule off for a deployment that runs the command on its own timetable
([ADR 0024](adr/0024-a-scheduled-pass-is-a-command-first.md)) — and the
stack below was started that way, so the queue stays put long enough to
look at:

```bash
ODUDU_OUTBOX_ENABLED=false docker compose up -d
curl -sS -o /dev/null -X POST \
  http://localhost:3000/realms/reset-demo/login-actions/reset-password \
  --data-urlencode 'email=ada@example.com'
docker compose exec -T postgres psql -U odudu -d odudu -q -c \
  'select to_address, attempts, sent_at, next_attempt_at <= now() as due
     from email_outbox where sent_at is null;'
```

```
   to_address    | attempts | sent_at | due
-----------------+----------+---------+-----
 ada@example.com |        0 |         | t
(1 row)
```

Queued, never attempted, and due. The command sends it:

```bash
docker compose exec -T odudu node dist/main.js send-mail
```

```
{"ran":true,"sent":1,"failed":0}
```

(Two pino lines precede that summary on the way past — one saying
`ODUDU_SMTP_HOST is unset; capturing outgoing mail instead of sending it`,
and then the captured message itself, in the shape
[Address verification](#address-verification) shows. Only the outcome is
repeated here.)

The capture the request used to produce inside its own response is now
produced here, by the sender, on the way past — and the row records that it
went:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -q -c \
  'select to_address, attempts, sent_at is not null as sent from email_outbox
     order by created_at desc limit 1;'
```

```
   to_address    | attempts | sent
-----------------+----------+------
 ada@example.com |        1 | t
(1 row)
```

(The `limit 1` is what makes that a claim about the message just sent.
`email_outbox` keeps a delivered message for `ODUDU_RETENTION_EMAIL_SENT_SECONDS`,
so by this point in the document the table also holds every verification and
reset message the sections above queued.)

A second run has nothing due:

```bash
docker compose exec -T odudu node dist/main.js send-mail
```

```
{"ran":true,"sent":0,"failed":0}
```

Running it from more than one place at once is safe, and — unlike
[`odudu reap`](#retention-what-odudu-reap-removes) — it does not serialise
them. The claim is a single `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP
LOCKED)` per realm: two senders that meet on one queue take different
messages and both make progress, where a lock would have had one of them do
nothing. The claim also counts the attempt and pushes `next_attempt_at`
five minutes out, so a sender killed between the claim and the send costs
that wait and no more.

**A transport failure cannot change any response.** It arrives here, long
after the request it belongs to was answered, so there is no status for it
to alter: the submission that queued the message has already returned its
`200` (or the `201` self-registration returns), and an SMTP outage neither
fails a registration nor tells a reset request's two paths apart. Before
the queue existed, a send that threw during registration answered `500`
and a reset request logged the failure and answered `200` anyway; now
neither case exists, because nothing on a request path holds a transport at
all.

A refused message keeps its place and its reason: `last_error`, and a
`next_attempt_at` one `ODUDU_OUTBOX_RETRY_BACKOFF_SECONDS` out, doubling
per attempt. After `ODUDU_OUTBOX_MAX_ATTEMPTS` (default `5`) it is offered
no further — and still there, with its error, for
[`odudu reap`](#retention-what-odudu-reap-removes) to bound rather than for
the sender to discard.

`send-mail` refuses to run at all in the same two configurations `reap`
does, and for the same reason: its claim is scoped by the realm policy.
With `ODUDU_APP_DATABASE_URL` unset:

```bash
docker compose exec -T odudu env -u ODUDU_APP_DATABASE_URL node dist/main.js send-mail
```

```
odudu send-mail requires ODUDU_APP_DATABASE_URL: it claims under the realm policy, which the owner role the migrations use escapes
```

and pointed at the owner:

```bash
docker compose exec -e ODUDU_APP_DATABASE_URL=postgres://odudu:odudu@postgres:5432/odudu \
  -T odudu node dist/main.js send-mail
```

```
the outbox sender claims under the realm policy, so its serving connection must be subject to it; ODUDU_APP_DATABASE_URL names a SUPERUSER or BYPASSRLS role
```

Symmetrically, a `ODUDU_DATABASE_URL` role that cannot bypass row-level
security reads no realms, and the queue would drain never with nothing to
say so; that is refused too. The schedule inside the server is the one
place that does not refuse per attempt: with no serving connection it
declines to start at all, warning
`not sending queued mail: ODUDU_APP_DATABASE_URL is unset` once, rather
than throwing this every fifteen seconds for the life of the process. **With the schedule off and no command
scheduled anywhere, queued mail is never sent** — and every flow that
queued it still answers exactly as it does when mail is going out, by
design, since the reset endpoint must not answer differently for an address
that exists.

## RP-initiated logout

`GET`/`POST /realms/{realm}/protocol/openid-connect/logout` implements
[OpenID Connect RP-Initiated Logout
1.0](protocols/oidc-rpinitiated.md). Ending a session revokes it and every
grant whose `session_id` names it — not access tokens, which stay valid to
their own `exp` regardless (see [What is not
implemented](#what-is-not-implemented) and README.md's own logout section
for why).

A client registers its `post_logout_redirect_uri` values ahead of time.
`seed client --post-logout-redirect-uri` registers them **as it creates** a
client, and refuses a client that already exists — deliberately, because a
re-run that quietly widened a registered redirect list is how an allowlist
grows by accident. `demo-spa` was seeded back in
[Bootstrap](#bootstrap), so this walkthrough sets the column directly;
changing a registered client is client-management work, which is P3a's
pending its RFC 7592 spike and P4's otherwise:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    UPDATE client_oidc_config
    SET post_logout_redirect_uris = ARRAY['http://localhost:8080/logged-out']
    FROM clients
    WHERE clients.id = client_oidc_config.client_id AND clients.client_id = 'demo-spa';
  "
```

Signing in exactly as [Path A](#path-a-authorization-code-with-pkce) does,
then redeeming a reused-session code for an `id_token`, gives an
`id_token_hint` naming this session:

```bash
CODE=$(curl -sS -b cookies.txt -D - -o /dev/null --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=xyz-hint' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/auth" \
  | sed -n 's/.*[Ll]ocation: .*[?&]code=\([^&[:space:]]*\).*/\1/p' | tr -d '\r')

TOKEN_RESPONSE=$(curl -sS \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode "code_verifier=$VERIFIER" \
  "http://localhost:3000/realms/demo/protocol/openid-connect/token")

ID_TOKEN=$(python3 -c "import json,sys; print(json.load(sys.stdin)['id_token'])" <<< "$TOKEN_RESPONSE")
REFRESH_TOKEN=$(python3 -c "import json,sys; print(json.load(sys.stdin)['refresh_token'])" <<< "$TOKEN_RESPONSE")

curl -sS -b cookies.txt -D - -o /dev/null \
  --get \
  --data-urlencode "id_token_hint=$ID_TOKEN" \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'post_logout_redirect_uri=http://localhost:8080/logged-out' \
  --data-urlencode 'state=xyz-bye' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/logout"
```

```
HTTP/1.1 302 Found
set-cookie: demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
cache-control: no-store
location: http://localhost:8080/logged-out?state=xyz-bye
content-length: 0
```

Both cookies are cleared, not just the one this login set: logout ends the
whole SSO session, and a browser could hold a live persistent cookie from a
different, remembered login even though this walkthrough's own login did
not set one.

The hint names the session the cookie itself belongs to (OIDC Core §3.1.2.2
validates it — this realm's own keys, this realm's issuer, an access token
refused by `typ`), so §2's confirmation is skipped and the exact-match
`post_logout_redirect_uri` is honoured. A `sid` naming a session outside
this browser's own resolved set — stale, or another browser's — is treated
as a hint that names nothing usable: confirmation falls back to whichever
of this browser's own sessions was most recently active, and the
confirmation page names that session, not the one the `sid` asked for, so
nobody is misled about which session confirming will end. The refresh
token this session's grant issued is now refused:

```bash
curl -sS \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$REFRESH_TOKEN" \
  --data-urlencode 'client_id=demo-spa' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/token"
```

```json
{ "error": "invalid_grant" }
```

A second, separate sign-in with **no** `id_token_hint` gets the
confirmation page §2 requires instead of an immediate redirect — nothing is
ended by this `GET` alone:

```bash
curl -sS -b cookies2.txt \
  "http://localhost:3000/realms/demo/protocol/openid-connect/logout"
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign out?</title></head>
<body>
<h1>Sign out?</h1>
<p>Signing out ends this session for every application that uses it.</p>
<form method="post" action="/realms/demo/protocol/openid-connect/logout">
  <input type="hidden" name="session_id" value="01a0a5a7-4d08-…">
  <button type="submit">Sign out</button>
</form>
</body>
</html>
```

(`session_id` shortened, as elsewhere in this document.) Unlike the login
form's `auth_session_id`, this hidden field _is_ the session cookie's own
value — echoed back rather than a distinct one-time token — and the POST
handler checks it again against what the cookie itself still resolves to
before ending anything: a double-submit-cookie defence, not a single-use
one. Only a browser holding that `HttpOnly` cookie can supply a match,
which is what stops a forged cross-site POST from ending a session it
cannot read the id of.

A `post_logout_redirect_uri` that is not an exact match to a registered
value — a trailing slash, a query string, a different host — is refused,
and the session still ends: §3's redirect rule is about the redirect
alone, never about whether logout happened.

### The same request over `POST`

§2 requires both methods at this endpoint, so an RP may serialize the
request parameters into a form body instead of a query string. It is the
same request and gets the same answer. The `GET` above ended the session
`cookies.txt` held, so this needs a session of its own: run the sign-in and
the code-for-`id_token` exchange again into a second jar — the same two
blocks, with `-c cookies-post.txt` on the login and `-b cookies-post.txt`
on the authorize — and then:

```bash
curl -sS -b cookies-post.txt -D - -o /dev/null -X POST \
  --data-urlencode "id_token_hint=$ID_TOKEN" \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'post_logout_redirect_uri=http://localhost:8080/logged-out' \
  --data-urlencode 'state=xyz-bye' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/logout"
```

```
HTTP/1.1 302 Found
set-cookie: demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
cache-control: no-store
location: http://localhost:8080/logged-out?state=xyz-bye
content-length: 0
```

(`x-request-id`, `Date` and the keep-alive headers are omitted, as
elsewhere in this document.) The session is gone, so the refresh token its
grant issued is refused exactly as after the `GET`:

```bash
curl -sS \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$REFRESH_TOKEN" \
  --data-urlencode 'client_id=demo-spa' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/token"
```

```json
{ "error": "invalid_grant" }
```

Two messages therefore arrive at the same `POST`: this one, and the
confirmation form above submitting back. The form's hidden `session_id` is
what tells them apart, so a body carrying it is a confirmation and a body
without it is a logout request. A forged cross-site POST cannot guess that
value, so it is read as a request — which, with no hint, is answered by the
confirmation page and ends nothing.

### A `client_id` that disagrees with the hint

§2 requires the OP to verify a `client_id` sent alongside an
`id_token_hint` against the client the hint was issued to. For a request to
turn on that comparison and nothing else, the client named has to be one
whose registration would otherwise have allowed the redirect — so
`demo-post`, seeded in [A confidential client](#a-confidential-client)
above, gets the same value `demo-spa` has — set directly for the reason
[RP-initiated logout](#rp-initiated-logout) gives, since the client already
exists:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    UPDATE client_oidc_config
    SET post_logout_redirect_uris = ARRAY['http://localhost:8080/logged-out']
    FROM clients
    WHERE clients.id = client_oidc_config.client_id AND clients.client_id = 'demo-post';
  "

docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    SELECT clients.client_id, client_oidc_config.post_logout_redirect_uris
    FROM client_oidc_config JOIN clients ON clients.id = client_oidc_config.client_id
    WHERE clients.client_id IN ('demo-post', 'demo-spa')
    ORDER BY clients.client_id;
  "
```

```
UPDATE 1
 client_id |     post_logout_redirect_uris
-----------+------------------------------------
 demo-post | {http://localhost:8080/logged-out}
 demo-spa  | {http://localhost:8080/logged-out}
(2 rows)
```

**That `SELECT` is not decoration.** A disagreeing `client_id` drops the
requested redirect before the registered list is ever consulted, so a run
in which `demo-post` had _no_ registered value produces byte-identical
output to the one below — §3 would have refused the redirect on its own and
the transcript would demonstrate nothing about §2's comparison. The two
rows above are what makes the answer attributable, which is also why the
`WHERE` clause is there: by this point the document has seeded eleven
clients, and the two that matter have to be shown rather than found in a
listing.

Then a third session of its own, signed in as before into
`cookies-aud.txt`, and a hint whose `aud` is `demo-spa` sent with a
`client_id` of `demo-post`:

```bash
curl -sS -b cookies-aud.txt -X POST \
  --data-urlencode "id_token_hint=$ID_TOKEN" \
  --data-urlencode 'client_id=demo-post' \
  --data-urlencode 'post_logout_redirect_uri=http://localhost:8080/logged-out' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/logout"
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign out?</title></head>
<body>
<h1>Sign out?</h1>
<p>Signing out ends this session for every application that uses it.</p>
<form method="post" action="/realms/demo/protocol/openid-connect/logout">
  <input type="hidden" name="session_id" value="01a0ae58-2a9a-…">
  <input type="hidden" name="client_id" value="demo-post">
  <button type="submit">Sign out</button>
</form>
</body>
</html>
```

(`session_id` shortened.) Nothing was ended, and the form carries no
`post_logout_redirect_uri` at all: §4 says information that failed to
validate is not used, so the hint and the redirect it would have
authorised are dropped together. The identical request with
`client_id=demo-spa` — the client the hint names — ends the session and
redirects:

```bash
curl -sS -b cookies-aud.txt -D - -o /dev/null -X POST \
  --data-urlencode "id_token_hint=$ID_TOKEN" \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'post_logout_redirect_uri=http://localhost:8080/logged-out' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/logout"
```

```
HTTP/1.1 302 Found
set-cookie: demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
cache-control: no-store
location: http://localhost:8080/logged-out
content-length: 0
```

### Front-channel and back-channel logout

[OpenID Connect Front-Channel Logout 1.0](protocols/oidc-frontchannel.md)
asks the OP to render, on the page it shows after ending a session, one
`<iframe>` per client that registered a `frontchannel_logout_uri` and held
a grant under that session. [Back-Channel Logout 1.0](protocols/oidc-backchannel.md)
asks it to also `POST` a signed Logout Token to every client that
registered a `backchannel_logout_uri` and held a grant under that session.
`seed client` has no flag for either URI (see
[What is not implemented](#what-is-not-implemented)), so a second client is
seeded and given both directly, the same way `post_logout_redirect_uris`
was set above:

```bash
odudu seed client \
  --realm demo --client-id reports-widget --client-secret reports-widget-secret \
  --redirect-uri http://localhost:9100/callback

docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    UPDATE client_oidc_config
    SET frontchannel_logout_uri = 'http://localhost:9100/logout',
        frontchannel_logout_session_required = true,
        backchannel_logout_uri = 'https://127.0.0.1:9443/backchannel'
    FROM clients
    WHERE clients.id = client_oidc_config.client_id AND clients.client_id = 'reports-widget';
  "
```

(`http://localhost:9100` is for reachability in this local walkthrough
only. `isValidLogoutUri` refuses `http` unconditionally for a URI
registered through dynamic registration or `seed client` — see
`docs/protocols/oidc-frontchannel.md`'s clause table — and this direct
`UPDATE` is the one path in this document that bypasses that check
entirely, the same way it bypasses the domain/port/scheme-matching check
on `frontchannel_logout_uri` itself.)

Signing in as [Path A](#path-a-authorization-code-with-pkce) does, then
reusing that same session's cookie for a second, consent-free authorization
against `reports-widget` and redeeming its code, gives the session a grant
under each client:

```bash
curl -sS -b cookies.txt --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=reports-widget' \
  --data-urlencode 'redirect_uri=http://localhost:9100/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=xyz-rw' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/auth"

curl -sS \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$RW_CODE" \
  --data-urlencode 'redirect_uri=http://localhost:9100/callback' \
  --data-urlencode 'client_id=reports-widget' \
  --data-urlencode "code_verifier=$VERIFIER" \
  -u reports-widget:reports-widget-secret \
  "http://localhost:3000/realms/demo/protocol/openid-connect/token"
```

Ending that session with no `post_logout_redirect_uri` at all — the branch
that renders the signed-out page rather than redirecting away from it —
now frames `reports-widget`:

```bash
curl -sS -b cookies.txt --get \
  --data-urlencode "id_token_hint=$ID_TOKEN" \
  "http://localhost:3000/realms/demo/protocol/openid-connect/logout"
```

```
HTTP/1.1 200 OK
set-cookie: demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
cache-control: no-store
content-type: text/html
content-security-policy: default-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; frame-src http://localhost:9100
x-frame-options: DENY
referrer-policy: no-referrer
content-length: 317
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Signed out</title></head>
<body>
<h1>Signed out</h1>
<p>You have been signed out.</p>
<iframe src="http://localhost:9100/logout?iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Fdemo&amp;sid=01a0bc04-3b60-…"></iframe>
</body>
</html>
```

(`sid` shortened; it is the session cookie's own id, and `iss` is this
realm's issuer.) `sid` is present because `reports-widget` registered
`frontchannel_logout_session_required`; a client that had not would be
framed with `iss` alone. `demo-spa` itself is not framed here — it
registered no `frontchannel_logout_uri` at all, and §2's own rule is that a
client without one is not framed and contributes no origin, which
`frame-src` above bears out: it names `reports-widget`'s origin and
nothing else.

**This is an attempt, not a delivered notification.** The iframe's
response is never read back, and whether `reports-widget` ever sees the
request depends on browser behaviour this OP does not control:
`docs/superpowers/p3b-spike-frontchannel.md` found that a cookie with no
explicit `SameSite` is never sent on this framed cross-site request at
all, in every browser tested, and a cookie that opts in with
`SameSite=None; Secure` is still subject to third-party-cookie blocking
that Safari and Firefox apply by default and Chrome allows a user or
administrator to apply. ADR 0034 has the full reasoning.

**Back-channel logout is a server-to-server `POST`, so none of that
applies to it — but it went through the same logout above**, because
`reports-widget` registered `backchannel_logout_uri` alongside
`frontchannel_logout_uri` in the `UPDATE` further up, and ending a session
enqueues a delivery for every client that registered either. This
sub-section's own commands were re-run against a fresh session on the
same compose stack (`docker compose -f infra/docker/compose.yaml up -d
--build`, per [Bootstrap](#bootstrap)), started with
`ODUDU_LOGOUT_SENDER_ENABLED=false` on the environment so the one-shot
command below is what claims the row, not the server's own schedule.
Queried straight after that same `GET .../logout` call:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    SELECT c.client_id, d.endpoint, d.attempts, d.delivered_at, d.last_error
    FROM backchannel_logout_deliveries d JOIN clients c ON c.id = d.client_id
    WHERE c.client_id = 'reports-widget';
  "
```

```
   client_id    |              endpoint              | attempts | delivered_at | last_error
----------------+------------------------------------+----------+--------------+------------
 reports-widget | https://127.0.0.1:9443/backchannel |        0 |              |
(1 row)
```

One row, written in the same transaction that ended the session — before
any pass has looked at it. `odudu send-logouts` is what drains it, on its
own schedule or as the one-shot command below
([README's "Ending a session tells the relying parties that were part of
it"](../README.md)):

```bash
odudu send-logouts
```

```
{"ran":true,"delivered":0,"failed":1}
```

Querying the same row again shows why, in the queue's own words:

```
   client_id    |              endpoint              | attempts | delivered_at |               last_error
----------------+------------------------------------+----------+--------------+-----------------------------------------
 reports-widget | https://127.0.0.1:9443/backchannel |        2 |              | address 127.0.0.1 is a loopback address
(1 row)
```

`assertPublicAddress` (`packages/protocol-oidc/src/service/remote-address.ts`)
refuses `127.0.0.0/8` unconditionally, ahead of any override — the same
guard `clientKeySet`'s `jwks_uri` fetch uses (ADR 0028). `attempts` reads
`2`, not `1`, because `claimDue` spends one optimistically at the claim
and `markFailed` spends a second recording the outcome.

**A private-range address is a different branch of that same guard, and
one an operator can open.** `ODUDU_ALLOW_PRIVATE_CLIENT_URLS` — already
read at boot for `jwks_uri` — now reaches
`createLogoutDeliveryTransport` too, at both call sites that build one
(`apps/server/src/main.ts`, `apps/server/src/cli/send-logouts.ts`). With
it set, delivery to a real listener actually happens. Continuing this
same stack: the container was recreated with
`ODUDU_ALLOW_PRIVATE_CLIENT_URLS=true` on the environment (`docker compose
up -d`), a plain Node `https` listener was started on this host's own LAN
address (`192.168.1.71:9443`, standing in for a relying party — a private
address is exactly what this variable exists to admit; a _public_ one
needs no such override), its self-signed certificate was copied into the
container (`docker cp cert.pem docker-odudu-1:/tmp/listener-cert.pem`),
and `reports-widget`'s `backchannel_logout_uri` was pointed at it instead:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    UPDATE client_oidc_config SET backchannel_logout_uri = 'https://192.168.1.71:9443/backchannel'
    FROM clients WHERE clients.id = client_oidc_config.client_id AND clients.client_id = 'reports-widget';
  "
```

A fresh sign-in, second-client authorization and logout — the same three
steps as above — enqueue one row exactly as before: the earlier row's own
`endpoint` is a snapshot taken at logout, unaffected by this `UPDATE`, so
only a fresh session's delivery targets the new address. `odudu
send-logouts`, run with `NODE_EXTRA_CA_CERTS` pointed at the copied
certificate — the standard Node mechanism for trusting a root beyond the
default store, needed because the transport passes no `ca` option in
production and so falls back to it:

```bash
docker compose -f infra/docker/compose.yaml exec -T \
  -e NODE_EXTRA_CA_CERTS=/tmp/listener-cert.pem odudu node dist/main.js send-logouts
```

```
{"ran":true,"delivered":1,"failed":0}
```

The listener's own log shows the request actually arrived:

```
POST /backchannel content-type=application/x-www-form-urlencoded body=logout_token=eyJhbGciOiJSUzI1NiIsImtpZCI6IjAxYTBiZDJlLTk4YjctN2JlZS04ODJkLTVkZDg2MjQwNGFjZSIsInR5cCI6ImxvZ291dCtqd3QifQ.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAvcmVhbG1zL2RlbW8iLCJhdWQiOiJyZXBvcnRzLXdpZGdldCIsImlhdCI6MTc4OTg4MDU4NSwiZXhwIjoxNzg5ODgwNzA1LCJqdGkiOiIwMWEwYmQzMi00YmE3LTc1YjctYTQ4YS05MWIwMWEyZmU0NWIiLCJzdWIiOiIwMWEwYmQyZS05OGJhLTc0NTEtOWQ5YS1jMDMzZTM3Y2FiNTEiLCJzaWQiOiIwMWEwYmQzMi00YTZhLTc4NjEtYmQzZC1hNTRlYmZlZWE2NGUiLCJldmVudHMiOnsiaHR0cDovL3NjaGVtYXMub3BlbmlkLm5ldC9ldmVudC9iYWNrY2hhbm5lbC1sb2dvdXQiOnt9fX0.hGIXaBd3Coz7k7NOgTPUAEZP1VFDiO9lfry96Soi-KtxbFcFQYvcxlIOPkaLT7Yis0vleyiUIII6EKnuxMZJ1ErNJiTg4ce-CQ7bRZdS1uR2HZZ6J8DTBUkT5sa6ptg-kPXnb92-2m-I_AIH2REEQTjlb6eMF1KYKJLtlt-qTSW11Ql959aAfIRjj9uMKUoYajtIODLcZ8OPh1p-CbIswgeFCloWcUx28U8d4PIKV7-S0Ru3y-rCaGszRLN9MkVJo8PA91Xo_TeqkSeAlUr18a5baA8iW2XJNBIFHwEWt9HBxYFNI8PqNm4TJuCQKa5HqGGlRGbU6L3sNFNSpzYOuQ
```

Its header decodes to `{"alg":"RS256","kid":"01a0bd2e-…","typ":"logout+jwt"}`
and its payload to `{"iss":"http://localhost:3000/realms/demo","aud":"reports-widget",
"iat":1789880585,"exp":1789880705,"jti":"01a0bd32-…","sub":"01a0bd2e-…",
"sid":"01a0bd32-…","events":{"http://schemas.openid.net/event/backchannel-logout":{}}}`
— every §2.4 member the clause table claims, on a token this walkthrough's
own listener actually received. The queue shows the same thing from the
other side:

```
   client_id    |               endpoint                | attempts |        delivered_at        | last_error
----------------+---------------------------------------+----------+----------------------------+------------
 reports-widget | https://192.168.1.71:9443/backchannel |        1 | 2026-09-20 05:03:18.365+00 |
(1 row)
```

`attempts` reads `1` here, not `2`: `markDelivered` records success without
touching `attempts` the way `markFailed` does.

Discovery now advertises `backchannel_logout_supported`,
`backchannel_logout_session_supported`, `frontchannel_logout_supported`
and `frontchannel_logout_session_supported` — all four unconditionally
`true` for every realm, since a client opts in per client rather than per
realm (see [Discovery](#1-discovery) above).

### Offline access

`offline_access` is a scope, seeded into every realm alongside
`openid`/`profile`/`email` and assigned to `demo-spa` too — the one scope
here assigned `'optional'` rather than `'default'`, which is what lets the
consent screen ([below](#the-consent-screen)) tell it apart from a scope
pre-approved the moment a client is assigned it (it maps no claims either
way — see [Discovery](#1-discovery) above). `demo-spa`'s own
`consent_required` is `false` — `seed client` names no way to set it, so
every seeded client keeps the column's own default — so the transcript
below reuses without ever seeing that screen; the consent section
demonstrates asking, against an anonymously self-registered client, whose
`consent_required` defaults `true` (ADR 0027, and the registration section
above). Requesting it produces a
grant with no session, which is what nothing here can expire and no logout
can end (OpenID Connect Back-Channel Logout 1.0 §2.7's second sentence,
[docs/protocols/oidc-backchannel.md](protocols/oidc-backchannel.md)). A
fresh login, keeping its cookie, redeems one code for a plain
`scope=openid` grant and then reuses the same live session — no new
login — to redeem a second code for `scope=openid offline_access`:

```bash
VERIFIER=$(openssl rand -hex 32)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 \
  | openssl base64 | tr '+/' '-_' | tr -d '=')

AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=xyz-bound' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "$BASE/auth" | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

CODE=$(curl -sS -c cookies-offline.txt -D - -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  "$LOGIN" | sed -n 's/.*[?&]code=\([^&[:space:]]*\).*/\1/p' | tr -d '\r')

BOUND_TOKENS=$(curl -sS \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode "code_verifier=$VERIFIER" "$BASE/token")
BOUND_REFRESH_TOKEN=$(printf '%s' "$BOUND_TOKENS" | sed -n 's/.*"refresh_token":"\([^"]*\)".*/\1/p')

OFFLINE_CODE=$(curl -sS -b cookies-offline.txt -D - -o /dev/null --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid offline_access' \
  --data-urlencode 'state=xyz-offline' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "$BASE/auth" \
  | sed -n 's/.*[Ll]ocation: .*[?&]code=\([^&[:space:]]*\).*/\1/p' | tr -d '\r')

OFFLINE_TOKENS=$(curl -sS \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$OFFLINE_CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode "code_verifier=$VERIFIER" "$BASE/token")
OFFLINE_REFRESH_TOKEN=$(printf '%s' "$OFFLINE_TOKENS" | sed -n 's/.*"refresh_token":"\([^"]*\)".*/\1/p')
```

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs…",
  "id_token": "eyJhbGciOiJSUzI1NiIs…",
  "refresh_token": "KES5eAgSveeI4Q3mnSv…",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "openid offline_access"
}
```

(All three token values truncated.) The access token, decoded:

```json
{
  "iss": "http://localhost:3000/realms/demo",
  "sub": "01a0a6cd-e3cb-…",
  "aud": ["http://localhost:3000/realms/demo"],
  "client_id": "demo-spa",
  "scope": "openid offline_access",
  "iat": 1789505162,
  "exp": 1789505462,
  "jti": "01a0a6d1-cbc5-…"
}
```

No `sid` — every other access token in this document carries one
([docs/protocols/oidc-backchannel.md](protocols/oidc-backchannel.md) §2.1),
and this is the one grant here with no session for it to name. The ID
token, decoded, is missing it the same way, but still carries `amr` and
`acr`:

```json
{
  "sub": "01a0a6cd-e3cb-…",
  "iss": "http://localhost:3000/realms/demo",
  "aud": "demo-spa",
  "iat": 1789505162,
  "exp": 1789505462,
  "auth_time": 1789505162,
  "amr": ["pwd"],
  "acr": "1"
}
```

`amr`/`acr` read the session the login itself established
(`code.sessionId`), not the grant's own, offline-nulled session binding —
the two are different fields for exactly this reason: an `offline_access`
grant has no session to end at logout, but it is still a statement about a
login that really happened, with a real authentication behind it.

Logging out the session that redeemed both codes ends it the same two-step
way shown above: `GET` for the confirmation page, then the hidden
`session_id` posted back to confirm.

```bash
curl -sS -b cookies-offline.txt "http://localhost:3000/realms/demo/protocol/openid-connect/logout"
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign out?</title></head>
<body>
<h1>Sign out?</h1>
<p>Signing out ends this session for every application that uses it.</p>
<form method="post" action="/realms/demo/protocol/openid-connect/logout">
  <input type="hidden" name="session_id" value="01a0a5e6-6047-…">
  <button type="submit">Sign out</button>
</form>
</body>
</html>
```

(`session_id` shortened, as elsewhere in this document.)

```bash
curl -sS -b cookies-offline.txt -D - \
  --data-urlencode 'session_id=01a0a5e6-6047-7c21-b8f7-da4b5d908534' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/logout"
```

```
HTTP/1.1 200 OK
set-cookie: demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
cache-control: no-store

<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Signed out</title></head>
<body>
<h1>Signed out</h1>
<p>You have been signed out.</p>
</body>
</html>
```

The session-bound refresh token is revoked with it:

```bash
curl -sS \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$BOUND_REFRESH_TOKEN" \
  --data-urlencode 'client_id=demo-spa' \
  "$BASE/token"
```

```json
{ "error": "invalid_grant" }
```

The offline one is not — nothing about ending the session touched a grant
with none:

```bash
curl -sS \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$OFFLINE_REFRESH_TOKEN" \
  --data-urlencode 'client_id=demo-spa' \
  "$BASE/token"
```

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs…",
  "refresh_token": "eycMYvzBLhLjl1zbcQ8…",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "openid offline_access"
}
```

(Both token values truncated.) A session-bound refresh token dies the
moment its session does, whether that session was ended by this logout or
by its own idle timeout expiring underneath it —
`packages/protocol-oidc/src/usecase/refresh-rotation.ts` checks the
session's own liveness, not just the grant's `revoked_at`, for exactly that
second case. An offline grant has neither: no session to end, and no idle
window to outlive, so it is bounded only by its own
`refresh_token_ttl_seconds` and by retention (see [What is not
implemented](#what-is-not-implemented)) — nothing about ending a session
ages it out early. A client is only handed this scope if the realm's
operator assigned it — `demo-spa` has it because `odudu seed` assigns every
default scope, `offline_access` included, though `'optional'` rather than
`'default'`; a request for it from a client whose assignment was withdrawn
between `/authorize` accepting the request and the code being redeemed
gets an ordinary session-bound grant back instead, since the resolved
scope at redemption is the authority, not the request `/authorize` saw. A
client never assigned the scope at all is refused outright, with
`invalid_scope`, before a code is ever issued — the same rule any other
unassigned scope gets (see [Discovery](#1-discovery) above).

### The consent screen

`demo-spa`'s own `consent_required` is `false`, so nothing above ever saw
this screen. It exists for a client whose `consent_required` is `true` —
every anonymously self-registered client (`consent_required` defaults
`true` there, per [Dynamic client registration](#dynamic-client-registration)
and ADR 0027) — and for `prompt=consent` on any client at all.

**This section is derived, not observed** — every other block in this
document is a command actually run against the compose stack; reproducing
that here would mean replaying the whole document's transcript from the
top to reach the same `demo` realm state this section wants to start from,
which the time available for this pass did not allow. What follows is
read off the implementation
(`packages/protocol-oidc/src/usecase/login-submission.ts`'s
`decideConsentGate`, `packages/protocol-oidc/src/usecase/authorization-request.ts`'s
own gate on the reuse path, and `packages/protocol-oidc/src/view/consent-html.ts`)
and the integration suite that exercises exactly these requests
(`packages/protocol-oidc/tests/consent.int.test.ts`, ten cases, all
passing) — not invented, but not a byte-for-byte transcript either. A
later pass that re-derives this section from a real run should replace
this note along with it.

A client that requires consent renders the screen once the credentials
that would otherwise complete the login have been accepted — after the
same required-action gate `/authorize`'s form path always enforced, and
before a code is ever issued:

```
POST /realms/demo/login-actions/authenticate
auth_session_id=…&username=ada&password=correct-horse-battery
```

```
HTTP/1.1 200 OK
content-type: text/html; charset=utf-8

<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Allow access?</title></head>
<body>
<h1>Example RP is asking for access</h1>
<form method="post" action="/realms/demo/login-actions/consent">
  <input type="hidden" name="auth_session_id" value="…">
  <ul><li>openid</li><li>profile</li></ul>
  <label><input type="checkbox" name="scope" value="offline_access"> offline_access — grants ongoing access, even while you are not present</label>
  <button type="submit" name="decision" value="allow">Allow</button>
  <button type="submit" name="decision" value="deny">Deny</button>
</form>
</body>
</html>
```

No `set-cookie`, no `location`: nothing is established and no code is
issued until the form below is answered. `offline_access` is the one scope
here that carries the explanatory clause OIDC Core §16.18 asks for — every
default scope (`openid`, `profile`) needs no box at all, since the client
was already assigned it without asking.

Declining the optional scope narrows what the eventual token carries —
`scope` in the token response omits `offline_access`, not merely "the flow
completed" — and the client's answer is what gets recorded, so the same
request does not ask again:

```
POST /realms/demo/login-actions/consent
auth_session_id=…&decision=allow
```

```
HTTP/1.1 302 Found
set-cookie: demo-session=…; HttpOnly; SameSite=Lax; Path=/
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: https://rp.example/cb?code=…&state=xyz-123&iss=http://localhost:3000/realms/demo
```

Pressing Deny instead answers exactly where a client-side `access_denied`
always does — the request's own `redirect_uri`, not a page — with nothing
established and no code issued:

```
POST /realms/demo/login-actions/consent
auth_session_id=…&decision=deny
```

```
HTTP/1.1 302 Found
location: https://rp.example/cb?error=access_denied&state=xyz-123&iss=http://localhost:3000/realms/demo
```

The gate applies to a live SSO session exactly as it does to a fresh
login, which is the reason this section exists rather than being folded
into the login-form walkthrough above: a second `/authorize` request,
against the same cookie, asking for a wider scope than what the first
consent recorded, renders this same screen again rather than reusing the
session straight through to a code — `packages/protocol-oidc/tests/consent.int.test.ts`'s
`asks for consent on a reused SSO session, not only on a fresh login` is
the case that would ship broken if the gate lived only on the form path.
Under `prompt=none`, that same reused-but-under-consented session is
refused rather than asked, since `prompt=none` forbids the interaction a
consent screen is:

```
GET /realms/demo/protocol/openid-connect/auth?…&prompt=none
Cookie: demo-session=…
```

```
HTTP/1.1 302 Found
location: https://rp.example/cb?error=consent_required&state=xyz-123&iss=http://localhost:3000/realms/demo
```

## Path C: `client_credentials`

No user, no browser, no PKCE, no redirect. A confidential client
authenticates as itself and gets a token for its own service account.

```bash
curl -sS -u demo-backend:demo-backend-secret \
  --data-urlencode 'grant_type=client_credentials' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs…",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": ""
}
```

```json
{ "alg": "RS256", "kid": "01a09678-…", "typ": "at+jwt" }
{
  "iss": "http://localhost:3000/realms/demo",
  "sub": "01a0967a-211c-…",
  "aud": ["http://localhost:3000/realms/demo"],
  "client_id": "demo-backend",
  "scope": "",
  "iat": 1789231004,
  "exp": 1789231304,
  "jti": "01a0967a-7d0d-…"
}
```

`sub` is the client's service-account subject, not any person.

**No ID token, and that is not an omission.** An ID token asserts that an
end user authenticated at a given time — `sub`, `auth_time`, `nonce`. Here
nobody did. Issuing one would be a claim about a human being where there is
no human being, which is why OIDC has no `client_credentials` flow at all.

**No refresh token either.** A refresh token exists to avoid re-involving a
user who is not present; this client can repeat the request whenever it
likes with the credentials it already holds.

The seed command gives a new client an empty `client_credentials` scope
allowlist, so the empty `scope` above is the only scope it can get. Asking
for anything, including `openid`, is refused:

```bash
curl -sS -u demo-backend:demo-backend-secret \
  --data-urlencode 'grant_type=client_credentials' --data-urlencode 'scope=openid' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

```json
{ "error": "invalid_scope" }
```

Which also means this token cannot be used at `/userinfo` — it has no
`openid` scope, and the endpoint says so specifically rather than pretending
the token is bad:

```
HTTP/1.1 403 Forbidden
www-authenticate: Bearer realm="userinfo", error="insufficient_scope"
```

**What the client does next:** call the API the token is for, and mint
another when it expires. There is nothing to store.

## CORS: the preflight and the request differ

A browser single-page client is the reader `## Path A` above walks through,
and until this section landed its preflight failed: `/token` and
`/userinfo` sent no `Access-Control-Allow-Origin` at all, so the browser
never let the page see the response. A preflight (`OPTIONS`) carries no
client identity — no body, no `Authorization` header, only `Origin`,
`Access-Control-Request-Method` and `Access-Control-Request-Headers` — so it
is answered from the **realm's union** of every client's registered
`web_origins`. The real request that follows is answered from **that one
client's own** origins, resolved once the request names which client it is:
`client_id` in the form body at `/token`, the `client_id` claim of the
bearer token at `/userinfo`. An origin the preflight allowed because it
belongs to a different client in the same realm is, correctly, withheld on
the real request — no status code or body changes, the header is just
absent, and the browser discards the response on its own.

`/certs` and `/.well-known/openid-configuration` are unauthenticated public
documents: every origin gets `Access-Control-Allow-Origin: *` and no `Vary`.
`/authorize` and `/login-actions/*` are top-level navigations and get no
CORS treatment of any kind — a header there would hand a script read access
to the login page.

The client-registration CLI has no flag for `web_origins` yet, so the two
clients below were seeded normally and then given origins with one direct
`UPDATE` against `client_oidc_config` — the commands after it are otherwise
exactly what `## Path A` already used, against a second realm seeded for
this section (`cors-demo`, with clients `demo-spa` at
`https://demo-spa.example`, `other-app` at `https://other-app.example`, and
`spa-with-user` — also at `https://demo-spa.example` — carrying the user
that signs in below).

A preflight for `/token`, from an origin that belongs to `other-app`, not to
the client the real request below will name:

```bash
curl -sS -D - -o /dev/null -X OPTIONS \
  http://localhost:3000/realms/cors-demo/protocol/openid-connect/token \
  -H "Origin: https://other-app.example" \
  -H "Access-Control-Request-Method: POST"
```

```
HTTP/1.1 204 No Content
vary: Origin
access-control-allow-origin: https://other-app.example
access-control-allow-methods: GET, POST, OPTIONS
access-control-allow-headers: authorization, content-type
access-control-max-age: 600
content-length: 0
```

The real request, same origin, naming `demo-spa` instead — whose own
origins do not include `other-app.example` — refused a bad refresh token
exactly as it would with no `Origin` header at all, and the CORS header is
simply absent from a response that is otherwise unchanged:

```bash
curl -sS -D - -o /dev/null -X POST \
  http://localhost:3000/realms/cors-demo/protocol/openid-connect/token \
  -H "Origin: https://other-app.example" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "grant_type=refresh_token&refresh_token=bogus&client_id=demo-spa"
```

```
HTTP/1.1 400 Bad Request
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
```

(`access-control-allow-origin` does not appear in that response at all —
`vary: Origin` does, on every response from this endpoint, allowed or not,
so a shared cache never serves one origin's answer to another.) The same
request with `Origin: https://demo-spa.example` — `demo-spa`'s own origin —
gets the header back, still a 400 for the same bogus refresh token:

```
HTTP/1.1 400 Bad Request
vary: Origin
access-control-allow-origin: https://demo-spa.example
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
```

`/userinfo` takes the same split from the other side: the client comes from
the access token's `client_id` claim rather than a body parameter. Signing
in as `spa-with-user` and calling `/userinfo` with its own origin gets the
header; with `other-app`'s origin, the same 200 with the same claims, and no
header:

```bash
curl -sS -D - -o /dev/null \
  http://localhost:3000/realms/cors-demo/protocol/openid-connect/userinfo \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Origin: https://demo-spa.example"
curl -sS -D - -o /dev/null \
  http://localhost:3000/realms/cors-demo/protocol/openid-connect/userinfo \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Origin: https://other-app.example"
```

```
HTTP/1.1 200 OK
vary: Origin
access-control-allow-origin: https://demo-spa.example
content-type: application/json; charset=utf-8
```

```
HTTP/1.1 200 OK
vary: Origin
content-type: application/json; charset=utf-8
```

The two public documents, from an origin nothing registered:

```bash
curl -sS -D - -o /dev/null \
  http://localhost:3000/realms/cors-demo/protocol/openid-connect/certs \
  -H "Origin: https://anything.example"
curl -sS -D - -o /dev/null \
  http://localhost:3000/realms/cors-demo/.well-known/openid-configuration \
  -H "Origin: https://anything.example"
```

```
HTTP/1.1 200 OK
access-control-allow-origin: *
content-type: application/json; charset=utf-8
```

```
HTTP/1.1 200 OK
access-control-allow-origin: *
content-type: application/json; charset=utf-8
```

(no `Vary` on either — a fixed wildcard has nothing to vary the response
on). And `/authorize`, which gets nothing:

```bash
curl -sS -D - -o /dev/null -X OPTIONS \
  http://localhost:3000/realms/cors-demo/protocol/openid-connect/auth \
  -H "Origin: https://other-app.example" \
  -H "Access-Control-Request-Method: GET"
```

```
HTTP/1.1 404 Not Found
vary: Origin
content-type: application/json; charset=utf-8
```

No `access-control-allow-origin` — the browser gets nothing to read this
response with. The `Vary: Origin` here is a side effect of `@fastify/cors`
answering every unmatched `OPTIONS` request from one global fallback route
regardless of which encapsulated scope registered it (`docs/superpowers/p2a-spike-log.md`
records the mechanism); it is harmless — nothing downstream keys a cache
entry on it — but it is not hidden here as something it is not.

## The branches

### `/authorize`: the render-versus-redirect boundary

This is the most security-sensitive ordering decision in the server. RFC
6749 §4.1.2.1 splits authorization-request failures into two families:

- The `client_id` is missing or unknown, or the `redirect_uri` is missing or
  does not match a registration. The server has **not** established that the
  redirect target belongs to the client that claims it. It **MUST NOT**
  redirect; it renders an error page in its own UI.
- Everything else. The redirect target has been validated, so the error is
  delivered there as query parameters, which is the only channel back to a
  client that is waiting at a redirect URI.

Getting a check on the wrong side of that line is not a taxonomy mistake —
it is an open redirector (RFC 6749 §10.15) wearing the identity provider's
domain. The rule is therefore that `client_id` and `redirect_uri` are
validated strictly before any other failure decides how to report itself.
OIDC Core §3.1.2.6 gives the rendered case its shape: HTTP 400 with no error
response parameters. The long-form reading is in
`docs/protocols/rfc6749.md`, under "The §4.1.2.1 split".

A rendered refusal looks like this — the error code is in the page, not in a
`Location` header:

```
HTTP/1.1 400 Bad Request
content-type: text/html

<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign-in error</title></head>
<body>
<h1>Can't continue</h1>
<p>Unknown or disabled client</p>
<p><small>invalid_client</small></p>
</body>
</html>
```

**Above the boundary — rendered, never redirected.** All verified against
the running stack. Every row answers with an HTML body and no `Location`
header, and every one is 400 except where the status is given.

| Request                                | Answer                                                          | Why this and not a redirect                                                                                              |
| -------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Unknown or disabled `client_id`        | `invalid_client`, "Unknown or disabled client"                  | No client, so no registration to judge a redirect target against                                                         |
| Unknown realm in the path              | `invalid_client`, "Unknown or disabled client"                  | Identical answer on purpose: a probe cannot tell a missing realm from a missing client                                   |
| `redirect_uri` not registered          | `invalid_request`, "Unregistered redirect URI"                  | Exactly the URI an attacker supplied; redirecting to it is the open redirect                                             |
| `redirect_uri` absent                  | `invalid_request`, "Unregistered redirect URI"                  | Nowhere to send anything                                                                                                 |
| Repeated `client_id` or `redirect_uri` | `invalid_request`, "Repeated … parameter"                       | Two values are no more trustworthy than an unregistered one; picking whichever parsed first defeats the check            |
| Repeated `response_type`               | `invalid_request`, "Repeated response_type parameter"           | The response type selects the response mode, so two of them name two delivery mechanisms                                 |
| Repeated `response_mode`               | `invalid_request`, "Repeated response_mode parameter"           | Same, stated directly                                                                                                    |
| `response_mode` other than `query`     | `invalid_request`, "Unsupported response_mode…"                 | It names how a response is delivered; an unsupported one leaves no way to deliver an error either (OIDC Core §3.1.2.6)   |
| No parameters at all                   | `invalid_client`, "Unknown or disabled client"                  | A request with no `client_id` is the first family                                                                        |
| `POST` in any encoding but form        | **415**, "…must be sent as `application/x-www-form-urlencoded`" | An unsupported representation, not a malformed authorization request; refused before any parser runs (RFC 9110 §15.5.16) |

That last row has its own section below, because a content type can be
wrong in more ways than one.

**Below the boundary — 302 to the registered `redirect_uri`**, carrying
`error`, `state` if the request had one, and always `iss`. All verified:

| Request                                   | `error`                     | Why                                                                                          |
| ----------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| No `code_challenge`                       | `invalid_request`           | PKCE is mandatory for every client, with no exception (ADR 0016)                             |
| `code_challenge` of the wrong shape       | `invalid_request`           | RFC 7636 §4.2 fixes it at 43–128 unreserved characters; see below                            |
| No `code_challenge_method`                | `invalid_request`           | It is not defaulted to `plain`, which is what RFC 7636 §4.3 would have it default to         |
| `code_challenge_method=plain`             | `invalid_request`           | Only `S256` is accepted; `plain` offers no protection against an intercepted code            |
| `response_type=token`                     | `unsupported_response_type` | Only the code flow exists; implicit issuance is gone from OAuth 2.1                          |
| Scope the realm does not define           | `invalid_scope`             | `scopes_supported` is that same list, so discovery and this endpoint cannot disagree         |
| Scope the client is not assigned          | `invalid_scope`             | Defined by the realm is not granted to every client; refused, never silently dropped         |
| Repeated `state` (or any other repeat)    | `invalid_request`           | Ambiguous, but a trustworthy redirect target exists by now, so the client can be told        |
| `prompt=none`                             | `login_required`            | For a request carrying no live session cookie; with one it issues a code instead (§3.1.2.3)  |
| `prompt=none login`                       | `invalid_request`           | `none` with any other value is contradictory (OIDC Core §3.1.2.1)                            |
| `prompt=` anything undefined              | `invalid_request`           | Better told than silently answered as if it had asked for nothing                            |
| `request=…`                               | `request_not_supported`     | Request objects are unimplemented, and §3.1.2.6 requires saying so rather than dropping them |
| `request_uri=…`                           | `request_uri_not_supported` | Same                                                                                         |
| Unverifiable `id_token_hint`              | `invalid_request`           | A hint this realm's keys did not sign is not a hint from here (OIDC Core §3.1.2.2)           |
| Another realm's `id_token_hint`           | `invalid_request`           | Same rule: the realm in the URL is the only issuer whose keys are consulted                  |
| `id_token_hint` minted for another client | `invalid_request`           | Its `aud` names a client, and this realm checks it against the one making this request       |

The error redirect for a request that sent no `state` carries only `error`
and `iss`:

```
location: http://localhost:8080/callback?error=invalid_request&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Fdemo
```

`iss` is on every authorization response including the errors (RFC 9207 §2):
a client that cannot tell which server failed its request is the client a
mix-up attack preys on.

### `redirect_uri` is compared as a string

Every difference below is a different URI, including the ones a URL parser
would call equivalent. Only the first is registered:

```bash
for u in http://localhost:8080/callback http://localhost:8080/callback/ \
         http://localhost:8080/Callback 'http://localhost:8080/callback?x=1' \
         http://LOCALHOST:8080/callback 'http://localhost:8080/callback#f'; do
  printf '%-40s ' "$u"
  curl -sS -o /dev/null -w '%{http_code}\n' --get --data-urlencode "redirect_uri=$u" \
    "http://localhost:3000/realms/demo/protocol/openid-connect/auth?response_type=code&client_id=demo-spa&scope=openid&code_challenge=$CHALLENGE&code_challenge_method=S256"
done
```

```
http://localhost:8080/callback           200
http://localhost:8080/callback/          400
http://localhost:8080/Callback           400
http://localhost:8080/callback?x=1       400
http://LOCALHOST:8080/callback           400
http://localhost:8080/callback#f         400
```

Each 400 is a rendered "Unregistered redirect URI" page, not a redirect —
the whole point of the boundary above. Normalizing the host's case, or a
trailing slash, or an added query string would each widen the set of
targets an attacker can name while still matching a registration.

### `POST /authorize`, and the content type

OIDC Core §3.1.2.1 says a POSTed authorization request is form serialized.
Anything else is a representation this endpoint does not take, so it is
refused at the HTTP layer, before a parser can invent values of the wrong
type for rules — mandatory PKCE above all — that are written for strings.

```bash
curl -sS -D - -X POST -H 'content-type: application/json' \
  --data '{"response_type":"code"}' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/auth'
```

```
HTTP/1.1 415 Unsupported Media Type
content-type: text/html
content-length: 272

<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign-in error</title></head>
<body>
<h1>Can't continue</h1>
<p>Authorization request parameters must be sent as application/x-www-form-urlencoded.</p>
<p><small>invalid_request</small></p>
</body>
</html>
```

A body arriving with **no `Content-Type` at all** has an unknown media type
(RFC 9110 §8.3), and unknown is unsupported here. It is answered with that
same page, byte for byte:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type:' \
  --data-binary '{"response_type":"code"}' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/auth'
```

```
415
```

Letting that one reach Fastify's own content-type refusal would have put
back what the rule set out to remove: one refusal in two representations,
that one a JSON error object where every other refusal here is an HTML
page.

Every case, run:

| `POST` with…                                        | Status | Body                                    |
| --------------------------------------------------- | ------ | --------------------------------------- |
| `application/x-www-form-urlencoded`                 | 200    | the login form                          |
| `application/x-www-form-urlencoded; charset=utf-8`  | 200    | the login form — the charset is allowed |
| `application/json`, `text/plain`, `application/xml` | 415    | the page above                          |
| a body and no `Content-Type`                        | 415    | the page above                          |
| an empty body in an unsupported type                | 415    | the page above                          |
| no body and no `Content-Type`                       | 400    | "Unknown or disabled client"            |

The last row is not an exception to the rule. A bodyless POST carries no
representation to reject, so it is a request with no parameters — and a
request with no `client_id` renders the first family's page, exactly as a
parameterless `GET` does.

### `prompt`

```bash
Q='response_type=code&client_id=demo-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&state=xyz-123&code_challenge=hUGit6EJl__NDqDG80Q49rMU-3qeOri8dH1TTe49hmI&code_challenge_method=S256'
for p in none 'none%20login' 'login%20none' 'none%20consent' unheard_of \
         'login%20unheard_of' Login login consent select_account; do
  printf '%-24s ' "prompt=$p"
  curl -sS -o /dev/null -D - \
    "http://localhost:3000/realms/demo/protocol/openid-connect/auth?$Q&prompt=$p" \
    | tr -d '\r' | awk '/^HTTP/{s=$2} /^[Ll]ocation:/{l=$2} END{print s, l}'
done
```

```
prompt=none              302 …/callback?error=login_required&state=xyz-123&iss=…
prompt=none%20login      302 …/callback?error=invalid_request&state=xyz-123&iss=…
prompt=login%20none      302 …/callback?error=invalid_request&state=xyz-123&iss=…
prompt=none%20consent    302 …/callback?error=invalid_request&state=xyz-123&iss=…
prompt=unheard_of        302 …/callback?error=invalid_request&state=xyz-123&iss=…
prompt=login%20unheard_of 302 …/callback?error=invalid_request&state=xyz-123&iss=…
prompt=Login             302 …/callback?error=invalid_request&state=xyz-123&iss=…
prompt=login             200
prompt=consent           200
prompt=select_account    200
```

(The redirect target and `iss` are shortened; both are as elsewhere in this
document.)

Four things are worth separating there.

**`none` is `login_required` for a request carrying no session.** The table
above ran with no cookie, so nothing was there to be silently authenticated
against — still exactly the behaviour OIDC Core §3.1.2.3 describes. A live
`demo-session` cookie changes this row specifically; [Signing in again from
an existing session](#signing-in-again-from-an-existing-session) below is
what it changes to.

**`none` with any other value is an error, not a decision.** §3.1.2.1 makes
the values mutually exclusive. Answering `none login` as if it were a bare
`none` would be this server picking which half of a contradiction the
client meant.

**An undefined value is refused.** §3.1.2.1 leaves that a MAY — a server is
allowed to ignore one instead. A client asking for an interaction this
server has never heard of is better told so than answered as though it had
asked for nothing. `Login` is refused for the same reason: the values are
case-sensitive.

**`prompt=login` renders the form, and so does no `prompt` at all — with no
session.** The table above ran with no cookie, so both forced and
unconditional authentication land on the same 200. They stop agreeing once
a session exists to force past, in the same section below.

### Signing in again from an existing session

`/authorize` reads the `demo-session` cookie the login POST sets (P2b), so
a second authorization request from the same browser can complete without
the form — and `prompt` decides whether that is allowed to happen. This
section runs one login, keeps the cookie, and sends it back three ways.

The first `/authorize`, with a login exactly as [Path
A](#path-a-authorization-code-with-pkce) runs it, keeping the cookie curl
is handed:

```bash
VERIFIER=$(openssl rand -hex 32)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 \
  | openssl base64 | tr '+/' '-_' | tr -d '=')
AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid profile email' \
  --data-urlencode 'state=xyz-live' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/auth" \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

curl -sS -c cookies.txt -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  "http://localhost:3000/realms/demo/login-actions/authenticate"

grep session cookies.txt
```

```
#HttpOnly_localhost	FALSE	/	FALSE	0	demo-session	01a0a540-…
```

The second `/authorize`, the cookie attached, no `prompt` at all — a
different `state`, the same `code_challenge` this session was never asked
to prove twice:

```bash
curl -sS -b cookies.txt -D - -o /dev/null \
  --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=xyz-reuse' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/auth" \
  | grep -i '^location'
```

```
location: http://localhost:8080/callback?code=I81jAkPQ…&state=xyz-reuse&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Fdemo
```

A 302 straight to `redirect_uri`, carrying a fresh `code` — no login form,
no second `set-cookie`, because the session that got this request here
already has one. `prompt=none` succeeds the same way, which is the entire
point of asking for it:

```bash
curl -sS -b cookies.txt -D - -o /dev/null \
  --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=xyz-none' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'prompt=none' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/auth" \
  | grep -i '^location'
```

```
location: http://localhost:8080/callback?code=8VtxFh-h…&state=xyz-none&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Fdemo
```

`prompt=login`, the same live cookie attached, forces the form anyway:

```bash
curl -sS -b cookies.txt -D - -o /dev/null \
  --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=xyz-login' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'prompt=login' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/auth"
```

```
HTTP/1.1 200 OK
content-type: text/html
```

— the login form, `auth_session_id` and all, exactly as a request with no
cookie at all gets. And a request with no cookie still gets
`login_required` under `prompt=none`, unchanged from the row in the table
above:

```bash
curl -sS -D - -o /dev/null \
  --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=xyz-000' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'prompt=none' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/auth" \
  | grep -i '^location'
```

```
location: http://localhost:8080/callback?error=login_required&state=xyz-000&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Fdemo
```

Redeeming a code the reuse redirect issued shows what carrying the session
forward means for `auth_time`. One more reuse, waited out a little first,
then redeemed with the same `$VERIFIER` the login above's `$CHALLENGE` was
built from:

```bash
sleep 5
CODE=$(curl -sS -b cookies.txt --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=xyz-authtime' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/auth" \
  | sed -n 's/.*[Ll]ocation: .*[?&]code=\([^&[:space:]]*\).*/\1/p')

curl -sS \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode "code_verifier=$VERIFIER" \
  "http://localhost:3000/realms/demo/protocol/openid-connect/token" \
  | python3 -c "import sys,json,base64; t=json.load(sys.stdin)['id_token']; p=t.split('.')[1]; p+='='*(-len(p)%4); c=json.loads(base64.urlsafe_b64decode(p)); print(c['auth_time'], c['iat'])"
```

```
1789478841 1789478878
```

`auth_time` is `2026-09-15 13:27:21 UTC`, the login at the top of this
section; `iat` is `2026-09-15 13:27:58 UTC`, this redemption, 37 seconds
later.

`auth_time` is the login's own moment, not the moment this token was
minted 37 seconds later — the fact a client's own `max_age` check
(§3.1.3.7) has to be able to rely on.

**Two clocks end a session, and each was moved on its own to see it.** The
realm's `sso_session_idle_seconds` (default `1800`) runs from the session's
last use and `sso_session_max_seconds` (default `36000`) from when it was
established; `isSessionLive` treats both boundaries as exclusive, and
neither can be waited out inside a document. So this moves each one under
the same live cookie — the idle window by backdating `last_active_at`, the
ceiling by backdating `expires_at` while leaving `last_active_at` at now, so
that the second run cannot pass for the first:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -q -c \
  "update sessions set last_active_at = now() - interval '2000 seconds'
     where id = '01a0ae80-b889-7dea-9674-f40a09becefc';"
```

```
idle-expired, no prompt      200
idle-expired, prompt=none    302 …/callback?error=login_required&state=idle2&iss=…
```

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -q -c \
  "update sessions set last_active_at = now(),
          created_at = now() - interval '40000 seconds',
          expires_at = now() - interval '4000 seconds'
     where id = '01a0ae80-b889-7dea-9674-f40a09becefc';"
```

```
max-expired, no prompt       200
max-expired, prompt=none     302 …/callback?error=login_required&state=max2&iss=…
```

(The same four requests this section already ran, against the same cookie
jar; the session id is the one `grep session cookies.txt` printed above, in
full because a `psql` statement needs it whole.) A dead session is not an
error: with no `prompt` the request is answered with the login form, exactly
as a request carrying no cookie is, and it is `prompt=none` — the client
saying it will not accept an interaction — that turns the same state into
`login_required`. A subject a `verify_email` realm has not verified is
refused on the same two terms.

`sessions` also carries `remembered`, a boolean set at establishment and
never rewritten, and a realm carries `max_sessions_per_browser` (1–32,
default 25) — a CHECK constraint bounding the **setting's own value**, and
also the ceiling `admitSession` evicts a browser's own least recently
active sessions down to before establishing a new one, read from the ids
its cookies already name rather than by subject
(`packages/authn-flows/src/usecase/session-admission.ts`, ADR 0033).
`odudu seed realm --set max_sessions_per_browser=10` changes the stored
value the same way as every other realm setting, and every login after
that is measured against the new ceiling.

A realm also carries the pair a remembered login's session is measured
against instead of `sso_session_idle_seconds`/`sso_session_max_seconds`:
`remember_me_allowed` (boolean, default `false`), `remember_me_idle_seconds`
(60–31536000, default 604800, one week) and `remember_me_max_seconds`
(60–31536000, default 2592000, thirty days), each settable the same way —
`odudu seed realm --set remember_me_idle_seconds=1209600`. Which pair a
session uses is picked by its own `remembered` column
(`packages/authn-flows/src/service/session-lifespan.ts`), set to `true`
when a login ticks the `remember_me` checkbox on a realm that allows it —
see [A remembered login](#a-remembered-login) above.

#### The session cap

A cookie jar, `cap-demo` with `max_sessions_per_browser` lowered to 2,
`odudu seed realm --name cap-demo --set max_sessions_per_browser=2`, three
logins in a row (`prompt=login` on each, so a live session never short-
circuits the form — see [Signing in again from an existing
session](#signing-in-again-from-an-existing-session) for what it would do
otherwise):

```
HTTP/1.1 302 Found
set-cookie: cap-demo-session=01a0ba51-2c09-…; HttpOnly; SameSite=Lax; Path=/
```

```
HTTP/1.1 302 Found
set-cookie: cap-demo-session=01a0ba51-2c09-….01a0ba51-2c7c-…; HttpOnly; SameSite=Lax; Path=/
```

```
HTTP/1.1 302 Found
set-cookie: cap-demo-session=01a0ba51-2c7c-….01a0ba51-2cf3-…; HttpOnly; SameSite=Lax; Path=/
```

(Session ids truncated; each response also carried the cleared persistent
cookie, `Max-Age=0`, omitted here since nothing about it changes.) The
third login's list still holds two ids, not three: `2c09`, the first
login's session, is gone, evicted by `admitSession` as the least recently
active once a third session tried to join a browser already at the cap —
the second and third logins' own ids are exactly what survive. Nothing
asked for this browser to end its oldest session; the realm's setting did.

The three logins above ran one at a time; two genuinely concurrent logins
from the same browser read the cookie before either has written it, so the
browser keeps only the later response's cookie and the earlier response's
session is named by neither. That session is still live, but
[logout](#rp-initiated-logout) resolves the same cookie to decide what it
can end, so it cannot be reached that way — an orphan, not a size problem.
It idles out at `sso_session_idle_seconds` (thirty minutes by default), or
at `remember_me_idle_seconds` (seven days by default) if the losing login
was a remembered one. ADR 0033's amendment has the full account and why it
is accepted rather than fixed now.

#### Choosing among sessions

More than one live session in the same browser — or a client asking with
`prompt=select_account` — answers neither with the login form nor with a
silent reuse: `decideReuse` (`packages/protocol-oidc/src/usecase/session-reuse.ts`)
returns a `select` outcome, `/authorize` renders a chooser instead, and its
own POST, `login-actions/select-account`, is where a pick is honoured or
refused.

A second user seeded into `demo` so this browser can hold sessions for two
subjects at once:

```bash
odudu seed user --realm demo --username bob --password another-horse-battery \
  --email bob@example.com
```

```json
{
  "command": "user",
  "realm": "demo",
  "realmId": "01a0baa4-…",
  "username": "bob",
  "userSubjectId": "01a0baa4-…"
}
```

Two logins, one cookie jar — the second with `prompt=login`, the same way
[the session cap](#the-session-cap) above forces the form past a cookie
that would otherwise short-circuit it:

```bash
VERIFIER=$(openssl rand -hex 32)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 \
  | openssl base64 | tr '+/' '-_' | tr -d '=')

AUTH1=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=alice-login' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/auth" \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

curl -sS -c cookies.txt -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH1" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  "http://localhost:3000/realms/demo/login-actions/authenticate"

AUTH2=$(curl -sS -b cookies.txt --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=bob-login' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'prompt=login' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/auth" \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

curl -sS -b cookies.txt -c cookies.txt -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH2" \
  --data-urlencode 'username=bob' \
  --data-urlencode 'password=another-horse-battery' \
  "http://localhost:3000/realms/demo/login-actions/authenticate"

grep session cookies.txt
```

```
#HttpOnly_localhost	FALSE	/	FALSE	0	demo-session	01a0baa4-73e4-79c2-8aa4-d9c6b73ceef9.01a0baa4-8d3c-7693-9086-0446d49daf22
```

A third `/authorize`, the same cookie jar, no `prompt` at all: the browser
now names two live sessions, so the chooser renders rather than either
login answering on its own:

```bash
curl -sS -b cookies.txt --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=xyz-select' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "http://localhost:3000/realms/demo/protocol/openid-connect/auth" -o chooser.html
cat chooser.html
```

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Choose an account</title></head>
<body>
<h1>Choose an account</h1>
<form method="post" action="/realms/demo/login-actions/select-account">
  <input type="hidden" name="auth_session_id" value="01a0baa4-a055-7f4a-bf3d-9698d36f0d63">
  <button type="submit" name="session_id" value="01a0baa4-73e4-79c2-8aa4-d9c6b73ceef9">ada</button>
  <button type="submit" name="session_id" value="01a0baa4-8d3c-7693-9086-0446d49daf22">bob</button>
  <button type="submit" name="use_other" value="1">Use another account</button>
</form>
</body>
</html>
```

The label on each button is `preferred_username` falling back to
`username` — never `email`, a recovery identifier this page can render on a
shared device — and the value is the session id itself, not the subject:
posting it back is the only way this request ever learns which session was
picked. Picking `ada`'s completes the authorization exactly as an ungated
reuse would, down to the code and the `iss` a mix-up attack would need to
fake:

```bash
AUTH3=$(sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}' chooser.html)
ADA_SESSION=$(grep -o 'name="session_id" value="[^"]*">ada' chooser.html \
  | sed -E 's/.*value="([^"]*)".*/\1/')

curl -sS -b cookies.txt -D - -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH3" \
  --data-urlencode "session_id=$ADA_SESSION" \
  "http://localhost:3000/realms/demo/login-actions/select-account"
```

```
HTTP/1.1 302 Found
location: http://localhost:8080/callback?code=wzxlUc1eWVJ7Bh4lfIAJERWArQUKg6UynM0ntrUFGKU&state=xyz-select&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Fdemo
```

The posted `session_id` is a claim the browser makes, honoured only when it
names a member of the set this same request's own cookies resolve to — the
same defence `login-actions/logout`'s confirmation form uses (see
[RP-initiated logout](#rp-initiated-logout)). A `session_id` naming some
other live session in the realm — one this browser's cookies never
named — is refused with 400, not honoured merely because the session
exists:

```bash
curl -sS -b cookies.txt -o /dev/null -w '%{http_code}\n' \
  --data-urlencode "auth_session_id=$AUTH3" \
  --data-urlencode 'session_id=00000000-0000-0000-0000-000000000000' \
  "http://localhost:3000/realms/demo/login-actions/select-account"
```

```
400
```

(A well-formed but foreign uuid stands in here for a stranger's real
session id — see `packages/protocol-oidc/tests/select-account.int.test.ts`
for the version of this with an actual second browser's live session,
which is what the integration suite proves this refusal against.)

`use_other=1` in place of `session_id` falls through to the ordinary login
form instead, on the same parked authentication session — nobody was ever
bound to it, so a fresh set of credentials starts it exactly as if the
chooser had never rendered:

```bash
curl -sS -b cookies.txt -o /dev/null -w '%{http_code}\n' \
  --data-urlencode "auth_session_id=$AUTH3" \
  --data-urlencode 'use_other=1' \
  "http://localhost:3000/realms/demo/login-actions/select-account"
```

```
200
```

### `id_token_hint`

A hint is checked against the realm's own keys and issuer before anything
else about the request is acted on (OIDC Core §3.1.2.2), and then — at
`/authorize` only — against the `client_id` making this request: an ID
Token's `aud` names the client it was issued to, and a hint minted for one
client is refused from another even though its signature and issuer are
this realm's own. Mint one by completing Path A and keeping the `id_token`;
mint another by doing the same for a second client in the same realm, and a
third by doing the same in a second realm:

```bash
odudu seed \
  --realm demo --client demo-spa-2 \
  --redirect-uri http://localhost:8080/callback2

odudu seed \
  --realm other --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@other.example
```

`$ID_TOKEN` from the bootstrap block is a hint `demo-spa` can use.
`$ID_TOKEN2` is Path A run again for `demo-spa-2` against the same realm;
`$ID_TOKEN3` is Path A run against `/realms/other/` instead:

```bash
curl -sS -o /dev/null -D - --get --data-urlencode "id_token_hint=$ID_TOKEN2" \
  "http://localhost:3000/realms/demo/protocol/openid-connect/auth?$Q" \
  | tr -d '\r' | awk '/^HTTP/{s=$2} /^[Ll]ocation:/{l=$2} END{print s, l}'
```

| `id_token_hint`                                                        | Answer                      |
| ---------------------------------------------------------------------- | --------------------------- |
| `not.a.jwt`                                                            | 302 `error=invalid_request` |
| An ID token issued by the realm `other`                                | 302 `error=invalid_request` |
| An ID token this realm issued to `demo-spa-2`, at `demo-spa`'s request | 302 `error=invalid_request` |
| An ID token this realm issued to `demo-spa`, at `demo-spa`'s request   | 200, the login form         |
| With `prompt=none`, a hint this realm issued for the requesting client | 302 `error=login_required`  |
| With `prompt=none`, any unusable hint                                  | 302 `error=invalid_request` |

The last two rows are the ordering. An unusable hint is refused as a
malformed request rather than answered with the prompt's own
`login_required`: `prompt=none` decides how to answer a request, and a
request carrying a hint this server cannot read is not yet a request to
answer that way.

An access token this realm minted for the same user is refused too, and for
two independent reasons rather than one: it carries `typ: at+jwt` (RFC 9068
§2.1), which the hint check demands a JWT not be, _and_ its own `aud` is
this realm's issuer (RFC 9068 §2.2) rather than the requesting client, which
the check above now also refuses. Deleting either check on its own still
leaves this token refused by the other — `docs/protocols/oidc-core.md`'s
reading note has the reasoning for both. `/userinfo` makes the mirror image
of the `typ` check of the token presented to it.

The realm row is the point of the whole check that predates the client
check above. Both tokens are RS256, both have the shape of an ID token, and
both were signed by this server — by a different realm's key. Only the
realm named in the URL has its keys consulted, so the second is refused
exactly like a forgery.

`/logout` shares this same signature-and-issuer check on its own
`id_token_hint`, but not the client check: RP-Initiated Logout §2 gives it
a different comparison to make instead, against an optional `client_id`
parameter — see [RP-initiated logout](#rp-initiated-logout) below.

What a valid hint then does is in [The login POST](#the-login-post): it
names who the response is about, and a different user signing in against
that request is answered `login_required` rather than with a code.

### The shape of `code_challenge`

RFC 7636 §4.1 and §4.2 give the verifier and the challenge one shape: 43 to
128 characters of unreserved ASCII (`A-Z a-z 0-9 - . _ ~`). A base64url
SHA-256 digest is 43 of them, unpadded.

| `code_challenge`              | Answer                      |
| ----------------------------- | --------------------------- |
| 43 `a`s                       | 200, the login form         |
| 128 `a`s                      | 200, the login form         |
| 42 `a`s                       | 302 `error=invalid_request` |
| 129 `a`s                      | 302 `error=invalid_request` |
| 43 characters including a `+` | 302 `error=invalid_request` |
| 43 characters including a `=` | 302 `error=invalid_request` |

`+` and `=` are what standard base64 produces and base64url does not: a
client that forgot to translate its alphabet, or left the padding on, is
told here rather than at `/token` sixty seconds later with an
`invalid_grant` that says nothing about why.

### Empty values, and repeated ones

An empty-valued parameter is read as an absent one, everywhere. That is not
a shortcut: a request carrying `scope=` and one carrying no `scope` express
the same thing, and answering them differently would make the presence of
an `&scope=` in a URL builder's output load-bearing.

| Request                    | Answer                                      |
| -------------------------- | ------------------------------------------- |
| `scope=` (empty)           | 200 — the default scope, as with no `scope` |
| `nonce=` (empty)           | 200 — no `nonce` claim in the ID token      |
| `state=` (empty), erroring | 302 with **no** `state` in the response     |
| `response_type=` (empty)   | 302 `error=unsupported_response_type`       |
| `client_id=` (empty)       | 400 rendered, "Unknown or disabled client"  |
| `redirect_uri=` (empty)    | 400 rendered, "Unregistered redirect URI"   |
| An unrecognized parameter  | 200 — ignored, and never reflected back     |

The last two 400s are the render-versus-redirect boundary again: an empty
`client_id` names nobody, and an empty `redirect_uri` is nowhere to send
anything, so neither can be reported by redirecting.

A **repeated** parameter is the opposite — always an error, never resolved
by taking one of the values. Which kind of error depends on which parameter
it is, and that difference is the boundary once more:

| Repeated parameter             | Answer                                                  |
| ------------------------------ | ------------------------------------------------------- |
| `client_id`                    | 400 rendered, "Repeated client_id parameter"            |
| `redirect_uri`                 | 400 rendered, "Repeated redirect_uri parameter"         |
| `response_type`                | 400 rendered, "Repeated response_type parameter"        |
| `response_mode`                | 400 rendered, "Repeated response_mode parameter"        |
| `state`, `scope`, or any other | 302 `error=invalid_request`, carrying the first `state` |

The first two are the §4.1.2.1 split: two `client_id`s or two
`redirect_uri`s mean the server has not established that this redirect
target belongs to this client, and picking whichever parsed first is
exactly the check being defeated. `response_type` and `response_mode`
select how a response is delivered, so two of them name two delivery
mechanisms and there is no single channel to deliver an error over either.
Everything else has a trustworthy target by the time it is noticed, so the
client is told.

### The login POST

| Request                                      | Answer                                         | Why                                                                                                                                                                                      |
| -------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong password                               | 200, the sign-in form again, same session id   | The session is live and can be retried; nothing is consumed                                                                                                                              |
| Unknown username                             | 200, the sign-in form again                    | Indistinguishable from a wrong password, and the credential query is still issued so the timing matches                                                                                  |
| Any password, while the account is locked    | 200, the sign-in form again                    | Byte-identical to a wrong password, and reached after the same verification, so neither the page nor the timing says the account is locked ([Brute-force lockout](#brute-force-lockout)) |
| A password over 256 characters               | 400, "Password must be at most 256 characters" | Refused at the read, before the Argon2id verification, so it costs nothing and counts no failure against the account                                                                     |
| Any submission over the per-origin budget    | 429, `Retry-After`, empty body                 | Decided before the body is parsed, so it is the same refusal whatever was submitted ([The per-origin throttle](#the-per-origin-throttle))                                                |
| No `auth_session_id`                         | 400, "This sign-in attempt is no longer valid" | That field is the form's CSRF defence; a submission without it is not a submission from the form                                                                                         |
| Unknown or expired `auth_session_id`         | 400, same page                                 | Folded together deliberately: neither names a live parked request                                                                                                                        |
| A second submit of a consumed session        | 400, same page                                 | The atomic consume is what stops a back-button press minting a second session and a second code                                                                                          |
| Right password, wrong `id_token_hint`ed user | 302 `error=login_required` to the client       | A positive response is for the end user the hint identifies. The session is left unconsumed, so the right user can still sign in against the same parked request                         |

The last one, both halves, run against one parked request:

```
# bob signs in against a request hinted for ada
location: …/callback?error=login_required&state=xyz-123&iss=…
# ada then signs in against the same parked request
location: …/callback?code=8M123PGvRXNW…&state=xyz-123&iss=…
```

(Code truncated.)

### `/token`

Checked in order: request shape, then client authentication, then the
grant. A malformed request is `invalid_request` before any client is looked
up, verified by sending no `grant_type` with an unknown `client_id` and
getting `invalid_request` rather than `invalid_client`.

| Request                                                 | Status | Body                     |
| ------------------------------------------------------- | ------ | ------------------------ |
| No `grant_type`                                         | 400    | `invalid_request`        |
| `grant_type=password`                                   | 400    | `unsupported_grant_type` |
| `authorization_code` with no `code` or `redirect_uri`   | 400    | `invalid_request`        |
| `refresh_token` with no `refresh_token`                 | 400    | `invalid_request`        |
| Unknown `client_id`                                     | 401    | `invalid_client`         |
| Wrong client secret                                     | 401    | `invalid_client`         |
| Secret in the body from a `client_secret_basic` client  | 401    | `invalid_client`         |
| Secret in the header from a `client_secret_post` client | 401    | `invalid_client`         |
| Both methods presented at once                          | 401    | `invalid_client`         |
| A `Basic` header that is not a form-urlencoding         | 401    | `invalid_client`         |
| Public client presenting a secret                       | 401    | `invalid_client`         |
| Public client asking for `client_credentials`           | 401    | `invalid_client`         |
| Confidential client with no service account             | 400    | `unauthorized_client`    |
| Unknown, expired or replayed `code`                     | 400    | `invalid_grant`          |
| Wrong or missing `code_verifier`                        | 400    | `invalid_grant`          |
| `redirect_uri` different from the code's                | 400    | `invalid_grant`          |
| A different client redeeming the code                   | 400    | `invalid_grant`          |
| Unknown, expired or replayed `refresh_token`            | 400    | `invalid_grant`          |
| Another client's `refresh_token`                        | 400    | `invalid_grant`          |
| Another realm's `code` or `refresh_token`               | 400    | `invalid_grant`          |
| Refresh or `client_credentials` asking for wider scope  | 400    | `invalid_scope`          |
| Any parameter sent twice, even with identical values    | 400    | `invalid_request`        |
| A required parameter sent with an empty value           | 400    | `invalid_request`        |
| An empty `client_id` from a public client               | 401    | `invalid_client`         |
| `GET` instead of `POST`                                 | 404    | —                        |

Every 401 carries `WWW-Authenticate: Basic realm="token"`. Every response,
success or failure, carries `cache-control: no-store` and `pragma:
no-cache`.

RFC 6749 §2.3.1 puts both halves of the `Basic` payload through
`application/x-www-form-urlencoded` before the base64, which is what lets a
secret containing `:` or `%` survive the round trip. A conforming client
sends `%25` for a literal `%`; `curl -u` encodes nothing, so an operator
whose secret contains one reaches that row with an ordinary command. The
header never parses, so the refusal comes before any client is looked up and
does not depend on the secret being the registered one:

```bash
curl -sS -D - \
  -u 'demo-backend:sec%ret' \
  --data-urlencode 'grant_type=client_credentials' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

```
HTTP/1.1 401 Unauthorized
www-authenticate: Basic realm="token"
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{"error":"invalid_client"}
```

Those bytes are not a form-urlencoding and hold no secret to recover, so
they are refused rather than read literally — reading them literally would
leave one registered secret with two accepted spellings on the wire. The
refusal is the same `invalid_client` as every other failed client
authentication, which is what keeps this failure from being distinguishable
from the rest.

Two deliberate silences. Every client-authentication failure reports the
same `invalid_client` and never which check failed, so probing cannot
enumerate clients or distinguish "no such client" from "wrong secret". Every
authorization-code failure reports the same `invalid_grant` (RFC 6749 §5.2),
so an attacker holding a stolen code cannot learn whether it was the PKCE
check or the client check that turned them away.

The expired-code row was verified by waiting out the 60-second lifetime and
redeeming: `{"error":"invalid_grant"}`. Refresh-token expiry was not waited
out — the lifetime is 14 days — but expiry, reuse and an unknown token all
leave the same atomic consume returning nothing, and so answer identically.

`unauthorized_client` is the one row with no command above it. The seed
command always provisions a confidential client with a service account, so
the compose stack cannot produce a client that lacks one; the row's evidence
is `packages/protocol-oidc/tests/client-credentials.int.test.ts`, which
builds that client against a real database. It is distinct from
`invalid_client` on purpose: the client is who it says it is, and the
refusal is about how it was provisioned (RFC 6749 §5.2).

#### Client authentication is by the registered method and no other

`client_credentials` is the shortest request that authenticates a client,
so it makes the clearest demonstration. `demo-backend` is registered
`client_secret_basic`, `demo-post` is registered `client_secret_post`, and
`demo-spa` is public.

```bash
curl -sS -u demo-backend:demo-backend-secret \
  --data-urlencode 'grant_type=client_credentials' \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

| How the client presents itself                    | Status | Body                         |
| ------------------------------------------------- | ------ | ---------------------------- |
| `demo-backend`, secret in the header (registered) | 200    | an access token              |
| `demo-backend`, secret in the body                | 401    | `{"error":"invalid_client"}` |
| `demo-post`, secret in the body (registered)      | 200    | an access token              |
| `demo-post`, secret in the header                 | 401    | `{"error":"invalid_client"}` |
| `demo-backend`, both at once                      | 401    | `{"error":"invalid_client"}` |
| `demo-backend`, header plus `client_secret=`      | 200    | an access token              |
| `demo-backend`, wrong secret                      | 401    | `{"error":"invalid_client"}` |
| `demo-spa` (public) asking for this grant         | 401    | `{"error":"invalid_client"}` |
| `demo-spa` presenting any secret                  | 401    | `{"error":"invalid_client"}` |
| A `client_id` naming nobody                       | 401    | `{"error":"invalid_client"}` |

The sixth row is the one worth pausing on. An empty `client_secret` beside
an `Authorization: Basic` header is **not** a second authentication method:
RFC 6749 §2.3.1 forbids presenting more than one, and an empty parameter is
an absent one, here as everywhere. Counting it would refuse a request that
succeeds with the parameter left out, which is a difference no
client should be able to trip over.

The 401 carries the challenge:

```
HTTP/1.1 401 Unauthorized
www-authenticate: Basic realm="token"
cache-control: no-store
pragma: no-cache
```

#### Repeated and empty parameters at `/token`

RFC 6749 §3.2 says a parameter may be sent at most once, and does not make
an exception for a duplicate that agrees with itself. A code redeemed with
`grant_type` sent twice, identically, is `invalid_request` — and the code
is **not** consumed by the refusal, so the same code redeems on the next
attempt:

```bash
curl -sS --data "grant_type=authorization_code&grant_type=authorization_code&code=$CODE&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&client_id=demo-spa&code_verifier=$VERIFIER" \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

```json
{ "error": "invalid_request" }
```

```bash
# the same code, each parameter sent once
curl -sS --data-urlencode 'grant_type=authorization_code' --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' --data-urlencode "code_verifier=$VERIFIER" \
  'http://localhost:3000/realms/demo/protocol/openid-connect/token'
```

```json
{ "access_token": "eyJhbGciOiJSUzI1NiIsImt…", "…": "…" }
```

An empty required parameter reads as an absent one, and is the same
`invalid_request` — run for `grant_type=`, `code=` and `redirect_uri=` in
turn, after which the untouched code still redeemed. An empty `client_id`
from a public client is a client that named itself not at all, so it is
`invalid_client` rather than `invalid_request`; the same code redeemed
afterwards once the `client_id` carried a value.

#### The refusals that deliberately consume nothing

Both single-use credentials here are destroyed by being used, and one of
them takes the whole grant with it when it is replayed. That makes it worth
knowing exactly which refusals are reachable by somebody who is not the
holder — because any of those that consumed the credential would be a way
to destroy a stranger's session on demand.

Run against one authorization code, in order, before redeeming it:

```
wrong code_verifier      {"error":"invalid_grant"}
wrong redirect_uri       {"error":"invalid_grant"}
a different client       {"error":"invalid_grant"}
no code_verifier at all  {"error":"invalid_grant"}
the correct redemption   {"access_token":"eyJhbGciOiJSUzI1NiIsImt…
```

Four refusals, and the code still worked: each attempt is rolled back
whole. The same for a refresh token — another client presenting it, and its
own client asking for scope it was never granted, both refused without
rotating anything, after which the owner's token refreshed normally. That
transcript is in [Path B](#what-a-replay-does-not-do).

And across realms, where the credential is real but presented at the wrong
tenant:

| Presented at realm `demo`                 | Answer                      | Afterwards, at realm `other` |
| ----------------------------------------- | --------------------------- | ---------------------------- |
| A `code` issued by realm `other`          | `{"error":"invalid_grant"}` | still redeems                |
| A `refresh_token` issued by realm `other` | `{"error":"invalid_grant"}` | still refreshes              |

The realm in the URL is the only tenant whose rows the query can see (ADR
0009), so the credential is not found rather than found and rejected — and
nothing in the other realm is touched, which is what the second column
proves.

### `/userinfo`

| Request                                    | Status | `WWW-Authenticate`                                 | Why                                                                               |
| ------------------------------------------ | ------ | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET` with the token in the header         | 200    | —                                                  | RFC 6750 §2.1, the method every client should use                                 |
| `POST` with the token in the header        | 200    | —                                                  | OIDC Core §5.3 requires both methods, answering identically                       |
| `POST` with `access_token=` in a form body | 200    | —                                                  | RFC 6750 §2.2, the only other transmission method accepted                        |
| No `Authorization` header                  | 401    | `Bearer realm="userinfo"`                          | No credentials were presented, so no error code (RFC 6750 §3.1)                   |
| Unparseable or unsigned token              | 401    | `…, error="invalid_token"`                         | —                                                                                 |
| An ID token presented as the bearer        | 401    | `…, error="invalid_token"`                         | `typ` must be `at+jwt`; the same key signed both, so `typ` is what separates them |
| Another realm's access token               | 401    | `…, error="invalid_token"`                         | Verified against this realm's keys only, so it is a forgery from here             |
| Token in the header _and_ the body         | 400    | `…, error="invalid_request"`                       | More than one transmission method (RFC 6750 §3.1)                                 |
| Valid token without `openid` scope         | 403    | `…, error="insufficient_scope"`                    | A distinct answer, so a valid-but-unscoped token is not confused with a bad one   |
| `POST` with a JSON body                    | 415    | (`accept-post: application/x-www-form-urlencoded`) | RFC 6750 §2.2 fixes the form-encoded method's content type                        |
| Unknown realm                              | 404    | —                                                  | —                                                                                 |

Failures here carry no response body: this endpoint answers a machine, and
reports in headers.

The two accepted transmission methods are accepted one at a time. Sending
the token both ways in one request is `invalid_request` — RFC 6750 §3.1
again, and a request carrying two credentials has not said which one it is
asking to be judged on:

```bash
curl -sS -D - -H "Authorization: Bearer $ACCESS_TOKEN" \
  --data-urlencode "access_token=$ACCESS_TOKEN" \
  http://localhost:3000/realms/demo/protocol/openid-connect/userinfo
```

```
HTTP/1.1 400 Bad Request
www-authenticate: Bearer realm="userinfo", error="invalid_request"
content-length: 0
```

The form-encoded method has exactly one content type, so a `POST` body in
any other is refused with the type it does take named in the response,
rather than with a guess at what the body meant:

```bash
curl -sS -D - -X POST -H 'content-type: application/json' \
  --data "{\"access_token\":\"$ACCESS_TOKEN\"}" \
  http://localhost:3000/realms/demo/protocol/openid-connect/userinfo
```

```
HTTP/1.1 415 Unsupported Media Type
accept-post: application/x-www-form-urlencoded
content-length: 0
```

### Realm resolution

An unknown realm is 404 at `/token`, `/userinfo`, `/certs` and the discovery
document, and a rendered `invalid_client` page at `/authorize`. All five
run:

```
/realms/nope/.well-known/openid-configuration   404
/realms/nope/protocol/openid-connect/certs      404
/realms/nope/protocol/openid-connect/token      404
/realms/nope/protocol/openid-connect/userinfo   404
/realms/nope/protocol/openid-connect/auth       400   (the rendered page)
```

`/authorize` is the odd one because it has a page to render and the others
do not, and its page is the same "Unknown or disabled client" a live realm
shows for a `client_id` it does not know — so a probe cannot tell a missing
realm from a missing client.

A disabled realm takes the same branch in the same lookup, so it is never
distinguishable from one that never existed; that half was not exercised
here, because nothing can disable a realm yet.

Realm isolation goes further than the URL, and the credentials prove it:
an authorization code, a refresh token, an access token and an
`id_token_hint` issued by one realm are each refused by another. The two
that are single-use — the code and the refresh token — were then presented
again at the realm that issued them, and both still worked, so the refusal
consumed nothing. Those runs are above, under `/token`, `/userinfo` and
`id_token_hint` respectively.

## What to do next, from wherever you are

**From a rendered error page at `/authorize`.** The client never sees it.
Something about the client's registration is wrong — the `client_id`, the
`redirect_uri`, the realm in the URL. Fix the request, or the registration,
and start again. Nothing was created server-side.

**From a redirect carrying `error`.** Match `state` to the request you
started, check `iss`, and give up on this attempt. `login_required` has two
causes: `prompt=none` forbade the interaction that was needed, in which
case retry without `prompt`; or the request carried an `id_token_hint` and
somebody else signed in, in which case retrying unchanged will keep failing
until the hinted user is the one at the keyboard.
`invalid_scope`, `unsupported_response_type`, `request_not_supported` and
the PKCE `invalid_request`s are bugs in the client, not transient failures;
retrying unchanged produces the same answer.

**From a `code`.** Verify `state` and `iss` first. Then redeem it at
`/token` with the same `redirect_uri` and the `code_verifier` you kept,
within 60 seconds, exactly once. Do not retry a redemption that returned
`invalid_grant` — if it succeeded once, retrying revokes the grant you just
received.

**From an access token.** Send it as `Authorization: Bearer …` to
`/userinfo` or to your own API. It lives 300 seconds. A resource server
validating it should verify the signature against the realm's JWKS, then
`typ: at+jwt`, `iss`, `exp`, and that it is named in `aud` — and then check
`scope` for whatever the call requires. There is no introspection endpoint,
so this is local validation only; the token stays valid until `exp` even if
its grant has since been revoked.

**From a refresh token.** Present it at `/token` when the access token is
about to expire, and **replace your stored copy with the one that comes
back**. Never retry a refresh with the token you already sent: that is
indistinguishable from a stolen token being replayed, and it revokes the
family. If a refresh returns `invalid_grant`, discard everything and start
Path A over — the grant is gone, whether through reuse detection, expiry, or
a replayed authorization code.

**From an ID token.** It is for the client, not for an API — never send it
as a bearer token; `/userinfo` refuses it. Verify it, read `sub`, `name` and
`email` from it, and then it has done its job.

**From `invalid_client` at `/token`.** Check which method the client is
registered for. Presenting the right secret the wrong way is refused exactly
like the wrong secret.

## What is not implemented

Every item below is in one of two states, and says which: **planned**, with
the phase that brings it, or **a decision**, with the clause or the ADR that
settles it. Nothing here is unplaced — the five items that were until
2026-09-17 are P13, and `tests/docs/not-implemented-placement.test.ts` fails
the build on an item that names neither a phase nor a decision, because an
unplaced gap in a list this long is indistinguishable from a forgotten one.
Phases are section 11 of
`docs/superpowers/specs/2026-09-10-odudu-design.md`, where the second phase
is two: **P2a** is the identity model — roles, groups, client scopes,
per-client web origins, email — and **P2b** is credentials, MFA and the
session lifecycle. A citation of either half here means that half.

**`/authorize`**

- **`display`, `ui_locales`, `claims_locales` and `login_hint` are accepted
  and ignored**, including values none of them define, such as
  `display=unheard_of`; every one of those requests answers 200 with the
  ordinary login form. A decision, not a gap: OIDC Core §15.1 asks of
  `display` that "the minimum level of support required for this parameter
  is simply that its use must not result in an error", and says the same of
  `ui_locales` and `claims_locales`. `login_hint` is OPTIONAL in §3.1.2.1
  and prefills a form this server does not prefill. `prompt` is deliberately
  not treated this way, because it is the one that changes whether the end
  user is asked anything at all.
- **`acr_values` is accepted and ignored on the request side.** §15.1 allows
  exactly that — "the minimum level of support required for this parameter
  is simply to have its use not result in an error" — so what happens today
  conforms. Every ID token now carries `acr` and `amr` describing the login
  that actually happened (`acrFor`/`amrFor`,
  `packages/protocol-oidc/src/service/acr.ts`) — `amr` names the RFC 8176
  values for the authenticators that ran (`pwd` for a password, nothing for
  an authenticator the registry has no accurate entry for), and `acr` is
  `'1'` for a single factor or `'2'` for two, including a passkey alone.
  Checking a _requested_ `acr_values` against a session, or forcing
  reauthentication to satisfy one, is step-up authentication: **P13**, whose
  criterion names it, beside PAR and DPoP and the FAPI 2.0 decision ADR 0016
  points at.
- **No request objects.** `request` and `request_uri` are refused explicitly,
  with `request_not_supported` and `request_uri_not_supported` — which is
  what OIDC Core §6.1 asks of an OP that does not support them, having first
  said "Support for the `request` parameter is OPTIONAL". Pushed
  authorization requests (PAR, RFC 9126) are **P13** for the same reason as
  DPoP: both are prerequisites of the FAPI 2.0 profiles ADR 0016 identifies,
  and P13's criterion is that plan passing, which neither omission survives.
- **PKCE is mandatory with no exception** and no per-client opt-out. This is
  a decision, not a gap: ADR 0016. A relying party that cannot do PKCE
  cannot use Odudu.
- **Only `response_type=code` and `response_mode=query`.** Also a decision.
  OAuth 2.1 removes the implicit grant, so OIDC Core's Implicit (§3.2) and
  Hybrid (§3.3) flows are out of scope by construction — the clause table in
  `docs/protocols/oidc-core.md` records them as `n/a` for that reason — and
  with no flow that returns a response in the fragment there is no second
  `response_mode` to offer. `response_modes_supported` states `["query"]`
  rather than being omitted so that the advertisement matches.
- **`resource` (RFC 8707 §2) is validated, but not yet checked for a query
  component** (**P3b**, per `rfc8707.md`'s own `deferred: P3b` row for this
  SHOULD). A single value is checked as an absolute URI with no
  fragment, against the client's registered `audiences`; two values or one
  outside that list refuse with `error=invalid_target`, on the same
  post-boundary redirect every other refusal here uses
  (`parseResource`, `packages/protocol-oidc/src/service/resource-indicator.ts`).
  `?resource=` alone, and a repeat where one value is empty
  (`resource=<uri>&resource=`), both resolve as RFC 6749 §3.1 resolves any
  other empty-valued parameter here — as omitted — rather than as a
  refusal or a second value; only two genuinely distinct values are a
  repeat. Omitting it resolves to the client's whole registered list, and
  a client
  with no registered audience — every client in this repository, today —
  still succeeds with an empty one rather than being refused. `[]` on the
  stored column has exactly one meaning: the resolved audience is empty,
  never "not carried" — every door that mints a code resolves and stores
  the same value: immediate session-reuse at `/authorize`, an ordinary
  first-time form login, the account chooser, and the consent step, which
  either a fresh login or a reuse promotion can detour through. The value
  is parked on the authentication session's own
  `PendingRequest.resource` between the request and whichever door
  completes it. `/token` now derives `aud` from this column — see the
  `resource` paragraph under [step 4](#4-token) of the walkthrough. What is
  still not there is RFC 8707 §2's SHOULD that a `resource` value carry no
  query component (**P3b**, `rfc8707.md`'s own `deferred: P3b` row for
  it), which `parseResource` does not check.

**Login**

- **Password, TOTP, passkey and recovery codes all sign somebody in.**
  The executor runs a realm's own ordered `authentication_executions`
  (REQUIRED/ALTERNATIVE/CONDITIONAL/DISABLED) through a registry keyed by
  authenticator name, and a login resumes across steps rather than
  restarting — a satisfied authenticator is never asked for twice, even
  across a rejected attempt at whatever comes after it. `otp` runs for any
  subject holding a TOTP credential
  ([Two-factor authentication with TOTP](#two-factor-authentication-with-totp)),
  and `passkey` signs a subject in with no username at all
  ([Signing in with a passkey](#signing-in-with-a-passkey-and-no-username)).
  `passkey` and `password` share an ALTERNATIVE group and a group offers one
  form at a time, so the passkey step is applicable to a submission that
  actually carries an assertion; with nothing submitted the group falls
  through to the password, whose page is what offers the passkey button.
  `recovery-code` is applicable on the same terms — only to a submission
  carrying one — which is how it substitutes for the OTP step instead of
  competing with it ([Recovery codes](#recovery-codes)).
  What is not there: any way to **change** a realm's flow.
  `authentication_executions` has an insert and nothing else, so the rows
  `provisionBrowserFlow` writes are what a realm has for good unless somebody
  edits the table. A flow editor is **P4**, with the rest of the admin
  surface.
- **Recovery codes are issued once and shown once.** Ten per subject, each
  Argon2id-hashed in its own credential row, offered by the
  `generate-recovery-codes` required action that enrolling either second
  factor adds. There is no way to see them again and no administrator
  surface that can print them, by construction rather than by omission.
  Spending the last one owes the action again, in the login that spent it —
  so a list runs out into a fresh set rather than into a lockout.
  What is not there yet: no way for a subject to ask for a fresh set _before_
  they run out, and no warning as the list gets short — self-service
  credential management is the account console, which is **P4**'s. And **no rate
  limit on re-issuing**: while the action is owed, each login submission
  with a valid password renders the page again, which costs ten Argon2id
  hashes and eleven row writes. Bounded by holding the password and by
  acknowledging the page, but a heavier multiplier than the verification one
  above; the per-account lockout counts failures and so reaches neither,
  and the per-origin throttle is what bounds both — ten submissions a
  minute per client address, which is a budget on the multiplier rather
  than a fix for it.
- **The account-lifecycle flows exist, and none of them mails on the
  request path.** Address verification
  (`GET /realms/{realm}/login-actions/action-token`,
  [Address verification](#address-verification)), self-registration
  (`GET`/`POST /realms/{realm}/login-actions/registration`,
  [Self-registration](#self-registration)) and password reset
  (`GET`/`POST /realms/{realm}/login-actions/reset-password`,
  [Password reset](#password-reset)) all exist now, gated by their own
  realm setting, each off by default. A realm with `verify_email` on
  refuses to complete a login for a self-registered address until it is
  verified — no authorization code, not just a page saying so. Each queues
  its mail in `email_outbox` and answers; a pass of its own sends it
  ([Sending queued mail](#sending-queued-mail-odudu-send-mail)), which is
  what closed the reset endpoint's timing oracle. What is not there yet:
  per-realm SMTP configuration — the transport is one set of
  `ODUDU_SMTP_*` variables for the whole server. That is **P4**: it is realm
  configuration carrying a credential, and the per-realm secret it needs
  already has a home in the key-encryption interface §5 puts the signing key
  behind.

- **The sign-in, error and consent pages are hardcoded HTML**, dependency-free
  with every interpolated value escaped. Theming and per-client branding are
  **P4b**, split out of P10 on 2026-09-17 because P10's criterion tested
  provider loading and would have passed with no theming at all. The
  variation it has to cover is visible in **P2a**'s registration and
  verification pages, **P2b**'s second-factor, recovery-code,
  change-password and logout pages, and **P3a**'s own consent page.

**`/token`**

- **No token exchange (RFC 8693)**, and so none of the delegation the agent
  identity layer is built on. **P5.**
- **No CIBA.** **P5**, whose exit criterion is CIBA approvals end to end.
- **No device authorization grant.** **P13**, whose criterion names a
  device-code client completing a login on a second device. It shares that
  phase with PAR, DPoP and step-up authentication for scheduling rather than
  for any protocol reason — RFC 8628 has nothing to do with FAPI, and the
  roadmap says so.
- **No resource owner password credentials.** A decision: the grant is
  removed by OAuth 2.1, and it is not coming back.
- **No `private_key_jwt` or mTLS client authentication.** **P3b**, whose exit
  criterion names both.
- **No DPoP or other sender-constrained tokens**, mTLS-bound tokens
  included. **P13**, as above: the FAPI 2.0 plan cannot pass without one of
  them.

**`/userinfo`**

- **No signed or encrypted UserInfo responses. JSON only.** Not a
  conformance gap: OIDC Core §5.3.2 requires the claims to be "returned as
  the members of a JSON object unless a signed or encrypted response was
  requested during Client Registration". A client can now request one —
  `userinfo_signed_response_alg`, `userinfo_encrypted_response_alg` and
  `userinfo_encrypted_response_enc` are registration metadata
  ([Dynamic client registration](#dynamic-client-registration)) and are
  stored — but `/userinfo` reads none of the three yet and answers JSON
  regardless of what a client registered. Delivering on what is already
  stored is **P3b**, whose exit criterion names signed and encrypted
  UserInfo responses for that reason.
- **No `claims` request parameter.** A decision: §5.5 says "Support for the
  `claims` parameter is OPTIONAL", and the two ID Token clauses that depend
  on it are deferred to **P3b**. P3a built the per-client machinery and
  consent screen the parameter needs, but P3a's own criterion never named
  the parameter itself and nothing in its plan built it, so it moves to
  P3b, filed beside the signed and encrypted UserInfo responses above,
  which read the same per-client registration data.
- **No aggregated or distributed claims.** A decision, and the specification
  is explicit: §5.6.2 says "Normal Claims MUST be supported. Support for
  Aggregated Claims and Distributed Claims is OPTIONAL." No phase is owed
  one.
- **No admin-configurable protocol mappers.** The claim registry
  (`standardClaimMappers`, the 22 names in `claims_supported`) and the
  role/group claims alongside it are fixed by the server, not by anything a
  realm operator can add or change. Reconfiguring what a scope maps to —
  Keycloak's protocol mapper concept — is **P4**'s, alongside the rest of
  the admin surface. `entitlements`, in particular, is deliberately never
  advertised: there is no notion of one in this identity model yet, and
  `packages/protocol-oidc/tests/claims-supported.int.test.ts` fails the
  build if it appears in a live discovery response.

**Endpoints that do not exist at all**

- **Token introspection (RFC 7662) and revocation (RFC 7009).** **P3b**,
  whose exit criterion names both. Until then a resource server validates
  access tokens locally against the JWKS, and ending a session or revoking
  a grant — including through [RP-initiated logout](#rp-initiated-logout) —
  does not invalidate an already-issued access token before its `exp`.
- **No administrative way to end somebody else's session.** Listing a
  subject's sessions and ending one is **P4**, with the rest of the admin
  surface, because until there is an admin API there is nowhere to put it.
- **Any admin API.** **P4.** The seed command and
  [dynamic client registration](#dynamic-client-registration) are the only
  administrative surfaces — the former for a realm's first user, client and
  signing key, the latter for a client a realm has opened itself to — and
  neither can add a user to an existing client, disable anything, rotate a
  key, or delete anything.
- **SAML, LDAP federation, identity brokering, authorization services.**
  P6–P9.

**Operational**

- **TLS is terminated in front of this server, never by it.** A deployment
  decision rather than a gap, and one the server enforces: it speaks plain
  HTTP, and with `NODE_ENV=production` refuses to boot until `ODUDU_TLS=true`
  asserts that something in front of it is doing that job. Consequently the
  issuer is `http://` on the local stack, and the session cookie drops its
  `__Host-` prefix and `Secure` attribute (ADR 0020) — correct for local
  development, unacceptable anywhere else.
- **One instance only.** Migrations run on boot from every process with no
  advisory lock, so replicas would race. **P11.**
- **No published image, no release process, no secret store beyond the
  process environment, and no backup or restore guidance.** **P12**,
  Operational readiness, appended on 2026-09-14 because none of it had a
  phase. Its position in the table is not a dependency: publishing an image
  waits on nothing, and `README.md` says what can be pulled forward.
- **Key rotation is not implemented.** A realm has one active signing key,
  created when it is seeded; the shape supports more than one, and the
  operation that would create a second does not exist. **P4**, whose exit
  criterion now names promoting a new key and retiring the one it replaces
  on the overlap window the design specification states. It landed there
  rather than in P3a or P3b because no relying party's request triggers a
  rotation:
  it is an operator action, and it needs the authenticated administrator,
  the audit event and the surface to trigger it from that P4 is the phase
  for.
- **Expired state is deleted, on a window per table, by one pass** —
  `odudu reap`, on the server's own schedule or as a command
  ([Retention](#retention-what-odudu-reap-removes)). What is not there yet:
  nothing bounds `refresh_tokens` on its own, because a refresh token is
  retained for the life of its grant family and ADR 0021 says why deleting
  on `expires_at` alone would silently disable reuse detection; and the pass
  discovers a misconfigured serving role once per tick rather than at boot,
  so a deployment that sets `ODUDU_APP_DATABASE_URL` to a role that escapes
  row-level security learns about it from an hourly log line.

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

## The shape of it

A **realm** is a tenant: its own users, clients, signing keys and sessions,
isolated in the database by PostgreSQL row-level security (ADR 0009). Every
protocol endpoint lives under `/realms/{realm}/`, so the realm is chosen by
the URL and never by a header or a parameter.

| Method | Path                                               | What it is                                                  |
| ------ | -------------------------------------------------- | ----------------------------------------------------------- |
| `GET`  | `/realms/{realm}/.well-known/openid-configuration` | Discovery document                                          |
| `GET`  | `/realms/{realm}/protocol/openid-connect/certs`    | JWKS (public signing keys)                                  |
| `GET`  | `/realms/{realm}/protocol/openid-connect/auth`     | Authorization endpoint                                      |
| `POST` | `/realms/{realm}/protocol/openid-connect/auth`     | Authorization endpoint (form)                               |
| `POST` | `/realms/{realm}/login-actions/authenticate`       | Login form submission                                       |
| `POST` | `/realms/{realm}/login-actions/required-action`    | Complete a pending required action (TOTP enrolment)         |
| `GET`  | `/realms/{realm}/login-actions/registration`       | Self-registration form                                      |
| `POST` | `/realms/{realm}/login-actions/registration`       | Self-registration submission                                |
| `GET`  | `/realms/{realm}/login-actions/action-token`       | Redeem a mailed action token (verify email, reset password) |
| `POST` | `/realms/{realm}/login-actions/action-token`       | Submit a new password against a reset-password token        |
| `GET`  | `/realms/{realm}/login-actions/reset-password`     | Password reset request form                                 |
| `POST` | `/realms/{realm}/login-actions/reset-password`     | Password reset request submission                           |
| `POST` | `/realms/{realm}/protocol/openid-connect/token`    | Token endpoint                                              |
| `GET`  | `/realms/{realm}/protocol/openid-connect/userinfo` | UserInfo                                                    |
| `POST` | `/realms/{realm}/protocol/openid-connect/userinfo` | UserInfo (form)                                             |
| `GET`  | `/realms/{realm}/protocol/openid-connect/logout`   | RP-initiated logout (`end_session_endpoint`)                |
| `POST` | `/realms/{realm}/protocol/openid-connect/logout`   | RP-initiated logout, confirmation form submission           |
| `GET`  | `/health/live`, `/health/ready`                    | Liveness, readiness                                         |

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

There is no admin API yet, so realms, clients, users and signing keys are
created by the server's seed command. It is the only way to create the first
of anything.

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
  "$BASE/auth" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p')

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
see [RP-initiated logout](#rp-initiated-logout) below.

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
      "n": "xnRWAMI0FVReCW0fKK2Yc743IzpZ…",
      "e": "AQAB",
      "alg": "RS256",
      "use": "sig",
      "kid": "01a096e2-c9e9-…"
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
content-length: 508

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
</body>
</html>
```

(`auth_session_id` and the `x-request-id` and `Date` headers differ per run.)

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
location: http://localhost:8080/callback?code=g7v4W3JWm05w…&state=xyz-123&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Fdemo
content-length: 0
```

(Session id and code truncated.)

Three things in that response:

- **`code`** — 32 random bytes, base64url. Only its SHA-256 hash is stored.
  It lives **60 seconds** and can be redeemed once.
- **`state`** — echoed back exactly as sent. The client compares it to what
  it sent and abandons the response if it differs.
- **`iss`** — RFC 9207 §2. The client checks it names the server it started
  with. Without it, a client talking to several providers cannot tell which
  one answered, which is the opening a mix-up attack needs.

The cookie is the SSO session, 12 hours. It carries `Secure` and the
`__Host-` prefix when the server is told TLS terminates in front of it
(`ODUDU_TLS=true`); on this plain-HTTP stack it does not, and the name is
`demo-session` rather than `__Host-demo-session`. **Nothing reads this
cookie yet** — see [What is not implemented](#what-is-not-implemented).

**What the client does next:** verify `state` and `iss`, then redeem the
code. Immediately: it expires in a minute.

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
  "iss": "http://localhost:3000/realms/demo",
  "aud": "demo-spa",
  "iat": 1789504919,
  "exp": 1789505219,
  "auth_time": 1789504919,
  "nonce": "n-0S6_WzA2Mj",
  "sid": "01a0a6ce-1788-…",
  "sub": "01a0a6cd-e3cb-…",
  "name": "ada",
  "preferred_username": "ada",
  "email": "ada@example.com",
  "email_verified": false,
  "amr": ["pwd"],
  "acr": "1"
}
```

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
  "iss": "http://localhost:3000/realms/demo",
  "aud": "demo-spa",
  "iat": 1789505061,
  "exp": 1789505361,
  "auth_time": 1789505061,
  "nonce": "n-0S6_WzA2Mj",
  "sid": "01a0a6d0-4425-…",
  "sub": "01a0a6cd-e3cb-…",
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
  "jti": "01a0a215-9c86-77a3-b7ab-dad58b49da4e"
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
  "iss": "http://localhost:3000/realms/demo",
  "aud": "demo-backend",
  "iat": 1789505125,
  "exp": 1789505425,
  "auth_time": 1789505125,
  "nonce": "n-0S6_WzA2Mj",
  "sid": "01a0a6d1-3d1f-…",
  "sub": "01a0a6cd-e3cb-…",
  "name": "ada",
  "preferred_username": "ada",
  "email": "ada@example.com",
  "email_verified": false,
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
exists — `ada`, seeded back in [Bootstrap](#bootstrap). There is still no
seed flag or admin surface to flip a realm's `verify_email` itself, only a
direct `UPDATE realms SET verify_email = true …`, the same gap
[Self-registration](#self-registration) hits for the other two
account-lifecycle settings:

```bash
odudu seed \
  --realm demo --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com \
  --send-verification-email
```

With `ODUDU_SMTP_HOST` unset — true of the compose stack and of every way
this document runs the server — nothing is actually sent. `capturingSender`
logs the message it would have sent instead, which is how a reader without
a mail server gets the link:

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

There is no seed flag or admin surface for the three account-lifecycle
settings yet (the same gap [Address verification](#address-verification)
notes), so this run flips them with `psql` against the compose stack's
database, the same one `odudu seed` writes to — by name, since the realm id
is generated and this document does not capture it:

```sql
UPDATE realms SET registration_allowed = true, verify_email = true
  WHERE name = 'register-demo';
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
  | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p')

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
  | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p')

curl -sS -i -X POST http://localhost:3000/realms/register-demo/login-actions/authenticate \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
```

```
HTTP/1.1 302 Found
set-cookie: register-demo-session=01a0a14e-…; HttpOnly; SameSite=Lax; Path=/
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
<head><meta charset="utf-8"><title>Can't create this account</title></head>
<body>
<h1>Can't create this account</h1>
<p>That email address is already registered.</p>
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
<head><meta charset="utf-8"><title>Can't create this account</title></head>
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
<head><meta charset="utf-8"><title>Can't create this account</title></head>
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
<head><meta charset="utf-8"><title>Can't create this account</title></head>
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
<head><meta charset="utf-8"><title>Can't create this account</title></head>
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

Every command and response below was executed against the compose stack.
The HTML bodies are line-wrapped for readability, as every other HTML
transcript in this document is — the markup is the server's, the line
breaks between and inside its tags are not.

There is no seed flag for `otp_required` yet (the same gap
[Self-registration](#self-registration) notes), so this run turns it on with
`psql`:

```bash
odudu seed \
  --realm otp-demo --client otp-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "UPDATE realms SET otp_required = true WHERE name = 'otp-demo';"
```

```
{"created":true,"realm":"otp-demo","realmId":"01a0a7c0-…","clientId":"otp-spa","userSubjectId":"01a0a7c0-…"}
UPDATE 1
```

### The password is right, and the login still does not finish

`/authorize` parks the request and renders the same password form
[Path A](#path-a-authorization-code-with-pkce) shows — nothing about a
second factor is decided before somebody has said who they are, because
which account a code belongs to is not knowable until then.

```bash
curl -sS 'http://localhost:3000/realms/otp-demo/protocol/openid-connect/auth?response_type=code&client_id=otp-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
```

The `auth_session_id` in that form — `01a0a7c0-bc80-7671-9a41-3aa5a8477c97`
in this run — is what every request below carries. Posting the correct
password answers 200 with an enrolment page rather than 302 with a code:
the password was accepted, and the pending action is what stops the login
from completing (no `set-cookie`, no `code`).

```bash
curl -sS -X POST http://localhost:3000/realms/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0a7c0-bc80-7671-9a41-3aa5a8477c97' \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
```

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Set up your authenticator</title>
  </head>
  <body>
    <h1>Set up your authenticator</h1>
    <p>Scan this with your authenticator app, or enter the key by hand.</p>
    <svg …>…</svg>
    <p>
      <code
        >otpauth://totp/otp-demo:ada?secret=ZVOPG3D7E34NZLZMDCSQXXYLWDQMCYOQ&amp;issuer=otp-demo&amp;algorithm=SHA1&amp;digits=6&amp;period=30</code
      >
    </p>
    <p>Key: <code>ZVOPG3D7E34NZLZMDCSQXXYLWDQMCYOQ</code></p>
    <form
      method="post"
      action="/realms/otp-demo/login-actions/required-action?action=configure-totp"
    >
      <input type="hidden" name="auth_session_id" value="01a0a7c0-bc80-7671-9a41-3aa5a8477c97" />
      <input type="hidden" name="secret" value="ZVOPG3D7E34NZLZMDCSQXXYLWDQMCYOQ" />
      <label
        >Code from your app
        <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"
      /></label>
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
  --data-urlencode 'auth_session_id=01a0a7c0-bc80-7671-9a41-3aa5a8477c97' \
  --data-urlencode 'secret=ZVOPG3D7E34NZLZMDCSQXXYLWDQMCYOQ' \
  --data-urlencode 'code=124343'
```

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Sign in</title>
  </head>
  <body>
    <form method="post" action="/realms/otp-demo/login-actions/authenticate">
      <input type="hidden" name="auth_session_id" value="01a0a7c0-bc80-7671-9a41-3aa5a8477c97" />
      <label>Username <input type="text" name="username" autocomplete="username" /></label>
      <label
        >Password <input type="password" name="password" autocomplete="current-password"
      /></label>
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>
```

The parked request survives the detour — same `auth_session_id` — and the
login form comes back. The password is asked for again because nothing was
written down for it: a factor that finishes a login is deliberately not
recorded, so that a login refused after authentication (an `id_token_hint`
naming somebody else, an unverified address) cannot be retried with the
factor already ticked off.

This run generated its codes with the algorithm's own implementation rather
than a phone:

```bash
node --input-type=module -e "
import { totpCode, totpCounter } from './packages/crypto/src/service/totp.ts';
console.log(totpCode('ZVOPG3D7E34NZLZMDCSQXXYLWDQMCYOQ', totpCounter(new Date())));
"
```

```
124343
```

### The same password now answers with a code form

```bash
curl -sS -X POST http://localhost:3000/realms/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0a7c0-bc80-7671-9a41-3aa5a8477c97' \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
```

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Sign in</title>
  </head>
  <body>
    <form method="post" action="/realms/otp-demo/login-actions/authenticate">
      <input type="hidden" name="auth_session_id" value="01a0a7c0-bc80-7671-9a41-3aa5a8477c97" />
      <label
        >Code from your app
        <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"
      /></label>
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>
```

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
  --data-urlencode 'auth_session_id=01a0a7c0-bc80-7671-9a41-3aa5a8477c97' \
  --data-urlencode 'code=124343'
```

```
200
```

RFC 6238 §5.2: a verifier must not accept an OTP twice. The credential
stores the time step of the last code it accepted, and the enrolment's own
code spent that step when it created the credential. The next one works:

```bash
curl -sS -i -X POST http://localhost:3000/realms/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a0a7c0-bc80-7671-9a41-3aa5a8477c97' \
  --data-urlencode 'code=033455'
```

```
HTTP/1.1 302 Found
set-cookie: otp-demo-session=01a0a7c1-c3fa-7ef6-b961-fddffc1cb317; HttpOnly; SameSite=Lax; Path=/
location: http://localhost:8080/callback?code=rMHzhb5xIyl95qrX_WLc0__Ch0WdBYe3cT6yrgKFGhg&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Fotp-demo
```

### What two factors do to the ID token

```bash
curl -sS -X POST http://localhost:3000/realms/otp-demo/protocol/openid-connect/token \
  -d grant_type=authorization_code \
  -d code=rMHzhb5xIyl95qrX_WLc0__Ch0WdBYe3cT6yrgKFGhg \
  -d client_id=otp-spa \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  -d code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

The ID token's payload (decoded; `id_token` itself is the usual three
base64url segments):

```json
{
  "sub": "01a0a7c0-6f2c-7a48-80a1-6e5021c5075e",
  "iss": "http://localhost:3000/realms/otp-demo",
  "aud": "otp-spa",
  "iat": 1789520899,
  "exp": 1789521199,
  "auth_time": 1789520888,
  "sid": "01a0a7c1-c3fa-7ef6-b961-fddffc1cb317",
  "amr": ["otp", "pwd"],
  "acr": "2"
}
```

`amr` names both factors, in RFC 8176's registry spellings rather than this
server's internal authenticator names, and `acr` is `"2"` — a statement
about this login, recorded on the session when it was established, not
re-derived at issuance from what the subject happens to have enrolled by
then.

## Enrolling a passkey

`POST /realms/{realm}/login-actions/required-action?action=configure-passkey`
enrols a WebAuthn credential for the subject the authentication session is
bound to, the same way the `configure-totp` submission above enrols a TOTP
one. Nothing yet asks for the action on its own — there is no realm switch
for passkeys, the way `otp_required` exists for TOTP — so it becomes pending
only when something adds it (today: a row in `user_required_actions`).
Signing in _with_ a passkey is not built; this enrols the credential a later
phase will authenticate against.

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

Refused, each for its own reason:

- A response replayed after a successful enrolment — the challenge it
  answered no longer exists, so there is nothing for it to match.
- A response answering a challenge this server never issued.
- A response produced against another relying party or origin.
- A submission for an action the subject does not owe: the required-action
  route refuses any action absent from their pending set, whatever the form
  says.
- Any enrolment at all on a deployment with no `ODUDU_PUBLIC_BASE_URL`. The
  relying party id comes from that value and nowhere else, and the page
  reports the action as one that cannot be completed rather than binding a
  credential to a guessed domain. With `NODE_ENV=production` the server
  refuses to boot in that state.

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

There is still no seed flag or admin surface for this setting (the same gap
[Address verification](#address-verification) and
[Self-registration](#self-registration) note for the other two), so this
run flips it with `psql` against the compose stack's database, the same one
`odudu seed` writes to — by name, since the realm id is generated and this
document does not capture it:

```sql
UPDATE realms SET reset_password_allowed = true WHERE name = 'reset-demo';
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

Identical, character for character — and only the first request produced
mail. `ODUDU_SMTP_HOST` is unset, so the container's log carries it instead
of an inbox, and it is there exactly once:

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
<head><meta charset="utf-8"><title>Can't reset your password</title></head>
<body>
<h1>Can't reset your password</h1>
<ul>
<li>Password must be at least 8 characters long.</li>
</ul>
</body>
</html>
```

Submitting a compliant password on the same link sets it:

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
  | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p')

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
  | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p')

curl -sS -i -X POST http://localhost:3000/realms/reset-demo/login-actions/authenticate \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=a brand new password'
```

```
HTTP/1.1 302 Found
set-cookie: reset-demo-session=01a0a184-8d8c-…; HttpOnly; SameSite=Lax; Path=/
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

## RP-initiated logout

`GET`/`POST /realms/{realm}/protocol/openid-connect/logout` implements
[OpenID Connect RP-Initiated Logout
1.0](protocols/oidc-rpinitiated.md). Ending a session revokes it and every
grant whose `session_id` names it — not access tokens, which stay valid to
their own `exp` regardless (see [What is not
implemented](#what-is-not-implemented) and README.md's own logout section
for why).

A client registers its `post_logout_redirect_uri` values ahead of time —
there is no seed flag for it yet, so this walkthrough sets one directly:

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
location: http://localhost:8080/logged-out?state=xyz-bye
content-length: 0
```

The hint names the session the cookie itself belongs to (OIDC Core §3.1.2.2
validates it — this realm's own keys, this realm's issuer, an access token
refused by `typ`), so §2's confirmation is skipped and the exact-match
`post_logout_redirect_uri` is honoured. The refresh token this session's
grant issued is now refused:

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

### Offline access

`offline_access` is a scope, seeded into every realm alongside
`openid`/`profile`/`email` and assigned to `demo-spa` too — the one scope
here assigned `'optional'` rather than `'default'`, which changes nothing
`/authorize` or `/token` do with it yet and is there for the consent screen
a later phase adds (it maps no claims either way — see
[Discovery](#1-discovery) above). Requesting it produces a
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
  "$BASE/auth" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p')

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
set-cookie: demo-session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/
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

| Request                                | `error`                     | Why                                                                                          |
| -------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| No `code_challenge`                    | `invalid_request`           | PKCE is mandatory for every client, with no exception (ADR 0016)                             |
| `code_challenge` of the wrong shape    | `invalid_request`           | RFC 7636 §4.2 fixes it at 43–128 unreserved characters; see below                            |
| No `code_challenge_method`             | `invalid_request`           | It is not defaulted to `plain`, which is what RFC 7636 §4.3 would have it default to         |
| `code_challenge_method=plain`          | `invalid_request`           | Only `S256` is accepted; `plain` offers no protection against an intercepted code            |
| `response_type=token`                  | `unsupported_response_type` | Only the code flow exists; implicit issuance is gone from OAuth 2.1                          |
| Scope the realm does not define        | `invalid_scope`             | `scopes_supported` is that same list, so discovery and this endpoint cannot disagree         |
| Scope the client is not assigned       | `invalid_scope`             | Defined by the realm is not granted to every client; refused, never silently dropped         |
| Repeated `state` (or any other repeat) | `invalid_request`           | Ambiguous, but a trustworthy redirect target exists by now, so the client can be told        |
| `prompt=none`                          | `login_required`            | No session is ever reused, so no end user is ever already authenticated (OIDC Core §3.1.2.3) |
| `prompt=none login`                    | `invalid_request`           | `none` with any other value is contradictory (OIDC Core §3.1.2.1)                            |
| `prompt=` anything undefined           | `invalid_request`           | Better told than silently answered as if it had asked for nothing                            |
| `request=…`                            | `request_not_supported`     | Request objects are unimplemented, and §3.1.2.6 requires saying so rather than dropping them |
| `request_uri=…`                        | `request_uri_not_supported` | Same                                                                                         |
| Unverifiable `id_token_hint`           | `invalid_request`           | A hint this realm's keys did not sign is not a hint from here (OIDC Core §3.1.2.2)           |
| Another realm's `id_token_hint`        | `invalid_request`           | Same rule: the realm in the URL is the only issuer whose keys are consulted                  |

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
  | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p')

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
(§3.1.3.7) has to be able to rely on. A session past its realm's
`sso_session_idle_seconds` or `sso_session_max_seconds`
(`docs/NEXT.md`), or one for a subject a `verify_email` realm has not
verified, is refused here exactly as `prompt=none` with no session at all
is — a redirect carrying `login_required`, nothing issued, no page shown.

### `id_token_hint`

A hint is checked against the realm's own keys and issuer before anything
else about the request is acted on (OIDC Core §3.1.2.2). Mint one by
completing Path A and keeping the `id_token`; mint another by doing the
same in a second realm:

```bash
odudu seed \
  --realm other --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@other.example
```

`$ID_TOKEN` from the bootstrap block is a hint this realm issued. Run the
same block against `/realms/other/` for one it did not:

```bash
HINT=$ID_TOKEN
curl -sS -o /dev/null -D - --get --data-urlencode "id_token_hint=$HINT" \
  "http://localhost:3000/realms/demo/protocol/openid-connect/auth?$Q" \
  | tr -d '\r' | awk '/^HTTP/{s=$2} /^[Ll]ocation:/{l=$2} END{print s, l}'
```

| `id_token_hint`                              | Answer                      |
| -------------------------------------------- | --------------------------- |
| `not.a.jwt`                                  | 302 `error=invalid_request` |
| An ID token issued by the realm `other`      | 302 `error=invalid_request` |
| An ID token this realm issued                | 200, the login form         |
| With `prompt=none`, a hint this realm issued | 302 `error=login_required`  |
| With `prompt=none`, any unusable hint        | 302 `error=invalid_request` |

The last two rows are the ordering. An unusable hint is refused as a
malformed request rather than answered with the prompt's own
`login_required`: `prompt=none` decides how to answer a request, and a
request carrying a hint this server cannot read is not yet a request to
answer that way.

An access token this realm minted for the same user is refused too, and not
by any of the rows above: it carries `typ: at+jwt` (RFC 9068 §2.1), and the
hint check demands a JWT that is not an access token. `/userinfo` makes the
mirror image of that check of the token presented to it, so neither token
type can stand in for the other in either direction.

The realm row is the point of the whole check. Both tokens are RS256, both
have the shape of an ID token, and both were signed by this server — by a
different realm's key. Only the realm named in the URL has its keys
consulted, so the second is refused exactly like a forgery.

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

| Request                                      | Answer                                         | Why                                                                                                                                                              |
| -------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong password                               | 200, the sign-in form again, same session id   | The session is live and can be retried; nothing is consumed                                                                                                      |
| Unknown username                             | 200, the sign-in form again                    | Indistinguishable from a wrong password, and the credential query is still issued so the timing matches                                                          |
| No `auth_session_id`                         | 400, "This sign-in attempt is no longer valid" | That field is the form's CSRF defence; a submission without it is not a submission from the form                                                                 |
| Unknown or expired `auth_session_id`         | 400, same page                                 | Folded together deliberately: neither names a live parked request                                                                                                |
| A second submit of a consumed session        | 400, same page                                 | The atomic consume is what stops a back-button press minting a second session and a second code                                                                  |
| Right password, wrong `id_token_hint`ed user | 302 `error=login_required` to the client       | A positive response is for the end user the hint identifies. The session is left unconsumed, so the right user can still sign in against the same parked request |

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

Every item below is in exactly one of three states, and says which:
**planned**, with the phase that brings it; **a decision**, with the clause
or the ADR that settles it; or **deliberately unplaced**, which the roadmap
means rather than forgets. Phases are section 11 of
`docs/superpowers/specs/2026-09-10-odudu-design.md`, where the second phase
is two: **P2a** is the identity model — roles, groups, client scopes,
per-client web origins, email — and **P2b** is credentials, MFA and the
session lifecycle. A citation of either half here means that half.

**`/authorize`**

- **No consent screen.** Every scope the realm defines and the client is
  assigned is granted without asking the user. The allowlist exists — it is
  the client's scope assignments — but nothing asks the user to approve what
  it lets through. **P3**, the phase named for consent, and — since
  2026-09-14 — the phase whose exit criterion names it too: a screen a user
  can refuse, and a recorded grant.
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
  reauthentication to satisfy one, is step-up authentication, which the
  roadmap leaves **deliberately unplaced** beside PAR and DPoP, to be scoped
  with the FAPI 2.0 decision ADR 0016 points at.
- **No request objects.** `request` and `request_uri` are refused explicitly,
  with `request_not_supported` and `request_uri_not_supported` — which is
  what OIDC Core §6.1 asks of an OP that does not support them, having first
  said "Support for the `request` parameter is OPTIONAL". Pushed
  authorization requests (PAR, RFC 9126) are **deliberately unplaced** for
  the same reason as DPoP: both are prerequisites of the FAPI 2.0 profiles
  ADR 0016 identifies, so they are scoped with that decision rather than
  scattered across phases.
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

**Login**

- **Password and TOTP; a passkey can be enrolled but not signed in with.**
  The remaining second-factor work is **P2b**'s, whose exit criterion is
  password, TOTP and passkey login through the flow tree.
  The executor now runs a realm's own ordered `authentication_executions`
  (REQUIRED/ALTERNATIVE/CONDITIONAL/DISABLED) through a registry keyed by
  authenticator name, and a login resumes across steps rather than
  restarting — a satisfied authenticator is never asked for twice, even
  across a rejected attempt at whatever comes after it. Every realm's flow
  `otp` now has a runtime and runs for any subject holding a TOTP
  credential ([Two-factor authentication with TOTP](#two-factor-authentication-with-totp)).
  `passkey`, also seeded as an execution by `provisionRealm`, does not: a
  passkey can be enrolled ([Enrolling a passkey](#enrolling-a-passkey)) but
  the authenticator that would assert one is inapplicable for every subject
  until its own task gives it a runtime.
- **Password reset exists; a timing oracle in it does not have a fix yet.**
  Address verification (`GET /realms/{realm}/login-actions/action-token`,
  [Address verification](#address-verification)), self-registration
  (`GET`/`POST /realms/{realm}/login-actions/registration`,
  [Self-registration](#self-registration)) and password reset
  (`GET`/`POST /realms/{realm}/login-actions/reset-password`,
  [Password reset](#password-reset)) all exist now, gated by their own
  realm setting, each off by default. A realm with `verify_email` on
  refuses to complete a login for a self-registered address until it is
  verified — no authorization code, not just a page saying so. The reset
  endpoint's remaining gap is [README.md](../README.md)'s stated
  limitation: mailing an existing address is measurably slower than
  answering for one that does not exist, closeable only by moving the send
  off the request path, which this phase's design spec rejects.
- **No "remember me".** A persistent session is a session-lifespan setting,
  and lifespans are **P2b**'s; the feature itself is not named in the
  roadmap.
- **No rate limiting or lockout**, on failed sign-ins or anywhere else.
  **P2b**, whose exit criterion names password policies and brute-force
  protection. Self-registration widens what that leaves open: `POST
/realms/{realm}/login-actions/registration` is unauthenticated and runs
  one Argon2id hash per request with no maximum password length, so an
  attacker who cannot yet guess a password can still spend the server's CPU
  with no account at all.
- **The sign-in and error pages are hardcoded HTML**, dependency-free with
  every interpolated value escaped. Theming is **P10**; the contract for it
  is deliberately left undecided until there are enough pages for the real
  variation to be visible, which means until **P2a** adds registration and
  verification pages and **P2b** adds the second-factor steps.

**`/token`**

- **No token exchange (RFC 8693)**, and so none of the delegation the agent
  identity layer is built on. **P5.**
- **No CIBA.** **P5**, whose exit criterion is CIBA approvals end to end.
- **No device authorization grant.** **Deliberately unplaced**, with PAR,
  DPoP and step-up authentication, for the FAPI 2.0 scoping ADR 0016 points
  at.
- **No resource owner password credentials.** A decision: the grant is
  removed by OAuth 2.1, and it is not coming back.
- **No `private_key_jwt` or mTLS client authentication.** **P3**, whose exit
  criterion names both.
- **No DPoP or other sender-constrained tokens**, mTLS-bound tokens
  included. **Deliberately unplaced**, as above.
- **No `resource` or `audience` request parameter.** A client's audiences
  are whatever its registration says. RFC 8707 resource indicators are
  **P3**, whose exit criterion names them alongside the per-client audience
  configuration that makes `aud` derived rather than asserted — which is
  where the deferred clause rows in `docs/protocols/rfc9068.md` point.

**`/userinfo`**

- **No signed or encrypted UserInfo responses. JSON only.** Not a
  conformance gap: OIDC Core §5.3.2 requires the claims to be "returned as
  the members of a JSON object unless a signed or encrypted response was
  requested during Client Registration", and no client can request one
  because there is no client registration to request it in. The clauses
  arrive with the registration that carries them, at **P3**, whose exit
  criterion names signed and encrypted UserInfo responses for that reason.
- **No `claims` request parameter.** A decision: §5.5 says "Support for the
  `claims` parameter is OPTIONAL", and the two ID Token clauses that depend
  on it are deferred to **P3** with the per-client machinery.
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

- **Token introspection (RFC 7662) and revocation (RFC 7009).** **P3**,
  whose exit criterion names both. Until then a resource server validates
  access tokens locally against the JWKS, and ending a session or revoking
  a grant — including through [RP-initiated logout](#rp-initiated-logout) —
  does not invalidate an already-issued access token before its `exp`.
- **Front-channel and back-channel logout.** **P3**: both are addressed to a
  client rather than to a browser, so both need per-client
  `frontchannel_logout_uri` and `backchannel_logout_uri` registered, which
  is client-registration metadata.
- **No administrative way to end somebody else's session.** Listing a
  subject's sessions and ending one is **P4**, with the rest of the admin
  surface, because until there is an admin API there is nowhere to put it.
- **Dynamic client registration (RFC 7591).** **P3.** Today the seed command
  is the only way to create a client.
- **Any admin API.** **P4.** The seed command is the only administrative
  surface, and it cannot add a user to an existing client, disable anything,
  rotate a key, or delete anything.
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
  rather than in P3 because no relying party's request triggers a rotation:
  it is an operator action, and it needs the authenticated administrator,
  the audit event and the surface to trigger it from that P4 is the phase
  for.
- **Nothing is ever deleted.** Every expired `sessions`,
  `authentication_sessions`, `authorization_codes`, `refresh_tokens` and
  `action_tokens` row is still on disk; expiry (and, for `action_tokens`,
  consumption) is enforced at read time, so none of them can be used. **P2b**,
  which owns the retention window because a lifespan says when something
  stops working and not when it stops existing. ADR 0021 carries why
  deleting on `expires_at` alone would silently disable refresh-token reuse
  detection — the same hazard applies to every table in this list, not only
  the one the ADR was written against.

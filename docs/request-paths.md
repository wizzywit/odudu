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

| Method | Path                                               | What it is                                          |
| ------ | -------------------------------------------------- | --------------------------------------------------- |
| `GET`  | `/realms/{realm}/.well-known/openid-configuration` | Discovery document                                  |
| `GET`  | `/realms/{realm}/protocol/openid-connect/certs`    | JWKS (public signing keys)                          |
| `GET`  | `/realms/{realm}/protocol/openid-connect/auth`     | Authorization endpoint                              |
| `POST` | `/realms/{realm}/protocol/openid-connect/auth`     | Authorization endpoint (form)                       |
| `POST` | `/realms/{realm}/login-actions/authenticate`       | Login form submission                               |
| `GET`  | `/realms/{realm}/login-actions/action-token`       | Redeem a mailed action token (address verification) |
| `POST` | `/realms/{realm}/protocol/openid-connect/token`    | Token endpoint                                      |
| `GET`  | `/realms/{realm}/protocol/openid-connect/userinfo` | UserInfo                                            |
| `POST` | `/realms/{realm}/protocol/openid-connect/userinfo` | UserInfo (form)                                     |
| `GET`  | `/health/live`, `/health/ready`                    | Liveness, readiness                                 |

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

### Address verification

`email_verified` is a stored claim, but until now nothing could set it
truthfully. `GET /realms/{realm}/login-actions/action-token?key=…` is the
other half: consuming the link a verification email carries. There is no
registration flow yet to trigger one on its own (`verify_email` on a realm
has no reader), so `odudu seed --send-verification-email` stands in for the
admin console's "Send verification email" action, against `ada`, already
seeded above:

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

Following the link once verifies it:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  'http://localhost:3000/realms/demo/login-actions/action-token?key=FZDLhOiE8AXyz6zzuGlRy4OkoK7ihPSIBoicxqaMWVM'
```

```
200
```

and a fresh ID token for `ada` now carries `"email_verified": true` where it
read `false` before — nothing else about the token changes, since email
and its verification status are the only claims this touches:

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
  "response_types_supported": ["code"],
  "response_modes_supported": ["query"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256", "ES256"],
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "none"],
  "authorization_response_iss_parameter_supported": true,
  "scopes_supported": ["address", "email", "groups", "openid", "phone", "profile", "roles"],
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

`scopes_supported` is the realm's own scope vocabulary, read from the
database rather than compiled in: these seven are what `odudu seed` gives a
new realm, and a realm that is given another scope advertises it here the
moment it exists. A scope is seeded only once a claim mapper can answer for
it, so this list never promises claims nothing returns.

Being advertised is only half of what `/authorize` needs, though — **a scope
is granted only when the realm defines it _and_ the client is assigned it**,
and either failure is `invalid_scope`. `odudu seed` assigns all seven to each
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
{ "alg": "RS256", "kid": "01a09678-…", "typ": "at+jwt" }
{
  "iss": "http://localhost:3000/realms/demo",
  "sub": "01a09678-07c1-…",
  "aud": ["http://localhost:3000/realms/demo"],
  "client_id": "demo-spa",
  "scope": "openid profile email",
  "iat": 1789230877,
  "exp": 1789231177,
  "jti": "01a09678-8ae6-…"
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
{ "alg": "RS256", "kid": "01a09678-…" }
{
  "iss": "http://localhost:3000/realms/demo",
  "aud": "demo-spa",
  "iat": 1789230877,
  "exp": 1789231177,
  "auth_time": 1789230870,
  "nonce": "n-0S6_WzA2Mj",
  "sub": "01a09678-07c1-…",
  "name": "ada",
  "preferred_username": "ada",
  "email": "ada@example.com",
  "email_verified": false
}
```

Its `aud` is the client, not the issuer: an ID token is a statement to the
client about who signed in, and an access token is a credential for an API.
`nonce` appears exactly when the request carried one, and the client must
compare it to what it sent. An ID token is issued only when the granted
scope includes `openid`.

**What the client does next:** verify the ID token's signature against the
JWKS, its `iss`, `aud`, `exp` and `nonce`; take `sub` as the user's
identifier; keep the access token for API calls and the refresh token
somewhere it can be used once.

### `roles`, once a scope reaches it

RFC 9068 §2.2.3.1 names `roles` as an access token claim, and Odudu adds it
to the same registry that assembles the ID token and `/userinfo` — but only
for the roles a granted scope actually reaches. There is no admin API or
seed flag for a role yet, so the run behind this section created one with
`psql` against the compose stack's database, the same one `odudu seed`
writes to:

```sql
INSERT INTO roles (id, realm_id, client_id, name)
  VALUES (gen_random_uuid(), '<realm_id>', NULL, 'reviewer') RETURNING id;
INSERT INTO subject_roles (realm_id, subject_id, role_id)
  VALUES ('<realm_id>', '<ada_subject_id>', '<role_id>');
INSERT INTO client_scope_roles (realm_id, client_scope_id, role_id)
  VALUES ('<realm_id>', '<roles_scope_id>', '<role_id>');
```

That gives `ada` a `reviewer` role, mapped to the `roles` scope
`provisionRealmDefaults` already seeded for the realm. Requesting
`scope=openid roles` instead of `scope=openid profile email` and redeeming
the code through Path A's usual steps produces an access token that carries
it:

```json
{
  "sub": "01a0a076-7bb2-…",
  "roles": ["reviewer"],
  "iss": "http://localhost:3000/realms/demo",
  "aud": ["http://localhost:3000/realms/demo"],
  "client_id": "demo-spa",
  "scope": "openid roles",
  "iat": 1789398555,
  "exp": 1789398855,
  "jti": "01a0a077-1b48-…"
}
```

The ID token issued alongside it carries no `roles`, though the same
`reviewer` role reached the same scope:

```json
{
  "iss": "http://localhost:3000/realms/demo",
  "aud": "demo-spa",
  "iat": 1789398555,
  "exp": 1789398855,
  "auth_time": 1789398555,
  "nonce": "n-0S6_WzA2Mj",
  "sub": "01a0a076-7bb2-…"
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
{ "sub": "01a0a076-7bb2-…", "roles": ["reviewer"] }
```

A role reaches a token only when it is mapped, this way, to a scope the
client is assigned — a role held but never mapped to any scope is left out
of the token entirely, and so is every role once `client_scope_roles` maps
nothing at all. The one way around the intersection is
`clients.full_scope_allowed`, which defaults to `false`: set it and a
client's tokens carry every role the subject holds, unfiltered.

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
  "sub": "01a09acc-6bd8-…",
  "aud": ["http://localhost:3000/realms/demo"],
  "client_id": "demo-backend",
  "scope": "openid profile email",
  "iat": 1789303513,
  "exp": 1789303813,
  "jti": "01a09acc-e390-…"
}
```

```json
{
  "iss": "http://localhost:3000/realms/demo",
  "aud": "demo-backend",
  "iat": 1789303513,
  "exp": 1789303813,
  "auth_time": 1789303513,
  "nonce": "n-0S6_WzA2Mj",
  "sub": "01a09acc-6bd8-…",
  "name": "ada",
  "preferred_username": "ada",
  "email": "ada@example.com",
  "email_verified": false
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

**`none` is `login_required`, always.** Nothing reads the SSO cookie at
`/authorize`, so no end user is ever already authenticated when the
decision is made. The answer is therefore unconditional rather than
session-dependent — which is still exactly the behaviour OIDC Core §3.1.2.3
describes, arrived at without a session to reuse rather than in spite of
one. Holding a live `demo-session` cookie changes nothing — add `-c
cookies.txt` to the login POST in the bootstrap block to keep one, then:

```bash
curl -sS -b cookies.txt -o /dev/null -D - \
  "http://localhost:3000/realms/demo/protocol/openid-connect/auth?$Q&prompt=none" \
  | grep -i '^location'
```

```
location: http://localhost:8080/callback?error=login_required&state=xyz-123&iss=…
```

**`none` with any other value is an error, not a decision.** §3.1.2.1 makes
the values mutually exclusive. Answering `none login` as if it were a bare
`none` would be this server picking which half of a contradiction the
client meant.

**An undefined value is refused.** §3.1.2.1 leaves that a MAY — a server is
allowed to ignore one instead. A client asking for an interaction this
server has never heard of is better told so than answered as though it had
asked for nothing. `Login` is refused for the same reason: the values are
case-sensitive.

**`prompt=login` renders the form, and so does no `prompt` at all.**
Forcing reauthentication is what happens anyway, because authentication is
unconditional. Holding the session cookie from a completed sign-in, both
still answer 200 with a fresh login form. That equality is a gap, not a
feature, and it closes in P2b when session reuse arrives — at which point
`prompt=login` starts meaning something the absence of `prompt` does not.

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
- **No session reuse.** The SSO cookie is set at login and never read.
  `prompt=none` therefore always answers `login_required`, and `prompt=login`
  is what happens anyway, because authentication is unconditional. **P2b**,
  whose exit criterion is an SSO session that is read as well as written.
- **`max_age` is accepted and ignored**, including `max_age=0`, which a
  client would expect to force reauthentication. This one is an obligation
  rather than a latitude: OIDC Core §15.1 requires every OP to support
  "enforcing a maximum authentication age via the `max_age` parameter",
  with none of the minimum-level-of-support caveat the parameters below
  carry. **P2b** — reauthentication needs a session that can be judged
  stale, and that is the phase which builds one. The clause row in
  `docs/protocols/oidc-core.md` is the same deferral.
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
- **`acr_values` is accepted and ignored.** §15.1 allows exactly that — "the
  minimum level of support required for this parameter is simply to have its
  use not result in an error" — so what happens today conforms. Acting on
  it, and reporting the result back in `acr` and `amr`, is step-up
  authentication, which the roadmap leaves **deliberately unplaced** beside
  PAR and DPoP, to be scoped with the FAPI 2.0 decision ADR 0016 points at.
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

- **Password only.** TOTP, passkeys and any second factor are **P2b**, whose
  exit criterion is password, TOTP and passkey login through the flow tree.
  The flow engine behind the single password step is already a step list for
  that reason, but there is one step in it.
- **No registration, password reset or account recovery.** Address
  verification — the prerequisite, since an unverified self-registered
  address is an account-takeover primitive — now exists
  (`GET /realms/{realm}/login-actions/action-token`, walked through in
  [Address verification](#address-verification)), but nothing yet triggers
  it except an operator running `odudu seed --send-verification-email`:
  `realms.verify_email`, `registration_allowed` and `reset_password_allowed`
  are columns with no reader. The three flows built on top are **P2a**'s;
  its exit criterion names all three.
- **No "remember me".** A persistent session is a session-lifespan setting,
  and lifespans are **P2b**'s; the feature itself is not named in the
  roadmap.
- **No rate limiting or lockout** on failed sign-ins. **P2b**, whose exit
  criterion names password policies and brute-force protection.
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
- **Four claims exist in total**: `sub`, `name`, `email`, `email_verified`,
  and `name` is the username because there is no separate display name yet.
  The standard claims beyond these four need a user profile — attributes,
  their storage and their mapping — which is **P2a**, whose exit criterion
  names it beside roles, groups and client scopes. It went there rather than
  to P4 because it changes the token contract, and because P4's
  admin-configurable protocol mappers would otherwise be configuring
  mappings over attributes that do not exist: P2a owns the attributes and
  the claims they produce, P4 owns reconfiguring that mapping.

**Endpoints that do not exist at all**

- **Token introspection (RFC 7662) and revocation (RFC 7009).** **P3**,
  whose exit criterion names both. Until then a resource server validates
  access tokens locally against the JWKS, and revoking a grant does not
  invalidate an already-issued access token before its `exp`.
- **RP-initiated logout (`end_session_endpoint`).** **P2b**, whose exit
  criterion ends the SSO session with it. It lands there rather than
  earlier because an endpoint that ends a session nothing consults would be
  theatre.
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
  `authentication_sessions`, `authorization_codes` and `refresh_tokens` row
  is still on disk; expiry is enforced at read time, so none of them can be
  used. **P2b**, which owns the retention window because a lifespan says when
  something stops working and not when it stops existing. ADR 0021 carries
  why deleting on `expires_at` alone would silently disable refresh-token
  reuse detection.

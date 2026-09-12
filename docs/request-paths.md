# Request paths

Every endpoint Odudu serves today, what a client does with each answer, and
what happens on each way a request can go wrong. Every command below was run
against the compose stack (`infra/docker/compose.yaml`) and every response is
the one that came back.

Values that change on every run — authorization codes, tokens, `jti`,
session ids, timestamps — are shortened or truncated where they appear, and
that is said each time. Nothing here is reconstructed from what the code
looks like it should do.

## The shape of it

A **realm** is a tenant: its own users, clients, signing keys and sessions,
isolated in the database by PostgreSQL row-level security (ADR 0009). Every
protocol endpoint lives under `/realms/{realm}/`, so the realm is chosen by
the URL and never by a header or a parameter.

| Method | Path                                               | What it is                    |
| ------ | -------------------------------------------------- | ----------------------------- |
| `GET`  | `/realms/{realm}/.well-known/openid-configuration` | Discovery document            |
| `GET`  | `/realms/{realm}/protocol/openid-connect/certs`    | JWKS (public signing keys)    |
| `GET`  | `/realms/{realm}/protocol/openid-connect/auth`     | Authorization endpoint        |
| `POST` | `/realms/{realm}/protocol/openid-connect/auth`     | Authorization endpoint (form) |
| `POST` | `/realms/{realm}/login-actions/authenticate`       | Login form submission         |
| `POST` | `/realms/{realm}/protocol/openid-connect/token`    | Token endpoint                |
| `GET`  | `/realms/{realm}/protocol/openid-connect/userinfo` | UserInfo                      |
| `POST` | `/realms/{realm}/protocol/openid-connect/userinfo` | UserInfo (form)               |
| `GET`  | `/health/live`, `/health/ready`                    | Liveness, readiness           |

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
created by the seed command built into the server image. It is the only way
to create the first of anything.

Bring the stack up first:

```bash
cd infra/docker && docker compose up -d --build
until curl -fsS http://localhost:3000/health/ready; do sleep 2; done
```

```
{"status":"ok","checks":{"database":"ok"}}
```

The loop is not decoration. `up -d` returns when the container has started,
which is before it has finished applying migrations, and a seed run in that
gap fails with `relation "realms" does not exist`.

### A public client, with a user

A public client has no secret. It proves itself with PKCE alone, which is
what a browser or mobile application should be.

```bash
docker compose exec -T odudu node dist/main.js seed \
  --realm demo --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
```

```json
{ "created": true, "realm": "demo", "realmId": "01a09678-…", "clientId": "demo-spa" }
```

(`realmId` is a generated identifier; shortened here.)

`--redirect-uri` may be repeated. It is matched by exact string comparison
when a request arrives — no trailing-slash tolerance, no case folding, no
ignoring the query string, because every normalization widens what an
attacker can aim at. `--email` is optional; without it the `email` and
`email_verified` claims are omitted together rather than an empty address
being asserted with a verification status.

Seeding asserts a whole desired state, so a re-run with identical arguments
reports that it changed nothing:

```bash
docker compose exec -T odudu node dist/main.js seed \
  --realm demo --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
```

```json
{ "created": false, "realm": "demo", "realmId": "01a09678-…", "clientId": "demo-spa" }
```

while a re-run that disagrees with what is stored refuses rather than
overwriting or silently ignoring the difference:

```bash
docker compose exec -T odudu node dist/main.js seed \
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
docker compose exec -T odudu node dist/main.js seed \
  --realm demo --client demo-backend --client-secret demo-backend-secret \
  --token-endpoint-auth-method client_secret_basic \
  --redirect-uri http://localhost:8080/callback
```

```json
{ "created": true, "realm": "demo", "realmId": "01a09678-…", "clientId": "demo-backend" }
```

```bash
docker compose exec -T odudu node dist/main.js seed \
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
step; read it if you would rather have something that fails loudly.

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
  "scopes_supported": ["openid", "profile", "email"],
  "claims_supported": ["sub", "name", "email", "email_verified"]
}
```

**What the client does next:** everything else in this document comes from
this document. `response_modes_supported` is stated rather than omitted
because omitting it would default to `["query", "fragment"]` (OIDC Discovery
§3) and promise a delivery mode `/authorize` refuses.
`code_challenge_methods_supported` lists `S256` and never `plain`.

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

### 5. `/userinfo`

```bash
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
  http://localhost:3000/realms/demo/protocol/openid-connect/userinfo
```

```json
{
  "sub": "01a09678-07c1-…",
  "name": "ada",
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
| Scope outside `openid profile email`   | `invalid_scope`             | The same list discovery advertises, imported rather than duplicated                          |
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
feature, and it closes in P2 when session reuse arrives — at which point
`prompt=login` starts meaning something the absence of `prompt` does not.

### `id_token_hint`

A hint is checked against the realm's own keys and issuer before anything
else about the request is acted on (OIDC Core §3.1.2.2). Mint one by
completing Path A and keeping the `id_token`; mint another by doing the
same in a second realm:

```bash
docker compose exec -T odudu node dist/main.js seed \
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

Per endpoint, with the phase that brings it. Phases are section 11 of
`docs/superpowers/specs/2026-09-10-odudu-design.md`.

**`/authorize`**

- **No consent screen.** Every requested scope within `openid profile email`
  is granted without asking the user. There is no per-client scope allowlist
  for interactive grants either. **P3.**
- **No session reuse.** The SSO cookie is set at login and never read.
  `prompt=none` therefore always answers `login_required`, and `prompt=login`
  is what happens anyway, because authentication is unconditional. **P2.**
- **No `max_age`, `acr_values`, `display`, `ui_locales`, `claims_locales` or
  `login_hint` behaviour.** They are accepted and ignored — including
  `max_age=0`, which a client would expect to force reauthentication, and
  values none of them define, such as `display=unheard_of`. Every one of
  those requests answers 200 with the ordinary login form. Accepting and
  ignoring is what OIDC Core allows for these; `prompt` is deliberately not
  treated the same way, because it is the one that changes whether the end
  user is asked anything at all.
- **An access token from this realm is accepted as an `id_token_hint`.** The
  check is signature, issuer and `sub` (OIDC Core §3.1.2.2), all of which an
  access token this realm minted satisfies; nothing here inspects `typ`. The
  hint only names a subject, so this admits no authority a real ID token for
  the same subject would not — but it is laxer than the name of the
  parameter suggests, and is recorded here rather than left to be
  discovered.
- **No request objects.** `request` and `request_uri` are refused explicitly
  rather than dropped. Pushed authorization requests (PAR) are not
  implemented either.
- **PKCE is mandatory with no exception** and no per-client opt-out. This is
  a decision, not a gap: ADR 0016. A relying party that cannot do PKCE
  cannot use Odudu.
- Only `response_type=code` and `response_mode=query`.

**Login**

- **Password only.** TOTP, passkeys and any second factor are **P2**. The
  flow engine behind the single password step is already a step list for
  that reason, but there is one step in it.
- **No registration, password reset, account recovery or "remember me".**
- **No rate limiting or lockout** on failed sign-ins.
- **The sign-in and error pages are hardcoded HTML**, dependency-free with
  every interpolated value escaped. Theming is **P10**; the contract for it
  is deliberately left undecided until **P2** adds enough pages for the real
  variation to be visible.

**`/token`**

- **No token exchange (RFC 8693)**, and so none of the delegation the agent
  identity layer is built on. **P5.**
- **No device grant, no CIBA** (CIBA is **P5**), no resource owner password
  credentials (removed by OAuth 2.1 and not coming back).
- **No `private_key_jwt` or mTLS client authentication**; no DPoP or other
  sender-constrained tokens. **P3 and later.**
- **No `resource` or `audience` request parameter.** A client's audiences
  are whatever its registration says.

**`/userinfo`**

- **No signed or encrypted UserInfo responses.** JSON only.
- **No `claims` request parameter**, no aggregated or distributed claims.
- Four claims exist in total: `sub`, `name`, `email`, `email_verified`, and
  `name` is the username because there is no separate display name yet.

**Endpoints that do not exist at all**

- **Token introspection (RFC 7662) and revocation (RFC 7009).** A resource
  server validates access tokens locally against the JWKS; revoking a grant
  does not invalidate an already-issued access token before its `exp`.
- **RP-initiated logout, front-channel and back-channel logout.** There is
  no way to end an SSO session other than waiting out its 12 hours.
- **Dynamic client registration (RFC 7591).** **P3.** Today the seed command
  is the only way to create a client.
- **Any admin API.** **P4.** The seed command is the only administrative
  surface, and it cannot add a user to an existing client, disable anything,
  rotate a key, or delete anything.
- **SAML, LDAP federation, identity brokering, authorization services.**
  P6–P9.

**Operational**

- **TLS is terminated in front of this server, never by it.** The server
  speaks plain HTTP, and with `NODE_ENV=production` refuses to boot until
  `ODUDU_TLS=true` asserts that something in front of it is doing that job.
  Consequently the issuer is `http://` on the local stack, and the session
  cookie drops its `__Host-` prefix and `Secure` attribute — correct for
  local development, unacceptable anywhere else.
- **One instance only.** Migrations run on boot from every process with no
  advisory lock, so replicas would race. **P11.**
- **Key rotation is not implemented.** A realm has one active signing key,
  created when it is seeded.

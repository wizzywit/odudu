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
curl http://localhost:3000/health/ready
```

```
{"status":"ok","checks":{"database":"ok"}}
```

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
{ "keys": [{ "kty": "RSA", "n": "pxr1XuyD21b…", "e": "AQAB", "kid": "01a09678-…" }] }
```

(`n` and `kid` truncated.)

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
| `POST` with a JSON body                | **415**, "…must be sent as `application/x-www-form-urlencoded`" | An unsupported representation, not a malformed authorization request; refused before any parser runs (RFC 9110 §15.5.16) |

`POST` with no body and no content type is not a refusal: it carries no
representation to reject, so it is a request with no parameters, and is
answered like one.

**Below the boundary — 302 to the registered `redirect_uri`**, carrying
`error`, `state` if the request had one, and always `iss`. All verified:

| Request                                | `error`                     | Why                                                                                          |
| -------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| No `code_challenge`                    | `invalid_request`           | PKCE is mandatory for every client, with no exception (ADR 0016)                             |
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

The error redirect for a request that sent no `state` carries only `error`
and `iss`:

```
location: http://localhost:8080/callback?error=invalid_request&iss=http%3A%2F%2Flocalhost%3A3000%2Frealms%2Fdemo
```

`iss` is on every authorization response including the errors (RFC 9207 §2):
a client that cannot tell which server failed its request is the client a
mix-up attack preys on.

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
| Unknown, expired or replayed `code`                     | 400    | `invalid_grant`          |
| Wrong or missing `code_verifier`                        | 400    | `invalid_grant`          |
| `redirect_uri` different from the code's                | 400    | `invalid_grant`          |
| A different client redeeming the code                   | 400    | `invalid_grant`          |
| Unknown, expired or replayed `refresh_token`            | 400    | `invalid_grant`          |
| Another client's `refresh_token`                        | 400    | `invalid_grant`          |
| Refresh or `client_credentials` asking for wider scope  | 400    | `invalid_scope`          |
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

### `/userinfo`

| Request                             | Status | `WWW-Authenticate`                                 | Why                                                                               |
| ----------------------------------- | ------ | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| No `Authorization` header           | 401    | `Bearer realm="userinfo"`                          | No credentials were presented, so no error code (RFC 6750 §3.1)                   |
| Unparseable or unsigned token       | 401    | `…, error="invalid_token"`                         | —                                                                                 |
| An ID token presented as the bearer | 401    | `…, error="invalid_token"`                         | `typ` must be `at+jwt`; the same key signed both, so `typ` is what separates them |
| Token in the header _and_ the body  | 400    | `…, error="invalid_request"`                       | More than one transmission method (RFC 6750 §3.1)                                 |
| Valid token without `openid` scope  | 403    | `…, error="insufficient_scope"`                    | A distinct answer, so a valid-but-unscoped token is not confused with a bad one   |
| `POST` with a JSON body             | 415    | (`accept-post: application/x-www-form-urlencoded`) | RFC 6750 §2.2 fixes the form-encoded method's content type                        |
| Unknown realm                       | 404    | —                                                  | —                                                                                 |

Failures here carry no response body: this endpoint answers a machine, and
reports in headers.

### Realm resolution

An unknown realm is 404 at `/token`, `/userinfo`, `/certs` and the discovery
document, and a rendered `invalid_client` page at `/authorize` — all four
run. A disabled realm takes the same branch in the same lookup, so it is
never distinguishable from one that never existed; that half was not
exercised here, because nothing can disable a realm yet.

## What to do next, from wherever you are

**From a rendered error page at `/authorize`.** The client never sees it.
Something about the client's registration is wrong — the `client_id`, the
`redirect_uri`, the realm in the URL. Fix the request, or the registration,
and start again. Nothing was created server-side.

**From a redirect carrying `error`.** Match `state` to the request you
started, check `iss`, and give up on this attempt. `login_required` means
interaction is needed and `prompt=none` forbade it: retry without `prompt`.
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
- **No `max_age`, `acr_values`, `display`, `ui_locales` or `login_hint`
  behaviour.** They are accepted as parameters and ignored.
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

---
title: 'Path A: authorization code with PKCE'
description: 'The full interactive flow. Every client uses PKCE, public and confidential alike, with no exception and no per-client opt-out (ADR 0016).'
---

# Path A: authorization code with PKCE

The full interactive flow. Every client uses PKCE, public and confidential
alike, with no exception and no per-client opt-out (ADR 0016).

## 1. Discovery

```bash
curl -sS http://localhost:3000/tenants/demo/.well-known/openid-configuration
```

```json
{
  "issuer": "http://localhost:3000/tenants/demo",
  "authorization_endpoint": "http://localhost:3000/tenants/demo/protocol/openid-connect/auth",
  "token_endpoint": "http://localhost:3000/tenants/demo/protocol/openid-connect/token",
  "introspection_endpoint": "http://localhost:3000/tenants/demo/protocol/openid-connect/token/introspect",
  "revocation_endpoint": "http://localhost:3000/tenants/demo/protocol/openid-connect/revoke",
  "userinfo_endpoint": "http://localhost:3000/tenants/demo/protocol/openid-connect/userinfo",
  "jwks_uri": "http://localhost:3000/tenants/demo/protocol/openid-connect/certs",
  "end_session_endpoint": "http://localhost:3000/tenants/demo/protocol/openid-connect/logout",
  "response_types_supported": ["code"],
  "response_modes_supported": ["query"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256", "ES256"],
  "userinfo_signing_alg_values_supported": ["RS256", "none"],
  "userinfo_encryption_alg_values_supported": [
    "RSA-OAEP-256",
    "ECDH-ES",
    "ECDH-ES+A128KW",
    "ECDH-ES+A192KW",
    "ECDH-ES+A256KW"
  ],
  "userinfo_encryption_enc_values_supported": [
    "A128CBC-HS256",
    "A192CBC-HS384",
    "A256CBC-HS512",
    "A128GCM",
    "A192GCM",
    "A256GCM"
  ],
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": [
    "authorization_code",
    "refresh_token",
    "client_credentials",
    "urn:ietf:params:oauth:grant-type:token-exchange"
  ],
  "token_endpoint_auth_methods_supported": [
    "client_secret_basic",
    "client_secret_post",
    "none",
    "private_key_jwt"
  ],
  "introspection_endpoint_auth_methods_supported": [
    "client_secret_basic",
    "client_secret_post",
    "private_key_jwt",
    "none"
  ],
  "revocation_endpoint_auth_methods_supported": [
    "client_secret_basic",
    "client_secret_post",
    "private_key_jwt",
    "none"
  ],
  "authorization_response_iss_parameter_supported": true,
  "claims_parameter_supported": true,
  "ui_locales_supported": ["en"],
  "prompt_values_supported": ["none", "login", "consent", "select_account"],
  "backchannel_logout_supported": true,
  "backchannel_logout_session_supported": true,
  "frontchannel_logout_supported": true,
  "frontchannel_logout_session_supported": true,
  "scopes_supported": [
    "address",
    "email",
    "groups",
    "mcp:read",
    "mcp:write",
    "me:read",
    "me:write",
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
see [RP-initiated logout](./rp-initiated-logout.md) below. The four
`backchannel_logout_*` and `frontchannel_logout_*` members are fixed `true`
for every tenant — see
[back-channel logout](./rp-initiated-logout.md#front-channel-and-back-channel-logout) below for what
reads them.

`scopes_supported` is the tenant's own scope vocabulary, read from the
database rather than compiled in: these twelve are what `odudu seed` gives a
new tenant, and a tenant that is given another scope advertises it here the
moment it exists. A scope is seeded only once a claim mapper can answer for
it, or — `offline_access`'s own exception — once it asks for a grant shape
rather than for data (see [offline access](./rp-initiated-logout.md#offline-access) below), so this
list never promises claims nothing returns. `mcp:read` and `mcp:write` are the third kind: they ask to use
the tenant's MCP endpoint, which carries no claims either, and `me:read` and `me:write` are the same kind, asking to
use the tenant's [me API](./the-me-api.md).

Being advertised is only half of what `/authorize` needs, though — **a scope
is granted only when the tenant defines it _and_ the client is assigned it**,
and either failure is `invalid_scope`. `odudu seed` assigns all eight to each
client it creates. The walk-through below asks for three of them — `openid`,
`profile` and `email` — which is why it is answered; `roles`, `groups`,
`address` and `phone` reach a token the same way, added to a request's
`scope` like any other.

The issuer is derived from the request, so it is `http://` on this
plain-HTTP local stack. A deployment terminates TLS in front of the server
and the issuer becomes `https://` — see
[the roadmap](../../../roadmap.md#decided-against-and-why).

The public keys are a separate fetch, and are what a client verifies an ID
token against:

```bash
curl -sS http://localhost:3000/tenants/demo/protocol/openid-connect/certs
```

```json
{
  "keys": [
    {
      "kty": "RSA",
      "n": "q-uWf9h3Uiq1LUw08NdRtTipD_fv…",
      "e": "AQAB",
      "kid": "01a0cb07-4e73-…",
      "alg": "RS256",
      "use": "sig"
    }
  ]
}
```

(`n` and `kid` truncated.) `kid` is what a client matches against the `kid`
in a token's header; `alg` and `use` say which algorithm the key is for and
that it is a signature key rather than an encryption one. One tenant has one
active key, so this array has one member.

## 2. `/authorize`

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
  'http://localhost:3197/tenants/demo/protocol/openid-connect/auth'
```

```
HTTP/1.1 200 OK
x-request-id: 01a1647b-2c1e-7ca8-a195-91f4799076e0
set-cookie: odudu-sign-in=01a1647b-2c2b-793d-b112-fbeacaf248f2.JXiLxsWqKLuPc5x42YKrEpXHxOrvmO_Rt4EC7SJtKSw; HttpOnly; SameSite=Lax; Path=/tenants/demo/; Max-Age=1800
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' http://localhost:8080; base-uri 'none'; script-src 'nonce-qrhsxazSsYmSwGYFtNAftg=='; connect-src 'self'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 3533
Date: Thu, 22 Oct 2026 16:39:16 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sign in</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Sign in</h1>
<p class="context">to continue to <bdi>demo-spa</bdi></p>
<p class="tenant"><bdi>demo</bdi></p>
</header>
<form method="post" action="/tenants/demo/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a1647b-2c2b-793d-b112-fbeacaf248f2">
  <label>Username <input type="text" name="username" autocomplete="username"></label>
  <label>Password <input type="password" name="password" autocomplete="current-password"></label>
  <button type="submit">Sign in</button>
</form>
<form method="post" action="/tenants/demo/login-actions/authenticate" id="passkey-form" data-failed="Your device did not finish signing in — {reason}. You can try again." data-cancelled="the request was cancelled" data-not-offered="this server is not offering passkeys">
  <input type="hidden" name="auth_session_id" value="01a1647b-2c2b-793d-b112-fbeacaf248f2">
  <input type="hidden" name="assertion" id="passkey-assertion">
  <p><button type="submit" id="passkey-submit" class="secondary">Sign in with a passkey</button></p>
</form>
<p id="passkey-error" class="alert" role="alert" hidden></p>
<noscript><p>Signing in with a passkey needs JavaScript, because only the browser can talk to your authenticator. Use your username and password above.</p></noscript>
<script nonce="qrhsxazSsYmSwGYFtNAftg==">
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
    const offered = await fetch('/tenants/demo/login-actions/passkey-challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ auth_session_id: form.auth_session_id.value }),
    });
    if (!offered.ok) throw new Error(form.dataset.notOffered);
    const options = await offered.json();
    const assertion = await navigator.credentials.get({
      publicKey: { ...options, challenge: fromBase64Url(options.challenge) },
    });
    field.value = JSON.stringify(assertion.toJSON());
    form.submit();
  } catch (caught) {
    const reason = caught && caught.message ? caught.message : form.dataset.cancelled;
    failure.textContent = form.dataset.failed.replace('{reason}', () => reason);
    failure.hidden = false;
  }
});
</script>
</main>
<script nonce="qrhsxazSsYmSwGYFtNAftg==">window.addEventListener('pageshow', function (event) { if (event.persisted) location.reload(); });</script>
</body>
</html>
```

(`auth_session_id`, the script's `nonce`, the `x-request-id` and `Date`
headers and the cookie's secret differ per run.)

The `set-cookie` header is new with the sign-in page. The cookie is `odudu-sign-in`, or
`__Secure-odudu-sign-in` when `ODUDU_TLS=true`. It names the authentication session this response
parked (the `auth_session_id` in the form). It proves the browser is the one that parked it, with
a secret that appears nowhere else, and the session's row keeps only a hash of it. It is
`HttpOnly` and `SameSite=Lax`, scoped to this tenant's path, and lasts as long as the parked
request (`Max-Age=1800`). It is not a session and signs nobody in; the login form's own
anti-forgery value is still the posted `auth_session_id`. What reads it is the page a mailed link
opens, which offers a way back to this request only to the browser holding it: see
[the way there and back](./self-registration.md#the-way-there-and-back).

The second form is the passkey one, and it has no username field of its
own: see [Signing in with a passkey](./signing-in-with-a-passkey-and-no-username.md).
It appears only where `ODUDU_PUBLIC_BASE_URL` is set, and only beside the
password — a passkey is an alternative to a first factor, not to a code
asked for after one, so the code form further down carries no script and no
`script-src` with it.

The script is inline because only a script can reach an authenticator. This
page and the passkey enrolment page are the two whose policy is not
`default-src 'none'` alone (ADR 0018's amendment); this one also carries
`connect-src 'self'`, since its script fetches the challenge:

```
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' http://localhost:8080; base-uri 'none'; script-src 'nonce-uYonuarTnJ+02aAWxgis8g=='; connect-src 'self'
```

(From its own stack, on `http://localhost:3086`, for the same `demo-spa`
request.) `form-action` names `http://localhost:8080` beside `'self'`: the
form's answer is a `302` to this request's `redirect_uri`, and a browser holds
the redirect a form submission follows to the directive too. The origin comes
from the request `/authorize` parked, never from the submission ([ADR
0018](https://github.com/wizzywit/odudu/blob/main/docs/adr/0018-framing-defence-on-rendered-pages.md)'s
second amendment).

That `nonce` is the one on the `<script>` element of the page it came with, minted
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
authentication session lives for the tenant's `login_ttl_seconds` (default
`1800`, thirty minutes).

`POST` is accepted at the same endpoint with the parameters form-encoded
(OIDC Core §3.1.2.1), and answers identically:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  --data 'response_type=code&client_id=demo-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&state=xyz-123&code_challenge=hUGit6EJl__NDqDG80Q49rMU-3qeOri8dH1TTe49hmI&code_challenge_method=S256' \
  'http://localhost:3000/tenants/demo/protocol/openid-connect/auth'
```

```
200
```

(The `code_challenge` shown is one run's value; any well-formed S256
challenge behaves the same.) Everything past "where do the parameters come
from" is one shared code path, so the two methods cannot drift apart.

## 3. The login POST

```bash
curl -sS -D - -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  'http://localhost:3000/tenants/demo/login-actions/authenticate'
```

```
HTTP/1.1 302 Found
set-cookie: demo-session=01a1d09d-b8ea-…:-f-lehfJxhKV…; HttpOnly; SameSite=Lax; Path=/
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-device=C74Nzrm4yL83SYBrNJWgWg; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/demo/; Max-Age=0
location: http://localhost:8080/callback?code=7Dk1_YDCRJAn…&state=xyz-123&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fdemo
content-length: 0
```

(Session entry and code truncated.)

The cookie's value is an **entry**, `<session id>:<secret>`: the id of the
session row, and 32 random bytes in base64url of which the server keeps
only a sha256 hash (`sessions.secret_hash`). The id half is public — it is
the `sid` claim of every ID token and access token this session issues —
so it identifies the session and authenticates nothing: presenting it
alone, or with any secret but this one, resolves to no session at all, at
the same cost as an id that names none. A browser holding several sessions
carries several entries, joined with `.`.

Four `set-cookie` headers, not one: the ephemeral `demo-session` this login
just established, `demo-session-persistent` cleared to empty with
`Max-Age=0` because this submission carried no `remember_me` field,
`demo-device`, the browser's device cookie (a random value that names no one;
[A session's device](./the-me-api.md#a-sessions-device) shows what it does),
and `odudu-sign-in`, the cookie the form's page set, cleared too because the
request it named is spent. The first two are always sent so a browser holding
a stale persistent cookie from before this pair existed loses it on the next
login rather than carrying it forward unnoticed. [A remembered
login](#a-remembered-login) below shows the other case.

Three things in that response:

- **`code`** — 32 random bytes, base64url. Only its SHA-256 hash is stored.
  It lives for the tenant's `authorization_code_ttl_seconds` — **60
  seconds** by default, ten minutes at most (RFC 6749 §4.1.2) — and can be
  redeemed once.
- **`state`** — echoed back exactly as sent. The client compares it to what
  it sent and abandons the response if it differs.
- **`iss`** — RFC 9207 §2. The client checks it names the server it started
  with. Without it, a client talking to several providers cannot tell which
  one answered, which is the opening a mix-up attack needs.

The cookie is the SSO session, and it has two clocks rather than one: the
tenant's `sso_session_idle_seconds` (default `1800`) from its last use, and
`sso_session_max_seconds` (default `36000`) from when it was established,
whichever comes first. It carries `Secure` and the `__Host-` prefix when the
server is told TLS terminates in front of it (`ODUDU_TLS=true`); on this
plain-HTTP stack it does not, and the name is `demo-session` rather than
`__Host-demo-session`. **`/authorize` reads it** — a second authorization
request from the same browser completes without the form, and `prompt`
decides whether that is allowed: see
[Signing in again from an existing session](./the-branches.md#signing-in-again-from-an-existing-session).

**What the client does next:** verify `state` and `iss`, then redeem the
code. Immediately: it expires in a minute.

### A refused login says so

A password the server turns down answers `200` with the form again, and the
form says so. The run below is against `demo` and `ada` as
[Bootstrap](./bootstrap.md#a-public-client-with-a-user) seeded them, on a stack started
with `ODUDU_THROTTLE_LIMIT=10000 ODUDU_LOGIN_THROTTLE_LIMIT=10000`;
`$AUTH_SESSION_ID` is the `auth_session_id` of a fresh `/authorize` form and
`$LOGIN` the login endpoint, `http://localhost:3195/tenants/demo/login-actions/authenticate`.
The response is shortened at the passkey script, which is the one
[the login page](#2-authorize) prints in full:

```bash
curl -sS -i \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=wrong-password' \
  "$LOGIN" | tr -d '\r' > /tmp/refused-wrong-password.txt
```

```
HTTP/1.1 200 OK
x-request-id: 01a17a89-5f66-7347-b6fd-04f4cf9b0e7f
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' http://localhost:8080; base-uri 'none'; script-src 'nonce-ga/V0OCL8nYHuyQADkB5Dw=='; connect-src 'self'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 3654
Date: Mon, 26 Oct 2026 23:26:25 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sign in</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Sign in</h1>
<p class="context">to continue to <bdi>demo-spa</bdi></p>
<p class="tenant"><bdi>demo</bdi></p>
</header>
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">Sign-in failed. Check your details and try again.</li>
</ul>
</div>
<form method="post" action="/tenants/demo/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a17a89-5f4f-71e1-a50b-49d5651d9943">
  <label>Username <input type="text" name="username" autocomplete="username" value="ada" aria-invalid="true" aria-describedby="form-error-0"></label>
  <label>Password <input type="password" name="password" autocomplete="current-password" aria-invalid="true" aria-describedby="form-error-0" autofocus></label>
  <button type="submit">Sign in</button>
</form>
<form method="post" action="/tenants/demo/login-actions/authenticate" id="passkey-form" data-failed="Your device did not finish signing in — {reason}. You can try again." data-cancelled="the request was cancelled" data-not-offered="this server is not offering passkeys">
  <input type="hidden" name="auth_session_id" value="01a17a89-5f4f-71e1-a50b-49d5651d9943">
  <input type="hidden" name="assertion" id="passkey-assertion">
  <p><button type="submit" id="passkey-submit" class="secondary">Sign in with a passkey</button></p>
</form>
<p id="passkey-error" class="alert" role="alert" hidden></p>
<noscript><p>Signing in with a passkey needs JavaScript, because only the browser can talk to your authenticator. Use your username and password above.</p></noscript>
<script nonce="ga/V0OCL8nYHuyQADkB5Dw==">…</script>
</main>
</body>
</html>
```

The same request for a name nobody holds, compared with that file line by
line:

```bash
curl -sS -i \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=nobody' \
  --data-urlencode 'password=wrong-password' \
  "$LOGIN" | tr -d '\r' > /tmp/refused-unknown-user.txt
diff /tmp/refused-wrong-password.txt /tmp/refused-unknown-user.txt
```

```
2c2
< x-request-id: 01a17a89-5f66-7347-b6fd-04f4cf9b0e7f
---
> x-request-id: 01a17a89-5fad-7006-b71d-1e89078d4768
4c4
< content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' http://localhost:8080; base-uri 'none'; script-src 'nonce-ga/V0OCL8nYHuyQADkB5Dw=='; connect-src 'self'
---
> content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' http://localhost:8080; base-uri 'none'; script-src 'nonce-Bjx0VB6x6YcbAGsFeQU9fQ=='; connect-src 'self'
10c10
< content-length: 3654
---
> content-length: 3657
41c41
<   <label>Username <input type="text" name="username" autocomplete="username" value="ada" aria-invalid="true" aria-describedby="form-error-0"></label>
---
>   <label>Username <input type="text" name="username" autocomplete="username" value="nobody" aria-invalid="true" aria-describedby="form-error-0"></label>
52c52
< <script nonce="ga/V0OCL8nYHuyQADkB5Dw==">
---
> <script nonce="Bjx0VB6x6YcbAGsFeQU9fQ==">
```

Five lines differ: the request id, the script nonce (in the header and on
the element), the length that follows the typed name, and the typed name
itself; the time of the response differs too when the second turns between
the two requests, as it did not here. Nothing says whether the account exists.

- **One message per step, whatever the cause.** The password step says
  `Sign-in failed. Check your details and try again.` for a wrong password,
  an unknown username, a locked account, a disabled account and an assertion
  that did not verify alike; the code form says `That code did not work.
Check it and try again.` for a wrong or replayed code and for a recovery
  code no list holds; a form that asks only for a recovery code says `That
recovery code did not work. Check it and try again.` The one message that
  says more is a recovery code the list **did** hold and the person has
  already spent ([below](./recovery-codes.md#the-same-code-again-is-refused-as-a-used-code)),
  because that is their own credential on an attempt already bound to them.
  A form that only asks for the next factor, or that was submitted with a
  field missing, claims no failure and carries no message.
- **The message is an alert and moves focus without a script.** It is
  one `<div role="alert">` above the form, and the fields it is about are
  `aria-invalid` and `aria-describedby` its entry; the first field still to fill
  carries `autofocus`: the password when the username is given back, the
  username otherwise, the code on the code form.
- **The username comes back, nothing else does.** It is escaped like any
  other interpolated value, and given back only on the password form: a
  password, a code or a recovery code is never put into a field. A name
  of more than 254 code points is not reflected at all, and the field comes
  back empty with the same message, so a megabyte of input is not a
  megabyte of output.
- **The page stays at the POST URL.** The address bar shows
  `/login-actions/authenticate`, not the `/authorize` URL the form came from.
  A reload asks the browser to confirm re-sending the form, and a confirmed
  one is another attempt — it counts towards the lockout and the throttle
  like any other. Back works because every page here is `no-store`
  ([how Back is handled](#a-login-posted-after-its-authentication-session-expired)):
  the browser fetches the `/authorize` form again rather than showing a stale
  one. A redirect to a `GET` that restored the URL was weighed and not
  built. The session id must stay out of a URL, since the hidden field is the
  form's whole CSRF defence, so the message could only reach the second page
  through server-side state keyed to the session, which is a new table to
  write, expire and read for a cosmetic gain; and the page at the POST URL
  already carries everything the person needs to try again.

### What a refused login leaves behind

Every password submitted writes one `login.password` row, accepted or not,
in the transaction that checked it. The two refusals below both answer
`200`, in bytes that differ only in the name typed, which
[Brute-force lockout](./brute-force-lockout.md) shows are identical by hash
once that is set aside; the rows are where they differ.
Each carries its own `x-request-id`, which the server adopts as the request
id and binds into the row, so the query that reads them back is scoped to
these two requests and to nothing else this document has done. The first
line prints the sha256 of the form's `auth_session_id`, which is what the
rows name it by:

```bash
printf '%s' "$AUTH_SESSION_ID" | shasum -a 256
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'x-request-id: login-refused-digest-wrong-password' \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=wrong-password' \
  "$LOGIN"
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'x-request-id: login-refused-digest-unknown-user' \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=nobody' \
  --data-urlencode 'password=wrong-password' \
  "$LOGIN"

docker compose exec -T postgres psql -U odudu -d odudu -x -P 'null=(null)' -c \
  "select e.action, e.outcome, e.actor_subject_id, c.client_id as actor_client,
          e.resource_type, e.resource_id, e.request_id, e.ip, e.detail
     from audit_events e left join clients c on c.id = e.actor_client_id
    where e.request_id in ('login-refused-digest-wrong-password',
                           'login-refused-digest-unknown-user')
    order by e.request_id desc;"
```

```
433ca52d17548c2c5857e420896a3a8d821a3fbf4e756e4a52aba362e60d8da8  -
200
200
-[ RECORD 1 ]----+-----------------------------------------------------------------
action           | login.password
outcome          | refused
actor_subject_id | 01a0db22-1c92-7730-9d37-4085f28eca2c
actor_client     | demo-spa
resource_type    | authentication_session
resource_id      | 433ca52d17548c2c5857e420896a3a8d821a3fbf4e756e4a52aba362e60d8da8
request_id       | login-refused-digest-wrong-password
ip               | 172.20.0.1
detail           | {"factor": "password", "reason": "bad_credential"}
-[ RECORD 2 ]----+-----------------------------------------------------------------
action           | login.password
outcome          | refused
actor_subject_id | (null)
actor_client     | demo-spa
resource_type    | authentication_session
resource_id      | 433ca52d17548c2c5857e420896a3a8d821a3fbf4e756e4a52aba362e60d8da8
request_id       | login-refused-digest-unknown-user
ip               | 172.20.0.1
detail           | {"factor": "password", "reason": "unknown_subject"}
```

That ran against the compose stack the other audit transcripts share, where
`ada` is subject `01a0db22-1c92-7730-9d37-4085f28eca2c` in `users` and whose
`/authorize` rendered `auth_session_id` `01a0de54-cffa-72f6-a6c3-90dd30a1809a`
for this run. The request ids are this run's own, since an earlier run of this
section left rows under the names it used before.

- **`resource_id` is a digest, never the `auth_session_id` itself.** The
  hidden field is what lets a browser finish a login that has already
  authenticated, so a row that carried it would hand anyone who can read
  the audit trail that login. The sha256 still names one login: every step
  of it, refused or accepted, carries the same `resource_id`.
- **The wrong password names `ada`; the unknown username names nobody.**
  `nobody` appears nowhere in the second row, and neither password appears
  in either: what was typed into the username field is never recorded,
  because people type passwords there often enough that recording it would
  eventually record one.
- **`ip` is the address the server saw**, `request.ip` and nothing else.
  Here that is Docker's bridge gateway, because nothing in front of the
  container is trusted to report the client's; `ODUDU_TRUST_PROXY` is what
  changes that, and no header does.
- **A locked account writes `reason: locked_out`** and answers with the same
  bytes as both of these ([Brute-force lockout](./brute-force-lockout.md)); the
  failure that locks it writes a second row, `lockout.tripped`. A second
  factor writes `login.otp` or `login.recovery_code` the same way, with
  `replayed` or `already_used` where the code was spent before, and a
  password that leads to one writes `factor.offered` naming the form.

### A remembered login

The login form renders a `remember_me` checkbox whenever the tenant's
`remember_me_allowed` setting is on (off by default):

```
<label><input type="checkbox" name="remember_me" id="remember-me" value="true"> Remember me</label>
```

`demo`'s setting was turned on for this run —
`odudu seed tenant --name demo --set remember_me_allowed=true` — since it is
off for every other transcript in this document. Ticking the box and
submitting the same form puts the new session's entry in the
**persistent** cookie instead:

```bash
curl -sS -D - -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  --data-urlencode 'remember_me=true' \
  'http://localhost:3000/tenants/demo/login-actions/authenticate'
```

```
HTTP/1.1 302 Found
set-cookie: demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-session-persistent=01a1d09d-b96b-…:GdO1oO9zZD_V…; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000
set-cookie: demo-device=O_6pQxUENAmIo6kkDHAZrw; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/demo/; Max-Age=0
location: http://localhost:8080/callback?code=fqoFC5lEuP9m…&state=xyz-123&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fdemo
content-length: 0
```

(Session entry and code truncated.) The two cookies swap roles from the
ordinary case above: `demo-session` is now the one cleared with
`Max-Age=0`, and `demo-session-persistent` carries this session's entry with
`Max-Age=2592000` — the tenant's `remember_me_max_seconds` (default 30
days), not `sso_session_max_seconds`. The session this establishes is also
measured against a different idle window while it lives,
`remember_me_idle_seconds` (default 7 days) rather than
`sso_session_idle_seconds`.

**The tenant setting is the authority, the field is only a request.** A
tenant with `remember_me_allowed` off ignores `remember_me` outright: the
session it establishes lands in the ephemeral cookie exactly as the
ordinary transcript above shows, with the persistent cookie still sent but
cleared, `Max-Age=0` — ticking a box the login page never even offered
(since the checkbox itself is gated on the same setting) changes nothing.

### A login posted after its authentication session expired

The parked request lives for the tenant's `login_ttl_seconds`, 30 minutes
by default. A login form left open longer and then submitted is refused with
nothing issued: no code and no redirect back to the client. The refusal page
offers **Start sign-in again** when it can rebuild the request, and says only
"Go back and start again" when it cannot.

Every sign-in page is also sent `cache-control: no-store`, so Back to the form
that preceded the refusal asks the server for it again rather than showing the
form with its dead `auth_session_id`. A page restored from a browser's
back/forward cache is the one case headers do not reach, so a form served to a
GET carries a small script that reloads it on `pageshow` when
`event.persisted` is true; a page that answers a POST carries none, because a
reload would send the POST again. ADR 0029's amendment has the reasoning.

On its own stack, not the one above, on `http://localhost:3094`, with `demo`
seeded as [Bootstrap](./bootstrap.md) does. A form fetched from the
authorization endpoint parked the request as
`01a137db-8c45-74c1-94ea-205ea7fded94`. The row, as stored, then the same row
expired with `psql` and shown to be (the `-x` listing and the header spaces
trimmed):

```sql
select expires_at - created_at as lifetime, pending_request from authentication_sessions
  where id = '01a137db-8c45-74c1-94ea-205ea7fded94';
update authentication_sessions set expires_at = now() - interval '1 second'
  where id = '01a137db-8c45-74c1-94ea-205ea7fded94';
select expires_at < now() as expired from authentication_sessions
  where id = '01a137db-8c45-74c1-94ea-205ea7fded94';
```

```
-[ RECORD 1 ]---+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
lifetime        | 00:30:00.00075
pending_request | {"nonce": null, "scope": "openid", "state": "demo-state", "claims": {"idToken": {}, "userinfo": {}}, "prompt": [], "clientId": "demo-spa", "resource": [], "redirectUri": "http://localhost:8080/callback", "codeChallenge": "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "codeChallengeMethod": "S256"}

UPDATE 1
 expired
---------
 t
(1 row)
```

The tenant's codes at this point, so that nothing below can be said to have
issued one:

```sql
select count(*) as codes from authorization_codes
  where tenant_id = (select id from tenants where name = 'demo');
```

```
 codes
-------
     4
(1 row)
```

The right password, posted against the expired row:

```bash
curl -sS -D - -X POST \
  --data-urlencode auth_session_id=01a137db-8c45-74c1-94ea-205ea7fded94 \
  --data-urlencode username=ada \
  --data-urlencode password=correct-horse-battery \
  http://localhost:3094/tenants/demo/login-actions/authenticate
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a137db-8e6b-77ac-b25e-37ce7a4452eb
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 1241
Date: Wed, 14 Oct 2026 00:41:38 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sign-in error</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Can&#39;t continue</h1>
<p><bdi>This sign-in attempt is no longer valid. Go back and start again.</bdi></p>
<p><a href="/tenants/demo/protocol/openid-connect/auth?response_type=code&amp;client_id=demo-spa&amp;redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&amp;scope=openid&amp;code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&amp;code_challenge_method=S256&amp;state=demo-state">Start sign-in again</a></p>
<p><small>invalid_request</small></p>
</main>
</body>
</html>
```

The link is this server's own authorization endpoint, rebuilt from the request
`/authorize` parked and validated, which the `pending_request` above shows:
`client_id`, `redirect_uri`, `scope`, `state` and the PKCE challenge are its
`clientId`, `redirectUri`, `scope`, `state` and `codeChallenge`. `/authorize`
validates it again from scratch when it is followed. The row authenticated
nothing: it was read only for those parameters, and it is still there because
the reaper keeps an expired one for
`ODUDU_RETENTION_AUTHENTICATION_SESSION_SECONDS` (an hour by default) after it
expires. A request that carried an `id_token_hint`, or a `claims` `sub`, is not
rebuilt, since the hint token itself is not stored and a request without it
would no longer be tied to one subject; it is handed back to its client
instead, in [Returning to the application](#returning-to-the-application)
below.

Following the link, with its `&amp;` read as `&`:

```bash
curl -sS -D - 'http://localhost:3171/tenants/demo/protocol/openid-connect/auth?response_type=code&client_id=demo-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=demo-state'
```

The response is `200` with the login form under a new `auth_session_id`
(`01a13fbe-5249-763c-b2e5-d2f276d734a5`), these headers, and, after the form, the reload script on the
same nonce the policy names:

```
HTTP/1.1 200 OK
x-request-id: 01a13fbe-5240-7c96-8789-6be19bcf58ab
set-cookie: odudu-sign-in=01a17a85-9fd8-7a3b-884a-3d516ef4d141._AOgPuOPokggVhZBE9a3mKwiyCh8FWYJW40gYg0HqkA; HttpOnly; SameSite=Lax; Path=/tenants/demo/; Max-Age=1800
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' http://localhost:8080; base-uri 'none'; script-src 'nonce-A4EUaub9ChHrn95wQwVmDg=='; connect-src 'self'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 3533
Date: Thu, 15 Oct 2026 13:26:39 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

```
<script nonce="A4EUaub9ChHrn95wQwVmDg==">window.addEventListener('pageshow', function (event) { if (event.persisted) location.reload(); });</script>
```

Then the reaper's work, which is what makes the link impossible: with the row
deleted, the same post has nothing to rebuild from and the page has no link.
The deletion, then the post:

```sql
delete from authentication_sessions where id = '01a137db-8c45-74c1-94ea-205ea7fded94';
```

```
DELETE 1
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a137db-8fa1-7f47-be66-a008a108cfbf
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 925
Date: Wed, 14 Oct 2026 00:41:38 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sign-in error</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Can&#39;t continue</h1>
<p><bdi>This sign-in attempt is no longer valid. Go back and start again.</bdi></p>
<p><small>invalid_request</small></p>
</main>
</body>
</html>
```

An `auth_session_id` that names nothing at all
(`00000000-0000-4000-8000-000000000000`, which no row holds) is answered by the same page:

```bash
curl -sS -D - -X POST \
  --data-urlencode auth_session_id=00000000-0000-4000-8000-000000000000 \
  --data-urlencode username=ada \
  --data-urlencode password=correct-horse-battery \
  http://localhost:3094/tenants/demo/login-actions/authenticate
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a137db-facc-7f29-86ed-3823793412ee
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 925
Date: Wed, 14 Oct 2026 00:42:05 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sign-in error</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Can&#39;t continue</h1>
<p><bdi>This sign-in attempt is no longer valid. Go back and start again.</bdi></p>
<p><small>invalid_request</small></p>
</main>
</body>
</html>
```

No code was issued by any of it, which the count shows against the one read
before:

```sql
select count(*) as codes from authorization_codes
  where tenant_id = (select id from tenants where name = 'demo');
```

```
 codes
-------
     4
(1 row)
```

The 30 minutes are the tenant's `login_ttl_seconds`, which
`PATCH /admin/tenants/{tenant}/settings` amends between `60` and `86400`
([Admin paths](../admin-paths/get-settings-and-patch-settings.md)).

### Returning to the application

A request that carried an `id_token_hint`, or a `claims` parameter whose
`id_token` names a `sub`, parks the subject it names with the request, and a
rebuilt authorization request could not carry that constraint (the hint token
is not stored). Its refusal offers **Return to the application** instead: an
error redirect to the `redirect_uri` the request was validated with, built by
the same `errorRedirect` the endpoint uses for its other refusals, with
`error=access_denied` (RFC 6749 section 4.1.2.1, OIDC Core section 3.1.2.6: the
sign-in was not completed and nothing was granted), the request's `state` and
the issuer as `iss`. The relying party restarts with a hint of its own. It is
offered only while the client is enabled and still registers that
`redirect_uri`. Same stack as above, a request naming `ada` as the `sub`
(`01a137d6-bf12-771f-81fb-97620b5fd349`), its row, expired, then the right password:

```bash
curl -sS -G 'http://localhost:3094/tenants/demo/protocol/openid-connect/auth' \
  --data-urlencode response_type=code --data-urlencode client_id=demo-spa \
  --data-urlencode redirect_uri=http://localhost:8080/callback \
  --data-urlencode scope=openid --data-urlencode state=demo-state \
  --data-urlencode code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM \
  --data-urlencode code_challenge_method=S256 \
  --data-urlencode 'claims={"id_token":{"sub":{"value":"01a137d6-bf12-771f-81fb-97620b5fd349"}}}'
```

The form it rendered parked the request as `01a137db-f90d-7fad-a999-84eb2dd317cb`, and the row holds the
constraint as `claimsSubject`:

```sql
select pending_request from authentication_sessions
  where id = '01a137db-f90d-7fad-a999-84eb2dd317cb';
update authentication_sessions set expires_at = now() - interval '1 second'
  where id = '01a137db-f90d-7fad-a999-84eb2dd317cb';
```

```
-[ RECORD 1 ]---+------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
pending_request | {"nonce": null, "scope": "openid", "state": "demo-state", "claims": {"idToken": {"sub": {"value": "01a137d6-bf12-771f-81fb-97620b5fd349", "essential": false}}, "userinfo": {}}, "prompt": [], "clientId": "demo-spa", "resource": [], "redirectUri": "http://localhost:8080/callback", "claimsSubject": "01a137d6-bf12-771f-81fb-97620b5fd349", "codeChallenge": "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "codeChallengeMethod": "S256"}
UPDATE 1
```

```bash
curl -sS -D - -X POST \
  --data-urlencode auth_session_id=01a137db-f90d-7fad-a999-84eb2dd317cb \
  --data-urlencode username=ada \
  --data-urlencode password=correct-horse-battery \
  http://localhost:3094/tenants/demo/login-actions/authenticate
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a137db-fa94-75e9-bec9-c11977da9446
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 1157
Date: Wed, 14 Oct 2026 00:42:05 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sign-in error</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Can&#39;t continue</h1>
<p><bdi>This sign-in attempt is no longer valid. Go back and start again.</bdi></p>
<p><a href="http://localhost:8080/callback?error=access_denied&amp;error_description=The+user+did+not+allow+the+request.&amp;state=demo-state&amp;iss=http%3A%2F%2Flocalhost%3A3094%2Ftenants%2Fdemo">Return to the application</a></p>
<p><small>invalid_request</small></p>
</main>
</body>
</html>
```

The link is the client's own callback, carrying the error and the `state` the
client sent, so the client can tell which of its requests ended and start the
next one.

### Signing in with an email address

A tenant whose `login_with_email` is on (default `false`,
[Admin paths](../admin-paths/get-settings-and-patch-settings.md#lifetimes-and-signing-in-with-an-email-address))
takes a verified email address in the same field as a username, matched
without regard to case. An input carrying `@` names the subject whose
verified address it is before any subject whose username it is, since
anybody may choose a username that copies an address but only its owner
verified it; an address nobody holds, one that is not verified, and one two
subjects hold in different cases all answer exactly as an unknown username
does, through the same statements, so the form says nothing about which
addresses exist. A wrong password counts towards the lockout of the
subject the address resolves to.

On `http://localhost:3171`, in a tenant `email-demo` seeded for it with `odudu
seed --tenant email-demo --client email-spa --redirect-uri
http://localhost:8080/callback --user grace --password correct-horse-battery
--email Grace@Example.com`, the setting turned on with `odudu seed tenant --name
email-demo --set login_with_email=true`, and the address marked verified
directly, with `update users set email_verified = true where email =
'Grace@Example.com'` in that tenant, in place of the admin API's profile
`PATCH`. The form names the field for both, and the address signs in typed in
another case:

```bash
AUTHORIZE='http://localhost:3171/tenants/email-demo/protocol/openid-connect/auth?response_type=code&client_id=email-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&state=s&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
PAGE=$(curl -sS "$AUTHORIZE")
echo "$PAGE" | grep -o '<label>[^<]*<input type="text"[^>]*>'
AUTH_SESSION_ID=$(echo "$PAGE" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)
curl -sS -D - -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=GRACE@example.com' \
  --data-urlencode 'password=correct-horse-battery' \
  http://localhost:3171/tenants/email-demo/login-actions/authenticate \
  | tr -d '\r' | grep -E '^HTTP|^location'
```

```
<label>Username or email <input type="text" name="username" autocomplete="username">
HTTP/1.1 302 Found
location: http://localhost:8080/callback?code=m_AGVWoDQOIiXXSQXiBjo6AdthcOo__zmLqpnJLKmFU&state=s&iss=http%3A%2F%2Flocalhost%3A3171%2Ftenants%2Femail-demo
```

A wrong password for the held address and any password for an address
nobody holds return byte-identical pages, once the three values that differ
— the form's own `auth_session_id`, the passkey script's nonce, and the
address typed, which the form gives back — are set aside:

```bash
for login in nobody@example.com grace@example.com; do
  PAGE=$(curl -sS "$AUTHORIZE")
  AUTH_SESSION_ID=$(echo "$PAGE" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)
  curl -sS -w '%{http_code} ' \
    --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
    --data-urlencode "username=$login" \
    --data-urlencode 'password=wrong-password' \
    http://localhost:3171/tenants/email-demo/login-actions/authenticate \
    | sed -e "s/$AUTH_SESSION_ID/AUTH_SESSION_ID/g" -e 's/nonce="[^"]*"/nonce="NONCE"/' \
          -e "s/value=\"$login\"/value=\"LOGIN\"/" \
    | shasum -a 256
done
```

```
dd856882a68ba289d87a9a1d39efefb1c8bc6679b6364e198c464e280fa529a0  -
dd856882a68ba289d87a9a1d39efefb1c8bc6679b6364e198c464e280fa529a0  -
```

## 4. `/token`

```bash
curl -sS -D - \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode "code_verifier=$VERIFIER" \
  'http://localhost:3000/tenants/demo/protocol/openid-connect/token'
```

```
HTTP/1.1 200 OK
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{
  "access_token": "eyJhbGciOiJSUzI1NiIs…",
  "id_token": "eyJhbGciOiJSUzI1NiIs…",
  "refresh_token": "HyqdGK5v2WV2lTarwqmC…",
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
{ "alg": "RS256", "kid": "01a0cb07-4e73-…", "typ": "at+jwt" }
{
  "iss": "http://localhost:3000/tenants/demo",
  "sub": "01a0cb07-4e76-…",
  "aud": ["http://localhost:3000/tenants/demo"],
  "client_id": "demo-spa",
  "scope": "openid profile email",
  "iat": 1790112846,
  "exp": 1790113146,
  "jti": "01a0cb0a-51c4-…",
  "sid": "01a0cb0a-5198-…",
  "grant_id": "01a0cb0a-51c4-7c7c-88cf-381892eee930"
}
```

`typ: at+jwt` (RFC 9068) is what stops an ID token being presented in its
place at `/userinfo`. The issuer is always in `aud`, added to whatever
resource audiences the client is configured for, because a token that
cannot be used at the issuer's own endpoints would be unusable for what
OIDC promised the client.

`grant_id` is a private claim: the `token_grants` row this access token was
minted from, present on every access token without exception — unlike `sid`,
absent below on a grant with no session. It is what lets introspection (and
`/revoke`) name one grant precisely; see [the RFC 9068 reading
note](https://github.com/wizzywit/odudu/blob/main/docs/protocols/rfc9068.md) on
private claims. Shown here in full rather than truncated, because `jti` and
`grant_id` are minted close enough together that their first 13 characters —
this document's usual truncation — coincide.

**A `resource` at `/token` narrows what the code already carries, and can
never widen it.** The same `resource` `/authorize` resolves and stores on
the code (see its own bullet under
[the roadmap](../../../roadmap.md#decided-against-and-why)) is what `/token`
derives `aud` from — a `resource` on the token request itself may select
one value out of what the code carries, but naming one the code does not
carry refuses with `invalid_target` rather than being ignored, on a public
client with no secret to authenticate the request. `$CODE` above is
already spent by the successful redemption, so this needs a fresh one —
the first three blocks under
[The shell variables](./bootstrap.md#the-shell-variables-the-rest-of-this-document-uses),
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
{"error":"invalid_target","error_description":"A requested resource is not available to this client."}
HTTP 400
```

Redeeming `$CODE` above with the _same_ `resource` a second time, or
without minting a fresh one first, does not reproduce this: the code is
already single-use spent by then, and the answer is `invalid_grant`, not
`invalid_target` — the two are easy to conflate by output shape alone, and
only a fresh code isolates which one actually fired.

`demo-spa` has no registered `audiences` — every client seeded by this document
does not, because none was given `odudu seed client --audience` — so its code's stored `resource`
is `[]`, and no `resource` named at `/token` is ever found in it; the ordinary
redemption above, naming none, still succeeds with `aud` the issuer alone,
exactly as it did before this existed. A client registered for at least one
audience — set with `odudu seed client --audience`, in the console or through the
admin API's `audiences` — would see `resource` narrow `aud`
to that one value instead; an integration test exercises that case, and the
refresh grant's own derivation. The refresh path narrows from the grant that the
original redemption already resolved, not from the client's current
configuration, so a narrowing made when the code was redeemed survives every
later refresh; a `resource` named on a refresh request itself narrows only that
one response and is not written back to the grant, so the refresh after it
returns to the grant's own (already-resolved) audience rather than whatever the
previous refresh asked for.

Requesting `profile` and `email` grants them (they are in `scope` above)
without putting `name`, `email` or `email_verified` on this token: an
access token goes to whatever's named in `aud`, not the browser, and
`client_scopes.include_in_access_token` defaults to `false` for
`openid`/`profile`/`email` for exactly that reason — the [`roles` section
below](#roles-once-a-scope-reaches-it) shows the symmetric flag that admits
`roles`/`groups` here by default instead.

The ID token, decoded:

```json
{ "alg": "RS256", "kid": "01a0cb07-4e73-…" }
{
  "sub": "01a0cb07-4e76-…",
  "name": "ada",
  "preferred_username": "ada",
  "email": "ada@example.com",
  "email_verified": false,
  "iss": "http://localhost:3000/tenants/demo",
  "aud": "demo-spa",
  "iat": 1790112846,
  "exp": 1790113146,
  "nonce": "n-0S6_WzA2Mj",
  "sid": "01a0cb0a-5198-…",
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

## `roles`, once a scope reaches it

RFC 9068 §2.2.3.1 names `roles` as an access token claim, and Odudu adds it
to the same registry that assembles the ID token and `/userinfo` — but only
for the roles a granted scope actually reaches. `odudu seed` now has
subcommands for the whole identity model this needs, run against the same
tenant and user the [Bootstrap](./bootstrap.md) section above already seeded:

```bash
odudu seed role --tenant demo --name reviewer
```

```json
{
  "command": "role",
  "tenant": "demo",
  "tenantId": "01a0cb07-4e24-73d6-8060-137e69941e60",
  "roleId": "01a0cb0b-3675-7d1d-a451-c4cffc489424",
  "name": "reviewer",
  "clientId": null
}
```

```bash
odudu seed grant-role --tenant demo --username ada --role reviewer
odudu seed map-role --tenant demo --scope roles --role reviewer
```

```json
{ "command": "grant-role", "tenant": "demo", "tenantId": "01a0cb07-4e24-73d6-8060-137e69941e60", "username": "ada", "role": "reviewer" }
{ "command": "map-role", "tenant": "demo", "tenantId": "01a0cb07-4e24-73d6-8060-137e69941e60", "scope": "roles", "role": "reviewer" }
```

That gives `ada` a `reviewer` role, mapped to the `roles` scope
`provisionTenantDefaults` already seeded for the tenant — `demo-spa` already
carries `roles` among the default scopes `seed client` assigned it, so no
`assign-scope` call is needed here; see [`assign-scope` and `default` versus
`optional`](#assign-scope-and-default-versus-optional) below for when one
is. Requesting `scope=openid roles` instead of `scope=openid profile email`
and redeeming the code through Path A's usual steps produces an access
token that carries it:

```json
{
  "roles": ["reviewer"],
  "iss": "http://localhost:3000/tenants/demo",
  "sub": "01a0cb07-4e76-…",
  "aud": ["http://localhost:3000/tenants/demo"],
  "client_id": "demo-spa",
  "scope": "openid roles",
  "iat": 1790112905,
  "exp": 1790113205,
  "jti": "01a0cb0b-3ab9-…",
  "sid": "01a0cb0b-3a9e-…",
  "grant_id": "01a0cb0b-3ab9-…"
}
```

The ID token issued alongside it carries no `roles`, though the same
`reviewer` role reached the same scope:

```json
{
  "sub": "01a0cb07-4e76-…",
  "iss": "http://localhost:3000/tenants/demo",
  "aud": "demo-spa",
  "iat": 1790112905,
  "exp": 1790113205,
  "nonce": "n-0S6_WzA2Mj",
  "sid": "01a0cb0b-3a9e-…",
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
  http://localhost:3000/tenants/demo/protocol/openid-connect/userinfo
```

```json
{ "sub": "01a0cb07-4e76-7fbe-8d86-b7c083319ef0", "roles": ["reviewer"] }
```

A role reaches a token only when it is mapped, this way, to a scope the
client is assigned — a role held but never mapped to any scope is left out
of the token entirely, and so is every role once `client_scope_roles` maps
nothing at all. The one way around the intersection is
`clients.full_scope_allowed`, which defaults to `false`: set it and a
client's tokens carry every role the subject holds, unfiltered.

## `assign-scope`, and `default` versus `optional`

A client-scoped role — one qualified as `clientId:roleName` — needs the client
it is scoped to seeded first, because `roles_client_fk` is a real foreign key: a
role naming a client that does not exist cannot be inserted, let alone granted.

```bash
odudu seed client \
  --tenant demo --client-id reports-api --client-secret reports-api-secret \
  --redirect-uri http://localhost:9000/cb
odudu seed role --tenant demo --name reader --client-id reports-api
odudu seed grant-role --tenant demo --username ada --role reports-api:reader
odudu seed map-role --tenant demo --scope roles --role reports-api:reader
```

```json
{ "command": "client", "created": true, "tenant": "demo", "tenantId": "01a0cb07-4e24-73d6-8060-137e69941e60", "clientId": "reports-api", "clientDbId": "01a0cb0b-9333-7597-8f47-5889cf21793c" }
{ "command": "role", "tenant": "demo", "tenantId": "01a0cb07-4e24-73d6-8060-137e69941e60", "roleId": "01a0cb0b-94a9-7bf5-9be5-93c7245e50f4", "name": "reader", "clientId": "reports-api" }
{ "command": "grant-role", "tenant": "demo", "tenantId": "01a0cb07-4e24-73d6-8060-137e69941e60", "username": "ada", "role": "reports-api:reader" }
{ "command": "map-role", "tenant": "demo", "tenantId": "01a0cb07-4e24-73d6-8060-137e69941e60", "scope": "roles", "role": "reports-api:reader" }
```

A token requested with `scope=openid roles` for `demo-spa` now carries
`"roles": ["reports-api:reader", "reviewer"]` — the qualified name is
exactly `clientId:roleName`, which is unambiguous only because
`roles_name_has_no_colon` refuses a `:` inside a role name itself; naming a
role with two colons (`a:b:c`) is refused by `grant-role`/`map-role` rather
than guessed at, since the client half could not contain one either.

`seed client` assigns every tenant-default scope — `roles` and `groups`
among them — to a client the moment it is created, with assignment kind
`default`. `seed assign-scope` exists for the scope a tenant defines
_afterwards_ — a resource server's own `reports:read`, say — that a client
needs added explicitly:

```bash
odudu seed scope --tenant demo --name reports:read
odudu seed assign-scope \
  --tenant demo --client-id demo-spa --scope reports:read --assignment optional
```

```json
{ "command": "scope", "tenant": "demo", "tenantId": "01a0cb07-4e24-73d6-8060-137e69941e60", "scopeId": "01a0cb0b-98f6-72d1-9c9d-06d721bd2f5b", "name": "reports:read" }
{ "command": "assign-scope", "tenant": "demo", "tenantId": "01a0cb07-4e24-73d6-8060-137e69941e60", "clientId": "demo-spa", "scope": "reports:read", "assignment": "optional" }
```

`assign-scope` is safe to run against a scope a client already carries — it
narrows or widens the existing assignment rather than colliding with it,
which matters because every tenant-default scope is already assigned by the
time a client exists to run it against.

**"I created a role and it is not in my token."** Three things gate it,
independently: the role must be granted to the subject (`grant-role`), the
role must be mapped to a scope (`map-role`), and the client must be assigned
that scope and the token request must actually include it (`scope=` at
`/authorize`, or `clients.full_scope_allowed`). Missing any one of the
three is indistinguishable from the outside — the claim is simply absent —
so when it is missing, check the three in that order rather than guessing
which one it was.

## Groups, and role inheritance

A role can also reach a token through a group rather than a direct grant.
`seed map-group-role` is the only path from the CLI to that: it maps a role
to a group the way `map-role` maps one to a client scope, and effective
role resolution then walks a subject's groups and their ancestors, not just
its direct assignments, in the same recursive CTE `groupRepository.mapRole`
was built for.

```bash
odudu seed group --tenant demo --name engineering
odudu seed group --tenant demo --name backend --parent /engineering
odudu seed join-group --tenant demo --username ada --group /engineering/backend
odudu seed role --tenant demo --name engineering-lead
odudu seed map-group-role --tenant demo --group /engineering --role engineering-lead
odudu seed map-role --tenant demo --scope roles --role engineering-lead
```

```json
{ "command": "group", "tenant": "demo", "tenantId": "01a0cb07-4e24-73d6-8060-137e69941e60", "groupId": "01a0cb0b-f688-7ac7-b127-0ced7f7970cd", "path": "/engineering" }
{ "command": "group", "tenant": "demo", "tenantId": "01a0cb07-4e24-73d6-8060-137e69941e60", "groupId": "01a0cb0b-f7fe-7c92-95c6-ab072a559d88", "path": "/engineering/backend" }
{ "command": "join-group", "tenant": "demo", "tenantId": "01a0cb07-4e24-73d6-8060-137e69941e60", "username": "ada", "group": "/engineering/backend" }
{ "command": "role", "tenant": "demo", "tenantId": "01a0cb07-4e24-73d6-8060-137e69941e60", "roleId": "01a0cb0b-fb9e-7d1a-a9e0-1da5dbed5397", "name": "engineering-lead", "clientId": null }
{ "command": "map-group-role", "tenant": "demo", "tenantId": "01a0cb07-4e24-73d6-8060-137e69941e60", "group": "/engineering", "role": "engineering-lead" }
{ "command": "map-role", "tenant": "demo", "tenantId": "01a0cb07-4e24-73d6-8060-137e69941e60", "scope": "roles", "role": "engineering-lead" }
```

`ada` is joined only to `/engineering/backend`, the _child_; the role is
mapped only to `/engineering`, the _parent_. Requesting `scope=openid roles
groups` and redeeming the code carries both `reviewer` (granted directly,
[above](#roles-once-a-scope-reaches-it)) and `engineering-lead` (reached
through the group) onto the same access token:

```json
{
  "roles": ["engineering-lead", "reports-api:reader", "reviewer"],
  "groups": ["/engineering/backend"],
  "iss": "http://localhost:3000/tenants/demo",
  "sub": "01a0cb07-4e76-…",
  "aud": ["http://localhost:3000/tenants/demo"],
  "client_id": "demo-spa",
  "scope": "openid roles groups",
  "iat": 1790112956,
  "exp": 1790113256,
  "jti": "01a0cb0b-ff48-…",
  "sid": "01a0cb0b-ff29-…",
  "grant_id": "01a0cb0b-ff47-7912-969b-83d383a2f5a5"
}
```

`groups` carries only the paths a subject directly belongs to — `ada`'s
own membership is `/engineering/backend`, not `/engineering` too — but
`roles` carries what those memberships and their ancestors reach, which is
why `engineering-lead` appears even though nothing ever joined `ada` to
`/engineering` itself. `seed join-group` is one way in; the admin API's
`PUT /admin/tenants/{tenant}/subjects/:id/groups` is the other, and refuses
a membership whose roles reach past its caller's own
([the admin paths](../admin-paths/index.md)).

## 5. `/userinfo`

```bash
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
  http://localhost:3000/tenants/demo/protocol/openid-connect/userinfo
```

```json
{
  "sub": "01a0cb07-4e76-…",
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
  http://localhost:3000/tenants/demo/protocol/openid-connect/userinfo
```

```
200
```

The claims come from the same registry the ID token's claims came from, so
one can never carry a claim the other omits for the same subject and scope.
The client must check that `sub` here matches the ID token's `sub`.

## The `claims` request parameter

§5.5's `claims` parameter narrows a response to what it names, never widens
one past what `scope` already granted — the parameter is not a path around
consent. This section reuses [the shell variables above](./bootstrap.md#the-shell-variables-the-rest-of-this-document-uses)
(`$BASE`, `$LOGIN`, `$VERIFIER`, `$CHALLENGE`, ada's own seeded credentials)
against the same stack, plus one more subject seeded the same documented
way — `odudu seed` refuses to add a second user to `demo-spa` once it
exists ("Seeding never adds a user to a client that already exists"
above), so `bob` gets his own client:

```bash
odudu seed \
  --tenant demo --client demo-second-user \
  --redirect-uri http://localhost:8080/callback \
  --user bob --password another-horse-battery
```

```json
{
  "created": true,
  "tenant": "demo",
  "tenantId": "01a0cb07-…",
  "clientId": "demo-second-user",
  "userSubjectId": "01a0cb0c-b2db-…"
}
```

`$ADA_SUB` and `$BOB_SUB` (used below) and `$COOKIE` are captured the same
way [the shell variables above](./bootstrap.md#the-shell-variables-the-rest-of-this-document-uses)
capture `$AUTH_SESSION_ID`/`$CODE` — re-running `odudu seed` for ada is
idempotent (`"created": false`, same `userSubjectId`), so this needs no
separate bootstrap:

```bash
ADA_SUB=$(odudu seed \
  --tenant demo --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com \
  | sed -n 's/.*"userSubjectId":"\([^"]*\)".*/\1/p')

BOB_SUB=$(odudu seed \
  --tenant demo --client demo-second-user \
  --redirect-uri http://localhost:8080/callback \
  --user bob --password another-horse-battery \
  | sed -n 's/.*"userSubjectId":"\([^"]*\)".*/\1/p')

AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=xyz-123' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "$BASE/auth" | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

COOKIE=$(curl -sS -D - -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  "$LOGIN" | sed -n 's/^[Ss]et-[Cc]ookie: \([^;]*\);.*/\1/p' | paste -sd'; ' -)
```

Requesting `email` with `scope=openid email` returns it:

```bash
curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid email' \
  --data-urlencode 'state=xyz-123' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'claims={"userinfo":{"email":null}}' \
  "$BASE/auth"
# … sign in as ada, redeem the code, then:
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" "$BASE/userinfo"
```

```json
{ "sub": "01a0cb07-4e76-…", "email": "ada@example.com" }
```

Every other scope-granted claim (`name`, `preferred_username`) is left out —
the `profile` scope was never asked for here, so this response was already
narrow — but `email` was, and it survives. The same request with
`scope=openid` alone — `email` never granted by scope this time — answers
with `email` absent, though `claims` asked for it exactly the same way:

```json
{ "sub": "01a0cb07-4e76-…" }
```

An `id_token` member's Essential Claims work the same way at `/token`.
Requesting `auth_time` as essential:

```bash
curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=xyz-123' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'claims={"id_token":{"auth_time":{"essential":true}}}' \
  "$BASE/auth"
# … sign in, redeem the code, then decode $ID_TOKEN
```

```json
{
  "sub": "01a0cb07-4e76-…",
  "iss": "http://localhost:3000/tenants/demo",
  "aud": "demo-spa",
  "iat": 1790113003,
  "exp": 1790113303,
  "auth_time": 1790113003,
  "sid": "01a0cb0c-b85c-…",
  "amr": ["pwd"],
  "acr": "1"
}
```

A request carrying neither `max_age` nor an essential `auth_time` request
gets no `auth_time` claim at all — §2's MAY, not the MUST the two triggers
above turn on:

```json
{
  "sub": "01a0cb07-4e76-…",
  "iss": "http://localhost:3000/tenants/demo",
  "aud": "demo-spa",
  "iat": 1790113003,
  "exp": 1790113303,
  "sid": "01a0cb0c-b90a-…",
  "amr": ["pwd"],
  "acr": "1"
}
```

The `id_token` member's `sub` is different from every other claim there:
OIDC Core §3.1.2.2 reads it as naming a specific End-User this request must
be answered for, not a claim to narrow the response to — and unlike every
other claim here, this constraint is enforced twice: once at /authorize, in
the same candidate-session filter `id_token_hint` already narrows, and again
wherever a login can happen _after_ that filter ran, because the filter only
governs a session reuse, not a form or a chooser the request can still
produce. With a live SSO session for ada (`$COOKIE`, `$ADA_SUB` and
`$BOB_SUB`, assigned above), naming her own subject serves the request
straight through:

```bash
curl -sS -D - -o /dev/null --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=abc' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode "claims={\"id_token\":{\"sub\":{\"value\":\"$ADA_SUB\"}}}" \
  -H "Cookie: $COOKIE" \
  "$BASE/auth"
```

```
HTTP/1.1 302 Found
location: http://localhost:8080/callback?code=rtTN9LmGGub6Jk-_CR8x8O2WXGQpQV_Cv287i6ouV5Q&state=abc&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fdemo
```

Naming bob's subject instead — nobody but ada is signed in on this cookie —
refuses under `prompt=none` rather than silently answering for the wrong
End-User:

```bash
curl -sS -D - -o /dev/null --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=abc' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'prompt=none' \
  --data-urlencode "claims={\"id_token\":{\"sub\":{\"value\":\"$BOB_SUB\"}}}" \
  -H "Cookie: $COOKIE" \
  "$BASE/auth"
```

```
HTTP/1.1 302 Found
location: http://localhost:8080/callback?error=login_required&error_description=The+user+is+not+signed+in.&state=abc&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fdemo
```

and without `prompt=none` shows a login form instead of refusing outright —
reassigning `$AUTH_SESSION_ID` to the one this specific form carries, for
the sign-in attempt below:

```bash
STARTED=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=abc' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode "claims={\"id_token\":{\"sub\":{\"value\":\"$BOB_SUB\"}}}" \
  -H "Cookie: $COOKIE" \
  "$BASE/auth")
echo "$STARTED" | grep -o 'name="password"'
AUTH_SESSION_ID=$(printf '%s' "$STARTED" | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')
```

```
name="password"
```

That form is not itself the enforcement — only where it starts. Somebody still
has to sign in, and the request named bob: ada signing in at the very form this
request produced is refused, not completed as ada.
`PendingRequest.claimsSubject` is what makes this possible — parked the same way
`idTokenHintSubject` already is, and re-checked at the same door,
`handleLoginSubmission`, once a password actually identifies somebody:

```bash
curl -sS -D - -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  "$LOGIN"
```

```
HTTP/1.1 302 Found
location: http://localhost:8080/callback?error=login_required&error_description=The+user+is+not+signed+in.&state=abc&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fdemo
```

The account chooser carries the identical constraint at its own POST
(`handleSelectAccountSubmission`) — a `session_id` the chooser page never
offered is refused the same way, even when it names a session that really
is live on the same browser. `claims-parameter.int.test.ts`'s own two tests
for this ("refuses when a different subject actually signs in at the form
the sub rule produced", "refuses when the chooser is asked to complete as a
session the sub rule excluded") drive both doors; this transcript shows the
first live.

A `claims` parameter that is not valid JSON is refused the same way any
other malformed request parameter is, at the client's own `redirect_uri`:

```bash
curl -sS -D - -o /dev/null --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=xyz-123' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'claims={' \
  "$BASE/auth"
```

```
HTTP/1.1 302 Found
location: http://localhost:8080/callback?error=invalid_request&error_description=claims+is+not+valid&state=xyz-123&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fdemo
```

Discovery states support for the parameter fixed `true`, the same way it
states `authorization_response_iss_parameter_supported` — every tenant
honours it the same way, so there is no per-tenant derivation:

```json
{ "claims_parameter_supported": true }
```

**The narrowing travels with the grant, so a refresh keeps it.** The code minted
at /authorize carries the `claims` request onto the grant its redemption creates
(`token_grants.requested_userinfo_claims`), and every access token minted from
that grant embeds it as `requested_userinfo_claims`, a third private
access-token claim alongside `grant_id` and `sid` (see [the RFC 9068 reading
note](https://github.com/wizzywit/odudu/blob/main/docs/protocols/rfc9068.md)
above). That covers the code's own token, each `refresh_token` redemption's, and
a token exchanged from one. Redeeming the `claims={"userinfo":{"email":null}}`
request above with `scope=openid email`, with `$ACCESS_TOKEN` and
`$REFRESH_TOKEN` taken from its token response the way [the shell variables
above](./bootstrap.md#the-shell-variables-the-rest-of-this-document-uses) take
them, and then refreshing (on the stack the refused-login transcript uses, where
ada is `01a0db22-1c92-…`):

```bash
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" "$BASE/userinfo"
```

```
{"sub":"01a0db22-1c92-…","email":"ada@example.com"}
```

The refresh replaces `$ACCESS_TOKEN` with the token it returns, and prints
its response with both tokens elided:

```bash
ORIGINAL_ACCESS_TOKEN=$ACCESS_TOKEN
REFRESHED=$(curl -sS \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$REFRESH_TOKEN" \
  --data-urlencode 'client_id=demo-spa' "$BASE/token")
printf '%s\n' "$REFRESHED" | sed 's/"access_token":"[^"]*"/"access_token":"…"/; s/"refresh_token":"[^"]*"/"refresh_token":"…"/'
ACCESS_TOKEN=$(printf '%s' "$REFRESHED" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ "$ACCESS_TOKEN" != "$ORIGINAL_ACCESS_TOKEN" ] && echo 'a different access token'
```

```
{"access_token":"…","refresh_token":"…","token_type":"Bearer","expires_in":300,"scope":"openid email"}
a different access token
```

and then, with the refreshed access token now in `$ACCESS_TOKEN`:

```bash
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" "$BASE/userinfo"
```

```
{"sub":"01a0db22-1c92-…","email":"ada@example.com"}
```

Before migration `0070` the refreshed token carried no narrowing, so this
last call also returned `email_verified`, the rest of what `scope=email`
grants. ADR 0036 decides the narrowing and its amendment records the fix.

## Encrypted and nested UserInfo responses

A client that registers `userinfo_encrypted_response_alg` gets its
`/userinfo` response encrypted to a key from its own published `jwks` — a
dynamic registration, since this is per-client data. `demo` registers
nothing until its policy is opened, exactly as
[dynamic client registration](./bootstrap.md#dynamic-client-registration) showed for
`reg-demo`, so that comes first and stays open for
[the consent screen](./rp-initiated-logout.md#the-consent-screen) below:

```bash
odudu seed tenant --name demo --set client_registration_policy=open
```

```json
{
  "command": "tenant",
  "created": false,
  "tenant": "demo",
  "tenantId": "01a0cb07-…",
  "settings": ["client_registration_policy"]
}
```

```bash
curl -sS -X POST http://localhost:3000/tenants/demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{
    "redirect_uris": ["https://rp.example/cb"],
    "userinfo_signed_response_alg": "RS256",
    "userinfo_encrypted_response_alg": "RSA-OAEP-256",
    "userinfo_encrypted_response_enc": "A256GCM",
    "jwks": {"keys": [{"kty":"RSA","n":"lEVM608l…","e":"AQAB","use":"enc"}]}
  }'
```

```json
{
  "client_id": "01a0cb0f-4cad-…",
  "client_id_issued_at": 1790113176,
  "client_secret": "oIz1jU-PCDfxXFGLIKxUD-8XZh_6dMRRU5fA-_iYtlk",
  "client_secret_expires_at": 0,
  "redirect_uris": ["https://rp.example/cb"],
  "grant_types": ["authorization_code"],
  "token_endpoint_auth_method": "client_secret_basic",
  "jwks": { "keys": [{ "kty": "RSA", "n": "lEVM608l…", "e": "AQAB", "use": "enc" }] },
  "userinfo_signed_response_alg": "RS256",
  "userinfo_encrypted_response_alg": "RSA-OAEP-256",
  "userinfo_encrypted_response_enc": "A256GCM"
}
```

Discovery's two new members are this tenant's own answer, the same way
[discovery](#1-discovery) above shows `userinfo_signing_alg_values_supported` —
except these two never vary by tenant, since no server key is involved, only
what the installed jose can produce:

```json
{
  "userinfo_encryption_alg_values_supported": [
    "RSA-OAEP-256",
    "ECDH-ES",
    "ECDH-ES+A128KW",
    "ECDH-ES+A192KW",
    "ECDH-ES+A256KW"
  ],
  "userinfo_encryption_enc_values_supported": [
    "A128CBC-HS256",
    "A192CBC-HS384",
    "A256CBC-HS512",
    "A128GCM",
    "A192GCM",
    "A256GCM"
  ]
}
```

Completing the same authorization code walk-through above against this
client (a dynamically-registered client needs its consent screen answered —
[the consent screen](./rp-initiated-logout.md#the-consent-screen) below) and calling `/userinfo`
with the access token it yields:

```bash
curl -sS -D - -H "Authorization: Bearer $ACCESS_TOKEN" \
  http://localhost:3000/tenants/demo/protocol/openid-connect/userinfo
```

```
HTTP/1.1 200 OK
content-type: application/jwt
content-length: 1451

eyJhbGciOiJSU0EtT0FFUC0yNTYiLCJlbmMiOiJBMjU2R0NNIiwiY3R5IjoiSldUIn0.L3PzB5rRx7YMIM1Ldh0gIe…
```

Five dot-separated parts, not three — a JWE compact serialization, not a
JWT. Its protected header, decoded:

```json
{ "alg": "RSA-OAEP-256", "enc": "A256GCM", "cty": "JWT" }
```

`cty: "JWT"` is the only signal the plaintext is itself a JWT rather than JSON —
decrypting with the private key matching the registered `jwks`
(`jose.compactDecrypt`) and reading that plaintext back shows a complete
`userinfo+jwt` response in its own right, the same shape described in "A signed
UserInfo response" (the OIDC Core reading note), now wrapped in encryption:

```json
{ "alg": "RS256", "kid": "01a0cb07-4e73-…", "typ": "userinfo+jwt" }
{
  "sub": "01a0cb07-4e76-…",
  "name": "ada",
  "preferred_username": "ada",
  "email": "ada@example.com",
  "email_verified": false,
  "iss": "http://localhost:3000/tenants/demo",
  "aud": "01a0cb0f-4cad-…"
}
```

Sign then encrypt, never the reverse: OIDC Core §5.3.2 only ever describes
this nesting, and this is what proves the order rather than merely trusting
`cty` — a JWE wrapping raw JSON with a `cty: "JWT"` header slapped on by
mistake would decrypt to something that is not a valid JWS at all.

A client that registers `userinfo_encrypted_response_alg` with no
`userinfo_signed_response_alg` gets the claims encrypted directly, with no
signing and no nesting — no `cty`, and the plaintext is the claims JSON,
carrying no `iss`/`aud` (those are added only when something actually
signs). This one also leaves out `userinfo_encrypted_response_enc`, unlike
the client above:

```bash
curl -sS -X POST http://localhost:3000/tenants/demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{
    "redirect_uris": ["https://rp2.example/cb"],
    "userinfo_encrypted_response_alg": "RSA-OAEP-256",
    "jwks": {"keys": [{"kty":"RSA","n":"n9ZADhg2…","e":"AQAB","use":"enc"}]}
  }'
```

```json
{
  "client_id": "01a0cb0f-4d81-…",
  "client_id_issued_at": 1790113176,
  "client_secret": "M5PcEC9GpoVyR3HO4PjqRULALZ-I0Br4ywgQspMhWSs",
  "client_secret_expires_at": 0,
  "redirect_uris": ["https://rp2.example/cb"],
  "grant_types": ["authorization_code"],
  "token_endpoint_auth_method": "client_secret_basic",
  "jwks": { "keys": [{ "kty": "RSA", "n": "n9ZADhg2…", "e": "AQAB", "use": "enc" }] },
  "userinfo_encrypted_response_alg": "RSA-OAEP-256",
  "userinfo_encrypted_response_enc": "A128CBC-HS256"
}
```

`_enc` was never sent, and the response carries `A128CBC-HS256` — the
default applying, unlike the client above, whose `A256GCM` was sent
explicitly and never defaulted. Completing the same walk-through and
calling `/userinfo`:

```
HTTP/1.1 200 OK
content-type: application/jwt
content-length: 513

eyJhbGciOiJSU0EtT0FFUC0yNTYiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0.UDGsIw_SCNRpkEdGUXA1-rSjxZGxDQ…
```

```json
{ "alg": "RSA-OAEP-256", "enc": "A128CBC-HS256" }
```

Decrypted:

```json
{ "sub": "01a0cb07-4e76-…" }
```

(This client requested `scope=openid` alone, hence one claim.)

A client whose key cannot be retrieved or selected — a dead `jwks_uri`, an empty
JWKS, two equally good candidates, or one the `kty`/`use`/`alg` filters reject —
never falls back to the JSON or signed form it would otherwise have gotten:
`/userinfo` answers 500 with no body at all, the same shape the signing-mismatch
case uses, and for the same reason — answering in clear text would publish
exactly what the client asked to have protected. An integration test exercises
all four causes; running one such request against this stack is not reproduced
here because reaching the "no candidate" and "ambiguous" cases needs no network
at all, and the "dead `jwks_uri`" case is a timing property, not a fixed
transcript.

**What a dead `jwks_uri` costs, on this path specifically.** Until this task,
`clientKeySet.fetch` (the same fetcher, shared with `/token`'s `private_key_jwt`
authentication) only ever sat on a misconfigured client's own request. Here it
sits between a resource server's `/userinfo` call and the answer it is waiting
on, for a client the resource server has no visibility into. A first, cold
request against a dead `jwks_uri` pays: an unbounded DNS lookup this codebase
does not bound itself (`node:dns`'s `lookup`, no timeout wrapped around it — the
OS resolver's own retry behaviour is what actually bounds it), then, if that
resolves, up to 5 seconds to connect and 10 seconds total transport.
`NEGATIVE_CACHE_TTL_MS` (30 seconds) means only the first request against a
given dead `jwks_uri` in that window pays it — every other request for that
client, **in the same tenant**, gets a cached refusal instead: the negative
cache is keyed by tenant and URI together, so a second tenant pointed at the
same dead `jwks_uri` pays the full cost again, independently.

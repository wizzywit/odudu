---
title: 'The branches'
description: 'This is the most security-sensitive ordering decision in the server.'
---

# The branches

## `/authorize`: the render-versus-redirect boundary

This is the most security-sensitive ordering decision in the server. RFC
6749 §4.1.2.1 splits authorization-request failures into two families:

- The `client_id` is missing or unknown, or the `redirect_uri` is missing or
  does not match a registration. The server has **not** established that the
  redirect target belongs to the client that claims it. It **MUST NOT**
  redirect; it renders an error page in its own UI.
- Everything else. The redirect target has been validated, so the error is
  delivered there as query parameters, which is the only channel back to a
  client that is waiting at a redirect URI.

Getting a check on the wrong side of that line is not a taxonomy mistake — it is
an open redirector (RFC 6749 §10.15) wearing the identity provider's domain. The
rule is therefore that `client_id` and `redirect_uri` are validated strictly
before any other failure decides how to report itself. OIDC Core §3.1.2.6 gives
the rendered case its shape: HTTP 400 with no error response parameters. The
long-form reading is in the RFC 6749 reading note, under "The §4.1.2.1 split".

A rendered refusal looks like this — the error code is in the page, not in a
`Location` header:

```
HTTP/1.1 400 Bad Request
content-type: text/html

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
<p><bdi>Unknown or disabled client</bdi></p>
<p><small>invalid_client</small></p>
</main>
</body>
</html>
```

**Above the boundary — rendered, never redirected.** All verified against
the running stack. Every row answers with an HTML body and no `Location`
header, and every one is 400 except where the status is given.

| Request                                | Answer                                                          | Why this and not a redirect                                                                                              |
| -------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Unknown or disabled `client_id`        | `invalid_client`, "Unknown or disabled client"                  | No client, so no registration to judge a redirect target against                                                         |
| Unknown tenant in the path             | `invalid_client`, "Unknown or disabled client"                  | Identical answer on purpose: a probe cannot tell a missing tenant from a missing client                                  |
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
| Scope the tenant does not define          | `invalid_scope`             | `scopes_supported` is that same list, so discovery and this endpoint cannot disagree         |
| Scope the client is not assigned          | `invalid_scope`             | Defined by the tenant is not granted to every client; refused, never silently dropped        |
| Repeated `state` (or any other repeat)    | `invalid_request`           | Ambiguous, but a trustworthy redirect target exists by now, so the client can be told        |
| `prompt=none`                             | `login_required`            | For a request carrying no live session cookie; with one it issues a code instead (§3.1.2.3)  |
| `prompt=none login`                       | `invalid_request`           | `none` with any other value is contradictory (OIDC Core §3.1.2.1)                            |
| `prompt=` anything undefined              | `invalid_request`           | Better told than silently answered as if it had asked for nothing                            |
| `request=…`                               | `request_not_supported`     | Request objects are unimplemented, and §3.1.2.6 requires saying so rather than dropping them |
| `request_uri=…`                           | `request_uri_not_supported` | Same                                                                                         |
| Unverifiable `id_token_hint`              | `invalid_request`           | A hint this tenant's keys did not sign is not a hint from here (OIDC Core §3.1.2.2)          |
| Another tenant's `id_token_hint`          | `invalid_request`           | Same rule: the tenant in the URL is the only issuer whose keys are consulted                 |
| `id_token_hint` minted for another client | `invalid_request`           | Its `aud` names a client, and this tenant checks it against the one making this request      |

The error redirect for a request that sent no `state` carries `error`, its
`error_description` and `iss`, and no `state`. This one sends no code challenge
either, on a stack on port `3197`:

```bash
curl -sS -o /dev/null -D - --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  'http://localhost:3197/tenants/demo/protocol/openid-connect/auth' \
  | tr -d '\r' | grep -i '^location'
```

```
location: http://localhost:8080/callback?error=invalid_request&error_description=code_challenge+is+required&iss=http%3A%2F%2Flocalhost%3A3197%2Ftenants%2Fdemo
```

`iss` is on every authorization response including the errors (RFC 9207 §2):
a client that cannot tell which server failed its request is the client a
mix-up attack preys on.

## `redirect_uri` is compared as a string

Every difference below is a different URI, including the ones a URL parser
would call equivalent. Only the first is registered:

```bash
for u in http://localhost:8080/callback http://localhost:8080/callback/ \
         http://localhost:8080/Callback 'http://localhost:8080/callback?x=1' \
         http://LOCALHOST:8080/callback 'http://localhost:8080/callback#f'; do
  printf '%-40s ' "$u"
  curl -sS -o /dev/null -w '%{http_code}\n' --get --data-urlencode "redirect_uri=$u" \
    "http://localhost:3000/tenants/demo/protocol/openid-connect/auth?response_type=code&client_id=demo-spa&scope=openid&code_challenge=$CHALLENGE&code_challenge_method=S256"
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

## `POST /authorize`, and the content type

OIDC Core §3.1.2.1 says a POSTed authorization request is form serialized.
Anything else is a representation this endpoint does not take, so it is
refused at the HTTP layer, before a parser can invent values of the wrong
type for rules — mandatory PKCE above all — that are written for strings.

```bash
curl -sS -D - -X POST -H 'content-type: application/json' \
  --data '{"response_type":"code"}' \
  'http://localhost:3000/tenants/demo/protocol/openid-connect/auth'
```

```
HTTP/1.1 415 Unsupported Media Type
content-type: text/html
content-length: 943

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
<p><bdi>Authorization request parameters must be sent as application/x-www-form-urlencoded.</bdi></p>
<p><small>invalid_request</small></p>
</main>
</body>
</html>
```

A body arriving with **no `Content-Type` at all** has an unknown media type
(RFC 9110 §8.3), and unknown is unsupported here. It is answered with that
same page, byte for byte:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type:' \
  --data-binary '{"response_type":"code"}' \
  'http://localhost:3000/tenants/demo/protocol/openid-connect/auth'
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

## `prompt`

```bash
Q='response_type=code&client_id=demo-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&state=xyz-123&code_challenge=hUGit6EJl__NDqDG80Q49rMU-3qeOri8dH1TTe49hmI&code_challenge_method=S256'
for p in none 'none%20login' 'login%20none' 'none%20consent' unheard_of \
         'login%20unheard_of' Login login consent select_account; do
  printf '%-24s ' "prompt=$p"
  curl -sS -o /dev/null -D - \
    "http://localhost:3000/tenants/demo/protocol/openid-connect/auth?$Q&prompt=$p" \
    | tr -d '\r' | awk '/^HTTP/{s=$2} /^[Ll]ocation:/{l=$2} END{print s, l}'
done
```

```
prompt=none              302 …/callback?error=login_required&error_description=The+user+is+not+signed+in.&state=xyz-123&iss=…
prompt=none%20login      302 …/callback?error=invalid_request&error_description=prompt+is+not+valid&state=xyz-123&iss=…
prompt=login%20none      302 …/callback?error=invalid_request&error_description=prompt+is+not+valid&state=xyz-123&iss=…
prompt=none%20consent    302 …/callback?error=invalid_request&error_description=prompt+is+not+valid&state=xyz-123&iss=…
prompt=unheard_of        302 …/callback?error=invalid_request&error_description=prompt+is+not+valid&state=xyz-123&iss=…
prompt=login%20unheard_of 302 …/callback?error=invalid_request&error_description=prompt+is+not+valid&state=xyz-123&iss=…
prompt=Login             302 …/callback?error=invalid_request&error_description=prompt+is+not+valid&state=xyz-123&iss=…
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

## Signing in again from an existing session

`/authorize` reads the `demo-session` cookie the login POST sets, so
a second authorization request from the same browser can complete without
the form — and `prompt` decides whether that is allowed to happen. This
section runs one login, keeps the cookie, and sends it back three ways.

The first `/authorize`, with a login exactly as [Path
A](./path-a-authorization-code-with-pkce.md) runs it, keeping the cookie curl
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
  "http://localhost:3000/tenants/demo/protocol/openid-connect/auth" \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

curl -sS -c cookies.txt -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  "http://localhost:3000/tenants/demo/login-actions/authenticate"

grep session cookies.txt
```

```
#HttpOnly_localhost	FALSE	/	FALSE	0	demo-session	01a0cb26-b57e-…
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
  "http://localhost:3000/tenants/demo/protocol/openid-connect/auth" \
  | grep -i '^location'
```

```
location: http://localhost:8080/callback?code=6sjG8C5KEPcu…&state=xyz-reuse&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fdemo
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
  "http://localhost:3000/tenants/demo/protocol/openid-connect/auth" \
  | grep -i '^location'
```

```
location: http://localhost:8080/callback?code=27RbW3OSX0QZ…&state=xyz-none&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fdemo
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
  "http://localhost:3000/tenants/demo/protocol/openid-connect/auth"
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
  "http://localhost:3000/tenants/demo/protocol/openid-connect/auth" \
  | grep -i '^location'
```

```
location: http://localhost:8080/callback?error=login_required&error_description=The+user+is+not+signed+in.&state=xyz-000&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fdemo
```

Redeeming a code the reuse redirect issued shows what carrying the session
forward means for `auth_time`. One more reuse, waited out a little first
and carrying `max_age` — the claim is emitted only for a request that asks
for it, by `max_age` or by an essential `auth_time`
([the `claims` request parameter](./path-a-authorization-code-with-pkce.md#the-claims-request-parameter)), so a
reuse that named neither would have nothing to show — then redeemed with
the same `$VERIFIER` the login above's `$CHALLENGE` was built from:

```bash
sleep 37
CODE=$(curl -sS -b cookies.txt -D - -o /dev/null --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=xyz-authtime' \
  --data-urlencode 'max_age=3600' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "http://localhost:3000/tenants/demo/protocol/openid-connect/auth" \
  | sed -n 's/.*[Ll]ocation: .*[?&]code=\([^&[:space:]]*\).*/\1/p')

curl -sS \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode "code_verifier=$VERIFIER" \
  "http://localhost:3000/tenants/demo/protocol/openid-connect/token" \
  | python3 -c "import sys,json,base64; t=json.load(sys.stdin)['id_token']; p=t.split('.')[1]; p+='='*(-len(p)%4); c=json.loads(base64.urlsafe_b64decode(p)); print(c['auth_time'], c['iat'])"
```

```
1793058507 1793058545
```

`auth_time` is `2026-10-26 23:48:27 UTC`, the login at the top of this
section; `iat` is `2026-10-26 23:49:05 UTC`, this redemption, 38 seconds
later.

`auth_time` is the login's own moment, not the moment this token was
minted 37 seconds later — the fact a client's own `max_age` check
(§3.1.3.7) has to be able to rely on.

**Two clocks end a session, and each was moved on its own to see it.** The
tenant's `sso_session_idle_seconds` (default `1800`) runs from the session's
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
     where id = '01a0cb26-b57e-7a03-9ea6-2faf76077c35';"
```

```
idle-expired, no prompt      200
idle-expired, prompt=none    302 …/callback?error=login_required&error_description=The+user+is+not+signed+in.&state=idle2&iss=…
```

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -q -c \
  "update sessions set last_active_at = now(),
          created_at = now() - interval '40000 seconds',
          expires_at = now() - interval '4000 seconds'
     where id = '01a0cb26-b57e-7a03-9ea6-2faf76077c35';"
```

```
max-expired, no prompt       200
max-expired, prompt=none     302 …/callback?error=login_required&error_description=The+user+is+not+signed+in.&state=max2&iss=…
```

(The same four requests this section already ran, against the same cookie
jar; the session id is the one `grep session cookies.txt` printed above —
the id half of the entry — in full because a `psql` statement needs it
whole.) A dead session is not an
error: with no `prompt` the request is answered with the login form, exactly
as a request carrying no cookie is, and it is `prompt=none` — the client
saying it will not accept an interaction — that turns the same state into
`login_required`. A subject a `verify_email` tenant has not verified is
refused on the same two terms.

`sessions` also carries `remembered`, a boolean set at establishment and never
rewritten, and a tenant carries `max_sessions_per_browser` (1–32, default 25) —
a CHECK constraint bounding the **setting's own value**, and also the ceiling
`admitSession` evicts a browser's own least recently active sessions down to
before establishing a new one, read from the entries its cookies already prove
rather than by subject (ADR 0033). `odudu seed tenant --set
max_sessions_per_browser=10` changes the stored value the same way as every
other tenant setting, and every login after that is measured against the new
ceiling.

A tenant also carries the pair a remembered login's session is measured against
instead of `sso_session_idle_seconds`/`sso_session_max_seconds`:
`remember_me_allowed` (boolean, default `false`), `remember_me_idle_seconds`
(60–31536000, default 604800, one week) and `remember_me_max_seconds`
(60–31536000, default 2592000, thirty days), each settable the same way — `odudu
seed tenant --set remember_me_idle_seconds=1209600`. Which pair a session uses
is picked by its own `remembered` column, set to `true` when a login ticks the
`remember_me` checkbox on a tenant that allows it — see [A remembered
login](./path-a-authorization-code-with-pkce.md#a-remembered-login) above.

### The session cap

A cookie jar, `cap-demo` with `max_sessions_per_browser` lowered to 2,
`odudu seed tenant --name cap-demo --set max_sessions_per_browser=2`, three
logins in a row (`prompt=login` on each, so a live session never short-
circuits the form — see [Signing in again from an existing
session](#signing-in-again-from-an-existing-session) for what it would do
otherwise):

```
HTTP/1.1 302 Found
set-cookie: cap-demo-session=01a17aa1-2304-…:apbh0c0f0axp…; HttpOnly; SameSite=Lax; Path=/
```

```
HTTP/1.1 302 Found
set-cookie: cap-demo-session=01a17aa1-2304-…:apbh0c0f0axp….01a17aa1-2368-…:cJlQ59sYOvtX…; HttpOnly; SameSite=Lax; Path=/
```

```
HTTP/1.1 302 Found
set-cookie: cap-demo-session=01a17aa1-2368-…:cJlQ59sYOvtX….01a17aa1-23c3-…:cMjvGbQ-cR0v…; HttpOnly; SameSite=Lax; Path=/
```

(Entries truncated to the start of the id and of the secret; each response
also carried the cleared persistent cookie, `Max-Age=0`, and the cleared
sign-in cookie, omitted here since nothing about them changes. A login writes
back the entries its browser presented, secrets unchanged.) The third login's
list still holds two entries, not three: `2304`, the first
login's session, is gone, evicted by `admitSession` as the least recently
active once a third session tried to join a browser already at the cap —
the second and third logins' own ids are exactly what survive. Nothing
asked for this browser to end its oldest session; the tenant's setting did.

The three logins above ran one at a time; two genuinely concurrent logins
from the same browser read the cookie before either has written it, so the
browser keeps only the later response's cookie and the earlier response's
session is named by neither. That session is still live, but
[logout](./rp-initiated-logout.md) resolves the same cookie to decide what it
can end, so it cannot be reached that way — an orphan, not a size problem.
It idles out at `sso_session_idle_seconds` (thirty minutes by default), or
at `remember_me_idle_seconds` (seven days by default) if the losing login
was a remembered one. ADR 0033's amendments have the full account. Since the
device cookie, admission also counts the subject's sessions on the browser's
device, so such a race no longer admits more than the cap, and the orphan is
listed under its device in the session lists; it is still not reachable
through logout. This page was captured before the device cookie.

### Choosing among sessions

More than one live session in the same browser — or a client asking with
`prompt=select_account` — answers neither with the login form nor with a silent
reuse: `decideReuse` returns a `select` outcome, `/authorize` renders a chooser
instead, and its own POST, `login-actions/select-account`, is where a pick is
honoured or refused.

A second user seeded into `demo` so this browser can hold sessions for two
subjects at once. `demo` has had `verify_email` on since
[Address verification](./path-a-as-a-confidential-client.md#address-verification), and a freshly seeded address
cannot sign in under it, so that goes back off first — nothing below is
about verification:

```bash
odudu seed tenant --name demo --set verify_email=false
odudu seed user --tenant demo --username carol --password another-horse-battery \
  --email carol@example.com
```

```json
{
  "command": "tenant",
  "created": false,
  "tenant": "demo",
  "tenantId": "01a0cb07-…",
  "settings": ["verify_email"]
}
{
  "command": "user",
  "tenant": "demo",
  "tenantId": "01a0cb07-…",
  "username": "carol",
  "userSubjectId": "01a0cb29-16b4-…"
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
  "http://localhost:3000/tenants/demo/protocol/openid-connect/auth" \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

curl -sS -c cookies.txt -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH1" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  "http://localhost:3000/tenants/demo/login-actions/authenticate"

AUTH2=$(curl -sS -b cookies.txt --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=carol-login' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'prompt=login' \
  "http://localhost:3000/tenants/demo/protocol/openid-connect/auth" \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

curl -sS -b cookies.txt -c cookies.txt -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH2" \
  --data-urlencode 'username=carol' \
  --data-urlencode 'password=another-horse-battery' \
  "http://localhost:3000/tenants/demo/login-actions/authenticate"

grep session cookies.txt
```

```
#HttpOnly_localhost	FALSE	/	FALSE	0	demo-session	01a17a9e-acbd-…:zJRqGDdMlrcd….01a17a9e-ad18-…:owS7TJJUZxCd…
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
  "http://localhost:3000/tenants/demo/protocol/openid-connect/auth" -o chooser.html
cat chooser.html
```

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Choose an account</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Choose an account</h1>
<p class="tenant"><bdi>demo</bdi></p>
</header>
<form method="post" action="/tenants/demo/login-actions/select-account">
  <input type="hidden" name="auth_session_id" value="01a0cb29-6541-7948-968b-a0a487e699f8">
  <button type="submit" name="session_id" value="01a0cb29-64de-7524-9fa8-6010a80148bb" class="secondary choice"><bdi>ada</bdi></button>
  <button type="submit" name="session_id" value="01a0cb29-652b-7714-9d32-50e37b35e21a" class="secondary choice"><bdi>carol</bdi></button>
  <button type="submit" name="use_other" value="1" class="quiet">Use another account</button>
</form>
</main>
<script nonce="uqvJ6PTdMJzOzZrbzuj+mQ==">window.addEventListener('pageshow', function (event) { if (event.persisted) location.reload(); });</script>
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
ADA_SESSION=$(grep -o 'name="session_id" value="[^"]*" class="secondary choice"><bdi>ada</bdi>' chooser.html \
  | sed -E 's/.*value="([^"]*)".*/\1/')

curl -sS -b cookies.txt -D - -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH3" \
  --data-urlencode "session_id=$ADA_SESSION" \
  "http://localhost:3000/tenants/demo/login-actions/select-account"
```

```
HTTP/1.1 302 Found
location: http://localhost:8080/callback?code=eukVsSqoebdy2jsL9zVMafxgPPOGZ3qwQaAc3WK0JNA&state=xyz-select&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fdemo
```

The posted `session_id` is a claim the browser makes, honoured only when it
names a member of the set this same request's own cookies resolve to — the
same defence `login-actions/logout`'s confirmation form uses (see
[RP-initiated logout](./rp-initiated-logout.md)). A `session_id` naming some
other live session in the tenant — one this browser's cookies never
named — is refused with 400, not honoured merely because the session
exists:

```bash
curl -sS -b cookies.txt -o /dev/null -w '%{http_code}\n' \
  --data-urlencode "auth_session_id=$AUTH3" \
  --data-urlencode 'session_id=00000000-0000-0000-0000-000000000000' \
  "http://localhost:3000/tenants/demo/login-actions/select-account"
```

```
400
```

(A well-formed but foreign uuid stands in here for a stranger's real session id
— see the integration suite for the version of this with an actual second
browser's live session, which is what the integration suite proves this refusal
against.)

`use_other=1` in place of `session_id` falls through to the ordinary login
form instead, on the same parked authentication session — nobody was ever
bound to it, so a fresh set of credentials starts it exactly as if the
chooser had never rendered:

```bash
curl -sS -b cookies.txt -o /dev/null -w '%{http_code}\n' \
  --data-urlencode "auth_session_id=$AUTH3" \
  --data-urlencode 'use_other=1' \
  "http://localhost:3000/tenants/demo/login-actions/select-account"
```

```
200
```

## `id_token_hint`

A hint is checked against the tenant's own keys and issuer before anything
else about the request is acted on (OIDC Core §3.1.2.2), and then — at
`/authorize` only — against the `client_id` making this request: an ID
Token's `aud` names the client it was issued to, and a hint minted for one
client is refused from another even though its signature and issuer are
this tenant's own. Mint one by completing Path A and keeping the `id_token`;
mint another by doing the same for a second client in the same tenant, and a
third by doing the same in a second tenant:

```bash
odudu seed \
  --tenant demo --client demo-spa-2 \
  --redirect-uri http://localhost:8080/callback2

odudu seed \
  --tenant other --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@other.example
```

`$ID_TOKEN` from the bootstrap block is a hint `demo-spa` can use.
`$ID_TOKEN2` is Path A run again for `demo-spa-2` against the same tenant;
`$ID_TOKEN3` is Path A run against `/tenants/other/` instead:

```bash
curl -sS -o /dev/null -D - --get --data-urlencode "id_token_hint=$ID_TOKEN2" \
  "http://localhost:3000/tenants/demo/protocol/openid-connect/auth?$Q" \
  | tr -d '\r' | awk '/^HTTP/{s=$2} /^[Ll]ocation:/{l=$2} END{print s, l}'
```

| `id_token_hint`                                                         | Answer                      |
| ----------------------------------------------------------------------- | --------------------------- |
| `not.a.jwt`                                                             | 302 `error=invalid_request` |
| An ID token issued by the tenant `other`                                | 302 `error=invalid_request` |
| An ID token this tenant issued to `demo-spa-2`, at `demo-spa`'s request | 302 `error=invalid_request` |
| An ID token this tenant issued to `demo-spa`, at `demo-spa`'s request   | 200, the login form         |
| With `prompt=none`, a hint this tenant issued for the requesting client | 302 `error=login_required`  |
| With `prompt=none`, any unusable hint                                   | 302 `error=invalid_request` |

The last two rows are the ordering. An unusable hint is refused as a
malformed request rather than answered with the prompt's own
`login_required`: `prompt=none` decides how to answer a request, and a
request carrying a hint this server cannot read is not yet a request to
answer that way.

An access token this tenant minted for the same user is refused too, and for two
independent reasons rather than one: it carries `typ: at+jwt` (RFC 9068 §2.1),
which the hint check demands a JWT not be, _and_ its own `aud` is this tenant's
issuer (RFC 9068 §2.2) rather than the requesting client, which the check above
now also refuses. Deleting either check on its own still leaves this token
refused by the other — the OIDC Core reading note has the reasoning for both.
`/userinfo` makes the mirror image of the `typ` check of the token presented to
it.

The tenant row is the point of the whole check that predates the client
check above. Both tokens are RS256, both have the shape of an ID token, and
both were signed by this server — by a different tenant's key. Only the
tenant named in the URL has its keys consulted, so the second is refused
exactly like a forgery.

`/logout` shares this same signature-and-issuer check on its own
`id_token_hint`, but not the client check: RP-Initiated Logout §2 gives it
a different comparison to make instead, against an optional `client_id`
parameter — see [RP-initiated logout](./rp-initiated-logout.md) below.

What a valid hint then does is in [The login POST](#the-login-post): it
names who the response is about, and a different user signing in against
that request is answered `login_required` rather than with a code.

## The shape of `code_challenge`

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

## Empty values, and repeated ones

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

## The login POST

| Request                                                               | Answer                                         | Why                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wrong password                                                        | 200, the sign-in form again, same session id   | The session is live and can be retried; nothing is consumed                                                                                                                                                                                      |
| Unknown username                                                      | 200, the sign-in form again                    | Indistinguishable from a wrong password, and the credential query is still issued so the timing matches                                                                                                                                          |
| Any password, while the account is locked                             | 200, the sign-in form again                    | Byte-identical to a wrong password, and reached after the same verification, so neither the page nor the timing says the account is locked ([Brute-force lockout](./brute-force-lockout.md))                                                     |
| A password over 256 characters                                        | 400, "Password must be at most 256 characters" | Refused at the read, before the Argon2id verification, so it costs nothing and counts no failure against the account                                                                                                                             |
| Any submission over the per-origin budget                             | 429, `Retry-After`, a page naming the wait     | Decided before the body is parsed, so it is the same refusal whatever was submitted ([The per-origin throttle](./brute-force-lockout.md#the-per-origin-throttle))                                                                                |
| Sign-in submissions for one username over its budget from one address | 429, `Retry-After`, a page naming the wait     | Decided from the submitted form before any account is looked up, so it is the same refusal for a name that is an account and one that is not ([The per-username budget on sign-in](./brute-force-lockout.md#the-per-username-budget-on-sign-in)) |
| No `auth_session_id`                                                  | 400, "This sign-in attempt is no longer valid" | That field is the form's CSRF defence; a submission without it is not a submission from the form                                                                                                                                                 |
| Unknown or expired `auth_session_id`                                  | 400, same page                                 | Folded together deliberately: neither names a live parked request                                                                                                                                                                                |
| A second submit of a consumed session                                 | 400, same page                                 | The atomic consume is what stops a back-button press minting a second session and a second code                                                                                                                                                  |
| Right password, wrong `id_token_hint`ed user                          | 302 `error=login_required` to the client       | A positive response is for the end user the hint identifies. The session is left unconsumed, so the right user can still sign in against the same parked request                                                                                 |

The last one, both halves, run against one parked request:

```
# bob signs in against a request hinted for ada
location: …/callback?error=login_required&error_description=The+user+is+not+signed+in.&state=xyz-123&iss=…
# ada then signs in against the same parked request
location: …/callback?code=hafB3JLce2ju…&state=xyz-123&iss=…
```

(Code truncated.)

## `/token`

Checked in order: request shape, then client authentication, then the
grant. A malformed request is `invalid_request` before any client is looked
up, verified by sending no `grant_type` with an unknown `client_id` and
getting `invalid_request` rather than `invalid_client`.

| Request                                                                                                                                                      | Status | Body                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------ |
| No `grant_type`                                                                                                                                              | 400    | `invalid_request`        |
| `grant_type=password`                                                                                                                                        | 400    | `unsupported_grant_type` |
| `authorization_code` with no `code` or `redirect_uri`                                                                                                        | 400    | `invalid_request`        |
| `refresh_token` with no `refresh_token`                                                                                                                      | 400    | `invalid_request`        |
| Unknown `client_id`                                                                                                                                          | 401    | `invalid_client`         |
| Wrong client secret                                                                                                                                          | 401    | `invalid_client`         |
| Secret in the body from a `client_secret_basic` client                                                                                                       | 401    | `invalid_client`         |
| Secret in the header from a `client_secret_post` client                                                                                                      | 401    | `invalid_client`         |
| Both methods presented at once (Basic, body secret, a `client_assertion`, **or a proxy-supplied certificate subject alongside any of the other three**)      | 401    | `invalid_client`         |
| A `Basic` header that is not a form-urlencoding                                                                                                              | 401    | `invalid_client`         |
| Public client presenting a secret                                                                                                                            | 401    | `invalid_client`         |
| Public client asking for `client_credentials`                                                                                                                | 400    | `unauthorized_client`    |
| `private_key_jwt`: assertion fails structural validation (bad `iss`/`sub`/`aud`/`exp`/`jti`, or doesn't parse as a JWT)                                      | 401    | `invalid_client`         |
| `private_key_jwt`: unknown or disabled client, or one not registered for the method                                                                          | 401    | `invalid_client`         |
| `private_key_jwt`: client publishes no keys, or its `jwks_uri` can't be fetched (address guard, DNS, transport, status, content type, size, or invalid JSON) | 401    | `invalid_client`         |
| `private_key_jwt`: signature doesn't verify (wrong key, or a fetched document that isn't a JWK Set)                                                          | 401    | `invalid_client`         |
| `private_key_jwt`: replayed assertion (`jti` already spent)                                                                                                  | 401    | `invalid_client`         |
| `tls_client_auth`: `ODUDU_TRUST_PROXY` is off — the header is never read, whatever it says (falls back to ordinary client authentication)                    | 401    | `invalid_client`         |
| `tls_client_auth`: the certificate header sent twice, or genuinely duplicated by an intermediary                                                             | 401    | `invalid_client`         |
| `tls_client_auth`: no `client_id` presented alongside the certificate                                                                                        | 401    | `invalid_client`         |
| `tls_client_auth`: unknown or disabled client, one not confidential, or one not registered for the method                                                    | 401    | `invalid_client`         |
| `tls_client_auth`: certificate subject does not match the client's registered `tls_client_auth_subject_dn`                                                   | 401    | `invalid_client`         |
| Confidential client with no service account                                                                                                                  | 400    | `unauthorized_client`    |
| Unknown, expired or replayed `code`                                                                                                                          | 400    | `invalid_grant`          |
| Wrong or missing `code_verifier`                                                                                                                             | 400    | `invalid_grant`          |
| `redirect_uri` different from the code's                                                                                                                     | 400    | `invalid_grant`          |
| A different client redeeming the code                                                                                                                        | 400    | `invalid_grant`          |
| Unknown, expired or replayed `refresh_token`                                                                                                                 | 400    | `invalid_grant`          |
| Another client's `refresh_token`                                                                                                                             | 400    | `invalid_grant`          |
| Another tenant's `code` or `refresh_token`                                                                                                                   | 400    | `invalid_grant`          |
| Refresh or `client_credentials` asking for wider scope                                                                                                       | 400    | `invalid_scope`          |
| Any parameter sent twice, even with identical values                                                                                                         | 400    | `invalid_request`        |
| A required parameter sent with an empty value                                                                                                                | 400    | `invalid_request`        |
| An empty `client_id` from a public client                                                                                                                    | 401    | `invalid_client`         |
| `GET` instead of `POST`                                                                                                                                      | 404    | —                        |

`/revoke` and `/introspect` read the same client authentication as `/token`: a
`private_key_jwt` assertion, whose `aud` is this tenant's `/token` URL at all
three endpoints, a `tls_client_auth` certificate subject under the same
`ODUDU_TRUST_PROXY` rule, or either password method, and refuse a failed one
with the same `401` and `invalid_client`.
The built-in `odudu-admin` client is one that authenticates this way, and the
console's refusals and acceptances at `/token` and `/revoke` are transcripts in
[Console paths](../console-paths/the-gateway-is-a-confidential-client.md).

Every 401 carries `WWW-Authenticate: Basic realm="token"`. Every response,
success or failure, carries `cache-control: no-store` and `pragma:
no-cache`.

`tls_client_auth` (RFC 8705 §2.1) registers with a `tls_client_auth_subject_dn`
metadata field — the exact string the client's certificate's subject must equal,
byte for byte after trimming surrounding whitespace, for the comparison to pass
(no `distinguishedNameMatch`, a deliberate simplification). Registering
`token_endpoint_auth_method: "tls_client_auth"` without it is
`invalid_client_metadata`. At `/token`, the subject arrives as a header a
trusted reverse proxy sets — its name is `ODUDU_TLS_CLIENT_CERT_HEADER` (default
`x-ssl-client-s-dn`), and the method is refused outright, not downgraded,
whenever `ODUDU_TRUST_PROXY` is off ([Deploying](../../../operating/deploying.md) has the
proxy's own obligations). Off means the method is unavailable end to end, not
only at `/token`: discovery's `token_endpoint_auth_methods_supported` does not
name `tls_client_auth` either — off on this stack, which is why the transcript
above does not list it — and registering a client for it is itself
`invalid_client_metadata`, the same as an unknown `token_endpoint_auth_method`
would be.

`/revoke` and `/introspect` take the same certificate subject under the same
rule, from the same header, and discovery lists the method for both exactly when
it lists it for `/token`. On a stack of its own, on `http://localhost:3082`,
with `ODUDU_TRUST_PROXY=true` added by a compose override
(`ODUDU_TLS_CLIENT_CERT_HEADER` left at its default). A tenant, `tls-demo`, with
registration open, and a client registered dynamically for `tls_client_auth`
with the subject `CN=tls-demo-client,O=Example`:

```bash
docker compose exec -T odudu node dist/main.js seed tenant --name tls-demo --set client_registration_policy=open
curl -sS -X POST http://localhost:3082/tenants/tls-demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"client_name":"tls-demo-client","grant_types":["client_credentials"],"token_endpoint_auth_method":"tls_client_auth","tls_client_auth_subject_dn":"CN=tls-demo-client,O=Example"}'
```

```
{"command":"tenant","created":true,"tenant":"tls-demo","tenantId":"01a1209c-e194-785e-82e5-4f027cdb9022","settings":["client_registration_policy"]}
```

```
{"client_id":"01a1209c-e2f4-7913-adce-9c43e5cdeef2","client_id_issued_at":1791548514,"client_secret":"Lgpir8vBpe8TIXObBxvxdGrP3P5YNl2rFe4sUgil8kk","client_secret_expires_at":0,"redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"tls_client_auth","client_name":"tls-demo-client","tls_client_auth_subject_dn":"CN=tls-demo-client,O=Example"}
```

The client's token, with the header a proxy would set from the certificate it
verified (`$CID` is the `client_id` above). The status line and headers are as
sent; the body below is **not the bytes on the wire**: it is the response read
back by `python3` and printed with the access token cut to its first 24
characters and an ellipsis, so its quotes and spacing are Python's:

```bash
curl -sS -D - -H 'x-ssl-client-s-dn: CN=tls-demo-client,O=Example' \
  --data-urlencode grant_type=client_credentials --data-urlencode client_id=$CID \
  http://localhost:3082/tenants/tls-demo/protocol/openid-connect/token
```

```
HTTP/1.1 200 OK
x-request-id: 01a1209d-0501-742a-8c1d-4c4b577f8641
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 957
Date: Fri, 09 Oct 2026 12:22:03 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"access_token": "eyJhbGciOiJSUzI1NiIsImtp…", "token_type": "Bearer", "expires_in": 300, "scope": ""}
```

The subject must match. A different one is refused at `/introspect`, the same
`invalid_client` as at `/token`; the matching one is answered (`active` is
`false` because this client is not among the token's audiences, which
[the introspection section](./rp-initiated-logout.md#token-introspection-and-revocation) explains):

```bash
curl -sS -D - -H 'x-ssl-client-s-dn: CN=someone-else' \
  --data-urlencode "token=$ACCESS" --data-urlencode client_id=$CID \
  http://localhost:3082/tenants/tls-demo/protocol/openid-connect/token/introspect
curl -sS -D - -H 'x-ssl-client-s-dn: CN=tls-demo-client,O=Example' \
  --data-urlencode "token=$ACCESS" --data-urlencode client_id=$CID \
  http://localhost:3082/tenants/tls-demo/protocol/openid-connect/token/introspect
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1209d-05e9-79ae-962b-6f2f25031314
www-authenticate: Basic realm="token"
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 78
Date: Fri, 09 Oct 2026 12:22:04 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"invalid_client","error_description":"Client authentication failed."}
```

```
HTTP/1.1 200 OK
x-request-id: 01a1209d-0614-7dc3-b275-228300d01cb2
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 16
Date: Fri, 09 Oct 2026 12:22:04 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"active":false}
```

At `/revoke`, the header sent twice is refused, never read as one value:

```bash
curl -sS -D - -H 'x-ssl-client-s-dn: CN=tls-demo-client,O=Example' \
  -H 'x-ssl-client-s-dn: CN=tls-demo-client,O=Example' \
  --data-urlencode "token=$ACCESS" --data-urlencode client_id=$CID \
  http://localhost:3082/tenants/tls-demo/protocol/openid-connect/revoke
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1209d-0649-7872-8a47-0908b65b9b53
www-authenticate: Basic realm="token"
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 78
Date: Fri, 09 Oct 2026 12:22:04 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"invalid_client","error_description":"Client authentication failed."}
```

And a revocation is shown to revoke or not, by the grant's own row, scoped to the
grant the token names (`grant_id`, read from the token's payload): a new token, the
state, a revocation under the wrong subject and the state, a revocation under the
right one and the state:

```sql
select revoked_at is not null as revoked from token_grants where id = '01a1209d-52ee-708b-a0d7-849089601673';
```

```
 revoked
---------
 f
(1 row)
```

```
401
```

```
 revoked
---------
 f
(1 row)
```

```
200
```

```
 revoked
---------
 t
(1 row)
```

(The two status codes are curl's `-w "%{http_code}"` of the wrong-subject and the
matching revocation.) With this stack's `ODUDU_TRUST_PROXY=true`, the three
`*_auth_methods_supported` members of `tls-demo`'s discovery document read, one
per line as `python3` printed them:

```
token_endpoint_auth_methods_supported ["client_secret_basic", "client_secret_post", "none", "private_key_jwt", "tls_client_auth"]
introspection_endpoint_auth_methods_supported ["client_secret_basic", "client_secret_post", "private_key_jwt", "tls_client_auth", "none"]
revocation_endpoint_auth_methods_supported ["client_secret_basic", "client_secret_post", "private_key_jwt", "tls_client_auth", "none"]
```

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
  'http://localhost:3000/tenants/demo/protocol/openid-connect/token'
```

```
HTTP/1.1 401 Unauthorized
www-authenticate: Basic realm="token"
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8

{"error":"invalid_client","error_description":"Client authentication failed."}
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
redeeming: `{"error":"invalid_grant","error_description":"The code or token is not valid."}`. Refresh-token expiry was not waited
out — the lifetime is 14 days — but expiry, reuse and an unknown token all
leave the same atomic consume returning nothing, and so answer identically.

`unauthorized_client` is the one row with no command above it. The seed command
always provisions a confidential client with a service account, so the compose
stack cannot produce a client that lacks one; the row's evidence is an
integration test, which builds that client against a real database. It is
distinct from `invalid_client` on purpose: the client is who it says it is, and
the refusal is about how it was provisioned (RFC 6749 §5.2).

### Client authentication is by the registered method and no other

`client_credentials` is the shortest request that authenticates a client,
so it makes the clearest demonstration. `demo-backend` is registered
`client_secret_basic`, `demo-post` is registered `client_secret_post`, and
`demo-spa` is public.

```bash
curl -sS -u demo-backend:demo-backend-secret \
  --data-urlencode 'grant_type=client_credentials' \
  'http://localhost:3000/tenants/demo/protocol/openid-connect/token'
```

| How the client presents itself                    | Status | Body                                                                                             |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| `demo-backend`, secret in the header (registered) | 200    | an access token                                                                                  |
| `demo-backend`, secret in the body                | 401    | `{"error":"invalid_client","error_description":"Client authentication failed."}`                 |
| `demo-post`, secret in the body (registered)      | 200    | an access token                                                                                  |
| `demo-post`, secret in the header                 | 401    | `{"error":"invalid_client","error_description":"Client authentication failed."}`                 |
| `demo-backend`, both at once                      | 401    | `{"error":"invalid_client","error_description":"Client authentication failed."}`                 |
| `demo-backend`, header plus `client_secret=`      | 200    | an access token                                                                                  |
| `demo-backend`, wrong secret                      | 401    | `{"error":"invalid_client","error_description":"Client authentication failed."}`                 |
| `demo-spa` (public) asking for this grant         | 400    | `{"error":"unauthorized_client","error_description":"This client may not use this grant type."}` |
| `demo-spa` presenting any secret                  | 401    | `{"error":"invalid_client","error_description":"Client authentication failed."}`                 |
| A `client_id` naming nobody                       | 401    | `{"error":"invalid_client","error_description":"Client authentication failed."}`                 |

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

### Repeated and empty parameters at `/token`

RFC 6749 §3.2 says a parameter may be sent at most once, and does not make
an exception for a duplicate that agrees with itself. A code redeemed with
`grant_type` sent twice, identically, is `invalid_request` — and the code
is **not** consumed by the refusal, so the same code redeems on the next
attempt:

```bash
curl -sS --data "grant_type=authorization_code&grant_type=authorization_code&code=$CODE&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&client_id=demo-spa&code_verifier=$VERIFIER" \
  'http://localhost:3000/tenants/demo/protocol/openid-connect/token'
```

```json
{
  "error": "invalid_request",
  "error_description": "The request is missing a parameter or has a wrong one."
}
```

```bash
# the same code, each parameter sent once
curl -sS --data-urlencode 'grant_type=authorization_code' --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' --data-urlencode "code_verifier=$VERIFIER" \
  'http://localhost:3000/tenants/demo/protocol/openid-connect/token'
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

### The refusals that deliberately consume nothing

Both single-use credentials here are destroyed by being used, and one of
them takes the whole grant with it when it is replayed. That makes it worth
knowing exactly which refusals are reachable by somebody who is not the
holder — because any of those that consumed the credential would be a way
to destroy a stranger's session on demand.

Run against one authorization code, in order, before redeeming it:

```
wrong code_verifier      {"error":"invalid_grant","error_description":"The code or token is not valid."}
wrong redirect_uri       {"error":"invalid_grant","error_description":"The code or token is not valid."}
a different client       {"error":"invalid_grant","error_description":"The code or token is not valid."}
no code_verifier at all  {"error":"invalid_grant","error_description":"The code or token is not valid."}
the correct redemption   {"access_token":"eyJhbGciOiJSUzI1NiIsImt…
```

Four refusals, and the code still worked: each attempt is rolled back
whole. The same for a refresh token — another client presenting it, and its
own client asking for scope it was never granted, both refused without
rotating anything, after which the owner's token refreshed normally. That
transcript is in [Path B](./path-b-refresh-rotation.md#what-a-replay-does-not-do).

And across tenants, where the credential is real but presented at the wrong
tenant:

| Presented at tenant `demo`                 | Answer                                                                            | Afterwards, at tenant `other` |
| ------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------- |
| A `code` issued by tenant `other`          | `{"error":"invalid_grant","error_description":"The code or token is not valid."}` | still redeems                 |
| A `refresh_token` issued by tenant `other` | `{"error":"invalid_grant","error_description":"The code or token is not valid."}` | still refreshes               |

The tenant in the URL is the only tenant whose rows the query can see (ADR
0009), so the credential is not found rather than found and rejected — and
nothing in the other tenant is touched, which is what the second column
proves.

## `/userinfo`

| Request                                    | Status | `WWW-Authenticate`                                 | Why                                                                               |
| ------------------------------------------ | ------ | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET` with the token in the header         | 200    | —                                                  | RFC 6750 §2.1, the method every client should use                                 |
| `POST` with the token in the header        | 200    | —                                                  | OIDC Core §5.3 requires both methods, answering identically                       |
| `POST` with `access_token=` in a form body | 200    | —                                                  | RFC 6750 §2.2, the only other transmission method accepted                        |
| No `Authorization` header                  | 401    | `Bearer realm="userinfo"`                          | No credentials were presented, so no error code (RFC 6750 §3.1)                   |
| Unparseable or unsigned token              | 401    | `…, error="invalid_token"`                         | —                                                                                 |
| An ID token presented as the bearer        | 401    | `…, error="invalid_token"`                         | `typ` must be `at+jwt`; the same key signed both, so `typ` is what separates them |
| Another tenant's access token              | 401    | `…, error="invalid_token"`                         | Verified against this tenant's keys only, so it is a forgery from here            |
| Token in the header _and_ the body         | 400    | `…, error="invalid_request"`                       | More than one transmission method (RFC 6750 §3.1)                                 |
| Valid token without `openid` scope         | 403    | `…, error="insufficient_scope"`                    | A distinct answer, so a valid-but-unscoped token is not confused with a bad one   |
| `POST` with a JSON body                    | 415    | (`accept-post: application/x-www-form-urlencoded`) | RFC 6750 §2.2 fixes the form-encoded method's content type                        |
| Unknown tenant                             | 404    | —                                                  | —                                                                                 |

Failures here carry no response body: this endpoint answers a machine, and
reports in headers.

The two accepted transmission methods are accepted one at a time. Sending
the token both ways in one request is `invalid_request` — RFC 6750 §3.1
again, and a request carrying two credentials has not said which one it is
asking to be judged on:

```bash
curl -sS -D - -H "Authorization: Bearer $ACCESS_TOKEN" \
  --data-urlencode "access_token=$ACCESS_TOKEN" \
  http://localhost:3000/tenants/demo/protocol/openid-connect/userinfo
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
  http://localhost:3000/tenants/demo/protocol/openid-connect/userinfo
```

```
HTTP/1.1 415 Unsupported Media Type
accept-post: application/x-www-form-urlencoded
content-length: 0
```

## Tenant resolution

An unknown tenant is 404 at `/token`, `/userinfo`, `/certs` and the discovery
document, and a rendered `invalid_client` page at `/authorize`. All five
run:

```
/tenants/nope/.well-known/openid-configuration   404
/tenants/nope/protocol/openid-connect/certs      404
/tenants/nope/protocol/openid-connect/token      404
/tenants/nope/protocol/openid-connect/userinfo   404
/tenants/nope/protocol/openid-connect/auth       400   (the rendered page)
```

`/authorize` is the odd one because it has a page to render and the others
do not, and its page is the same "Unknown or disabled client" a live tenant
shows for a `client_id` it does not know — so a probe cannot tell a missing
tenant from a missing client.

A disabled tenant is refused everywhere an unknown one is but two places: its
discovery document and `/certs` still answer `200`. Public keys are not secret,
and the relying parties the disable queued Back-Channel Logout Tokens for need
them to validate those tokens (Back-Channel Logout 1.0 §2.6); a tenant that
stopped publishing its keys at the moment it queued them would have every one
rejected. Deleting the tenant removes its keys, and both then answer `404`.
Everything else — `/token`, `/userinfo`, and `/authorize`'s rendered page —
cannot tell a disabled tenant from one that never existed. From the repository
root, on port 3082, brought up from an empty volume for [the admin
paths](../admin-paths/index.md)'s `DELETE /admin/tenants/{tenant}`. A tenant
`lapsed` is seeded and answers, then is disabled through `psql`, in the column
`PATCH /admin/tenants/{tenant}` with `enabled: false` and the console's Disable
both write, and is asked again beside `nope`. The `diff` compares `lapsed`'s and
`nope`'s rendered `/auth` page, headers included but for `date` and
`x-request-id`; it printed nothing and exited 0. The last line counts the keys
`lapsed` still publishes:

```bash
export COMPOSE_PROJECT_NAME=odudu-t8b2
odudu() { docker compose -f infra/docker/compose.yaml exec -T odudu node dist/main.js "$@"; }
pg() { docker compose -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu -tA -c "$1"; }
ask() {
  for p in "$@"; do
    printf '%-50s %s\n' "/tenants/$t/$p" \
      "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3082/tenants/$t/$p")"
  done
}
odudu seed tenant --name lapsed
t=lapsed ask .well-known/openid-configuration protocol/openid-connect/certs
pg "update tenants set enabled = false where name = 'lapsed' returning name, enabled"
for t in lapsed nope; do
  ask .well-known/openid-configuration protocol/openid-connect/{certs,token,userinfo,auth}
done
answer() { curl -s -D - "http://localhost:3082/tenants/$1/$2" | grep -iv '^date:\|^x-request-id:'; }
diff <(answer lapsed protocol/openid-connect/auth) <(answer nope protocol/openid-connect/auth)
echo "diff exit $?"
curl -s http://localhost:3082/tenants/lapsed/protocol/openid-connect/certs \
  | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["keys"]), "key")'
```

```
{"command":"tenant","created":true,"tenant":"lapsed","tenantId":"01a0ef23-23c9-791b-9733-189c42be5382"}
/tenants/lapsed/.well-known/openid-configuration   200
/tenants/lapsed/protocol/openid-connect/certs      200
lapsed|f
UPDATE 1
/tenants/lapsed/.well-known/openid-configuration   200
/tenants/lapsed/protocol/openid-connect/certs      200
/tenants/lapsed/protocol/openid-connect/token      404
/tenants/lapsed/protocol/openid-connect/userinfo   404
/tenants/lapsed/protocol/openid-connect/auth       400
/tenants/nope/.well-known/openid-configuration     404
/tenants/nope/protocol/openid-connect/certs        404
/tenants/nope/protocol/openid-connect/token        404
/tenants/nope/protocol/openid-connect/userinfo     404
/tenants/nope/protocol/openid-connect/auth         400
diff exit 0
1 key
```

`odudu seed` also wrote Node's `ExperimentalWarning` for Web Crypto to
stderr, which is left out above.

Tenant isolation goes further than the URL, and the credentials prove it:
an authorization code, a refresh token, an access token and an
`id_token_hint` issued by one tenant are each refused by another. The two
that are single-use — the code and the refresh token — were then presented
again at the tenant that issued them, and both still worked, so the refusal
consumed nothing. Those runs are above, under `/token`, `/userinfo` and
`id_token_hint` respectively.

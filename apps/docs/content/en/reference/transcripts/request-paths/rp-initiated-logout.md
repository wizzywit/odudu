---
title: 'RP-initiated logout'
description: 'GET/POST /tenants/{tenant}/protocol/openid-connect/logout implements OpenID Connect RP-Initiated Logout 1.0.'
---

# RP-initiated logout

`GET`/`POST /tenants/{tenant}/protocol/openid-connect/logout` implements [OpenID
Connect RP-Initiated Logout
1.0](https://github.com/wizzywit/odudu/blob/main/docs/protocols/oidc-rpinitiated.md).
Ending a session revokes it and every grant whose `session_id` names it. The
access tokens those grants minted are self-contained `at+jwt` JWTs, so a
resource server that only checks a signature locally keeps accepting one until
its own `exp` regardless — but
[`/introspect`](#token-introspection-and-revocation) reports it inactive
immediately, and `/userinfo` refuses it outright with `invalid_token`, which is
what closes that gap before `exp` for both doors. The paragraph on the back-channel
sender under "Front-channel and back-channel logout" has the same account.

A client registers its `post_logout_redirect_uri` values ahead of time.
`seed client --post-logout-redirect-uri` registers them **as it creates** a
client, and refuses a client that already exists — deliberately, because a
re-run that quietly widened a registered redirect list is how an allowlist
grows by accident. `demo-spa` was seeded back in
[Bootstrap](./bootstrap.md), so this walkthrough sets the column directly;
`PATCH /admin/tenants/{tenant}/clients/{id}` amends the list with
`If-Match`, and RFC 7592's own client-configuration endpoint — a client
amending itself with its registration token — is planned on [the roadmap](../../../roadmap.md#later):

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    UPDATE client_oidc_config
    SET post_logout_redirect_uris = ARRAY['http://localhost:8080/logged-out']
    FROM clients
    WHERE clients.id = client_oidc_config.client_id AND clients.client_id = 'demo-spa';
  "
```

Signing in exactly as [Path A](./path-a-authorization-code-with-pkce.md) does,
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
  "http://localhost:3000/tenants/demo/protocol/openid-connect/auth" \
  | sed -n 's/.*[Ll]ocation: .*[?&]code=\([^&[:space:]]*\).*/\1/p' | tr -d '\r')

TOKEN_RESPONSE=$(curl -sS \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode "code_verifier=$VERIFIER" \
  "http://localhost:3000/tenants/demo/protocol/openid-connect/token")

ID_TOKEN=$(python3 -c "import json,sys; print(json.load(sys.stdin)['id_token'])" <<< "$TOKEN_RESPONSE")
REFRESH_TOKEN=$(python3 -c "import json,sys; print(json.load(sys.stdin)['refresh_token'])" <<< "$TOKEN_RESPONSE")
```

The browser then arrives at the logout endpoint with that hint and a registered
redirect. The blocks of this section ran against a fresh stack seeded with `demo`, `demo-spa`, `demo-post` and `ada` as
[Bootstrap](./bootstrap.md) does. It publishes **port 3191**, and a local TCP
forward from port 3000 to it let these commands read as they always have;
the sections below name 3191, which is the port they were run on. The pipe prints the
status line, the `content-security-policy` and `<title>`, and the form's hidden
fields except `csrf`:

```bash
curl -sS -b cookies.txt -D - --get \
  --data-urlencode "id_token_hint=$ID_TOKEN" \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'post_logout_redirect_uri=http://localhost:8080/logged-out' \
  --data-urlencode 'state=xyz-bye' \
  "http://localhost:3000/tenants/demo/protocol/openid-connect/logout" | tee page.txt \
  | grep -iE '^HTTP|^location|^set-cookie|<title>|name="(session_id|client_id|post_logout_redirect_uri|state)"|^content-security-policy'
```

```
HTTP/1.1 200 OK
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' http://localhost:8080; base-uri 'none'
<title>Sign out?</title>
  <input type="hidden" name="session_id" value="01a17ced-34cf-7caa-8eb4-1546abc5d157">
  <input type="hidden" name="client_id" value="demo-spa">
  <input type="hidden" name="post_logout_redirect_uri" value="http://localhost:8080/logged-out">
  <input type="hidden" name="state" value="xyz-bye">
```

The hint matches the session in the cookie, a registered redirect is
requested, and still nothing is ended and no cookie is touched: the answer is
the confirmation page, because a `GET` that names a valid ID token proves
that somebody holds the token, and nothing about the End-User's intent (§2).
`form-action` lists the registered redirect's origin because the form's
`POST` will redirect there. The browser posts the form back, which is the
request that ends the session. `field` reads one hidden field out of the page
saved above:

```bash
field() { sed -n "s/.*name=.$1. value=.\([^>]*\).>.*/\1/p" page.txt; }
curl -sS -b cookies.txt -D - -o /dev/null -X POST \
  --data-urlencode "session_id=$(field session_id)" --data-urlencode "csrf=$(field csrf)" \
  --data-urlencode "client_id=$(field client_id)" \
  --data-urlencode "post_logout_redirect_uri=$(field post_logout_redirect_uri)" \
  --data-urlencode "state=$(field state)" \
  "http://localhost:3000/tenants/demo/protocol/openid-connect/logout"
```

```
HTTP/1.1 302 Found
x-request-id: 01a17ced-3557-71f7-bd45-47d940774759
set-cookie: demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
cache-control: no-store
location: http://localhost:8080/logged-out?state=xyz-bye
content-length: 0
Date: Tue, 27 Oct 2026 10:34:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

Both cookies are cleared, not just the one this login set: logout ends the
whole SSO session, and a browser could hold a live persistent cookie from a
different, remembered login even though this walkthrough's own login did
not set one.

The hint is validated (OIDC Core §3.1.2.2 — this tenant's own keys, this
tenant's issuer, an access token refused by `typ`), and what it does is
identify the session: the page asks about the one the hint's `sid` names. The
confirmation is asked for whatever the hint is, so the exact-match
`post_logout_redirect_uri` is honoured only by the `POST` that follows it. A
`sid` naming a session outside this browser's own resolved set — stale, or
another browser's — is treated as a hint that names nothing usable: the page
falls back to whichever of this browser's own sessions was most recently
active and names that session, not the one the `sid` asked for, so nobody is
misled about which session confirming will end. A hint past its `exp` is read
the same way ([below](#an-id-token-past-its-exp-sent-as-the-hint)).
The refresh
token this session's grant issued is now refused:

```bash
curl -sS \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$REFRESH_TOKEN" \
  --data-urlencode 'client_id=demo-spa' \
  "http://localhost:3000/tenants/demo/protocol/openid-connect/token"
```

```json
{ "error": "invalid_grant", "error_description": "The code or token is not valid." }
```

## An ID token past its `exp`, sent as the hint

A hint is usually older than five minutes by the time a client sends it —
the console's own sign-out sends the ID token it stored at sign-in — so
RP-Initiated Logout §2 and OIDC Core §3.1.2.2 both ask the OP to accept one
"even when the `exp` time has passed". At the logout endpoint what bounds
that is the session the hint's `sid` names, not the clock: the `sid` has to
equal a session still live in this browser's own cookies, and all it then
does is choose which session the confirmation page asks about. Nothing is
ended by the request. At `/authorize` the hint only constrains the request;
it authenticates nobody.

This section ran against a fresh stack of its own,
published on **port 3191**, so every URL below is the port it ran
on, seeded only with `demo`, `demo-spa`, `demo-post` and `ada` as
[Bootstrap](./bootstrap.md) does. The
redirect list from the section above is in place, and `demo-spa`'s ID token
lifetime is lowered to its minimum of five seconds, so a hint can be shown past
its `exp` in the time it takes to run the next block. `psql` is a function for
the compose stack's database, the way `odudu` is for its CLI:

```bash
psql() { docker compose -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu "$@"; }
BASE=http://localhost:3191/tenants/demo/protocol/openid-connect
LOGIN=http://localhost:3191/tenants/demo/login-actions/authenticate
psql -c "UPDATE client_oidc_config SET id_token_ttl_seconds = 5
  FROM clients WHERE clients.id = client_oidc_config.client_id AND clients.client_id = 'demo-spa';"
```

```
UPDATE 1
```

Two sign-ins, each from its own browser (its own cookie jar), each
redeemed for an ID token. `signin` is [the shell variables
section](./bootstrap.md#the-shell-variables-the-rest-of-this-document-uses)'s sequence
with a cookie jar added; `claims` prints what a token says about itself and
`sid_of` reads its `sid`. Seven seconds later both tokens are past their
`exp`:

```bash
signin() { # $1 = cookie jar; sets ID_TOKEN
  VERIFIER=$(openssl rand -hex 32)
  CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
  AUTH_SESSION_ID=$(curl -sS --get --data-urlencode 'response_type=code' --data-urlencode 'client_id=demo-spa' \
    --data-urlencode 'redirect_uri=http://localhost:8080/callback' --data-urlencode 'scope=openid' \
    --data-urlencode 'state=s' --data-urlencode "code_challenge=$CHALLENGE" --data-urlencode 'code_challenge_method=S256' \
    "$BASE/auth" | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')
  CODE=$(curl -sS -c "$1" -D - -o /dev/null --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
    --data-urlencode 'username=ada' --data-urlencode 'password=correct-horse-battery' "$LOGIN" \
    | sed -n 's/.*[?&]code=\([^&[:space:]]*\).*/\1/p' | tr -d '\r')
  ID_TOKEN=$(curl -sS --data-urlencode 'grant_type=authorization_code' --data-urlencode "code=$CODE" \
    --data-urlencode 'redirect_uri=http://localhost:8080/callback' --data-urlencode 'client_id=demo-spa' \
    --data-urlencode "code_verifier=$VERIFIER" "$BASE/token" | sed -n 's/.*"id_token":"\([^"]*\)".*/\1/p')
}
sid_of() { claims "$1" | python3 -c "import json,sys; print(json.load(sys.stdin)['sid'])"; }
claims() { python3 - "$1" <<'PY'
import sys,json,base64
p=sys.argv[1].split('.')[1]; p+='='*(-len(p)%4)
c=json.loads(base64.urlsafe_b64decode(p))
print(json.dumps({k:c[k] for k in ('iat','exp','sid') if k in c}))
PY
}
signin jarA.txt; TOKEN_A=$ID_TOKEN; claims "$TOKEN_A"
signin jarB.txt; TOKEN_B=$ID_TOKEN; claims "$TOKEN_B"
sleep 7; date -u +%s
SID_A=$(sid_of "$TOKEN_A"); SID_B=$(sid_of "$TOKEN_B")
echo "SID_A=$SID_A"; echo "SID_B=$SID_B"
```

```
{"iat": 1793095190, "exp": 1793095195, "sid": "01a17ccd-4887-7db7-8ea3-802d7ad7fc07"}
{"iat": 1793095190, "exp": 1793095195, "sid": "01a17ccd-4942-736c-85df-cbc451c237e6"}
1793095197
SID_A=01a17ccd-4887-7db7-8ea3-802d7ad7fc07
SID_B=01a17ccd-4942-736c-85df-cbc451c237e6
```

The precondition that makes the next calls safe is the session, not the
clock, and it is shown rather than asserted: both sessions are live, and
`post_logout_redirect_uris` is what `demo-spa` may be sent to:

```bash
LIVE="select id, expires_at > now() as live from sessions where id in ('$SID_A','$SID_B') order by created_at;"
psql -c "$LIVE"
psql -c "select c.client_id, o.post_logout_redirect_uris, o.id_token_ttl_seconds
  from client_oidc_config o join clients c on c.id = o.client_id where c.client_id = 'demo-spa';"
```

```
                  id                  | live
--------------------------------------+------
 01a17ccd-4887-7db7-8ea3-802d7ad7fc07 | t
 01a17ccd-4942-736c-85df-cbc451c237e6 | t
(2 rows)

 client_id |     post_logout_redirect_uris      | id_token_ttl_seconds
-----------+------------------------------------+----------------------
 demo-spa  | {http://localhost:8080/logged-out} |                    5
(1 row)
```

First the cases that still ask. Browser B presents the hint of session A:
that `sid` names a session B's cookie does not hold, so the hint names
nothing usable and the page asks about whichever session B's cookie does hold. A hint with the
last character of its signature changed (`$FORGED`) is no hint at all,
however its `exp` reads, and asks the same way. And a request with no session
cookie has no session to ask about, so it gets the no-session page. The pipe prints each
answer's status line, any `location` or `set-cookie`, and the page's
`<title>`:

```bash
FORGED="${TOKEN_A%?}$([ "${TOKEN_A: -1}" = A ] && echo B || echo A)"
curl -sS -b jarB.txt -D - --get --data-urlencode "id_token_hint=$TOKEN_A" \
  --data-urlencode 'client_id=demo-spa' --data-urlencode 'post_logout_redirect_uri=http://localhost:8080/logged-out' \
  --data-urlencode 'state=xyz-bye' "$BASE/logout" | grep -iE '^HTTP|^location|^set-cookie|<title>'
echo ---
curl -sS -b jarA.txt -D - --get --data-urlencode "id_token_hint=$FORGED" \
  --data-urlencode 'client_id=demo-spa' --data-urlencode 'post_logout_redirect_uri=http://localhost:8080/logged-out' \
  --data-urlencode 'state=xyz-bye' "$BASE/logout" | grep -iE '^HTTP|^location|^set-cookie|<title>'
echo ---
curl -sS -D - --get --data-urlencode "id_token_hint=$TOKEN_A" --data-urlencode 'client_id=demo-spa' "$BASE/logout" \
  | grep -iE '^HTTP|^location|^set-cookie|<title>'
```

```
HTTP/1.1 200 OK
<title>Sign out?</title>
---
HTTP/1.1 200 OK
<title>Sign out?</title>
---
HTTP/1.1 200 OK
<title>Already signed out</title>
```

The first two are the confirmation form and the third the no-session page;
none carries a `location` or a `set-cookie`. Neither session ended:

```bash
psql -c "$LIVE"
```

```
                  id                  | live
--------------------------------------+------
 01a17ccd-4887-7db7-8ea3-802d7ad7fc07 | t
 01a17ccd-4942-736c-85df-cbc451c237e6 | t
(2 rows)
```

`/authorize` reads the same lapsed hint as a constraint. Browser B's
session is live and it is the hint's subject, so a code is issued; with
`prompt=none` and no session cookie there is nobody to answer for, so
`login_required` comes back as for a request with no hint; and a lapsed
hint with its signature changed is `invalid_request`, as an unexpired one
would be (the code is shortened to `…`):

```bash
AUTH=(--get --data-urlencode 'response_type=code' --data-urlencode 'client_id=demo-spa'
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' --data-urlencode 'scope=openid'
  --data-urlencode 'state=xyz-auth' --data-urlencode "code_challenge=$CHALLENGE"
  --data-urlencode 'code_challenge_method=S256')
echo "# lapsed hint, live session of its subject"
curl -sS -b jarB.txt -D - -o /dev/null "${AUTH[@]}" --data-urlencode "id_token_hint=$TOKEN_B" "$BASE/auth" \
  | grep -iE '^HTTP|^location' | sed 's/code=[^&]*/code=…/'
echo "# lapsed hint, prompt=none, no session cookie"
curl -sS -D - -o /dev/null "${AUTH[@]}" --data-urlencode 'prompt=none' --data-urlencode "id_token_hint=$TOKEN_B" "$BASE/auth" \
  | grep -iE '^HTTP|^location'
echo "# forged lapsed hint, live session"
curl -sS -b jarB.txt -D - -o /dev/null "${AUTH[@]}" \
  --data-urlencode "id_token_hint=${TOKEN_B%?}$([ "${TOKEN_B: -1}" = A ] && echo B || echo A)" "$BASE/auth" \
  | grep -iE '^HTTP|^location'
```

```
# lapsed hint, live session of its subject
HTTP/1.1 302 Found
location: http://localhost:8080/callback?code=…&state=xyz-auth&iss=http%3A%2F%2Flocalhost%3A3191%2Ftenants%2Fdemo
# lapsed hint, prompt=none, no session cookie
HTTP/1.1 302 Found
location: http://localhost:8080/callback?error=login_required&error_description=The+user+is+not+signed+in.&state=xyz-auth&iss=http%3A%2F%2Flocalhost%3A3191%2Ftenants%2Fdemo
# forged lapsed hint, live session
HTTP/1.1 302 Found
location: http://localhost:8080/callback?error=invalid_request&error_description=id_token_hint+is+not+valid&state=xyz-auth&iss=http%3A%2F%2Flocalhost%3A3191%2Ftenants%2Fdemo
```

Now browser A presents the hint of its own session at the logout
endpoint, more than five seconds past its `exp`. The `sid` equals a live
session in this browser, so the page asks about that session, the one the
hint names, and carries the registered redirect. A `GET` ends nothing, however
well the hint matches. The pipe prints the status line, the `<title>` and the
form's hidden fields except `csrf`:

```bash
curl -sS -b jarA.txt -D - --get --data-urlencode "id_token_hint=$TOKEN_A" \
  --data-urlencode 'client_id=demo-spa' --data-urlencode 'post_logout_redirect_uri=http://localhost:8080/logged-out' \
  --data-urlencode 'state=xyz-bye' "$BASE/logout" | tee pageA.txt \
  | grep -iE '^HTTP|^location|^set-cookie|<title>|name="(session_id|client_id|post_logout_redirect_uri|state)"'
```

```
HTTP/1.1 200 OK
<title>Sign out?</title>
  <input type="hidden" name="session_id" value="01a17ccd-4887-7db7-8ea3-802d7ad7fc07">
  <input type="hidden" name="client_id" value="demo-spa">
  <input type="hidden" name="post_logout_redirect_uri" value="http://localhost:8080/logged-out">
  <input type="hidden" name="state" value="xyz-bye">
```

The `session_id` is session A's, not B's. The browser posts the form back,
and that `POST` is what ends the session and redirects. `field` reads one
hidden field out of the page saved above, `pageA.txt`:

```bash
field() { sed -n "s/.*name=.$1. value=.\([^>]*\).>.*/\1/p" pageA.txt; }
curl -sS -b jarA.txt -D - -o /dev/null -X POST \
  --data-urlencode "session_id=$(field session_id)" --data-urlencode "csrf=$(field csrf)" \
  --data-urlencode "client_id=$(field client_id)" \
  --data-urlencode "post_logout_redirect_uri=$(field post_logout_redirect_uri)" \
  --data-urlencode "state=$(field state)" "$BASE/logout"
```

```
HTTP/1.1 302 Found
x-request-id: 01a17ccd-6706-758b-ae98-2e961a23b710
set-cookie: demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
cache-control: no-store
location: http://localhost:8080/logged-out?state=xyz-bye
content-length: 0
Date: Tue, 27 Oct 2026 09:59:58 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

Session A is ended and B untouched, and the audit trail records the end
exactly as it does for an unexpired hint — `session.ended` with
`via: logout`; the audit vocabulary has no member for the hint's outcome:

```bash
psql -c "$LIVE"
psql -c "select action, outcome, detail from audit_events where resource_id = '$SID_A' order by occurred_at;"
```

```
                  id                  | live
--------------------------------------+------
 01a17ccd-4887-7db7-8ea3-802d7ad7fc07 | f
 01a17ccd-4942-736c-85df-cbc451c237e6 | t
(2 rows)

     action      | outcome |      detail
-----------------+---------+-------------------
 session.created | allowed | {}
 session.ended   | allowed | {"via": "logout"}
(2 rows)
```

That is the bound at the logout endpoint: a lapsed hint identifies a session
for as long as that session is live and in the presenting browser's cookies,
and for nothing else. It ends nothing by itself: what ends the session is
the form posted back, whose `csrf` is derived from the cookie's own secret, so
a leaked ID token cannot force a sign-out. The token's exposure is that it
can reach logs and history and name a session to ask about. `OIDC-RPINITIATED-2-05` holds the rest of the matrix to the same
answer. At `/authorize` the equivalent is `OIDC-CORE-3.1.2.2-08`: a lapsed
hint with a live session of another subject is still `login_required`
under `prompt=none` and still gets the login form otherwise. Token
exchange does not read a lapsed `subject_token`.

## Token introspection and revocation

Local validation cannot see that a session just ended — the access token
above is still a validly signed JWT until its own `exp` — so the two walks
below use a freshly seeded tenant and confidential client of their own,
`revokedoc`/`revoke-doc-client`, so a resource server that wants to see a
revocation before `exp` has something to call. `seed client` has no
`--audience` flag (see [the roadmap](../../../roadmap.md#decided-against-and-why)'s entry on `odudu seed`), so the
client's own `client_oidc_config.audiences` is set directly, the same way
[the section above](./rp-initiated-logout.md) sets `post_logout_redirect_uris`
directly. `PATCH /admin/tenants/{tenant}/clients/{id}` sets it too, with
`If-Match` — `audiences` is one of the six list fields that require one
([Admin paths](../admin-paths/patch-clientsid.md)) — and a walkthrough driven
from a shell with no admin token in it reaches for SQL instead:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    UPDATE client_oidc_config
    SET audiences = ARRAY['revoke-doc-client']
    FROM clients
    WHERE clients.id = client_oidc_config.client_id AND clients.client_id = 'revoke-doc-client';
  "
```

`revoke-doc-client` now names itself in its own `audiences`, which is what lets
it call `/introspect` for its own tokens — `callerIsAddressed` entitles a caller
through its own `client_id` or any of its registered `audiences`, and this
client's request for no particular `resource` resolves to exactly that set
(`resolveAudience`).

Signing in as `revoke-doc-client` — the same PKCE flow as
[Path A](./path-a-authorization-code-with-pkce.md), against this client instead
of `demo-spa` — and introspecting the access token it receives, while the
session is still live:

```bash
curl -sS -u revoke-doc-client:revoke-doc-secret \
  -X POST "http://localhost:3191/tenants/revokedoc/protocol/openid-connect/token/introspect" \
  --data-urlencode "token=$ACCESS_TOKEN"
```

```json
{
  "active": true,
  "scope": "openid",
  "client_id": "revoke-doc-client",
  "sub": "01a17ccf-f3f1-…",
  "aud": ["revoke-doc-client", "http://localhost:3191/tenants/revokedoc"],
  "token_type": "Bearer",
  "exp": 1793095665,
  "iat": 1793095365
}
```

(This run, and every block of this section after it, is on the stack at port
3191, with the tenant `revokedoc` seeded fresh alongside `demo`.) The
`id_token_hint` logout asks first, as everywhere above: the `GET` answers the
confirmation page and the token is still active after it.

```bash
curl -sS -b cookies-rd.txt -D - --get \
  --data-urlencode "id_token_hint=$ID_TOKEN" \
  --data-urlencode "client_id=revoke-doc-client" \
  --data-urlencode "state=bye-1" \
  "http://localhost:3191/tenants/revokedoc/protocol/openid-connect/logout" | tee page-rd.txt \
  | grep -iE '^HTTP|^set-cookie|<title>|name="(session_id|client_id|post_logout_redirect_uri|state)"'

curl -sS -u revoke-doc-client:revoke-doc-secret \
  -X POST "http://localhost:3191/tenants/revokedoc/protocol/openid-connect/token/introspect" \
  --data-urlencode "token=$ACCESS_TOKEN"
```

```
HTTP/1.1 200 OK
<title>Sign out?</title>
  <input type="hidden" name="session_id" value="01a17ccf-f522-7100-ad40-6cfc23463025">
  <input type="hidden" name="client_id" value="revoke-doc-client">
  <input type="hidden" name="state" value="bye-1">
{"active":true,"scope":"openid","client_id":"revoke-doc-client","sub":"01a17ccf-f3f1-7d48-903d-f7e95d50873a","aud":["revoke-doc-client","http://localhost:3191/tenants/revokedoc"],"token_type":"Bearer","exp":1793095665,"iat":1793095365}
```

Posting the form back ends the session. Introspecting the identical,
still-unexpired access token again:

```bash
field() { sed -n "s/.*name=.$1. value=.\([^>]*\).>.*/\1/p" page-rd.txt; }
curl -sS -b cookies-rd.txt -D - -o /dev/null -X POST \
  --data-urlencode "session_id=$(field session_id)" --data-urlencode "csrf=$(field csrf)" \
  --data-urlencode "client_id=$(field client_id)" --data-urlencode "state=$(field state)" \
  "http://localhost:3191/tenants/revokedoc/protocol/openid-connect/logout" | head -3

curl -sS -u revoke-doc-client:revoke-doc-secret \
  -X POST "http://localhost:3191/tenants/revokedoc/protocol/openid-connect/token/introspect" \
  --data-urlencode "token=$ACCESS_TOKEN"
```

```
HTTP/1.1 200 OK
x-request-id: 01a17ccf-f722-7223-88c2-422a74a2aeba
set-cookie: revokedoc-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
{"active":false}
```

(`field` is the first section's function, redefined to read `page-rd.txt`. The
logout answers the signed-out page, `200`, which `head -3` cuts short.) `exp`
above is `1793095665`; this second call landed seconds after `iat` — nearly all
300 seconds still on the clock, and none of them made any difference, because
logout revoked the grant this token names along with the session
(`tokenGrantRepository(tx).revokeForSession`, called by `endSession`), and
introspection checks that `revoked_at` before it ever looks at the session (RFC
7662 §8.2) — not merely the token's own signature. A resource server that only
verified the JWT locally would still be accepting this token.

`/revoke` (RFC 7009) is the other half — ending a grant deliberately, from
either side of it, rather than waiting for a session to end one. A fresh
sign-in, the same way, gives a second, still-live access and refresh token
pair. Revoking the refresh token:

```bash
curl -sS -i -u revoke-doc-client:revoke-doc-secret \
  -X POST "http://localhost:3000/tenants/revokedoc/protocol/openid-connect/revoke" \
  --data-urlencode "token=$REFRESH_TOKEN"
```

```
HTTP/1.1 200 OK
cache-control: no-store
content-length: 0
```

(`x-request-id`, `Date` and the keep-alive headers are omitted, as elsewhere in
this document.) The grant is really gone, not merely marked for it: redeeming the same
refresh token now fails the same way an unknown one would (RFC 6749 §5.2's
own rule against distinguishing them),

```bash
curl -sS -u revoke-doc-client:revoke-doc-secret \
  -X POST "http://localhost:3000/tenants/revokedoc/protocol/openid-connect/token" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "refresh_token=$REFRESH_TOKEN"
```

```json
{ "error": "invalid_grant", "error_description": "The code or token is not valid." }
```

and so does its sibling access token — the two name the same `token_grants` row,
so revoking either invalidates both (RFC 7009: "Both revocation directions go
through the grant, not the token"):

```bash
curl -sS -u revoke-doc-client:revoke-doc-secret \
  -X POST "http://localhost:3000/tenants/revokedoc/protocol/openid-connect/token/introspect" \
  --data-urlencode "token=$ACCESS_TOKEN"
```

```json
{ "active": false }
```

Revoking it again is RFC 7009 §2.2's other rule, pinned separately from the
first `200` above: an already-revoked token is not an error either.

```bash
curl -sS -i -u revoke-doc-client:revoke-doc-secret \
  -X POST "http://localhost:3000/tenants/revokedoc/protocol/openid-connect/revoke" \
  --data-urlencode "token=$REFRESH_TOKEN"
```

```
HTTP/1.1 200 OK
cache-control: no-store
content-length: 0
```

And discovery now names the endpoint that did all of this:

```
"introspection_endpoint": "http://localhost:3000/tenants/revokedoc/protocol/openid-connect/token/introspect",
"revocation_endpoint": "http://localhost:3000/tenants/revokedoc/protocol/openid-connect/revoke",
```

A second, separate sign-in with **no** `id_token_hint` gets the
confirmation page §2 requires instead of an immediate redirect — nothing is
ended by this `GET` alone:

```bash
curl -sS -b cookies2.txt \
  "http://localhost:3000/tenants/demo/protocol/openid-connect/logout"
```

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sign out?</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Sign out?</h1>
<p>Signing out ends this session for every application that uses it.</p>
<form method="post" action="/tenants/demo/protocol/openid-connect/logout">
  <input type="hidden" name="session_id" value="01a0de36-80e1-…">
  <input type="hidden" name="csrf" value="yU7AU__xF-kY…">
  <button type="submit">Sign out</button>
</form>
</main>
</body>
</html>
```

(`session_id` and `csrf` shortened, as elsewhere in this document.)
`session_id` is the session's **id** — the id half of the cookie's entry,
and the `sid` every token for it carries — so it is not a secret and proves
nothing on its own. `csrf` is what does: base64url of an HMAC-SHA256 over
`logout-confirm:<session id>`, keyed by the **secret** half of the entry.
The POST recomputes it from the entry this browser's cookie presents for
that session and compares in constant time, and the session must also be
one the cookie still resolves to. A forger who knows the id from any token
still cannot produce the token, and the secret itself never appears in the
page. Two defences stand beside it: the cookie is `SameSite=Lax`, so a
cross-site POST carries none, and a `session_id` outside the cookie's own
set is refused.

The right `session_id` without the token, from the same browser, is
refused with exactly the page a non-member `session_id` gets, and ends
nothing:

```bash
SID2=$(curl -sS -b cookies2.txt \
  "http://localhost:3094/tenants/demo/protocol/openid-connect/logout" \
  | sed -n 's/.*name="session_id" value="\([^"]*\)".*/\1/p')

curl -sS -b cookies2.txt -D - -X POST \
  --data-urlencode "session_id=$SID2" \
  "http://localhost:3094/tenants/demo/protocol/openid-connect/logout"
```

```
HTTP/1.1 400 Bad Request
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 880

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Can&#39;t sign out</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Can&#39;t sign out</h1>
<p>This sign-out attempt is no longer valid. Go back and try again.</p>
</main>
</body>
</html>
```

(`x-request-id`, `Date` and the keep-alive headers are omitted. This page and
the refusal come from a fresh sign-in into `cookies2.txt`, on
`http://localhost:3094`, with `demo` seeded as [Bootstrap](./bootstrap.md) does.
`cache-control` comes last of the page headers, where `pageHeaders` puts it.)

A `post_logout_redirect_uri` that is not an exact match to a registered
value — a trailing slash, a query string, a different host — is refused,
and the session still ends: §3's redirect rule is about the redirect
alone, never about whether logout happened.

## What a session leaves in the audit log

A session writes one `session` row when a login creates it and one when it
ends, each in the transaction that did the work. A signed-in `/authorize`
that reuses a session creates nothing and writes nothing. This run signs in
with a fresh jar, fetches the confirmation page for the `session_id` and
`csrf` it carries, and posts both back. The sign-in and the confirming
`POST` each carry their own `x-request-id` — the page fetch between them
writes no row and carries none — so the query below reads those two requests
and nothing else:

```bash
AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'state=xyz-audit' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "$BASE/auth" | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

curl -sS -c cookies-audit.txt -o /dev/null -w '%{http_code}\n' \
  -H 'x-request-id: logout-csrf-doc-sign-in' \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  "$LOGIN"

PAGE=$(curl -sS -b cookies-audit.txt \
  "http://localhost:3000/tenants/demo/protocol/openid-connect/logout")
SESSION_ID=$(printf '%s' "$PAGE" | sed -n 's/.*name="session_id" value="\([^"]*\)".*/\1/p')
CSRF=$(printf '%s' "$PAGE" | sed -n 's/.*name="csrf" value="\([^"]*\)".*/\1/p')

curl -sS -b cookies-audit.txt -o /dev/null -w '%{http_code}\n' \
  -H 'x-request-id: logout-csrf-doc-confirm' \
  --data-urlencode "session_id=$SESSION_ID" \
  --data-urlencode "csrf=$CSRF" \
  "http://localhost:3000/tenants/demo/protocol/openid-connect/logout"

docker compose exec -T postgres psql -U odudu -d odudu -x -P 'null=(null)' -c \
  "select e.action, e.outcome, e.actor_subject_id, c.client_id as actor_client,
          e.resource_type, e.resource_id, e.request_id, e.ip, e.detail
     from audit_events e left join clients c on c.id = e.actor_client_id
    where e.event_type = 'session'
      and e.request_id in ('logout-csrf-doc-sign-in', 'logout-csrf-doc-confirm')
    order by e.occurred_at;"
```

```
302
200
-[ RECORD 1 ]----+-------------------------------------
action           | session.created
outcome          | allowed
actor_subject_id | 01a0db22-1c92-7730-9d37-4085f28eca2c
actor_client     | demo-spa
resource_type    | session
resource_id      | 01a0de36-817a-78e7-9515-96498c511556
request_id       | logout-csrf-doc-sign-in
ip               | 172.20.0.1
detail           | {}
-[ RECORD 2 ]----+-------------------------------------
action           | session.ended
outcome          | allowed
actor_subject_id | 01a0db22-1c92-7730-9d37-4085f28eca2c
actor_client     | (null)
resource_type    | session
resource_id      | 01a0de36-817a-78e7-9515-96498c511556
request_id       | logout-csrf-doc-confirm
ip               | 172.20.0.1
detail           | {"via": "logout"}
```

On the same stack as [what a refused login leaves
behind](./path-a-authorization-code-with-pkce.md#what-a-refused-login-leaves-behind):
`ada` is subject `01a0db22-1c92-…`, and `resource_id` is the session the
`demo-session` cookie's entry named — its id half, never its secret.
`detail.via` says how a session ended: `logout` here, `admin` when the admin
API's `DELETE …/sessions/{sid}` ends it (beside that route's own
`admin_mutation` row), and `evicted` when a login past the tenant's
`max_sessions_per_browser` ends the browser's least recently active session,
naming that session's own subject. Ending a session that has already ended
writes no second row.

## The same request over `POST`

§2 requires both methods at this endpoint, so an RP may serialize the
request parameters into a form body instead of a query string. It is the
same request and gets the same answer: the confirmation page, and nothing
ended until the form is posted back. The `GET` above ended the session
`cookies.txt` held, so this needs a session of its own: run the sign-in and
the code-for-`id_token` exchange again into a second jar — the same two
blocks, with `-c cookies-post.txt` on the login and `-b cookies-post.txt`
on the authorize — and then, on the same stack at port 3191:

```bash
curl -sS -b cookies-post.txt -D - -X POST \
  --data-urlencode "id_token_hint=$ID_TOKEN" \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'post_logout_redirect_uri=http://localhost:8080/logged-out' \
  --data-urlencode 'state=xyz-bye' \
  "http://localhost:3191/tenants/demo/protocol/openid-connect/logout" | tee page-post.txt \
  | grep -iE '^HTTP|^location|^set-cookie|<title>|name="(session_id|client_id|post_logout_redirect_uri|state)"'
```

```
HTTP/1.1 200 OK
<title>Sign out?</title>
  <input type="hidden" name="session_id" value="01a17cce-ce03-7f60-af97-12e40d3f06a3">
  <input type="hidden" name="client_id" value="demo-spa">
  <input type="hidden" name="post_logout_redirect_uri" value="http://localhost:8080/logged-out">
  <input type="hidden" name="state" value="xyz-bye">
```

Posting that form back, with `field` redefined to read `page-post.txt`, ends
the session:

```bash
field() { sed -n "s/.*name=.$1. value=.\([^>]*\).>.*/\1/p" page-post.txt; }
curl -sS -b cookies-post.txt -D - -o /dev/null -X POST \
  --data-urlencode "session_id=$(field session_id)" --data-urlencode "csrf=$(field csrf)" \
  --data-urlencode "client_id=$(field client_id)" \
  --data-urlencode "post_logout_redirect_uri=$(field post_logout_redirect_uri)" \
  --data-urlencode "state=$(field state)" \
  "http://localhost:3191/tenants/demo/protocol/openid-connect/logout"
```

```
HTTP/1.1 302 Found
x-request-id: 01a17cce-ceb0-7766-8434-eb5d79453ebe
set-cookie: demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
cache-control: no-store
location: http://localhost:8080/logged-out?state=xyz-bye
content-length: 0
Date: Tue, 27 Oct 2026 10:01:30 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The session is gone, so the refresh token its grant issued is refused exactly
as after the `GET`:

```bash
curl -sS \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$REFRESH_TOKEN" \
  --data-urlencode 'client_id=demo-spa' \
  "http://localhost:3191/tenants/demo/protocol/openid-connect/token"
```

```json
{ "error": "invalid_grant", "error_description": "The code or token is not valid." }
```

Two messages therefore arrive at the same `POST`: this one, and the
confirmation form above submitting back. The form's hidden `session_id` is
what tells them apart, so a body carrying it is a confirmation and a body
without it is a logout request. A confirmation is honoured only with the
`csrf` token the cookie's secret derives; a body without `session_id` is
read as a request — which, whatever hint it carries, is answered by the
confirmation page and ends nothing.

## A form edited after it was issued

The form's `csrf` is an HMAC the cookie's secret keys, over the session id and
over the form's `client_id`, `post_logout_redirect_uri` and `state` as well,
each length-prefixed. A request that changes any one of them after the page
was issued no longer proves itself, so a forger who can steer a victim's
browser to the form cannot retarget where it redirects or what `state` it
returns. This ran on the stack at **port 3191** that the sections around it ran
on, with `demo`, `demo-spa`, `demo-post` and `ada` seeded as
[Bootstrap](./bootstrap.md) does and the redirect list from the first section in
place; the one query below is scoped to a single session, so what ran before
does not show in it. `psql` is a function for the compose
stack's database, as in the section on an ID token past its `exp`:

```bash
psql() { docker compose -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu "$@"; }
BASE=http://localhost:3191/tenants/demo/protocol/openid-connect
curl -sS -b cookies-edit.txt --get \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'post_logout_redirect_uri=http://localhost:8080/logged-out' \
  --data-urlencode 'state=xyz-bye' \
  "$BASE/logout" > page-edit.txt
grep -E '<title>|name="(session_id|client_id|post_logout_redirect_uri|state)"' page-edit.txt
```

```
<title>Sign out?</title>
  <input type="hidden" name="session_id" value="01a17cee-cfca-777e-b30c-6be218764488">
  <input type="hidden" name="client_id" value="demo-spa">
  <input type="hidden" name="post_logout_redirect_uri" value="http://localhost:8080/logged-out">
  <input type="hidden" name="state" value="xyz-bye">
```

`cookies-edit.txt` is the jar of a login as `ada`, the same sign-in the other
sections use. `submit` posts the form back with every field as the page gave it
except the one named, which it sends with another value. Each edit is made
alone, to a form whose token is otherwise genuine, and the session is read back
from the database after the three of them. The redirect edit goes to an address
`demo-spa` has not registered, and the `client_id` edit to another registered
client, so the redirect rule or the client lookup would each have had something
to say about them. The session being live afterwards is what shows the token was
refused first: the redirect check runs only after the session has ended:

```bash
field() { sed -n "s/.*name=.$1. value=.\([^>]*\).>.*/\1/p" page-edit.txt; }
submit() { # $1 = the field to change, $2 = what is sent in its place
  ARGS=()
  for f in session_id csrf client_id post_logout_redirect_uri state; do
    v=$(field $f); [ "$f" = "$1" ] && v=$2
    ARGS+=(--data-urlencode "$f=$v")
  done
  curl -sS -b cookies-edit.txt -D - -X POST "${ARGS[@]}" "$BASE/logout" \
    | grep -iE '^HTTP|^location|^set-cookie|<title>'
}
LIVE="select id, expires_at > now() as live from sessions where id = '$(field session_id)';"
echo '# state replaced'; submit state xyz-other
echo '# post_logout_redirect_uri replaced'; submit post_logout_redirect_uri http://localhost:8080/elsewhere
echo '# client_id replaced'; submit client_id demo-post
psql -c "$LIVE"
echo '# nothing replaced'; submit none none
psql -c "$LIVE"
```

```
# state replaced
HTTP/1.1 400 Bad Request
<title>Can&#39;t sign out</title>
# post_logout_redirect_uri replaced
HTTP/1.1 400 Bad Request
<title>Can&#39;t sign out</title>
# client_id replaced
HTTP/1.1 400 Bad Request
<title>Can&#39;t sign out</title>
                  id                  | live
--------------------------------------+------
 01a17cee-cfca-777e-b30c-6be218764488 | t
(1 row)

# nothing replaced
HTTP/1.1 302 Found
set-cookie: demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: http://localhost:8080/logged-out?state=xyz-bye
                  id                  | live
--------------------------------------+------
 01a17cee-cfca-777e-b30c-6be218764488 | f
(1 row)
```

Each edited form is refused with the same page a non-member's `session_id` gets
and ends nothing; the unedited one ends the session and redirects as before.
(`x-request-id`, `Date` and the keep-alive headers are omitted from the filtered
output by the `grep`.)

## A client may skip the page

A client's operator can turn the confirmation off for that client alone,
with `skip_logout_confirmation` ([`PATCH /clients/{id}`](../admin-paths/patch-clientsid.md#turning-the-logout-confirmation-off-for-one-client)
shows the write and its audit row; ADR 0047 has the reasoning). It applies to
one request only: an `id_token_hint` that verifies, whose audience is that
client and whose `sid` is the session the browser holds. This section ran on
**port 3193**, a new
stack with the tenant `demo`, the user `ada` and the public clients `demo-spa`
and `demo-post` seeded, each with the redirect `http://localhost:8080/callback`
and the post-logout redirect `http://localhost:8080/logged-out`. Before
anything below, `demo-spa` had been given `skip_logout_confirmation: true` and a
back-channel logout URI, `https://rp.example/backchannel`, through the admin API,
and `demo-post` was left as seeded. `psql` is a function for that stack's
database, and `live` asks whether a session is still live:

```bash
psql() { docker compose -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu "$@"; }
live() { psql -c "select id, expires_at > now() as live from sessions where id = '$1';"; }
psql -c "select c.client_id, c.skip_logout_confirmation from clients c join tenants t on t.id = c.tenant_id where t.name = 'demo' and not c.builtin_admin and c.client_id in ('demo-spa','demo-post') order by 1;"
```

```
 client_id | skip_logout_confirmation
-----------+--------------------------
 demo-post | f
 demo-spa  | t
(2 rows)
```

`ada` signed in with a new `cookies.txt` jar and `demo-spa`'s `id_token` was
obtained as the opening section does, so `ID_TOKEN` is a hint for `demo-spa`
whose `sid` is `$SID`, the session in the jar. The request is the same one the
opening section sent, and this time it is the whole exchange: no page, the
session ended, both cookies cleared and the browser sent on with its `state`:

```bash
BASE=http://localhost:3193/tenants/demo/protocol/openid-connect
live $SID
curl -sS -b cookies.txt -D - -o /dev/null --get \
  --data-urlencode "id_token_hint=$ID_TOKEN" \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'post_logout_redirect_uri=http://localhost:8080/logged-out' \
  --data-urlencode 'state=skip-1' \
  "$BASE/logout" | grep -iE '^HTTP|^location|^set-cookie|<title>'
live $SID
```

```
                  id                  | live
--------------------------------------+------
 01a17d0b-c1ad-7a65-8577-9596d23850d9 | t
(1 row)

HTTP/1.1 302 Found
set-cookie: demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: http://localhost:8080/logged-out?state=skip-1
                  id                  | live
--------------------------------------+------
 01a17d0b-c1ad-7a65-8577-9596d23850d9 | f
(1 row)
```

(The `grep` leaves out `x-request-id`, `Date` and the keep-alive headers.) The
session ended the way the confirmation `POST` ends one, so the grant `demo-spa`
held under it was revoked and its back-channel logout was queued for the
sender:

```bash
psql -c "select c.client_id, d.session_id, d.endpoint from backchannel_logout_deliveries d join clients c on c.id = d.client_id join tenants t on t.id = d.tenant_id where t.name = 'demo' and d.session_id = '$SID';"
```

```
 client_id |              session_id              |            endpoint
-----------+--------------------------------------+--------------------------------
 demo-spa  | 01a17d0b-c1ad-7a65-8577-9596d23850d9 | https://rp.example/backchannel
(1 row)
```

Every other request still asks. A second sign-in as `ada` gave a new session,
which `$SID` now names, and two hints, `ID_POST` for `demo-post` and `ID_SPA` for
`demo-spa`. `demo-post` kept the default, so its own hint, which is valid and
names this very session, gets the page. `demo-spa` skips, but a `client_id` with
no hint gets the page, and so does the hint `demo-post` was issued, whether or
not `client_id` names the client that skips. Each answer leaves the session live:

```bash
ask() { curl -sS -b cookies.txt -D - --get "$@" "$BASE/logout" | grep -iE '^HTTP|^location|^set-cookie|<title>'; live $SID; }
echo '# demo-post, which keeps the page, with its own hint'
ask --data-urlencode "id_token_hint=$ID_POST" --data-urlencode client_id=demo-post \
  --data-urlencode post_logout_redirect_uri=http://localhost:8080/logged-out --data-urlencode state=skip-2
echo '# demo-spa, which skips, with a client_id and no hint'
ask --data-urlencode client_id=demo-spa \
  --data-urlencode post_logout_redirect_uri=http://localhost:8080/logged-out --data-urlencode state=skip-3
echo '# demo-spa, which skips, with the hint demo-post was issued'
ask --data-urlencode "id_token_hint=$ID_POST" --data-urlencode client_id=demo-spa \
  --data-urlencode post_logout_redirect_uri=http://localhost:8080/logged-out --data-urlencode state=skip-4
```

```
# demo-post, which keeps the page, with its own hint
HTTP/1.1 200 OK
<title>Sign out?</title>
                  id                  | live
--------------------------------------+------
 01a17d0c-3525-78aa-b009-331bc781acd2 | t
(1 row)

# demo-spa, which skips, with a client_id and no hint
HTTP/1.1 200 OK
<title>Sign out?</title>
                  id                  | live
--------------------------------------+------
 01a17d0c-3525-78aa-b009-331bc781acd2 | t
(1 row)

# demo-spa, which skips, with the hint demo-post was issued
HTTP/1.1 200 OK
<title>Sign out?</title>
                  id                  | live
--------------------------------------+------
 01a17d0c-3525-78aa-b009-331bc781acd2 | t
(1 row)
```

Dynamic Client Registration never takes the field, so an anonymous
registration cannot opt itself out. `demo` had its registration policy set to
`open` (`odudu seed tenant --name demo --set client_registration_policy=open`)
for this and nothing else. The first request names the field and is refused;
the second registers the same client without it, and the row it made has the
setting off:

```bash
curl -sS -D - -H 'Content-Type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"],"skip_logout_confirmation":true}' \
  http://localhost:3193/tenants/demo/clients-registrations/openid-connect | grep -iE '^HTTP|^\{'
CID=$(curl -sS -H 'Content-Type: application/json' -d '{"redirect_uris":["https://rp.example/cb"]}' \
  http://localhost:3193/tenants/demo/clients-registrations/openid-connect | python3 -c "import json,sys; print(json.load(sys.stdin)['client_id'])")
psql -c "select client_id, registration_origin, skip_logout_confirmation from clients where client_id = '$CID';"
```

```
HTTP/1.1 400 Bad Request
{"error":"invalid_client_metadata","error_description":"skip_logout_confirmation is not accepted at registration: an administrator sets it"}
              client_id               | registration_origin | skip_logout_confirmation
--------------------------------------+---------------------+--------------------------
 01a17d0b-8aab-72db-92ad-1138b5f69c1f | anonymous           | f
(1 row)
```

The console's own client is the one client that has it on from the start, in
every tenant. The query below ran on this stack, whose tenants `odudu seed
admin` and `odudu seed tenant` had provisioned:

```bash
psql -c "select t.name, c.client_id, c.builtin_admin, c.skip_logout_confirmation from clients c join tenants t on t.id = c.tenant_id where c.builtin_admin order by t.name;"
```

```
  name  |  client_id  | builtin_admin | skip_logout_confirmation
--------+-------------+---------------+--------------------------
 demo   | odudu-admin | t             | t
 system | odudu-admin | t             | t
(2 rows)
```

## A `client_id` that disagrees with the hint

§2 requires the OP to verify a `client_id` sent alongside an
`id_token_hint` against the client the hint was issued to. For a request to
turn on that comparison and nothing else, the client named has to be one
whose registration would otherwise have allowed the redirect — so
`demo-post`, seeded in [A confidential client](./bootstrap.md#a-confidential-client)
above, gets the same value `demo-spa` has — set directly for the reason
[RP-initiated logout](./rp-initiated-logout.md) gives, since the client already
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
  "http://localhost:3000/tenants/demo/protocol/openid-connect/logout"
```

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sign out?</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Sign out?</h1>
<p>Signing out ends this session for every application that uses it.</p>
<form method="post" action="/tenants/demo/protocol/openid-connect/logout">
  <input type="hidden" name="session_id" value="01a0cb1f-d286-…">
  <input type="hidden" name="csrf" value="MvKAEuRTdkFN…">
  <input type="hidden" name="client_id" value="demo-post">
  <button type="submit">Sign out</button>
</form>
</main>
</body>
</html>
```

(`session_id` and `csrf` shortened.) Nothing was ended, and the form carries no
`post_logout_redirect_uri` at all: §4 says information that failed to
validate is not used, so the hint and the redirect it would have
authorised are dropped together. The identical request with
`client_id=demo-spa` — the client the hint names — asks too, but its form
carries the redirect, and posting that form ends the session and
redirects. Both requests ran on the stack at port 3191, the first of them
the one recorded above:

```bash
curl -sS -b cookies-aud.txt -D - -X POST \
  --data-urlencode "id_token_hint=$ID_TOKEN" \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'post_logout_redirect_uri=http://localhost:8080/logged-out' \
  "http://localhost:3191/tenants/demo/protocol/openid-connect/logout" | tee page-aud2.txt \
  | grep -iE '^HTTP|^location|^set-cookie|<title>|name="(session_id|client_id|post_logout_redirect_uri|state)"'

field() { sed -n "s/.*name=.$1. value=.\([^>]*\).>.*/\1/p" page-aud2.txt; }
curl -sS -b cookies-aud.txt -D - -o /dev/null -X POST \
  --data-urlencode "session_id=$(field session_id)" --data-urlencode "csrf=$(field csrf)" \
  --data-urlencode "client_id=$(field client_id)" \
  --data-urlencode "post_logout_redirect_uri=$(field post_logout_redirect_uri)" \
  "http://localhost:3191/tenants/demo/protocol/openid-connect/logout"
```

```
HTTP/1.1 200 OK
<title>Sign out?</title>
  <input type="hidden" name="session_id" value="01a17cce-cf3d-7052-b595-f9a435dd3677">
  <input type="hidden" name="client_id" value="demo-spa">
  <input type="hidden" name="post_logout_redirect_uri" value="http://localhost:8080/logged-out">
HTTP/1.1 302 Found
x-request-id: 01a17cce-cfbe-7e72-8e9b-cc4a606a24a1
set-cookie: demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
cache-control: no-store
location: http://localhost:8080/logged-out
content-length: 0
Date: Tue, 27 Oct 2026 10:01:30 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

(`field` is redefined to read `page-aud2.txt` before the second request. The `session_id` is the one the `demo-post` request's form
carried too: the disagreeing hint was dropped, and the page asked about the
browser's own session.)

## Front-channel and back-channel logout

[OpenID Connect Front-Channel Logout 1.0](https://github.com/wizzywit/odudu/blob/main/docs/protocols/oidc-frontchannel.md)
asks the OP to render, on the page it shows after ending a session, one
`<iframe>` per client that registered a `frontchannel_logout_uri` and held
a grant under that session. [Back-Channel Logout 1.0](https://github.com/wizzywit/odudu/blob/main/docs/protocols/oidc-backchannel.md)
asks it to also `POST` a signed Logout Token to every client that
registered a `backchannel_logout_uri` and held a grant under that session.
`seed client` has no flag for either URI (see
[the roadmap](../../../roadmap.md#decided-against-and-why)'s entry on `odudu seed`),
so a second client is seeded and given both directly, the same way
`post_logout_redirect_uris` was set above.
`PATCH /admin/tenants/{tenant}/clients/{id}` sets both, revalidating them
the way registration does — a `frontchannel_logout_uri` that shares no
registered redirect URI's origin is refused `400` there
([Admin paths](../admin-paths/patch-clientsid.md)):

```bash
odudu seed client \
  --tenant demo --client-id reports-widget --client-secret reports-widget-secret \
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

(`http://localhost:9100` is for reachability in this local walkthrough only.
`isValidLogoutUri` refuses `http` unconditionally for a URI registered through
dynamic registration or `seed client` — see [the front-channel logout reading
note](https://github.com/wizzywit/odudu/blob/main/docs/protocols/oidc-frontchannel.md)'s
clause table — and this direct `UPDATE` is the one path in this document that
bypasses that check entirely, the same way it bypasses the
domain/port/scheme-matching check on `frontchannel_logout_uri` itself.)

Signing in as [Path A](./path-a-authorization-code-with-pkce.md) does, then
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
  "http://localhost:3000/tenants/demo/protocol/openid-connect/auth"

curl -sS \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$RW_CODE" \
  --data-urlencode 'redirect_uri=http://localhost:9100/callback' \
  --data-urlencode 'client_id=reports-widget' \
  --data-urlencode "code_verifier=$VERIFIER" \
  -u reports-widget:reports-widget-secret \
  "http://localhost:3000/tenants/demo/protocol/openid-connect/token"
```

Ending that session with no `post_logout_redirect_uri` at all — the branch
that renders the signed-out page rather than redirecting away from it —
takes the two steps every logout takes here. The `GET` asks, on the stack at
port 3191, and the page it answers carries no redirect:

```bash
curl -sS -b cookies.txt -D - --get \
  --data-urlencode "id_token_hint=$ID_TOKEN" \
  "http://localhost:3191/tenants/demo/protocol/openid-connect/logout" | tee page.txt \
  | grep -iE '^HTTP|^set-cookie|<title>|name="(session_id|client_id|post_logout_redirect_uri|state)"'
```

```
HTTP/1.1 200 OK
<title>Sign out?</title>
  <input type="hidden" name="session_id" value="01a17cee-581f-7efc-a8ca-e10d67b741b9">
  <input type="hidden" name="client_id" value="demo-spa">
```

The form posted back, with every hidden field it carries, ends the session and now
frames `reports-widget`:

```bash
field() { sed -n "s/.*name=.$1. value=.\([^>]*\).>.*/\1/p" page.txt; }
curl -sS -b cookies.txt -i -X POST \
  --data-urlencode "session_id=$(field session_id)" --data-urlencode "csrf=$(field csrf)" \
  --data-urlencode "client_id=$(field client_id)" \
  "http://localhost:3191/tenants/demo/protocol/openid-connect/logout"
```

```
HTTP/1.1 200 OK
set-cookie: demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; frame-src http://localhost:9100
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 974
```

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Signed out</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Signed out</h1>
<p>You have been signed out.</p>
<iframe src="http://localhost:9100/logout?iss=http%3A%2F%2Flocalhost%3A3191%2Ftenants%2Fdemo&amp;sid=01a17cee-581f-…"></iframe>
</main>
</body>
</html>
```

(`sid` shortened; it is the id half of the session cookie's entry, and `iss` is
this tenant's issuer. `field` is redefined to read
`page.txt` in the block above. From the same stack at `http://localhost:3191`, with the two
commands above run against it and `x-request-id`, `Date` and the keep-alive
headers omitted.) `sid` is present because `reports-widget` registered
`frontchannel_logout_session_required`; a client that had not would be framed
with `iss` alone. `demo-spa` itself is not framed here — it registered no
`frontchannel_logout_uri` at all, and §2's own rule is that a client without one
is not framed and contributes no origin, which `frame-src` above bears out: it
names `reports-widget`'s origin and nothing else.

**This is an attempt, not a delivered notification.** The iframe's response is
never read back, and whether `reports-widget` ever sees the request depends on
browser behaviour this OP does not control: A spike found that a cookie with no
explicit `SameSite` is never sent on this framed cross-site request at all, in
every browser tested, and a cookie that opts in with `SameSite=None; Secure` is
still subject to third-party-cookie blocking that Safari and Firefox apply by
default and Chrome allows a user or administrator to apply. ADR 0034 has the
full reasoning.

**Back-channel logout is a server-to-server `POST`, so none of that applies to
it — but it went through the same logout above**, because `reports-widget`
registered `backchannel_logout_uri` alongside `frontchannel_logout_uri` in the
`UPDATE` further up, and ending a session enqueues a delivery for every client
that registered either. This sub-section's own commands were re-run against a
fresh session on the same compose stack (per [Bootstrap](./bootstrap.md)),
started with `ODUDU_LOGOUT_SENDER_ENABLED=false` on the environment so the
one-shot command below is what claims the row, not the server's own schedule.
Queried straight after that same logout:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    SELECT c.client_id, d.endpoint, d.attempts, d.delivered_at, d.last_error
    FROM backchannel_logout_deliveries d JOIN clients c ON c.id = d.client_id
    WHERE c.client_id = 'reports-widget' AND d.endpoint LIKE '%127.0.0.1%';
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
own schedule or as the one-shot command below:

```bash
odudu send-logouts
```

```
{"ran":true,"delivered":0,"failed":1}
```

**Ending a session tells the relying parties that were part of it.** A
session that ends enqueues one back-channel Logout Token per client that
registered a `backchannel_logout_uri` and used the session, and a third
pass, `send-logouts`, delivers them — every `ODUDU_LOGOUT_SENDER_INTERVAL_SECONDS`
(default `15`) plus a tenth as jitter, or as the one-shot command above. It
reports the same shape `send-mail` does: `{"ran":true,"delivered":N,"failed":N}`,
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

Querying the same row again shows why, in the queue's own words:

```
   client_id    |              endpoint              | attempts | delivered_at |               last_error
----------------+------------------------------------+----------+--------------+-----------------------------------------
 reports-widget | https://127.0.0.1:9443/backchannel |        1 |              | address 127.0.0.1 is a loopback address
(1 row)
```

`assertPublicAddress` refuses `127.0.0.0/8` unconditionally, ahead of any
override — the same guard `clientKeySet`'s `jwks_uri` fetch uses (ADR 0028).
`attempts` reads `1`: `claimDue` spends the attempt when it claims the row, and
`markFailed` records only the error and when the row is next due, so
`BACKCHANNEL_LOGOUT_MAX_ATTEMPTS` is the number of times a token is really
offered. The pass and this second query are from after `markFailed` stopped
spending a second attempt: `reports-widget` created in its `demo` through `POST
/clients` with this back-channel URI, `ada` signed in through it and signed out
through the confirmation page, as [One sign-in's audit
trail](./one-sign-ins-audit-trail-read-through-the-admin-api.md) does, then the
same query, which answered the first query's row above byte for byte, the same
pass and the same query again.

**A private-range address is a different branch of that same guard, and one an
operator can open.** `ODUDU_ALLOW_PRIVATE_CLIENT_URLS` — already read at boot
for `jwks_uri` — now reaches `createLogoutDeliveryTransport` too, at both call
sites that build one. With it set, delivery to a real listener actually happens.
Continuing this same stack: the container was recreated with
`ODUDU_ALLOW_PRIVATE_CLIENT_URLS=true` on the environment (`docker compose up
-d`), a plain Node `https` listener was started on this host's own LAN address
(`192.168.1.71:9444`, standing in for a relying party — a private address is
exactly what this variable exists to admit; a _public_ one needs no such
override), its self-signed certificate was copied into the container (`docker cp
cert.pem docker-odudu-1:/tmp/listener-cert.pem`), and `reports-widget`'s
`backchannel_logout_uri` was pointed at it instead:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    UPDATE client_oidc_config SET backchannel_logout_uri = 'https://192.168.1.71:9444/backchannel'
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

(Node also writes a `DeprecationWarning` to stderr about a TLS server name
that is an IP address, left out here as the `ExperimentalWarning` lines are.)
The listener's own log shows the request actually arrived:

```
POST /backchannel content-type=application/x-www-form-urlencoded body=logout_token=eyJhbGciOiJSUzI1NiIsImtpZCI6IjAxYTBjYjA3LTRlNzMtN2M1NS04Y2Y2LTRkMTY1OTVmN2EyOCIsInR5cCI6ImxvZ291dCtqd3QifQ.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAvdGVuYW50cy9kZW1vIiwiYXVkIjoicmVwb3J0cy13aWRnZXQiLCJpYXQiOjE3OTAxMTQzODcsImV4cCI6MTc5MDExNDUwNywianRpIjoiMDFhMGNiMjEtZDdiOS03YmJiLTgwNGItZDE3NmJmZGYzNjdjIiwic3ViIjoiMDFhMGNiMDctNGU3Ni03ZmJlLThkODYtYjdjMDgzMzE5ZWYwIiwic2lkIjoiMDFhMGNiMjEtZDcxMy03Y2NkLWE2NjktYzAxYzFlYjI4ZWU0IiwiZXZlbnRzIjp7Imh0dHA6Ly9zY2hlbWFzLm9wZW5pZC5uZXQvZXZlbnQvYmFja2NoYW5uZWwtbG9nb3V0Ijp7fX19.kki0ioQoGA1xaiCQz-hRNrKyVjqA815Ke5orwat7vTck6A7Ax_jrx8LSlCSCmzHgx7WRtqE2SiA0HmzUQlUFQh0GPzQ7qTzgCI5jrIPCzRqzWUNIzUKprzDBJL6b_FKe5OY4QgshJAxVBmdXRQxr5QW85-INuO90oFqmHQp_kMd7pXEpZpAVdyzqS8STI5Fkq85f-pvImq1UQcZJNwJx39PqwUEf7sY1Bx2ioiQ0L5hOAHL0M_jxZRGExRecy0uhX4zx6WRY6Yw_8-buClwQVPXq6MtPkaZwMJqFS3ijAR0FjmT-c0TE0hz-EgMRIwz8IOpjDvOrfcrot2vJ2b1lBg
```

Its header decodes to `{"alg":"RS256","kid":"01a0cb07-…","typ":"logout+jwt"}`
and its payload to `{"iss":"http://localhost:3000/tenants/demo","aud":"reports-widget",
"iat":1790114387,"exp":1790114507,"jti":"01a0cb21-…","sub":"01a0cb07-…",
"sid":"01a0cb21-…","events":{"http://schemas.openid.net/event/backchannel-logout":{}}}`
— every §2.4 member the clause table claims, on a token this walkthrough's
own listener actually received. The queue shows the same thing from the
other side — the same query as above, scoped to this endpoint instead,
since the refused loopback row is still in the table beside it:

```bash
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "
    SELECT c.client_id, d.endpoint, d.attempts, d.delivered_at, d.last_error
    FROM backchannel_logout_deliveries d JOIN clients c ON c.id = d.client_id
    WHERE c.client_id = 'reports-widget' AND d.endpoint LIKE '%192.168%';
  "
```

```
   client_id    |               endpoint                | attempts |        delivered_at        | last_error
----------------+---------------------------------------+----------+----------------------------+------------
 reports-widget | https://192.168.1.71:9444/backchannel |        1 | 2026-09-22 21:59:48.213+00 |
(1 row)
```

`attempts` reads `1` here, the one offer that was delivered: the claim spends
the attempt, and `markDelivered` records the success.

Discovery now advertises `backchannel_logout_supported`,
`backchannel_logout_session_supported`, `frontchannel_logout_supported`
and `frontchannel_logout_session_supported` — all four unconditionally
`true` for every tenant, since a client opts in per client rather than per
tenant (see [Discovery](./path-a-authorization-code-with-pkce.md#1-discovery) above).

## A matched redirect, after the frames

The redirect used at the top of this document had nobody to tell: `demo-spa`
was the only client with a grant under the session, and it registered no
`frontchannel_logout_uri`, so there was nothing to frame and the answer was a
`302` at once. When another client of the session did register one, the
browser has to load that client's logout address before it leaves, or the
client keeps its own session. The server then answers `200` with the frames
and sends the browser on afterwards.

This section ran on a freshly built stack of its own, published on **port
3191**, seeded only with `demo`, `demo-spa`, `demo-post` and `ada` as
[Bootstrap](./bootstrap.md) does, and with `reports-widget` set up as in the
section above (a front-channel address of `http://localhost:9100/logout`
asking for `sid`). `demo-spa`'s redirect list is the one set at the top of this
document. A session was then signed in as [Path A](./path-a-authorization-code-with-pkce.md)
does, with a grant under each client, exactly as in the section above. The
same request as at the top of this document asks first:

```bash
curl -sS -i -b cookies.txt --get \
  --data-urlencode "id_token_hint=$ID_TOKEN" \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'post_logout_redirect_uri=http://localhost:8080/logged-out' \
  --data-urlencode 'state=xyz-bye' \
  "http://localhost:3191/tenants/demo/protocol/openid-connect/logout" | tee page.txt \
  | grep -iE '^HTTP|^set-cookie|<title>|name="(session_id|client_id|post_logout_redirect_uri|state)"|^content-security'
```

```
HTTP/1.1 200 OK
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' http://localhost:8080; base-uri 'none'
<title>Sign out?</title>
  <input type="hidden" name="session_id" value="01a17cd1-0fcb-798e-a7ae-1f0ea14a9755">
  <input type="hidden" name="client_id" value="demo-spa">
  <input type="hidden" name="post_logout_redirect_uri" value="http://localhost:8080/logged-out">
  <input type="hidden" name="state" value="xyz-bye">
```

The form posted back, with `field` redefined to read `page.txt`,
ends the session:

```bash
field() { sed -n "s/.*name=.$1. value=.\([^>]*\).>.*/\1/p" page.txt; }
curl -sS -i -b cookies.txt -X POST \
  --data-urlencode "session_id=$(field session_id)" --data-urlencode "csrf=$(field csrf)" \
  --data-urlencode "client_id=$(field client_id)" \
  --data-urlencode "post_logout_redirect_uri=$(field post_logout_redirect_uri)" \
  --data-urlencode "state=$(field state)" \
  "http://localhost:3191/tenants/demo/protocol/openid-connect/logout"
```

```
HTTP/1.1 200 OK
set-cookie: demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; script-src 'nonce-tBoid3qMPsW180DrfC603Q=='; frame-src http://localhost:9100
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 1740

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Signed out</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<meta http-equiv="refresh" content="5;url=http://localhost:8080/logged-out?state=xyz-bye">
<h1>Signed out</h1>
<p>You have been signed out. Taking you back to the app.</p>
<p><a id="continue" href="http://localhost:8080/logged-out?state=xyz-bye">Continue</a></p>
<iframe src="http://localhost:9100/logout?iss=http%3A%2F%2Flocalhost%3A3191%2Ftenants%2Fdemo&amp;sid=01a17cd1-0fcb-…"></iframe>
<script nonce="tBoid3qMPsW180DrfC603Q==">
(function () {
  var next = document.getElementById('continue').href;
  var frames = document.querySelectorAll('iframe');
  var pending = frames.length;
  var left = false;
  function leave() { if (!left) { left = true; location.replace(next); } }
  frames.forEach(function (frame) {
    frame.addEventListener('load', function () {
      if (frame.dataset.seen) return;
      frame.dataset.seen = '1';
      pending -= 1;
      if (pending === 0) leave();
    });
  });
  setTimeout(leave, 2000);
})();
</script>
</main>
</body>
</html>
```

(`sid` shortened, and `x-request-id`, `Date` and the keep-alive headers
omitted. The `script-src` nonce is different on every response.) The session
is already ended when this page is sent. The policy licenses the one origin the
page frames and the one script it carries, nothing more. The script waits for
the frame to load, for two seconds at most, then goes to the link on the page,
which is the registered address with `state` added. A browser that does not run
script follows the `refresh` element after five seconds. A frame that never
answers, or a client that is down, costs those two seconds and no more.

Sending the first request again, the `GET` with the hint, finds no session to
end. The address still matches, so the answer is the plain redirect, with no
frames and nothing ended twice:

```bash
curl -sS -i --get -b cookies.txt \
  --data-urlencode "id_token_hint=$ID_TOKEN" \
  --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'post_logout_redirect_uri=http://localhost:8080/logged-out' \
  --data-urlencode 'state=xyz-bye' \
  "http://localhost:3191/tenants/demo/protocol/openid-connect/logout"
```

```
HTTP/1.1 302 Found
cache-control: no-store
location: http://localhost:8080/logged-out?state=xyz-bye
content-length: 0
```

## Offline access

`offline_access` is a scope, seeded into every tenant alongside
`openid`/`profile`/`email` and assigned to `demo-spa` too — the one scope here
assigned `'optional'` rather than `'default'`, which is what lets the consent
screen ([below](#the-consent-screen)) tell it apart from a scope pre-approved
the moment a client is assigned it (it maps no claims either way — see
[Discovery](./path-a-authorization-code-with-pkce.md#1-discovery) above).
`demo-spa`'s own `consent_required` is `false`, because `seed client` leaves it off
unless it is given `--consent-required`
(`PATCH /admin/tenants/{tenant}/clients/{id}` changes it later, without `If-Match`,
being no list field) — so the transcript below reuses without ever seeing that
screen; the consent section demonstrates asking, against an anonymously
self-registered client, whose `consent_required` defaults `true` (ADR 0027, and
the registration section
above). Requesting it produces a grant with no session, which is what nothing
here can expire and no logout can end (OpenID Connect Back-Channel Logout 1.0
§2.7's second sentence, [the back-channel logout reading
note](https://github.com/wizzywit/odudu/blob/main/docs/protocols/oidc-backchannel.md)).
A fresh login, keeping its cookie, redeems one code for a plain `scope=openid`
grant and then reuses the same live session — no new login — to redeem a second
code for `scope=openid offline_access`:

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
  "refresh_token": "nAnQ0qDYIZyOInKkB2H…",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "openid offline_access"
}
```

(All three token values truncated.) The access token, decoded:

```json
{
  "iss": "http://localhost:3000/tenants/demo",
  "sub": "01a0cb07-4e76-…",
  "aud": ["http://localhost:3000/tenants/demo"],
  "client_id": "demo-spa",
  "scope": "openid offline_access",
  "iat": 1790114491,
  "exp": 1790114791,
  "jti": "01a0cb23-6bde-…",
  "grant_id": "01a0cb23-6bde-7b79-83f6-673a0f0a0226"
}
```

No `sid` — every other access token in this document carries one ([the
back-channel logout reading
note](https://github.com/wizzywit/odudu/blob/main/docs/protocols/oidc-backchannel.md)
§2.1), and this is the one grant here with no session for it to name. `grant_id`
carries no such exception; it names the grant itself, not a session, so it is on
this token exactly as it is on every other. The ID token, decoded, is missing
`sid` the same way, but still carries `amr` and `acr`:

```json
{
  "sub": "01a0cb07-4e76-…",
  "iss": "http://localhost:3000/tenants/demo",
  "aud": "demo-spa",
  "iat": 1790114491,
  "exp": 1790114791,
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
curl -sS -b cookies-offline.txt "http://localhost:3000/tenants/demo/protocol/openid-connect/logout"
```

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sign out?</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Sign out?</h1>
<p>Signing out ends this session for every application that uses it.</p>
<form method="post" action="/tenants/demo/protocol/openid-connect/logout">
  <input type="hidden" name="session_id" value="01a0cb23-6b57-…">
  <input type="hidden" name="csrf" value="DVXf1lmDU4DM…">
  <button type="submit">Sign out</button>
</form>
</main>
</body>
</html>
```

(`session_id` and `csrf` shortened, as elsewhere in this document;
`$SESSION_ID` and `$CSRF` below are the two hidden values read from it.)

```bash
curl -sS -b cookies-offline.txt -D - \
  --data-urlencode "session_id=$SESSION_ID" \
  --data-urlencode "csrf=$CSRF" \
  "http://localhost:3000/tenants/demo/protocol/openid-connect/logout"
```

```
HTTP/1.1 200 OK
set-cookie: demo-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 826

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Signed out</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Signed out</h1>
<p>You have been signed out.</p>

</main>
</body>
</html>
```

(`x-request-id`, `Date` and the keep-alive headers are omitted.) The
session-bound refresh token is revoked with it:

```bash
curl -sS \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$BOUND_REFRESH_TOKEN" \
  --data-urlencode 'client_id=demo-spa' \
  "$BASE/token"
```

```json
{ "error": "invalid_grant", "error_description": "The code or token is not valid." }
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
  "refresh_token": "ACz3TGdmqj05ZrH738L…",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "openid offline_access"
}
```

(Both token values truncated.) A session-bound refresh token dies the moment its
session does, whether that session was ended by this logout or by its own idle
timeout expiring underneath it — refresh rotation checks the session's own
liveness, not just the grant's `revoked_at`, for exactly that second case. An
offline grant has neither: no session to end, and no idle window to outlive, so
it is bounded only by its own `refresh_token_ttl_seconds` and by retention (see
[the roadmap](../../../roadmap.md#decided-against-and-why)) —
nothing about ending a session ages it out early. An administrator revokes one
with `DELETE /admin/tenants/{tenant}/subjects/{id}/grants/{clientId}`, or every
grant a client holds with `DELETE /admin/tenants/{tenant}/clients/{id}/grants`
([Admin
paths](../admin-paths/get-subjectsidgrants-and-delete-subjectsidgrantsclientid.md)).
A client is only handed this scope if the tenant's operator assigned it —
`demo-spa` has it because `odudu seed` assigns every default scope,
`offline_access` included, though `'optional'` rather than `'default'`; a
request for it from a client whose assignment was withdrawn between `/authorize`
accepting the request and the code being redeemed gets an ordinary session-bound
grant back instead, since the resolved scope at redemption is the authority, not
the request `/authorize` saw. A client never assigned the scope at all is
refused outright, with `invalid_scope`, before a code is ever issued — the same
rule any other unassigned scope gets (see
[Discovery](./path-a-authorization-code-with-pkce.md#1-discovery) above).

## The consent screen

The scopes it lists are ordered by each scope's `display_order`, then its
name, and each is shown by the scope's `consent_text` where an
administrator gave it one ([the admin paths](../admin-paths/index.md), under
`PATCH /scopes/:id`); the scopes below have neither, so they show by name.

`demo-spa`'s own `consent_required` is `false`, so nothing above ever saw
this screen. It exists for a client whose `consent_required` is `true` —
every anonymously self-registered client (`consent_required` defaults
`true` there, per [Dynamic client registration](./bootstrap.md#dynamic-client-registration)
and ADR 0027) — and for `prompt=consent` on any client at all.

The screen and the reuse and `prompt=none` answers below come from a stack of
its own on `http://localhost:3094`, started on an empty volume, with `demo`
seeded the way [Bootstrap](./bootstrap.md) seeds it. The subsections from "The
client's own pages" on come from an earlier stack, whose transcripts show no
response header. The refused consent and the `prompt=none` refusal were run again
on a later stack, on `http://localhost:3199`, against a client made from the
command line, `odudu seed client --tenant demo --client-id consent-spa --public
--redirect-uri https://rp.example/cb --consent-required`, with `ada` in `demo`;
`$CLIENT_ID` is `consent-spa` there. The `prompt=none` answer follows an Allow
that left `offline_access` unticked, so that scope is the one missing. `client_registration_policy` is `disabled` on `demo` by
default, the same as every tenant, so the anonymously self-registered client
this section needs it open:

```bash
odudu seed tenant --name demo --set client_registration_policy=open
```

```json
{
  "command": "tenant",
  "created": false,
  "tenant": "demo",
  "tenantId": "01a137d6-\u2026",
  "settings": ["client_registration_policy"]
}
```

Then the client itself, with no credential presented — `registration_origin`
is `'anonymous'` and `consent_required` defaults `true` on the row it wrote:

```bash
curl -sS -X POST http://localhost:3094/tenants/demo/clients-registrations/openid-connect \
  -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://rp.example/cb"],"client_name":"Example RP"}'
```

```json
{
  "client_id": "01a137d6-c1b7-76fa-92b1-bb33828ae56f",
  "client_id_issued_at": 1791938183,
  "client_secret": "zEOnBPiO5AnubSnAQ3nQTq_DHRsIvOd4cXTTXEGp-lw",
  "client_secret_expires_at": 0,
  "redirect_uris": ["https://rp.example/cb"],
  "grant_types": ["authorization_code"],
  "token_endpoint_auth_method": "client_secret_basic",
  "client_name": "Example RP"
}
```

A client that requires consent renders the screen once the credentials
that would otherwise complete the login have been accepted — after the
same required-action gate `/authorize`'s form path always enforced, and
before a code is ever issued. PKCE and the parked request are the same
shape [the login POST](./path-a-authorization-code-with-pkce.md#3-the-login-post) uses, against this new client and
`scope=openid profile offline_access`, with `state=xyz-123` and a cookie jar,
`cookies-consent.txt`, kept from `/authorize` onward:

```bash
curl -sS -D - -c cookies-consent.txt -b cookies-consent.txt \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  'http://localhost:3094/tenants/demo/login-actions/authenticate'
```

```
HTTP/1.1 200 OK
x-request-id: 01a137d6-c260-716b-9777-461155c440c8
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' https://rp.example; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 1453
Date: Wed, 14 Oct 2026 00:36:23 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Allow access?</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1><bdi>Example RP</bdi> is asking for access</h1>
<p class="tenant"><bdi>demo</bdi></p>
</header>
<form method="post" action="/tenants/demo/login-actions/consent">
  <input type="hidden" name="auth_session_id" value="01a137d6-c22e-791c-9097-e8d295b70e7f">
  <ul>
  <li><bdi>openid</bdi></li>
  <li><bdi>profile</bdi></li>
  </ul>
  <label><input type="checkbox" name="scope" value="offline_access"> <bdi>offline_access</bdi> — grants ongoing access, even while you are not present</label>
  <button type="submit" name="decision" value="allow">Allow</button>
  <button type="submit" name="decision" value="deny" class="secondary">Deny</button>
</form>
</main>
</body>
</html>
```

No `set-cookie`, no `location`: nothing is established and no code is
issued until the form below is answered. `offline_access` is the one scope
here that carries the explanatory clause OIDC Core §16.18 asks for — every
default scope (`openid`, `profile`) needs no box at all, since the client
was already assigned it without asking. The page's `form-action` names the
client's `https://rp.example` because answering it ends in the redirect
there.

Declining the optional scope narrows what the eventual token carries —
`scope` in the token response omits `offline_access`, not merely "the flow
completed" — and the client's answer is what gets recorded, so the same
request does not ask again. Leaving the checkbox unticked and pressing
Allow:

```bash
curl -sS -D - -c cookies-consent.txt -b cookies-consent.txt \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'decision=allow' \
  'http://localhost:3094/tenants/demo/login-actions/consent'
```

```
HTTP/1.1 302 Found
x-request-id: 01a137d6-c2c7-78cf-8e8d-1b9762557de3
set-cookie: demo-session=01a137d6-c2e4-7f70-8fc3-6dbee704dde9:a-7981Ir1Wexv7gTDwGcUtsV2iJBTzlNF6CaRh_DHds; HttpOnly; SameSite=Lax; Path=/
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/demo/; Max-Age=0
location: https://rp.example/cb?code=NreYk9SzpC5ttZWW-ylIReNrfpOulmUMp4DXbH8_JDk&state=xyz-123&iss=http%3A%2F%2Flocalhost%3A3094%2Ftenants%2Fdemo
content-length: 0
Date: Wed, 14 Oct 2026 00:36:23 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The ID token that code redeems for says how ada authenticated, exactly as a
login with no consent screen would. The consent door reads the factors the
login recorded on its authentication session, and the password that finished
it is one of them:

```bash
curl -sS -X POST http://localhost:3094/tenants/demo/protocol/openid-connect/token \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d grant_type=authorization_code \
  -d code=NreYk9SzpC5ttZWW-ylIReNrfpOulmUMp4DXbH8_JDk \
  --data-urlencode 'redirect_uri=https://rp.example/cb' \
  -d code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

The `id_token`'s payload, decoded:

```json
{
  "sub": "01a137d6-bf12-771f-81fb-97620b5fd349",
  "name": "ada",
  "preferred_username": "ada",
  "iss": "http://localhost:3094/tenants/demo",
  "aud": "01a137d6-c1b7-76fa-92b1-bb33828ae56f",
  "iat": 1791938184,
  "exp": 1791938484,
  "sid": "01a137d6-c2e4-7f70-8fc3-6dbee704dde9",
  "amr": ["pwd"],
  "acr": "1"
}
```

Until 2026-10-05 a login through this screen issued neither claim, because
the factor that finished it was never written down for the consent POST to
read.

Pressing Deny instead answers exactly where a client-side `access_denied`
always does — the request's own `redirect_uri`, not a page — with nothing
established and no code issued. (A fresh parked request, `state=xyz-deny`,
logged in the same way as above — the one that redeemed a code cannot
answer twice.)

```bash
curl -sS -D - \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'decision=deny' \
  'http://localhost:3199/tenants/demo/login-actions/consent'
```

```
HTTP/1.1 302 Found
x-request-id: 01a167e4-dcea-7c79-b582-1b02ba377c8f
location: https://rp.example/cb?error=access_denied&error_description=The+user+did+not+allow+the+request.&state=xyz-deny&iss=http%3A%2F%2Flocalhost%3A3199%2Ftenants%2Fdemo
content-length: 0
Date: Fri, 23 Oct 2026 08:33:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The gate applies to a live SSO session exactly as it does to a fresh login,
which is the reason this section exists rather than being folded into the
login-form walkthrough above: a second `/authorize` request, against the same
cookie, asking for a wider scope than what the first consent recorded, renders
this same screen again rather than reusing the session straight through to a
code — a test named `asks for consent on a reused SSO session, not only on a
fresh login` is the case that would ship broken if the gate lived only on the
form path. The cookie from Allow above (`openid profile`, `offline_access`
declined) asking again with `offline_access` in scope, this time with no login
form in between — the session is still live:

```bash
curl -sS -D - -b cookies-consent.txt --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode 'redirect_uri=https://rp.example/cb' \
  --data-urlencode 'scope=openid profile offline_access' \
  --data-urlencode 'state=xyz-reuse' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  'http://localhost:3094/tenants/demo/protocol/openid-connect/auth'
```

```
HTTP/1.1 200 OK
x-request-id: 01a137d6-c485-73aa-b3c3-824d47fe7178
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' https://rp.example; base-uri 'none'; script-src 'nonce-RGkC4LknpA2uMvjtQxZIHg=='
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 1602
Date: Wed, 14 Oct 2026 00:36:24 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Allow access?</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1><bdi>Example RP</bdi> is asking for access</h1>
<p class="tenant"><bdi>demo</bdi></p>
</header>
<form method="post" action="/tenants/demo/login-actions/consent">
  <input type="hidden" name="auth_session_id" value="01a137d6-c495-744e-aefc-7c457bb799de">
  <ul>
  <li><bdi>openid</bdi></li>
  <li><bdi>profile</bdi></li>
  </ul>
  <label><input type="checkbox" name="scope" value="offline_access"> <bdi>offline_access</bdi> — grants ongoing access, even while you are not present</label>
  <button type="submit" name="decision" value="allow">Allow</button>
  <button type="submit" name="decision" value="deny" class="secondary">Deny</button>
</form>
</main>
<script nonce="RGkC4LknpA2uMvjtQxZIHg==">window.addEventListener('pageshow', function (event) { if (event.persisted) location.reload(); });</script>
</body>
</html>
```

(The same form the login POST produced above under a fresh
`auth_session_id`, with two differences that come from this being a GET: the
policy gains `script-src` naming a nonce, and the one `<script>` carrying it
follows the form, reloading the page if a browser restores it from its cache
— a reload would re-send the POST that produced the page above, so that
page has none. A second `/authorize`, not a POST, is what got here, because
the SSO cookie skipped the login form entirely.) Under
`prompt=none`, that same reused-but-under-consented session is refused
rather than asked, since `prompt=none` forbids the interaction a consent
screen is:

```bash
curl -sS -D - -b cookies-consent.txt --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode 'redirect_uri=https://rp.example/cb' \
  --data-urlencode 'scope=openid profile offline_access' \
  --data-urlencode 'state=xyz-reuse' \
  --data-urlencode 'prompt=none' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  'http://localhost:3199/tenants/demo/protocol/openid-connect/auth'
```

```
HTTP/1.1 302 Found
x-request-id: 01a167e4-f9ca-701f-a03b-dcf5e4dad8b7
location: https://rp.example/cb?error=consent_required&error_description=The+user+has+not+agreed+to+this+request+yet.&state=xyz-reuse&iss=http%3A%2F%2Flocalhost%3A3199%2Ftenants%2Fdemo
content-length: 0
Date: Fri, 23 Oct 2026 08:33:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

### The client's own pages

A client that registered RFC 7591's `client_uri`, `policy_uri` or `tos_uri` has
each linked under its name, so the End-User can read them before answering.
Every link is escaped through the renderer's own `escapeHtml`, attribute and
text alike, and the page's policy is the one every continuing page sends: a link
is a navigation, which `default-src 'none'` does not govern. On the earlier
stack named above, with a tenant of its own, `email-demo`, holding `grace`
(`odudu seed tenant --name email-demo`, then `odudu seed user` with an address),
`$ADMIN_TOKEN` got the way [the admin
paths](../admin-paths/getting-the-token.md) shows, and a public client created
through the admin API for it:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"client_id": "billing-spa", "name": "Billing & Co", "token_endpoint_auth_method": "none", "redirect_uris": ["http://localhost:8080/callback"], "consent_required": true, "client_uri": "https://billing.example/about?from=consent&lang=en", "policy_uri": "https://billing.example/privacy", "tos_uri": "https://billing.example/terms"}' \
  http://localhost:3086/admin/tenants/email-demo/clients \
  | jq -c '{client_id, name, consent_required, client_uri, policy_uri, tos_uri}'
PAGE=$(curl -sS 'http://localhost:3086/tenants/email-demo/protocol/openid-connect/auth?response_type=code&client_id=billing-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&state=s&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256')
AUTH_SESSION_ID=$(echo "$PAGE" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)
curl -sS -D - \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=grace' \
  --data-urlencode 'password=correct-horse-battery' \
  http://localhost:3086/tenants/email-demo/login-actions/authenticate \
  | tr -d '\r' | sed -n '1p;/^content-security-policy/p;/<h1>/,/<form/p'
```

```
{"client_id":"billing-spa","name":"Billing & Co","consent_required":true,"client_uri":"https://billing.example/about?from=consent&lang=en","policy_uri":"https://billing.example/privacy","tos_uri":"https://billing.example/terms"}
HTTP/1.1 200 OK
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' http://localhost:8080; base-uri 'none'
<h1><bdi>Billing &amp; Co</bdi> is asking for access</h1>
<p class="tenant"><bdi>email-demo</bdi></p>
</header>
<p><a href="https://billing.example/about?from=consent&amp;lang=en">About <bdi>Billing &amp; Co</bdi></a> · <a href="https://billing.example/privacy">Privacy policy</a> · <a href="https://billing.example/terms">Terms of service</a></p>
<form method="post" action="/tenants/email-demo/login-actions/consent">
```

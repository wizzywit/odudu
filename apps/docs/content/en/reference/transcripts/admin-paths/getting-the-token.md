---
title: 'Getting the token'
description: 'odudu seed admin creates the system tenant, its odudu-admin client and its signing key, and a subject holding tenant-admin there — which composites…'
---

# Getting the token

`odudu seed admin` creates the `system` tenant, its `odudu-admin` client
and its signing key, and a subject holding `tenant-admin` there — which
composites every capability plus `manage-tenants`, so this one subject
reaches every route in the table above, in every tenant.

From an empty volume with a console key made for it, so its `ada`, password,
code and cookie are that run's own and name nothing in the sections after it:

```bash
docker compose -p odudu-docs-12b exec -T odudu node dist/main.js seed admin --username ada
```

```
fYR3GHYEwNL7mFD-3X4_RvfYFqZve2_1
This password is shown once and cannot be retrieved again.
{"command":"admin","tenantId":"0199aa00-0000-7000-8000-000000000001","username":"ada","subjectId":"01a1203a-f86d-7e8e-a537-e39f5d77b04f"}
```

`odudu-admin` is a **confidential client** while the console is on: it holds no
secret and authenticates at `/token` with an assertion signed by the key in
`ODUDU_CONSOLE_CLIENT_KEY` ([Run it from a checkout](../../../contributing/run-from-a-checkout.md) has the console's key). The row the
seed just wrote shows it, as the database owner, scoped to the `system`
tenant:

```bash
docker compose -p odudu-docs-12b exec -T postgres psql -U odudu -d odudu -c \
  "select k.client_id, k.type, k.secret_hash is null as no_secret_hash, c.token_endpoint_auth_method, jsonb_array_length(c.jwks->'keys') as keys, c.jwks->'keys'->0->>'kid' as kid from clients k join client_oidc_config c on c.client_id = k.id join tenants t on t.id = k.tenant_id where t.name = 'system' and k.client_id = 'odudu-admin';"
```

```
  client_id  |     type     | no_secret_hash | token_endpoint_auth_method | keys |                     kid
-------------+--------------+----------------+----------------------------+------+---------------------------------------------
 odudu-admin | confidential | t              | private_key_jwt            |    1 | lYibdzdNfYB4SVGy-ZQYkvsm0bDUZp6lFv0ZePKgWkM
(1 row)
```

The loopback flow starts the way any authorization code flow does. The
`jar` holds the cookies from here on, and the PKCE verifier is RFC 7636
Appendix B's, whose challenge is below:

```bash
curl -sS -c jar -b jar -o authorize.html \
  'http://localhost:3082/tenants/system/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=http%3A%2F%2F127.0.0.1%3A8080%2Fcallback&scope=openid&state=s&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
curl -sS -c jar -b jar -o change.html \
  --data-urlencode "auth_session_id=$(grep -o 'name="auth_session_id" value="[^"]*"' authorize.html | head -1 | sed 's/.*value="//;s/"//')" \
  --data-urlencode username=ada --data-urlencode 'password=fYR3GHYEwNL7mFD-3X4_RvfYFqZve2_1' \
  http://localhost:3082/tenants/system/login-actions/authenticate
```

The subject is created with an `update-password` required action, so the
first `authorize`/login round trip does not end in a redirect. It ends on
the change-password page, `change.html`, whose form carries the same
`auth_session_id` the login form did:

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Change your password</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Change your password</h1>
<p class="tenant"><bdi>system</bdi></p>
</header>
<p>This account needs a new password before you can continue.</p>
<form method="post" action="/tenants/system/login-actions/required-action?action=update-password">
  <input type="hidden" name="auth_session_id" value="01a1203b-3d92-7736-aa5e-d291255eace5">
  <label>New password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-describedby="password-rules-list"></label>
  <div class="rules hint" id="password-rules" data-min="15" data-summary="{met} of {total} rules met">
    <p class="rules-head"><span>Your password needs:</span> <button type="button" class="quiet" hidden aria-controls="password" aria-pressed="false">Show password</button> <span role="status"></span></p>
    <ul id="password-rules-list">
      <li data-rule="length">At least 15 characters</li>
      <li>Not a common password</li>
    </ul>
  </div>
  <script nonce="7md+1DAiwQPvGU9En6HBTA==">(function () {
  var box = document.getElementById('password-rules');
  var field = document.getElementById('password');
  if (!box || !field) return;
  var rows = Array.from(box.querySelectorAll('li[data-rule]'));
  var min = Number(box.getAttribute('data-min'));
  var tests = {
    length: function (v) { return Array.from(v.normalize('NFC')).length >= min; },
    digit: function (v) { return /\d/u.test(v); },
    uppercase: function (v) { return /[A-Z]/u.test(v); },
    lowercase: function (v) { return /[a-z]/u.test(v); },
    special: function (v) { return /[^A-Za-z0-9]/u.test(v); }
  };
  var status = box.querySelector('[role=status]');
  var timer;
  function check() {
    return rows.filter(function (row) {
      var ok = tests[row.getAttribute('data-rule')](field.value);
      row.setAttribute('data-met', String(ok));
      return ok;
    }).length;
  }
  field.addEventListener('input', function () {
    var met = check();
    clearTimeout(timer);
    timer = setTimeout(function () {
      status.textContent = box.getAttribute('data-summary').replace('{met}', met).replace('{total}', rows.length);
    }, 800);
  });
  check();
  var toggle = box.querySelector('button');
  toggle.hidden = false;
  toggle.addEventListener('click', function () {
    var show = field.type === 'password';
    field.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
  });
})();</script>
  <button type="submit">Update password</button>
</form>
</main>
</body>
</html>
```

Submitting it **ends in the redirect**: the password the login form already
accepted is not asked for again, and with nothing else owed the parked
login completes:

```bash
curl -sS -D - -c jar -b jar -o /dev/null \
  --data-urlencode "auth_session_id=01a1203b-3d92-7736-aa5e-d291255eace5" \
  --data-urlencode 'password=correct-horse-battery-staple-9' \
  'http://localhost:3082/tenants/system/login-actions/required-action?action=update-password'
```

```
HTTP/1.1 302 Found
x-request-id: 01a1203b-533a-7119-94ff-8e90304357b2
set-cookie: system-session=01a1203b-5383-79a0-892a-1da6060f57f0:AwhbliF-ogxYzIWVNx7EtXc3LSGLG6tess9MT_vLbnU; HttpOnly; SameSite=Lax; Path=/
set-cookie: system-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/system/; Max-Age=0
location: http://127.0.0.1:8080/callback?code=uNtx2kbG23_7tdxFwbLiFIPfeWGfj2HGKG-mqC3XSYs&state=s&iss=http%3A%2F%2Flocalhost%3A3082%2Ftenants%2Fsystem
content-length: 0
Date: Fri, 09 Oct 2026 10:35:21 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The cookie's value is `<session id>:<secret>`. The id half is the `sid`
the token below carries, so every client that receives a token holds it;
only the secret, which the server keeps as a sha256 hash, signs anybody in.

The code redeems at `/token` the way any `authorization_code` does — **but
the client is confidential, so a code alone is worth nothing there**. Posted
with the verifier and no client authentication, it is refused, whoever
holds it:

```bash
curl -sS -D - \
  --data-urlencode grant_type=authorization_code \
  --data-urlencode 'code=uNtx2kbG23_7tdxFwbLiFIPfeWGfj2HGKG-mqC3XSYs' \
  --data-urlencode redirect_uri=http://127.0.0.1:8080/callback \
  --data-urlencode client_id=odudu-admin \
  --data-urlencode code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk \
  http://localhost:3082/tenants/system/protocol/openid-connect/token
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1203b-7384-7591-a64d-25b92f53f7ce
vary: Origin
www-authenticate: Basic realm="token"
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 78
Date: Fri, 09 Oct 2026 10:35:29 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"invalid_client","error_description":"Client authentication failed."}
```

What does authenticate it is an RFC 7523 assertion, signed with the console's
key by whoever holds it. `odudu console assertion --tenant <name>` prints one
(`iss` and `sub` the client, `aud` the tenant's token endpoint, a minute's
lifetime, a `jti` the server remembers). Its two decoded segments, then the
same code redeemed with it. The refusal above spent nothing: the code is
still good. Token strings are cut to their first 24 characters and an
ellipsis, one of two places here where a block is not the bytes on the wire:

```bash
ASSERTION=$(docker compose -p odudu-docs-12b exec -T odudu node dist/main.js console assertion --tenant system)
curl -sS -D - \
  --data-urlencode grant_type=authorization_code \
  --data-urlencode 'code=uNtx2kbG23_7tdxFwbLiFIPfeWGfj2HGKG-mqC3XSYs' \
  --data-urlencode redirect_uri=http://127.0.0.1:8080/callback \
  --data-urlencode client_id=odudu-admin \
  --data-urlencode code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk \
  --data-urlencode client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer \
  --data-urlencode "client_assertion=$ASSERTION" \
  http://localhost:3082/tenants/system/protocol/openid-connect/token
```

```
{"alg":"ES256","kid":"lYibdzdNfYB4SVGy-ZQYkvsm0bDUZp6lFv0ZePKgWkM"}
{"iss":"odudu-admin","sub":"odudu-admin","aud":"http://localhost:3082/tenants/system/protocol/openid-connect/token","iat":1791542130,"exp":1791542190,"jti":"d006a56d-23ae-4398-985a-c4a2edf9df3b"}
```

```
HTTP/1.1 200 OK
x-request-id: 01a1203b-76b3-758f-9aab-e551eaf77680
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 1305
Date: Fri, 09 Oct 2026 10:35:30 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"access_token":"eyJhbGciOiJFUzI1NiIsImtp…","id_token":"eyJhbGciOiJFUzI1NiIsImtp…","refresh_token":"VhmsJmaRSWDOs27jKjGz8d5W…","token_type":"Bearer","expires_in":300,"scope":"openid"}
```

The access token's `aud` carries `urn:odudu:params:admin-api` **without the
request asking for it** — it comes from the client's own registered
`audiences`, which `provisionAdminClient` sets, so no `resource` parameter
is involved. The block below is that token's payload, base64url-decoded and
indented — the other, because the bytes on the wire are a signed JWT:

```
{
  "iss": "http://localhost:3082/tenants/system",
  "sub": "01a1203a-f86d-7e8e-a537-e39f5d77b04f",
  "aud": ["urn:odudu:params:admin-api", "http://localhost:3082/tenants/system"],
  "client_id": "odudu-admin",
  "scope": "openid",
  "iat": 1791542130,
  "exp": 1791542430,
  "jti": "01a1203b-76ee-770f-a30e-ad9c67688ecf",
  "sid": "01a1203b-5383-79a0-892a-1da6060f57f0",
  "grant_id": "01a1203b-76ed-7f8b-94ad-a0175049233a"
}
```

`expires_in` is 300 seconds, so a capture session longer than five minutes
refreshes with the `refresh_token` the same response carried — presenting its
own assertion, since a refresh authenticates the client the way the exchange
did. The probe that says the token works at all:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/system/whoami
```

```
{"subjectId":"01a1203a-f86d-7e8e-a537-e39f5d77b04f","issuerTenantId":"0199aa00-0000-7000-8000-000000000001","capabilities":["manage-clients","manage-keys","manage-sessions","manage-tenant","manage-tenants","manage-users","view-audit","view-users"],"crossTenant":false}
```

## The admin client itself

Its representation, read back through the route the clients section describes,
with the same token. The filter is the exact `client_id`, so the page holds the
one client whatever else the tenant holds. `type` is `confidential` and
`token_endpoint_auth_method` is `private_key_jwt`; `jwks` is the console's
public key, the only half of it the server ever stores, and `kid` is its RFC
7638 thumbprint. There is no `client_secret` anywhere in the tenant for it, and
`service_subject_id` is `null` because it holds no `client_credentials` grant:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/system/clients?client_id_exact=odudu-admin'
```

```
HTTP/1.1 200 OK
x-request-id: 01a18711-d218-77c4-b1d8-6360bd647bd2
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 2337
Date: Thu, 29 Oct 2026 09:50:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a18700-83c9-7a02-9b62-8d1956b09dae","client_id":"odudu-admin","name":"Odudu administration","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":true,"registration_origin":"seeded","created_at":"2026-10-29T09:32:00.298Z","redirect_uris":["http://127.0.0.1:8080/callback","http://localhost:3000/console/auth/callback"],"grant_types":["authorization_code","refresh_token"],"token_endpoint_auth_method":"private_key_jwt","audiences":["urn:odudu:params:admin-api"],"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":["http://localhost:3000/console/"],"jwks":{"keys":[{"x":"aGq8ehE1zvB68TgqZayK_lkYRNm0vA6h952baJXQc8U","y":"oQ9TfiTytJOTeGH_4qdFyVQuZmlfg5GW_7ZokhBYvWg","alg":"ES256","crv":"P-256","kid":"ryDJgLR1j3NaIONgY2PD1W3iDMdkhNlsu0lel927CAs","kty":"EC","use":"sig"}]},"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":true,"service_subject_id":null,"scopes":[{"id":"01a18700-83bd-76f6-a2a7-70ced4e4abf2","name":"address","assignment":"default"},{"id":"01a18700-83bb-7112-9735-909d94d1e229","name":"email","assignment":"default"},{"id":"01a18700-83c2-7e44-8e66-1ec4637698d6","name":"groups","assignment":"default"},{"id":"01a18700-83c4-7e0a-98dc-3b43107bec46","name":"offline_access","assignment":"optional"},{"id":"01a18700-83b6-71ce-a672-044f5dafa16b","name":"openid","assignment":"default"},{"id":"01a18700-83bf-7e2f-9497-b80e83196a40","name":"phone","assignment":"default"},{"id":"01a18700-83b9-7763-81a3-1b3b2b7f13e1","name":"profile","assignment":"default"},{"id":"01a18700-83c1-71e5-8f1a-d3d9d8b75354","name":"roles","assignment":"default"}],"service_account_admin_reach":[]}]}
```

The command above names port `3000`, not `3082` like the rest of this page. This one block was run again on a
throwaway stack on that port (see [how the transcripts were made](../../../contributing/transcripts.md)), so the
`redirect_uris` and `post_logout_redirect_uris` in its output name that port and its ids are that run's.

The tenant cannot change how it authenticates. Neither the method nor the
keys are among the fields the built-in client may be amended in, so an
administrator cannot swap in a key of their own, and a secret has nothing to
rotate:

```bash
curl -sS -D - -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "If-Match: $ETAG" -H 'content-type: application/json' \
  -d '{"token_endpoint_auth_method":"none"}' \
  http://localhost:3082/admin/tenants/system/clients/01a1203a-f7c6-76b2-89fa-7c51f3507f28
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/system/clients/01a1203a-f7c6-76b2-89fa-7c51f3507f28/secret
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1203b-ac86-7611-a96e-476b75ec60d5
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 274
Date: Fri, 09 Oct 2026 10:35:44 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"token_endpoint_auth_method on odudu-admin, this tenant's built-in admin client, is not amendable: it could leave every administrator of this tenant locked out","instance":"01a1203b-ac86-7611-a96e-476b75ec60d5"}
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1203b-ac3d-74c8-b0e4-58050288746e
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 188
Date: Fri, 09 Oct 2026 10:35:44 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"a client that authenticates with private_key_jwt has no secret to rotate","instance":"01a1203b-ac3d-74c8-b0e4-58050288746e"}
```

The key rotates from outside the API, with `odudu console provision`: the
the section [Rotating the console's key](#rotating-the-consoles-key) below.

## Converting a public admin client

A tenant seeded with the console off holds a public `odudu-admin`, as every
tenant did before the console existed; `odudu console provision` makes it
confidential, registering the console's key on it, and a second run writes
nothing. A second tenant, `legacy`, seeded with `ODUDU_CONSOLE=false` for this
one command, beside `system`:

```bash
docker compose -p odudu-docs-12b exec -T -e ODUDU_CONSOLE=false odudu node dist/main.js seed tenant --name legacy
docker compose -p odudu-docs-12b exec -T postgres psql -U odudu -d odudu -c \
  "select t.name, k.type, k.secret_hash is null as no_secret_hash, c.token_endpoint_auth_method, c.jwks->'keys'->0->>'kid' as kid, c.redirect_uris from clients k join client_oidc_config c on c.client_id = k.id join tenants t on t.id = k.tenant_id where t.name in ('system', 'legacy') and k.client_id = 'odudu-admin' order by t.name;"
```

```
{"command":"tenant","created":true,"tenant":"legacy","tenantId":"01a12041-7d62-7faa-a947-917341aa4f5a"}
```

```
  name  |     type     | no_secret_hash | token_endpoint_auth_method |                     kid                     |                                redirect_uris
--------+--------------+----------------+----------------------------+---------------------------------------------+------------------------------------------------------------------------------
 legacy | public       | t              | none                       |                                             | {http://127.0.0.1:8080/callback}
 system | confidential | t              | private_key_jwt            | lYibdzdNfYB4SVGy-ZQYkvsm0bDUZp6lFv0ZePKgWkM | {http://127.0.0.1:8080/callback,http://localhost:3082/console/auth/callback}
(2 rows)
```

The command, then the same query. `legacy` is confidential, holds the console's
key and carries the console's redirect URI beside the loopback one, and `system`
is as it was:

```bash
docker compose -p odudu-docs-12b exec -T odudu node dist/main.js console provision
```

```
provisioned 2 tenants
```

```
  name  |     type     | no_secret_hash | token_endpoint_auth_method |                     kid                     |                                redirect_uris
--------+--------------+----------------+----------------------------+---------------------------------------------+------------------------------------------------------------------------------
 legacy | confidential | t              | private_key_jwt            | lYibdzdNfYB4SVGy-ZQYkvsm0bDUZp6lFv0ZePKgWkM | {http://127.0.0.1:8080/callback,http://localhost:3082/console/auth/callback}
 system | confidential | t              | private_key_jwt            | lYibdzdNfYB4SVGy-ZQYkvsm0bDUZp6lFv0ZePKgWkM | {http://127.0.0.1:8080/callback,http://localhost:3082/console/auth/callback}
(2 rows)
```

"Nothing" is checked rather than claimed. `xmin` is the id of the transaction
that last wrote a row, so a pass that writes nothing leaves it alone. Read
after the first run, then after a second:

```bash
docker compose -p odudu-docs-12b exec -T postgres psql -U odudu -d odudu -c \
  "select t.name, k.xmin::text as client_row, c.xmin::text as config_row from clients k join client_oidc_config c on c.client_id = k.id join tenants t on t.id = k.tenant_id where t.name in ('system', 'legacy') and k.client_id = 'odudu-admin' order by t.name;"
docker compose -p odudu-docs-12b exec -T odudu node dist/main.js console provision
docker compose -p odudu-docs-12b exec -T postgres psql -U odudu -d odudu -c \
  "select t.name, k.xmin::text as client_row, c.xmin::text as config_row from clients k join client_oidc_config c on c.client_id = k.id join tenants t on t.id = k.tenant_id where t.name in ('system', 'legacy') and k.client_id = 'odudu-admin' order by t.name;"
```

```
  name  | client_row | config_row
--------+------------+------------
 legacy | 782        | 782
 system | 757        | 757
(2 rows)
```

```
provisioned 2 tenants
```

```
  name  | client_row | config_row
--------+------------+------------
 legacy | 782        | 782
 system | 757        | 757
(2 rows)
```

## Rotating the console's key

The four steps, on the same two tenants, with `$A` the key the server
runs on and `$B` the one `console keygen` printed (cut to its first 60
characters here, which is the variable's name and the first 35 of the key's; the
line is the whole configuration entry). The query reads each tenant's registered
key set:

```bash
docker compose -p odudu-docs-12b exec -T odudu node dist/main.js console keygen
docker compose -p odudu-docs-12b exec -T postgres psql -U odudu -d odudu -c \
  "select t.name, jsonb_array_length(c.jwks->'keys') as keys, c.jwks->'keys'->0->>'kid' as first_kid, c.jwks->'keys'->1->>'kid' as second_kid from client_oidc_config c join clients k on k.id = c.client_id join tenants t on t.id = k.tenant_id where k.client_id = 'odudu-admin' order by 1;"
```

```
ODUDU_CONSOLE_CLIENT_KEY=eyJrdHkiOiJFQyIsIngiOiJ3N01waUxUaWZ
```

```
  name  | keys |                  first_kid                  | second_kid
--------+------+---------------------------------------------+------------
 legacy |    1 | lYibdzdNfYB4SVGy-ZQYkvsm0bDUZp6lFv0ZePKgWkM |
 system |    1 | lYibdzdNfYB4SVGy-ZQYkvsm0bDUZp6lFv0ZePKgWkM |
(2 rows)
```

Step 1, before any server signs with `$B`: the pass with `$B` current and `$A`
the key it replaces. Both are registered, the signing key first, so a gateway
still signing with `$A` is accepted, and so is one that has been rolled:

```bash
docker compose -p odudu-docs-12b exec -T -e ODUDU_CONSOLE_CLIENT_KEY=$B -e ODUDU_CONSOLE_CLIENT_KEY_PREVIOUS=$A \
  odudu node dist/main.js console provision
```

```
provisioned 2 tenants
```

```
  name  | keys |                  first_kid                  |                 second_kid
--------+------+---------------------------------------------+---------------------------------------------
 legacy |    2 | eI17EP1c344tSxqMmlBFXFhaedH7qc5F7KS2GFMv3i8 | lYibdzdNfYB4SVGy-ZQYkvsm0bDUZp6lFv0ZePKgWkM
 system |    2 | eI17EP1c344tSxqMmlBFXFhaedH7qc5F7KS2GFMv3i8 | lYibdzdNfYB4SVGy-ZQYkvsm0bDUZp6lFv0ZePKgWkM
(2 rows)
```

Steps 2 and 3, the roll and a second pass, are the same command and are not
repeated. Step 4, `ODUDU_CONSOLE_CLIENT_KEY_PREVIOUS` unset, drops `$A` from
every tenant:

```bash
docker compose -p odudu-docs-12b exec -T -e ODUDU_CONSOLE_CLIENT_KEY=$B \
  odudu node dist/main.js console provision
```

```
provisioned 2 tenants
```

```
  name  | keys |                  first_kid                  | second_kid
--------+------+---------------------------------------------+------------
 legacy |    1 | eI17EP1c344tSxqMmlBFXFhaedH7qc5F7KS2GFMv3i8 |
 system |    1 | eI17EP1c344tSxqMmlBFXFhaedH7qc5F7KS2GFMv3i8 |
(2 rows)
```

The gateway still signs with `$A`, so the run ends by putting it back, the same
command with the container's own environment:

```bash
docker compose -p odudu-docs-12b exec -T odudu node dist/main.js console provision
```

```
provisioned 2 tenants
```

```
  name  | keys |                  first_kid                  | second_kid
--------+------+---------------------------------------------+------------
 legacy |    1 | lYibdzdNfYB4SVGy-ZQYkvsm0bDUZp6lFv0ZePKgWkM |
 system |    1 | lYibdzdNfYB4SVGy-ZQYkvsm0bDUZp6lFv0ZePKgWkM |
(2 rows)
```

## The admin client's registered URIs

`odudu-admin` is registered the loopback redirect URI
`http://127.0.0.1:8080/callback` that the flow above ends on, and — while the
console is on (`ODUDU_CONSOLE`, `true` by default) — two more built from
`ODUDU_PUBLIC_BASE_URL`: the redirect URI
`${ODUDU_PUBLIC_BASE_URL}/console/auth/callback` and the post-logout redirect
URI `${ODUDU_PUBLIC_BASE_URL}/console/`. `seed admin`, `seed tenant`, `seed
--tenant`, `POST /admin/tenants` and `POST /admin/tenant-imports` write them;
none is ever taken from a request's `Host`. The query is scoped to the `system`
tenant's own admin client; the database held 2 tenants. psql ends each header
line with a space, trimmed in every block below:

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "select c.redirect_uris, c.post_logout_redirect_uris from client_oidc_config c join clients k on k.id = c.client_id join tenants t on t.id = k.tenant_id where t.name = 'system' and k.client_id = 'odudu-admin';"
```

A `system` tenant seeded before the console existed carries the loopback
alone:

```
          redirect_uris           | post_logout_redirect_uris
----------------------------------+---------------------------
 {http://127.0.0.1:8080/callback} | {}
(1 row)
```

`odudu console provision` re-runs `provisionAdminClient` over every
tenant — the command to run after setting or changing the base, since
redirect matching is exact. Its stderr carries only Node's experimental
Web Crypto warnings, discarded here:

```bash
docker compose exec -T odudu node dist/main.js console provision 2>/dev/null
```

```
provisioned 2 tenants
```

and the same query then reads:

```
                                redirect_uris                                 |    post_logout_redirect_uris
------------------------------------------------------------------------------+----------------------------------
 {http://127.0.0.1:8080/callback,http://localhost:3000/console/auth/callback} | {http://localhost:3000/console/}
(1 row)
```

A run under another base replaces both console URIs rather than adding a second
pair, and keeps the loopback. After rebuilding the image:

```bash
docker compose exec -T -e ODUDU_PUBLIC_BASE_URL=http://127.0.0.1:3000 odudu \
  node dist/main.js console provision 2>/dev/null
```

```
provisioned 2 tenants
```

The same psql query then reads:

```
                                redirect_uris                                 |    post_logout_redirect_uris
------------------------------------------------------------------------------+----------------------------------
 {http://127.0.0.1:8080/callback,http://127.0.0.1:3000/console/auth/callback} | {http://127.0.0.1:3000/console/}
(1 row)
```

Running the plain command again, under the server's own base:

```bash
docker compose exec -T odudu node dist/main.js console provision 2>/dev/null
```

```
provisioned 2 tenants
```

puts the `http://localhost:3000` pair back, and the query reads:

```
                                redirect_uris                                 |    post_logout_redirect_uris
------------------------------------------------------------------------------+----------------------------------
 {http://127.0.0.1:8080/callback,http://localhost:3000/console/auth/callback} | {http://localhost:3000/console/}
(1 row)
```

With the console off the command refuses, since it has nothing to
register, and exits `1`. The refusal is written to stderr, so this block
merges stderr instead of discarding it. It is unfiltered: the refusal comes
before anything loads Web Crypto, so no experimental-feature warning is
printed, and the refusal is the only line:

```bash
docker compose exec -T -e ODUDU_CONSOLE=false odudu node dist/main.js console provision 2>&1
```

```
console provision has nothing to register while ODUDU_CONSOLE=false
```

The server itself refuses to boot with the console on and no base, and
with an `https` base while `ODUDU_TLS` is off: every cookie follows
`ODUDU_TLS`, so the console's would be served without `Secure` to a browser
that came over https. `ODUDU_TRUST_PROXY` plays no part: the issuer is the
base whatever a request carries. Each refusal was run as a second process
inside a running container (on a stack on port `3197`, started with `ODUDU_TLS` unset), so
the guard fires before anything binds a port:

```bash
docker compose exec -T odudu env -u ODUDU_PUBLIC_BASE_URL node dist/main.js 2>&1 | grep '^OduduError'
docker compose exec -T -e ODUDU_PUBLIC_BASE_URL=https://idp.example.test odudu \
  node dist/main.js 2>&1 | grep '^OduduError'
```

```
OduduError: ODUDU_PUBLIC_BASE_URL is required while the administration console is on: its redirect URI is built from that base and never from a request header. Set it, or set ODUDU_CONSOLE=false to serve no console.
OduduError: ODUDU_PUBLIC_BASE_URL is https://idp.example.test, but ODUDU_TLS is off. Every cookie follows ODUDU_TLS, so the console would be served without Secure and the __Host- prefix to a browser that reached it over https. Set ODUDU_TLS=true, or set ODUDU_CONSOLE=false.
```

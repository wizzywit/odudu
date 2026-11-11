---
title: 'A tenant at its own address'
description: 'What the server answers for a registered domain, an idle one and an unknown one, and what the address a tenant left still serves for an hour.'
---

# A tenant at its own address

A tenant is reached at `/tenants/<name>` under the operator's base address until it switches to a
domain of its own ([Custom domains](../../../operating/custom-domains.md)). This page is what the
server answers at each step of that: the question a reverse proxy asks before it gets a certificate,
the tenant served at the root of its host, and the address the tenant left, which keeps serving what
was already issued for one hour. The admin calls that register and switch a domain are on
[the domains page of the admin paths](../admin-paths/get-domains-post-domains-and-the-domain-routes.md).

Every command was run, in this order, on a freshly built compose stack (the project
`odudu-p4j-tx`, port `3000`, the throttles at `10000`, the schedules off) with `odudu seed admin
--username ada`, the tenant `demo` and its client `demo-spa` and user `ada` made as
[Bootstrap](./bootstrap.md) makes them. `AT` and `RT` are the access and refresh tokens of a
sign-in at the path address, made as [Path A](./path-a-authorization-code-with-pkce.md) makes one,
before anything below. No DNS names `login.acme-corp.dev`, so each request to it goes to the stack's
port with the `Host` header a proxy would have kept; the server decides from that header alone. The stack does
not end TLS, so an address is `http`; behind a proxy with `ODUDU_TLS=true` the same address is `https`.
Tokens are cut to their first twelve characters and an ellipsis in the one block that shows them.

## The proxy's question

`GET /internal/domain-check?domain=<host>` answers `200` for a host Odudu serves and `404` for every
other, with no body either way and nothing that says why. Before the host is registered the
answer is no. Registering it with `odudu seed domain` leaves it `pending`, and a host nobody has proved is
no:

```bash
curl -sS -D - "http://localhost:3000/internal/domain-check?domain=login.acme-corp.dev"
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1a898-08b5-7901-840e-cd095b38d5ee
content-length: 0
Date: Wed, 04 Nov 2026 22:04:58 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

```bash
docker compose exec -T odudu odudu seed domain --tenant demo --host login.acme-corp.dev
```

```
{"command":"domain","tenant":"demo","tenantId":"01a1a897-8841-7e6e-bbec-1ac13aee6b28","host":"login.acme-corp.dev","state":"pending","canonical":false,"created":true,"recordName":"_odudu-challenge.login.acme-corp.dev","recordValue":"odudu-domain-verification=qTBNwMnsimcp0ri67J_UcbUfN9B1HPyXbV09NZ7yKfQ"}
```

```bash
curl -sS -D - "http://localhost:3000/internal/domain-check?domain=login.acme-corp.dev"
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1a898-0abb-70bf-855f-fe5254b54517
content-length: 0
Date: Wed, 04 Nov 2026 22:04:58 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

```bash
docker compose exec -T odudu odudu seed domain --tenant demo --host login.acme-corp.dev --assume-verified
```

```
{"command":"domain","tenant":"demo","tenantId":"01a1a897-8841-7e6e-bbec-1ac13aee6b28","host":"login.acme-corp.dev","state":"verified","canonical":false,"created":false}
```

```bash
curl -sS -D - "http://localhost:3000/internal/domain-check?domain=login.acme-corp.dev"
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1a898-0c6f-7405-95a2-dfdf465afda4
content-length: 0
Date: Wed, 04 Nov 2026 22:04:59 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

## Switching

`--assume-verified` marks the domain verified without the DNS proof, which is what a seeded domain is
for and why it refuses to run in production. A verified domain that is not the tenant's address is
idle, and the answer is still no. `--canonical` makes it the address, and the answer changes:

```bash
docker compose exec -T odudu odudu seed domain --tenant demo --host login.acme-corp.dev --assume-verified --canonical
```

```
{"command":"domain","tenant":"demo","tenantId":"01a1a897-8841-7e6e-bbec-1ac13aee6b28","host":"login.acme-corp.dev","state":"verified","canonical":true,"created":false}
```

```bash
curl -sS -D - "http://localhost:3000/internal/domain-check?domain=login.acme-corp.dev"
```

```
HTTP/1.1 200 OK
x-request-id: 01a1a898-0e02-7357-a933-9d15498183e5
content-length: 0
Date: Wed, 04 Nov 2026 22:04:59 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

## Discovery

Discovery at the domain names the domain as the issuer. The path address is still being served,
for an hour, and names its own issuer, since an address states the issuer of the address it is read at:

```bash
curl -sS -D - -H "Host: login.acme-corp.dev" http://localhost:3000/.well-known/openid-configuration
```

```
HTTP/1.1 200 OK
x-request-id: 01a1cb3d-19e2-74d9-a547-3399c361bdee
access-control-allow-origin: *
content-type: application/json; charset=utf-8
content-length: 2376
Date: Wed, 11 Nov 2026 15:32:21 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"issuer":"http://login.acme-corp.dev","authorization_endpoint":"http://login.acme-corp.dev/protocol/openid-connect/auth","token_endpoint":"http://login.acme-corp.dev/protocol/openid-connect/token","introspection_endpoint":"http://login.acme-corp.dev/protocol/openid-connect/token/introspect","revocation_endpoint":"http://login.acme-corp.dev/protocol/openid-connect/revoke","userinfo_endpoint":"http://login.acme-corp.dev/protocol/openid-connect/userinfo","jwks_uri":"http://login.acme-corp.dev/protocol/openid-connect/certs","end_session_endpoint":"http://login.acme-corp.dev/protocol/openid-connect/logout","response_types_supported":["code"],"response_modes_supported":["query"],"subject_types_supported":["public"],"id_token_signing_alg_values_supported":["RS256","ES256"],"userinfo_signing_alg_values_supported":["RS256","none"],"userinfo_encryption_alg_values_supported":["RSA-OAEP-256","ECDH-ES","ECDH-ES+A128KW","ECDH-ES+A192KW","ECDH-ES+A256KW"],"userinfo_encryption_enc_values_supported":["A128CBC-HS256","A192CBC-HS384","A256CBC-HS512","A128GCM","A192GCM","A256GCM"],"code_challenge_methods_supported":["S256"],"grant_types_supported":["authorization_code","refresh_token","client_credentials","urn:ietf:params:oauth:grant-type:token-exchange"],"token_endpoint_auth_methods_supported":["client_secret_basic","client_secret_post","none","private_key_jwt"],"introspection_endpoint_auth_methods_supported":["client_secret_basic","client_secret_post","private_key_jwt","none"],"revocation_endpoint_auth_methods_supported":["client_secret_basic","client_secret_post","private_key_jwt","none"],"authorization_response_iss_parameter_supported":true,"claims_parameter_supported":true,"ui_locales_supported":["en"],"prompt_values_supported":["none","login","consent","select_account"],"backchannel_logout_supported":true,"backchannel_logout_session_supported":true,"frontchannel_logout_supported":true,"frontchannel_logout_session_supported":true,"scopes_supported":["address","email","groups","mcp:read","mcp:write","me:read","me:write","offline_access","openid","phone","profile","roles"],"claims_supported":["sub","name","given_name","family_name","middle_name","nickname","preferred_username","profile","picture","website","gender","birthdate","zoneinfo","locale","updated_at","email","email_verified","roles","groups","address","phone_number","phone_number_verified"]}
```

This block is from a later run, on a tenant `demo` with the same domain, which is why it is not from the run above; `scopes_supported` now lists the twelve scopes every tenant starts with.

```bash
curl -sS http://localhost:3000/tenants/demo/.well-known/openid-configuration | jq -r '.issuer, .token_endpoint'
```

```
http://localhost:3000/tenants/demo
http://localhost:3000/tenants/demo/protocol/openid-connect/token
```

```bash
curl -sS -H "Host: login.acme-corp.dev" http://localhost:3000/.well-known/openid-configuration | jq -r '.issuer, .token_endpoint'
```

```
http://login.acme-corp.dev
http://login.acme-corp.dev/protocol/openid-connect/token
```

## The address the tenant left

Nobody signs in at it any more. An authorization request is answered with a page that points to the
new address:

```bash
curl -sS -D - --get --data-urlencode response_type=code --data-urlencode client_id=demo-spa --data-urlencode redirect_uri=http://localhost:8080/callback --data-urlencode scope=openid --data-urlencode state=x --data-urlencode code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM --data-urlencode code_challenge_method=S256 http://localhost:3000/tenants/demo/protocol/openid-connect/auth
```

```
HTTP/1.1 410 Gone
cache-control: no-store
vary: Accept-Language, Cookie
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
x-content-type-options: nosniff
content-language: en
content-length: 992
Date: Wed, 04 Nov 2026 22:04:59 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>This address has moved</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>This address has moved</h1>
<p>Sign-in is no longer offered at this address. Continue at the new address instead:</p>
<p><a href="http://login.acme-corp.dev"><bdi>http://login.acme-corp.dev</bdi></a></p>
</main>
</body>
</html>
```

```bash
curl -sS -D - --data-urlencode grant_type=refresh_token --data-urlencode "refresh_token=$RT" --data-urlencode client_id=demo-spa http://localhost:3000/tenants/demo/protocol/openid-connect/token | sed -E 's/("(access|id)_token":"[^"]{12})[^"]*"/\1…"/g;s/("refresh_token":"[^"]{12})[^"]*"/\1…"/'
```

```
HTTP/1.1 200 OK
x-request-id: 01a1a898-0e4f-79b8-adf8-9c1074e12dcd
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 1078
Date: Wed, 04 Nov 2026 22:04:59 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"access_token":"eyJhbGciOiJS…","refresh_token":"0T9I3RybLja5…","token_type":"Bearer","expires_in":300,"scope":"openid profile email"}
```

```bash
curl -sS -D - -H "Authorization: Bearer $AT" http://localhost:3000/tenants/demo/protocol/openid-connect/userinfo
```

```
HTTP/1.1 200 OK
x-request-id: 01a1a898-0e89-78a5-b553-a80cd3a3454a
vary: Origin
content-type: application/json; charset=utf-8
content-length: 135
Date: Wed, 04 Nov 2026 22:04:59 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"sub":"01a1a897-8a8e-7bd4-864a-e21c7ab3de7d","name":"ada","preferred_username":"ada","email":"ada@example.com","email_verified":false}
```

```bash
curl -sS -D - -H "Host: login.acme-corp.dev" -H "Authorization: Bearer $AT" http://localhost:3000/protocol/openid-connect/userinfo
```

```
HTTP/1.1 200 OK
x-request-id: 01a1a898-0eb5-76bc-83eb-b1f09c2907f2
vary: Origin
content-type: application/json; charset=utf-8
content-length: 135
Date: Wed, 04 Nov 2026 22:04:59 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"sub":"01a1a897-8a8e-7bd4-864a-e21c7ab3de7d","name":"ada","preferred_username":"ada","email":"ada@example.com","email_verified":false}
```

Everything already issued keeps working there for the hour. The refresh token of the sign-in before
the switch is accepted at the old address and the access token from that sign-in is accepted at
either address, and a token minted at the old address carries the old issuer.

## A sign-in at the domain

A sign-in at the domain is Path A with every URL at the root and the `Host` header sent. A token
it mints, `AT2` here, carries the domain as its issuer and audience:

```bash
echo "$AT2" | jq -R -r 'split(".")[1] | gsub("-";"+") | gsub("_";"/") | @base64d | fromjson | .iss, .aud[0]'
```

```
http://login.acme-corp.dev
http://login.acme-corp.dev
```

## Hosts that are not the tenant's address

A host that is registered and verified but is not the address answers a bare `404` on every path, whatever
the path is. A host that is not registered at all is routed exactly as before, so at the root it reaches
no route and gets the application's ordinary `404`. On the tenant's own host, the path address and the
admin API are refused, since a domain serves its own tenant at the root and nothing else, and
`/health*` answers on any host without a lookup. The proxy's question has one answer for every kind of
no, whether the host is idle, unknown, an IP address or missing:

```bash
curl -sS -D - -H "Host: idle.acme-corp.dev" http://localhost:3000/protocol/openid-connect/auth
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1a898-1134-7986-9c5a-382f23eb2fa3
content-length: 0
Date: Wed, 04 Nov 2026 22:05:00 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

```bash
curl -sS -D - -H "Host: nobody.acme-corp.dev" http://localhost:3000/protocol/openid-connect/auth
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1a898-1140-744d-bc86-0b87ed0b3bc6
vary: Accept
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 151
Date: Wed, 04 Nov 2026 22:05:00 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#not-found","title":"Not Found","status":404,"detail":"No resource at this path","instance":"01a1a898-1140-744d-bc86-0b87ed0b3bc6"}
```

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -H "Host: login.acme-corp.dev" http://localhost:3000/tenants/demo/.well-known/openid-configuration
```

```
404
```

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -H "Host: login.acme-corp.dev" http://localhost:3000/admin/tenants/demo/domains
```

```
404
```

```bash
curl -sS -D - -H "Host: idle.acme-corp.dev" http://localhost:3000/health/live
```

```
HTTP/1.1 200 OK
x-request-id: 01a1a898-1161-7984-9291-a6dad65cbd0d
content-type: application/json; charset=utf-8
content-length: 15
Date: Wed, 04 Nov 2026 22:05:00 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":"ok"}
```

```bash
curl -sS -D - "http://localhost:3000/internal/domain-check?domain=idle.acme-corp.dev"
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1a898-116a-7492-85dc-e6d07c016e99
content-length: 0
Date: Wed, 04 Nov 2026 22:05:00 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

```bash
curl -sS -D - "http://localhost:3000/internal/domain-check?domain=nobody.acme-corp.dev"
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1a898-1177-7885-a286-c9ca59d56915
content-length: 0
Date: Wed, 04 Nov 2026 22:05:00 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

```bash
curl -sS -D - "http://localhost:3000/internal/domain-check?domain=127.0.0.1"
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1a898-1183-77b0-948a-64f5ff8cfd76
content-length: 0
Date: Wed, 04 Nov 2026 22:05:00 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

```bash
curl -sS -D - "http://localhost:3000/internal/domain-check"
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1a898-118d-775c-a9d0-bd04270b173c
content-length: 0
Date: Wed, 04 Nov 2026 22:05:00 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

## Switching back

Switching back needs the admin API on the base address and nothing from the domain. `ADMIN_TOKEN` is a token
from [Getting the token](../admin-paths/getting-the-token.md). The domain's own address then stops
serving sign-in and points to the path address, which serves it again. The block that follows shows only
the status line and the page's heading, address and link:

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'If-Match: "2d2edaaffd0c42b402f1819e595dab5d71ff785d5a0a090ca0a36a48faa02186"' http://localhost:3000/admin/tenants/demo/domains/7f7b3438-5481-49dc-a185-daf513d6dbfe/deactivate
```

```
HTTP/1.1 200 OK
x-request-id: 01a1a898-13fd-7de4-b302-564ee7f0e7d3
cache-control: no-store
etag: "4c8f0793cefd5ded11e95d1bd8e1cfaf41295a5cdce8231237b0e89fcb8f7cce"
content-type: application/json; charset=utf-8
content-length: 215
Date: Wed, 04 Nov 2026 22:05:01 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"7f7b3438-5481-49dc-a185-daf513d6dbfe","host":"login.acme-corp.dev","state":"verified","canonical":false,"verified_at":"2026-11-04T22:04:59.333Z","last_checked_at":"2026-11-04T22:04:59.333Z","dns_record":null}
```

```bash
curl -sS -D - -H "Host: login.acme-corp.dev" --get --data-urlencode response_type=code --data-urlencode client_id=demo-spa --data-urlencode redirect_uri=http://localhost:8080/callback --data-urlencode scope=openid --data-urlencode state=x --data-urlencode code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM --data-urlencode code_challenge_method=S256 http://localhost:3000/protocol/openid-connect/auth | sed -n '1p;/<h1>/,/<\/a>/p'
```

```
HTTP/1.1 410 Gone
<h1>This address has moved</h1>
<p>Sign-in is no longer offered at this address. Continue at the new address instead:</p>
<p><a href="http://localhost:3000/tenants/demo"><bdi>http://localhost:3000/tenants/demo</bdi></a></p>
```

```bash
curl -sS -o /dev/null -w '%{http_code}\n' --get --data-urlencode response_type=code --data-urlencode client_id=demo-spa --data-urlencode redirect_uri=http://localhost:8080/callback --data-urlencode scope=openid --data-urlencode state=x --data-urlencode code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM --data-urlencode code_challenge_method=S256 http://localhost:3000/tenants/demo/protocol/openid-connect/auth
```

```
200
```

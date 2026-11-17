---
title: 'Authorization server metadata'
description: 'The RFC 8414 document a tenant publishes at its path address and at its own domain, and the empty 404 for a tenant that is not there.'
---

# Authorization server metadata

A client that knows only a resource, such as an MCP server that names this tenant as its
authorization server, asks the authorization server what it offers
(RFC 8414). A tenant answers with the same issuer and
endpoints as its [discovery document](./path-a-authorization-code-with-pkce.md), in the members
RFC 8414 defines, and with the scopes `mcp:read` and `mcp:write` always listed. RFC 8414 §3.1
puts the well-known suffix between the host and the issuer's path, so the tenant's issuer decides
where the document is: `/.well-known/oauth-authorization-server/tenants/<name>` at the path
address, and `/.well-known/oauth-authorization-server` on a tenant's own domain. The reading note
is `docs/protocols/rfc8414.md`.

Every command was run, in this order, on a freshly built stack (port `3000`, the
throttles at `10000`, the schedules off) driven only as far as
this page goes: the tenant `demo`, its client `demo-spa` and its user `ada` made as
[Bootstrap](./bootstrap.md) makes them, then a second tenant `gone-demo` made and switched off
(below), then the domain `login.acme-corp.dev` seeded as the tenant's address. No DNS names that
domain, so each request to it goes to the stack's port with the `Host` header a proxy would have
kept. The stack does not end TLS, so an issuer is `http`; behind a proxy with `ODUDU_TLS=true` the
same address is `https`.

## At the path address

The document is public: no credential, and every origin may read it.

```bash
curl -sS -D - -o /dev/null http://localhost:3000/.well-known/oauth-authorization-server/tenants/demo
```

```
HTTP/1.1 200 OK
x-request-id: 01a1cb3b-f92e-7897-934d-ee1391e114a0
access-control-allow-origin: *
content-type: application/json; charset=utf-8
content-length: 1535
Date: Wed, 11 Nov 2026 15:31:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

```bash
curl -sS http://localhost:3000/.well-known/oauth-authorization-server/tenants/demo | jq .
```

```
{
  "issuer": "http://localhost:3000/tenants/demo",
  "authorization_endpoint": "http://localhost:3000/tenants/demo/protocol/openid-connect/auth",
  "token_endpoint": "http://localhost:3000/tenants/demo/protocol/openid-connect/token",
  "jwks_uri": "http://localhost:3000/tenants/demo/protocol/openid-connect/certs",
  "introspection_endpoint": "http://localhost:3000/tenants/demo/protocol/openid-connect/token/introspect",
  "revocation_endpoint": "http://localhost:3000/tenants/demo/protocol/openid-connect/revoke",
  "response_types_supported": [
    "code"
  ],
  "response_modes_supported": [
    "query"
  ],
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
  "token_endpoint_auth_signing_alg_values_supported": [
    "RS256",
    "ES256"
  ],
  "introspection_endpoint_auth_methods_supported": [
    "client_secret_basic",
    "client_secret_post",
    "private_key_jwt",
    "none"
  ],
  "introspection_endpoint_auth_signing_alg_values_supported": [
    "RS256",
    "ES256"
  ],
  "revocation_endpoint_auth_methods_supported": [
    "client_secret_basic",
    "client_secret_post",
    "private_key_jwt",
    "none"
  ],
  "revocation_endpoint_auth_signing_alg_values_supported": [
    "RS256",
    "ES256"
  ],
  "code_challenge_methods_supported": [
    "S256"
  ],
  "authorization_response_iss_parameter_supported": true,
  "ui_locales_supported": [
    "en"
  ],
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
  ]
}
```

(`jq` only indents what the server sent as one line, 1,535 bytes.) Three things in it are there
because a client reads them. `none` beside `private_key_jwt` in `token_endpoint_auth_methods_supported`
says a public client may use the token endpoint, which Claude requires before it will use a client
identifier that is a URL. The three `..._auth_signing_alg_values_supported` lists are required by §2
wherever `private_key_jwt` is listed. `mcp:read` and `mcp:write` are in the list because every tenant starts with them
as scopes, as it does with `me:read` and `me:write`; this document also lists the two `mcp` scopes for a tenant that
has deleted them, and never adds a `me` scope the tenant does not define. `registration_endpoint` is absent
because `demo` does not open client registration, and `client_id_metadata_document_supported` is
absent because `demo` has not turned on client ID metadata documents.

A tenant turns client identifiers that are URLs on with its `cimd_enabled` setting, off by
default. The member appears, as `true`, only then, and the OpenID discovery document never
carries it. In a tenant `cimd-demo` created for this section, run on the same stack:

```bash
M=http://localhost:3000/.well-known/oauth-authorization-server/tenants/cimd-demo
odudu seed tenant --name cimd-demo
curl -sS $M | jq -c 'has("client_id_metadata_document_supported")'
odudu seed tenant --name cimd-demo --set cimd_enabled=true
curl -sS $M | jq '{client_id_metadata_document_supported, token_endpoint_auth_methods_supported}'
curl -sS http://localhost:3000/tenants/cimd-demo/.well-known/openid-configuration | jq -c 'has("client_id_metadata_document_supported")'
```

```
{"command":"tenant","created":true,"tenant":"cimd-demo","tenantId":"01a1b041-9dcc-7394-a1d0-b244a14decb0"}
false
{"command":"tenant","created":false,"tenant":"cimd-demo","tenantId":"01a1b041-9dcc-7394-a1d0-b244a14decb0","settings":["cimd_enabled"]}
{
  "client_id_metadata_document_supported": true,
  "token_endpoint_auth_methods_supported": [
    "client_secret_basic",
    "client_secret_post",
    "none",
    "private_key_jwt"
  ]
}
false
```

With it on, an authorization request whose `client_id` is a URL makes the server fetch the
document there. This one names a host that does not exist, so the request is refused as an
unknown client is, and the server logs why, naming the host and never any body:

```bash
Q="response_type=code&redirect_uri=https%3A%2F%2Fclient.invalid.test%2Fcb&scope=openid&state=s&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256"
curl -sS -D - "http://localhost:3000/tenants/cimd-demo/protocol/openid-connect/auth?client_id=https%3A%2F%2Fclient.invalid.test%2Foauth%2Fclient.json&$Q" | sed -n '1p'
docker compose logs odudu 2>&1 | grep 'metadata document' | tail -1 | cut -d'|' -f2- | jq -c '{host, reason, msg}'
```

```
HTTP/1.1 400 Bad Request
{"host":"client.invalid.test","reason":"unreachable","msg":"client metadata document refused"}
```

With the setting off again, the same request is the same `400`, and nothing is fetched:

```bash
odudu seed tenant --name cimd-demo --set cimd_enabled=false
curl -sS -D - "http://localhost:3000/tenants/cimd-demo/protocol/openid-connect/auth?client_id=https%3A%2F%2Fclient.invalid.test%2Foauth%2Fclient.json&$Q" | sed -n '1p'
curl -sS $M | jq -c 'has("client_id_metadata_document_supported")'
```

```
{"command":"tenant","created":false,"tenant":"cimd-demo","tenantId":"01a1b041-9dcc-7394-a1d0-b244a14decb0","settings":["cimd_enabled"]}
HTTP/1.1 400 Bad Request
false
```

The issuer is the tenant's, the one its discovery document states:

```bash
curl -sS http://localhost:3000/tenants/demo/.well-known/openid-configuration | jq -r .issuer
```

```
http://localhost:3000/tenants/demo
```

## A tenant that is not there

A tenant that does not exist and one that is switched off answer the same bytes, an empty `404`,
so nothing tells them apart. `gone-demo` was made and switched off with:

```bash
odudu seed tenant --name gone-demo
odudu seed tenant --name gone-demo --set enabled=false
```

```
{"command":"tenant","created":true,"tenant":"gone-demo","tenantId":"01a1b041-aef4-72d4-9dba-3187e0e72a7e"}
{"command":"tenant","created":false,"tenant":"gone-demo","tenantId":"01a1b041-aef4-72d4-9dba-3187e0e72a7e","settings":["enabled"]}
```

```bash
curl -sS -D - http://localhost:3000/.well-known/oauth-authorization-server/tenants/gone-demo
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1b041-b803-7568-8a6b-37e0c6354ef4
access-control-allow-origin: *
content-length: 0
Date: Fri, 06 Nov 2026 09:47:39 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

```bash
curl -sS -D - http://localhost:3000/.well-known/oauth-authorization-server/tenants/nobody
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1b041-b877-714e-b15a-810979436e0f
access-control-allow-origin: *
content-length: 0
Date: Fri, 06 Nov 2026 09:47:39 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

The discovery document still describes a switched-off tenant, since it still publishes the keys its
queued logout tokens are signed with; this one points a client at a token endpoint that tenant
refuses, so it does not.

At the path address the document is at the one URL above and nowhere else. Under the tenant, where
a domain's request is routed, it is not served, so an issuer has one metadata URL:

```bash
curl -sS -D - http://localhost:3000/tenants/demo/.well-known/oauth-authorization-server
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1b041-b895-7c64-951d-29676426965f
content-length: 0
Date: Fri, 06 Nov 2026 09:47:39 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

## At the tenant's own domain

Seeding a domain as the tenant's address is what a switch does, without the DNS proof
([A tenant at its own address](./custom-domains-a-domain-host-and-the-proxys-question.md) has the
steps):

```bash
odudu seed domain --tenant demo --host login.acme-corp.dev --assume-verified --canonical
```

```
{"command":"domain","tenant":"demo","tenantId":"01a1b041-9605-7b7d-8ff2-e3ef207c4ef8","host":"login.acme-corp.dev","state":"verified","canonical":true,"created":true}
```

The domain's issuer has no path, so its document is at the root of the host, and every URL in it is
the domain's:

```bash
curl -sS -D - -o /dev/null -H "Host: login.acme-corp.dev" http://localhost:3000/.well-known/oauth-authorization-server
```

```
HTTP/1.1 200 OK
x-request-id: 01a1cb3c-1864-7a0d-9464-61a2148b4cd0
access-control-allow-origin: *
content-type: application/json; charset=utf-8
content-length: 1487
Date: Wed, 11 Nov 2026 15:31:15 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

```bash
curl -sS -H "Host: login.acme-corp.dev" http://localhost:3000/.well-known/oauth-authorization-server | jq '{issuer, authorization_endpoint, token_endpoint, jwks_uri}'
```

```
{
  "issuer": "http://login.acme-corp.dev",
  "authorization_endpoint": "http://login.acme-corp.dev/protocol/openid-connect/auth",
  "token_endpoint": "http://login.acme-corp.dev/protocol/openid-connect/token",
  "jwks_uri": "http://login.acme-corp.dev/protocol/openid-connect/certs"
}
```

The path address is the address the tenant left, and for an hour it keeps answering where a token
already issued is used, discovery among them. This document is one of those, and it states the issuer
of the address it is read at, which is still the path one:

```bash
curl -sS http://localhost:3000/.well-known/oauth-authorization-server/tenants/demo | jq -r .issuer
```

```
http://localhost:3000/tenants/demo
```

On the domain itself the path-inserted URL is not served, since the domain's issuer has no path:

```bash
curl -sS -D - -o /dev/null -H "Host: login.acme-corp.dev" http://localhost:3000/.well-known/oauth-authorization-server/tenants/demo
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1cb3c-1899-7258-a645-852ce211f700
content-type: application/problem+json; charset=utf-8
content-length: 151
Date: Wed, 11 Nov 2026 15:31:15 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

After the hour the path address serves nothing for the tenant, this document included, and answers
the same empty `404` every other path there gives. That was not run on this stack, which would have
had to wait an hour; an integration test against a real database holds it.

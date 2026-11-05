---
title: 'Protected resource metadata'
description: 'The RFC 9728 document a tenant publishes for its MCP endpoint, at its path address and its own domain, and the 404 for a tenant not there.'
---

# Protected resource metadata

An MCP client is given one address, the tenant's MCP endpoint, and has to find where to sign in.
The resource answers with the document RFC 9728 defines: the endpoint's own address as the
`resource`, the authorization server to use, and the scopes it takes. RFC 9728 §3.1 puts the
well-known suffix between the host and the resource's path, so the tenant's address decides where
the document is: `/.well-known/oauth-protected-resource/tenants/<name>/mcp` at the path address, and
`/.well-known/oauth-protected-resource/mcp` on a tenant's own domain. The reading note is
`docs/protocols/rfc9728.md`. The MCP endpoint itself is not served yet, so no `401` carrying the
`WWW-Authenticate` challenge that points a client here was run; the two strings that challenge is
built from are held by unit tests, and this page shows the document they point at.

Every command was run, in this order, on a freshly built compose stack (the project
`odudu-p5a-i1b`, port `3000`, the throttles at `10000`, the schedules off) driven only as far as
this page goes: the tenant `demo`, its client `demo-spa` and its user `ada` made as
[Bootstrap](./bootstrap.md) makes them, then a second tenant `gone-demo` made and switched off
(below), then the domain `login.acme-corp.dev` seeded as the tenant's address. No DNS names that
domain, so each request to it goes to the stack's port with the `Host` header a proxy would have
kept. The stack does not end TLS, so an address is `http`; behind a proxy with `ODUDU_TLS=true` the
same address is `https`.

## At the path address

The document is public: no credential, and every origin may read it.

```bash
curl -sS -D - -o /dev/null http://localhost:3000/.well-known/oauth-protected-resource/tenants/demo/mcp
```

```
HTTP/1.1 200 OK
x-request-id: 01a1ab7c-822e-728e-8f13-6ab05f4f9b30
access-control-allow-origin: *
content-type: application/json; charset=utf-8
content-length: 198
Date: Thu, 05 Nov 2026 11:33:46 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

```bash
curl -sS http://localhost:3000/.well-known/oauth-protected-resource/tenants/demo/mcp | jq .
```

```
{
  "resource": "http://localhost:3000/tenants/demo/mcp",
  "authorization_servers": [
    "http://localhost:3000/tenants/demo"
  ],
  "scopes_supported": [
    "mcp:read",
    "mcp:write"
  ],
  "bearer_methods_supported": [
    "header"
  ]
}
```

(`jq` only indents what the server sent as one line, 198 bytes.) `resource` is the address a client
connects to, with no trailing slash: a client compares it as a string with the address it was given,
and refuses the document when they differ. `authorization_servers` has one entry, because a client
reads only the first, and it is the issuer the tenant's
[authorization server metadata](./authorization-server-metadata.md) states:

```bash
curl -sS http://localhost:3000/.well-known/oauth-authorization-server/tenants/demo | jq -r .issuer
```

```
http://localhost:3000/tenants/demo
```

`bearer_methods_supported` is `header` alone, since a token in a query string or a form body is not
accepted.

## A tenant that is not there

A tenant that does not exist and one that is switched off answer the same bytes, an empty `404`,
so nothing tells them apart. `gone-demo` was made and switched off with:

```bash
odudu seed tenant --name gone-demo
odudu seed tenant --name gone-demo --set enabled=false
```

```
{"command":"tenant","created":true,"tenant":"gone-demo","tenantId":"01a1ab7c-83e5-7a47-9623-a3ac2a19ed04"}
{"command":"tenant","created":false,"tenant":"gone-demo","tenantId":"01a1ab7c-83e5-7a47-9623-a3ac2a19ed04","settings":["enabled"]}
```

```bash
curl -sS -D - http://localhost:3000/.well-known/oauth-protected-resource/tenants/gone-demo/mcp
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1ab7c-860c-7ba6-8ab8-d17cf5c52f63
access-control-allow-origin: *
content-length: 0
Date: Thu, 05 Nov 2026 11:33:47 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

```bash
curl -sS -D - http://localhost:3000/.well-known/oauth-protected-resource/tenants/nobody/mcp
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1ab7c-8617-7c99-9042-95e952972233
access-control-allow-origin: *
content-length: 0
Date: Thu, 05 Nov 2026 11:33:47 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

At the path address the document is at the one URL above and nowhere else. Under the tenant, where
a domain's request is routed, it is not served, so a resource has one metadata URL:

```bash
curl -sS -D - http://localhost:3000/tenants/demo/.well-known/oauth-protected-resource/mcp
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1ab7c-8621-7ef3-a99a-8a06d4400f1d
content-length: 0
Date: Thu, 05 Nov 2026 11:33:47 GMT
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
{"command":"domain","tenant":"demo","tenantId":"01a1ab7c-8126-729a-93fb-1eeb163d4604","host":"login.acme-corp.dev","state":"verified","canonical":true,"created":true}
```

The domain's resource has the path `/mcp` and no tenant segment, so its document is at
`/.well-known/oauth-protected-resource/mcp` of that host, and the resource and the authorization
server in it are the domain's:

```bash
curl -sS -D - -o /dev/null -H "Host: login.acme-corp.dev" http://localhost:3000/.well-known/oauth-protected-resource/mcp
```

```
HTTP/1.1 200 OK
x-request-id: 01a1ab7c-8864-7cec-b13e-97006aeea376
access-control-allow-origin: *
content-type: application/json; charset=utf-8
content-length: 182
Date: Thu, 05 Nov 2026 11:33:47 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

```bash
curl -sS -H "Host: login.acme-corp.dev" http://localhost:3000/.well-known/oauth-protected-resource/mcp | jq .
```

```
{
  "resource": "http://login.acme-corp.dev/mcp",
  "authorization_servers": [
    "http://login.acme-corp.dev"
  ],
  "scopes_supported": [
    "mcp:read",
    "mcp:write"
  ],
  "bearer_methods_supported": [
    "header"
  ]
}
```

The path address is the address the tenant left, and for an hour it keeps answering where a token
already issued is used. This document is one of those, and it states the resource of the address it
is read at, which is still the path one:

```bash
curl -sS http://localhost:3000/.well-known/oauth-protected-resource/tenants/demo/mcp | jq .
```

```
{
  "resource": "http://localhost:3000/tenants/demo/mcp",
  "authorization_servers": [
    "http://localhost:3000/tenants/demo"
  ],
  "scopes_supported": [
    "mcp:read",
    "mcp:write"
  ],
  "bearer_methods_supported": [
    "header"
  ]
}
```

On the domain itself the path-inserted URL is not served, since the domain's resource has no
tenant segment:

```bash
curl -sS -D - -o /dev/null -H "Host: login.acme-corp.dev" http://localhost:3000/.well-known/oauth-protected-resource/tenants/demo/mcp
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1ab7c-8888-769c-ae37-10b952f4718b
content-type: application/problem+json; charset=utf-8
content-length: 151
Date: Thu, 05 Nov 2026 11:33:47 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

After the hour the path address serves nothing for the tenant, this document included, and answers
the same empty `404` every other path there gives. That was not run on this stack, which would have
had to wait an hour; an integration test against a real database holds it.

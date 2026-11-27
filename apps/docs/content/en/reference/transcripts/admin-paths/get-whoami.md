---
title: 'GET /whoami'
description: 'The identity probe: what an operator reaches for when a token is not working and they need to know what the server thinks it is, before debugging…'
---

# `GET /whoami`

The identity probe: what an operator reaches for when a token is not working and
they need to know what the server thinks it is, before debugging anything else.
It requires an authenticated caller and no capability beyond that — any admin
token good enough to reach this tenant's admin surface at all can call it, the
one route the capability matrix proves every `TenantCapability` admits.

It answers `subjectId` (the token's `sub`), `issuerTenantId` and
`issuerTenantName` — the id and the name of the tenant that **issued** the token,
not the tenant named in the URL — `capabilities` and `crossTenant`. `capabilities` is the caller's own effective admin-client roles,
resolved on its issuing tenant exactly the way `authorizeAdmin` resolves them
(`callerCapabilities`) — composites expanded, so a `manage-users` holder sees
`view-users` alongside it — narrowed to the `TenantCapability` names (twelve, with `view-domains`, `manage-domains` and the three assistant capabilities) plus
`manage-tenants` and sorted. A composite role itself, `tenant-admin` among them,
is never a member of that list: holding one expands to what it composites, never
to its own name, and the published schema enforces the narrowing with a `z.enum`
over that fixed vocabulary rather than an open `string[]`. The set is the same
regardless of which tenant is named in the path: what a caller may do is fixed
by where its roles live, not by what it is asking about. `crossTenant` is `true`
when the path tenant differs from the issuing one, which is exactly when
reaching a capability-gated route here also needs `manage-tenants` ("The shape
of it" above).

The recorded run is under "Getting the token" above, against
`/admin/tenants/system/whoami` (`crossTenant: false`, the caller's own tenant).
The same token against `demo` — a tenant `ada-whoami` never issued from —
answers identical `capabilities`, `crossTenant` now `true`:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/whoami
```

```
{"subjectId":"01a1b0fc-0449-7630-8e75-09f82c1f14e2","issuerTenantId":"0199aa00-0000-7000-8000-000000000001","issuerTenantName":"system","capabilities":["manage-clients","manage-domains","manage-keys","manage-sessions","manage-tenant","manage-tenants","manage-users","view-audit","view-domains","view-users"],"crossTenant":true}
```

This block ran again after `view-domains` and `manage-domains` joined the built-in roles, so its ids and times are not those of the blocks around it. The caller is the run's own `ada`, holding `tenant-admin`, so `subjectId` is hers.

That block shows the answer as it was before `assistant_available` was added, and was not run again: its caller was the run's own `ada`, which this change had no stack for. Every whoami answer now carries `assistant_available`, `true` when the deployment resolved a standard model for the console assistant and `false` otherwise, and is left out of the answer to an AI agent's token, which is told nothing of the assistant; the two blocks below show both.

A client that holds only `use-assistant` sees only that. The run is on a fresh tenant `assist-demo`, so its ids are that run's own; the client's token is got with `client_credentials`, as on [`GET /assistant/status`](./get-assistantstatus.md). On a stack that sets none of the assistant's variables, `assistant_available` is `false`:

```bash
curl -sS -D - -H "Authorization: Bearer $USER_TOKEN" http://localhost:3000/admin/tenants/assist-demo/whoami
```

```
HTTP/1.1 200 OK
x-request-id: 01a215fc-7e92-7acc-a93f-71b0eadf216c
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 222
Date: Thu, 26 Nov 2026 03:53:18 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"subjectId":"01a215fc-7c81-735d-a915-304b29d37308","issuerTenantId":"01a215fc-77dd-71ea-a23a-12e14cc7460e","issuerTenantName":"assist-demo","capabilities":["use-assistant"],"crossTenant":false,"assistant_available":false}
```

The same stack started again over the same volume with `ODUDU_ASSISTANT_MODELS` set to `standard=anthropic:claude-model-for-transcript` and `ANTHROPIC_API_KEY` to a placeholder, and a token got again, answers `true`:

```
HTTP/1.1 200 OK
x-request-id: 01a215fc-99cf-7101-bf68-036a14eb440a
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 221
Date: Thu, 26 Nov 2026 03:53:25 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"subjectId":"01a215fc-7c81-735d-a915-304b29d37308","issuerTenantId":"01a215fc-77dd-71ea-a23a-12e14cc7460e","issuerTenantName":"assist-demo","capabilities":["use-assistant"],"crossTenant":false,"assistant_available":true}
```

The console reads this field and asks for the assistant's settings only where it is `true`, so a deployment without an assistant is never sent a request it answers as a path that was never served.

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

It answers `subjectId` (the token's `sub`), `issuerTenantId` — the tenant that
**issued** the token, not the tenant named in the URL — `capabilities` and
`crossTenant`. `capabilities` is the caller's own effective admin-client roles,
resolved on its issuing tenant exactly the way `authorizeAdmin` resolves them
(`callerCapabilities`) — composites expanded, so a `manage-users` holder sees
`view-users` alongside it — narrowed to the `TenantCapability` names (nine, with `view-domains` and `manage-domains`) plus
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
{"subjectId":"01a0e0a7-0ead-703a-ab34-22bcf5167d46","issuerTenantId":"0199aa00-0000-7000-8000-000000000001","capabilities":["manage-clients","manage-keys","manage-sessions","manage-tenant","manage-tenants","manage-users","view-audit","view-users"],"crossTenant":true}
```

The block above was captured before `view-domains` and `manage-domains` existed. The same call on a
later stack, from the same kind of caller, a fresh `ada` holding `tenant-admin` (a different subject,
so a different `subjectId`), lists both:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/whoami
```

```
{"subjectId":"01a1a899-f88d-7c10-b446-f0729ae1e2fc","issuerTenantId":"0199aa00-0000-7000-8000-000000000001","capabilities":["manage-clients","manage-domains","manage-keys","manage-sessions","manage-tenant","manage-tenants","manage-users","view-audit","view-domains","view-users"],"crossTenant":true}
```

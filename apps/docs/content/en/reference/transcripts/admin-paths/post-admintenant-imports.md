---
title: 'POST /admin/tenant-imports'
description: 'POST /admin/tenant-imports requires manage-tenants and always creates a new tenant, from a document GET /export answered.'
---

# `POST /admin/tenant-imports`

`POST /admin/tenant-imports` requires `manage-tenants` and always creates a
new tenant, from a document `GET /export` answered. The body is
`{"name": …, "display_name": …, "document": …}`; `display_name` is optional,
and without it the document's own `settings.display_name` is used. Merging
into an existing tenant is not offered. An import is a creation, so a document
holding a name, `client_id`, description or consent text with a bidirectional
control (U+202A to U+202E, U+2066 to U+2069), as an export of a tenant with a
legacy value does, is refused at the document schema, at that field's path and
with the code `bidi_control_refused` (`document.clients[0].client_id`). Fix the
value in the source tenant first, or remove the control from the exported
document, then import it.

The whole request is validated before anything is written, and every
problem is answered together in one `400` whose `errors` lists each with
its JSON path from the body — `name`, or `document.clients[0].redirect_uris`.
The checks run in this order: the tenant name, by the same rule
`POST /admin/tenants` applies (`system` and `count` included); the document
against the export's own schema, which stops there if it fails; every
cross-reference, repeated name and composite cycle; each client through
`parseClientMetadata`, the validator registration and `POST /clients` use,
so a `jwks` key carrying a private member is refused here too; and last the
rules every admin API write is held to. A role with
`default_for_new_subjects` may not reach an admin capability through any
depth of composites, as under `PUT /roles/:id/default`. Nothing the document
grants may carry a capability the caller does not hold, the ceiling
`PUT /subjects/:id/roles` applies. A reserved name is a `400` here rather
than the `409` `POST /admin/tenants` answers, so that it is reported
beside the document's own problems. A name another tenant holds is refused
with `409` once the request is otherwise sound, still before any write.
The ranges the database's CHECK constraints hold settings and client token
lifetimes to are checked among the rest, each at its own path —
`document.settings.password_min_length`, or
`document.clients[0].access_token_ttl_seconds` above its ceiling of 3600
(`tenantSettingProblems`, `@odudu/domain-tenant`, and
`clientTokenTtlProblem`, `@odudu/protocol-oidc`, each held to its
constraints by a test that writes the boundary values).

What provisioning creates is matched, never created twice. A role marked
`builtin` is matched by its name on `odudu-admin`, a scope marked `builtin`
by its name, and the attributes the admin API lets an operator edit on
them — a role's `description`, a scope's
`description`, its two `include_in_*` flags, its role mappings, mapper
bindings and client assignments — are applied from the document. A
built-in scope the document leaves out is deleted, as it was where the
document came from; `openid`, which cannot be deleted, is required. A
built-in the new tenant does not provision, such as the system tenant's
`manage-tenants`, is refused, as is any other role on `odudu-admin`: a
document cannot mint a capability. So is leaving out a composite that
provisioning gives a capability role, which `DELETE /roles/:id/composites`
would refuse to remove, and naming one it does not give, which
`POST /roles/:id/composites` would refuse to add: a capability role's shape
is provisioning's in both directions.

Then one transaction creates the tenant the way `POST /admin/tenants` does
— its row, flow, built-in admin client and a signing key of its own, never
the source's — and writes the document into it: settings, flow, clients,
roles and their composites, groups, scopes, service-account roles, SMTP,
message overrides and subjects, in that order. A document exported before
tenants had languages or overrides still imports: a missing
`supported_locales` is English only, a missing `default_locale` is none, and
missing `message_overrides` is none. Each override is checked as `PUT
/message-overrides/{locale}/{key}` checks one, which includes refusing an argument such as `{name}` that the English text of its key does not read (the problem names the argument and the key, so the file can be corrected; this page holds no captured output of it), a pair named twice is refused,
and there may be at most 500; the problems come back with the rest, by path
(`document.message_overrides[3].key`). Each confidential client is given a fresh secret,
answered once under `client_secrets` in the `201` and never logged or
written to the trail. The SMTP relay arrives without a password, since none
travels; `PUT /smtp` sets one. A subject arrives with no credential and an
`update-password` required action, beside any it already owed. The import
writes one `tenant.import` row into the new tenant's trail, whose `detail`
carries the document's `version` and how many clients, roles, groups,
scopes and subjects it held.

So a document exported from the imported tenant equals the one imported, apart
from `settings.display_name` when the request names another, the `omitted` list
— no client secret, SMTP password or credential was carried across — and each
subject's `required_actions`, which gains `update-password`. An integration test
holds a round trip to exactly that.

A document with the export's full 10,000 subjects runs to several
megabytes, so this route admits a body of up to 16 MiB, where every other
route keeps Fastify's default of one; a larger body is refused with `413`.
A document holding more subjects than export would ever write — more than
10,000 — is refused at `document.subjects` among the other problems, with
the same text export's own `413` gives, since a smaller body can still hold
that many.

The import itself, through its trail row below, is run as `ada`. `import-source`
is built for it through the endpoints in these pages: a confidential
`client_credentials` client `billing-app`, a tenant role `billing-reader`, a
group `finance` holding it, and a subject `grace` who belongs to it and owes
`update-password`. The import names the tenant `import-demo2`. Both tenants and
the secret below are throwaway.

Everything below ran in one session on a freshly built stack with `odudu seed admin
--username ada` run against it and `$ADMIN_TOKEN` got as in [Getting the
token](./getting-the-token.md). `import-source` is made first, with an override of
the sign-in title in the default language:

```bash
A="Authorization: Bearer $ADMIN_TOKEN"; J='Content-Type: application/json'
T=http://localhost:3000/admin/tenants/import-source
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"import-source","display_name":"Import source"}' http://localhost:3000/admin/tenants -o /dev/null
curl -sS -X POST -H "$A" -H "$J" \
  -d '{"client_id":"billing-app","grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic"}' $T/clients -o /dev/null
ROLE=$(curl -sS -X POST -H "$A" -H "$J" -d '{"name":"billing-reader"}' $T/roles | jq -r .id)
GROUP=$(curl -sS -X POST -H "$A" -H "$J" -d '{"name":"finance"}' $T/groups | jq -r .id)
curl -sS -X PUT -H "$A" -H "$J" -d "{\"role_ids\":[\"$ROLE\"]}" $T/groups/$GROUP/roles -o /dev/null
GRACE=$(curl -sS -X POST -H "$A" -H "$J" -d '{"username":"grace","email":"grace@navy.example"}' $T/subjects | jq -r .id)
curl -sS -X PUT -H "$A" -H "$J" -d "{\"group_ids\":[\"$GROUP\"]}" $T/subjects/$GRACE/groups -o /dev/null
curl -sS -X PUT -H "$A" -H "$J" -H 'If-None-Match: *' -d '{"message":"Welcome back"}' $T/message-overrides/en/login.title -o /dev/null
```

The export, saved, then imported under a new name:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/import-source/export?include=subjects" > source.json
jq -n --slurpfile document source.json \
  '{name: "import-demo2", display_name: "Import demo", document: $document[0]}' \
  | curl -sS -D - -o import.json -X POST \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary @- \
      http://localhost:3000/admin/tenant-imports
cat import.json
```

```
HTTP/1.1 201 Created
x-request-id: 01a18736-2db6-766b-adbe-cf3622b60f31
cache-control: no-store
etag: "639038228c6595803ee9638d93d3dbae6e2638352c504bc4c1c35c409f621b57"
content-type: application/json; charset=utf-8
content-length: 264
Date: Thu, 29 Oct 2026 10:30:37 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"tenant":{"id":"01a18736-2dcc-756d-ab0a-9251fab5650a","name":"import-demo2","display_name":"Import demo","enabled":true,"created_at":"2026-10-29T10:30:37.260Z"},"client_secrets":[{"client_id":"billing-app","secret":"JBjEap08jVreHB5Y9CRBMq5nQR_Fil6IibkNemUG0X8"}]}
```

The secret it answered authenticates at the new tenant's `/token`:

```bash
SECRET=$(jq -r '.client_secrets[0].secret' import.json)
curl -sS -u "billing-app:$SECRET" \
  --data-urlencode 'grant_type=client_credentials' \
  http://localhost:3000/tenants/import-demo2/protocol/openid-connect/token \
  | jq -c '{token_type, expires_in, has_access_token: (.access_token | length > 0)}'
```

```
{"token_type":"Bearer","expires_in":300,"has_access_token":true}
```

The new tenant exported again, compared with the source's document with
`omitted` and `settings.display_name` set aside — `grace` already owed
`update-password` in the source, so her `required_actions` are unchanged —
and then those two fields side by side:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/import-demo2/export?include=subjects" > imported.json
diff <(jq -S 'del(.omitted, .settings.display_name)' source.json) \
     <(jq -S 'del(.omitted, .settings.display_name)' imported.json) && echo identical
jq -c '{display_name: .settings.display_name, omitted}' source.json imported.json
```

```
identical
{"display_name":"Import source","omitted":["clients[0].secret"]}
{"display_name":"Import demo","omitted":["clients[0].secret"]}
```

Each tenant's signing key, then the import's row in the new tenant's
trail, scoped to the tenant `resource_id` this import created — the only
row it could ever hold, since an import always creates a fresh tenant
rather than writing into one that already exists:

The same again, now that each row answers `actor_name` and `actor_origin`; the
ids are a fresh run's, not those above:

```bash
for tenant in import-source import-demo2; do
  curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
    "http://localhost:3000/admin/tenants/$tenant/keys" | jq -c '[.items[].kid]'
done
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/import-demo2/audit?action=tenant.import&resource_type=tenant&resource_id=$(jq -r .tenant.id import.json)"; echo
```

```
["01a18736-2c5e-78ce-8392-3bd18c0b31ad"]
["01a18736-2dfe-7b00-b012-0d6990e863cc"]
{"items":[{"id":"01a18736-2e5e-78cb-b899-184b51e887d5","occurred_at":"2026-10-29T10:30:37.260Z","event_type":"admin_mutation","action":"tenant.import","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"tenant","resource_id":"01a18736-2dcc-756d-ab0a-9251fab5650a","request_id":"01a18736-2db6-766b-adbe-cf3622b60f31","ip":"172.20.0.1","detail":{"counts":{"roles":9,"groups":1,"scopes":8,"clients":1,"subjects":1,"message_overrides":1},"source_version":1}}]}
```

A document broken in two places at once — a scope mapping naming a role
that does not exist, and a redirect URI registration would refuse. In the
saved document `scopes[0]` is `address`, mapping no role, and `clients[0]`
is `billing-app`, registering no redirect URI:

```bash
jq -c '{scope: .scopes[0].name, scope_roles: .scopes[0].roles, client: .clients[0].client_id, redirect_uris: .clients[0].redirect_uris}' source.json
```

```
{"scope":"address","scope_roles":[],"client":"billing-app","redirect_uris":[]}
```

Both problems are answered together, and no tenant was created:

```bash
jq '.scopes[0].roles = [{"name": "no-such-role", "client": null}]
    | .clients[0].redirect_uris = ["http://billing.example/callback"]' source.json \
  | jq -c '{name: "import-broken", document: .}' \
  | curl -sS -D - -X POST \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary @- \
      http://localhost:3000/admin/tenant-imports
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants?name=import-broken"
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a18736-2f2d-7f41-aeb8-8b9cbaf4e8f5
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 390
Date: Thu, 29 Oct 2026 10:30:37 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"the import was refused for 2 problem(s), listed under errors","errors":[{"path":"document.scopes[0].roles[0]","message":"names no role no-such-role"},{"path":"document.clients[0].redirect_uris","message":"redirect_uris entry http://billing.example/callback is not valid"}],"instance":"01a18736-2f2d-7f41-aeb8-8b9cbaf4e8f5"}
{"items":[]}
```

A name already in use, then a reserved one:

```bash
for name in import-source system; do
  jq -c --arg name "$name" '{name: $name, document: .}' source.json \
    | curl -sS -X POST \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        -H "Content-Type: application/json" \
        --data-binary @- \
        http://localhost:3000/admin/tenant-imports
  echo
done
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"the name \"import-source\" is already in use","instance":"01a18736-2f5f-7c30-b53f-0553014eddc4"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"the import was refused for 1 problem(s), listed under errors","errors":[{"path":"name","message":"the name \"system\" is reserved"}],"instance":"01a18736-2f77-7cbf-8477-7da0b1eaabd7"}
```

And a body over the limit:

```bash
python3 -c 'import json; print(json.dumps({"name": "import-huge", "document": {"padding": "x" * (16 * 1024 * 1024)}}))' > huge.json
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @huge.json \
  http://localhost:3000/admin/tenant-imports
```

```
{"type":"about:blank","title":"FastifyError","status":413,"detail":"Request body is too large","instance":"01a18736-2fe4-758c-871c-776f557af517"}
```

And a document of 10,001 copies of `grace`, each under its own username, built
from a fresh export of `import-source` — refused, and no tenant created:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/import-source/export?include=subjects" > source.json
jq -c '{name: "import-crowd", document: (.subjects = [range(10001) as $i
    | .subjects[0] + {username: "user-\($i)", email: null}])}' source.json \
  | curl -sS -X POST \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary @- \
      http://localhost:3000/admin/tenant-imports
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/count?name=import-crowd'
echo
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"the import was refused for 1 problem(s), listed under errors","errors":[{"path":"document.subjects","message":"the tenant holds more than 10000 subjects, too many to export with ?include=subjects; export without it, and move users in bulk through inbound provisioning (P7)"}],"instance":"01a18736-30de-7019-9524-acc75e1971cb"}
{"count":0,"capped":false}
```

And a document nesting the tenant role `billing-reader` under `view-users`,
built from a fresh export of `import-source` on this branch's head: refused
at the composite's own path, and no tenant created:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/import-source/export > source.json
jq -c '{name: "import-nested", document: (.roles |= map(
    if .builtin and .name == "view-users"
    then .composites += [{name: "billing-reader", client: null}] else . end))}' source.json \
  | curl -sS -X POST \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary @- \
      http://localhost:3000/admin/tenant-imports
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/count?name=import-nested'
echo
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"the import was refused for 1 problem(s), listed under errors","errors":[{"path":"document.roles[8].composites[0]","message":"nests billing-reader under view-users, which a new tenant provisions without it: nothing is nested under a capability role"}],"instance":"01a18736-3510-74b3-b0f5-66fc86db7111"}
{"count":0,"capped":false}
```

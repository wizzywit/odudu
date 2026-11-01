---
title: 'Scopes: list, create, read, update, delete'
description: "All five require manage-tenant. include_in_id_token and include_in_access_token (both default true) decide which token a scope's claims land in…"
---

# Scopes: list, create, read, update, delete

This page covers `GET /scopes`, `POST /scopes`, `GET /scopes/:id`, `PATCH /scopes/:id` and `DELETE /scopes/:id`.

All five require `manage-tenant`. `include_in_id_token` and
`include_in_access_token` (both default `true`) decide which token a
scope's claims land in; `PATCH` amends either, plus `description` and
`default_client_assignment` — `name` is refused, since it is the scope token
a client requests and a token carries. A duplicate name answers `409`.

**`default_client_assignment` is the tenant's default client scopes.** A scope
marked `default` or `optional` is assigned, that way, to every client created
afterwards — by `POST /clients`, by dynamic registration, by `odudu seed` and by
`seed client`, which all call `provisionClientDefaults` — and `null` leaves it
to be assigned deliberately. A new tenant marks the vocabulary it provisions as
that code always assigned it: `openid`, `profile`, `email`, `address`, `phone`,
`roles` and `groups` `default`, `offline_access` `optional`, and
`0089_scope_client_default.sql` marked an upgraded tenant's scopes of those
names the same way. A mark changes no client that already exists. It is a
scope's own column rather than a tenant setting listing names, because the
assignment kind belongs to each scope, and a deleted scope takes its mark with
it instead of leaving a name that matches nothing.

**`consent_text` and `display_order` are what the consent screen shows.**
The screen lists a client's requested scopes by `display_order` (an integer,
`0` by default, never negative), then by name, the pre-approved ones first
and the optional ones after, and shows each by its `consent_text` where it
has one — at most 500 characters, or `null` for the bare scope name — every
value through the page's own `escapeHtml`, with the page's policy unchanged:
it still carries no script. The text is one string for now; a text per
locale comes with the translated pages ([the roadmap](../../../roadmap.md#next)). Both travel in the
tenant document and are amended by `PATCH`.

`DELETE` cascades:
`client_scope_assignments_scope_fk` and `client_scope_roles_scope_fk` both name
`ON DELETE CASCADE`, not `RESTRICT`, so deleting an assigned, role-mapped
scope removes it and both dependent rows together rather than refusing —
**except the scope named `openid`**, refused with `409`: the same cascade
would strip it from every client's assignment in the tenant in one stroke,
the built-in admin client's included, which
`DELETE /scopes/:id/clients/:clientId` below refuses for that one client
alone. Every other scope stays deletable whatever it is assigned to,
unless the roles it maps reach an admin capability the caller does not hold
([a removal is judged by what it removes](./get-groupsidroles-and-put-groupsidroles.md#a-removal-is-judged-by-what-it-removes))
— a tenant-wide decision, not a per-client one. A **built-in** scope, one every
tenant is given, is deleted only when `?confirm=` names it again, so a script
cannot take one by accident, and an ordinary scope needs no confirmation; the
[built-in scopes page](./get-scopesidimpact-get-scopesbuiltins-and-post-scopesrestore-builtins.md)
shows the refusal, the confirmation and how to get one back. Every delete's
audit row carries `builtin` and how many client assignments and role mappings
it took.

Everything on this page ran in one session on a freshly built stack with `odudu
seed admin --username ada` run against it and `$ADMIN_TOKEN` got as in [Getting
the token](./getting-the-token.md). The tenant is `demo`, created first:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"demo"}' http://localhost:3000/admin/tenants -o /dev/null
```

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "billing", "include_in_id_token": false}' \
  http://localhost:3000/admin/tenants/demo/scopes
```

```
{"id":"01a1872c-0f50-76e2-826f-b46896955125","name":"billing","description":null,"include_in_id_token":false,"include_in_access_token":true,"default_client_assignment":null,"consent_text":null,"description_i18n":{},"consent_text_i18n":{},"display_order":0,"created_at":"2026-10-29T10:19:34.093Z"}
```

In `demo`: `billing` given a consent text, a place on the consent screen and a
client default, then a default that is none of the three values refused by name,
then a client created afterwards — its `scopes`, narrowed with `jq`, carry
`billing` as `optional` beside the vocabulary a new tenant marks:

```bash
BILLING=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:3000/admin/tenants/demo/scopes?name=billing" | jq -r '.items[0].id')
```

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"consent_text": "See and pay your invoices", "display_order": 10, "default_client_assignment": "optional"}' \
  http://localhost:3000/admin/tenants/demo/scopes/$BILLING; echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"default_client_assignment": "always"}' \
  http://localhost:3000/admin/tenants/demo/scopes/$BILLING; echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"client_id": "billing-portal", "redirect_uris": ["https://billing.demo.example/callback"]}' \
  http://localhost:3000/admin/tenants/demo/clients | jq -c '[.scopes[] | {name, assignment}]'
```

```
{"id":"01a1872c-0f50-76e2-826f-b46896955125","name":"billing","description":null,"include_in_id_token":false,"include_in_access_token":true,"default_client_assignment":"optional","consent_text":"See and pay your invoices","description_i18n":{},"consent_text_i18n":{},"display_order":10,"created_at":"2026-10-29T10:19:34.093Z"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"default_client_assignment: default_client_assignment must be default, optional or null","errors":[{"path":"default_client_assignment","message":"default_client_assignment must be default, optional or null"}],"instance":"01a1872c-0f84-7232-a72b-d18f75379d8b"}
[{"name":"openid","assignment":"default"},{"name":"profile","assignment":"default"},{"name":"email","assignment":"default"},{"name":"address","assignment":"default"},{"name":"phone","assignment":"default"},{"name":"roles","assignment":"default"},{"name":"groups","assignment":"default"},{"name":"offline_access","assignment":"optional"},{"name":"billing","assignment":"optional"}]
```

In `demo`, with `billing` created and marked as above: a public client `consent-portal`,
named `Consent <Portal>`, made with `consent_required` and given the vocabulary
— `billing` among it — by `POST /clients`; `profile` given a text and an order;
`grace` seeded with `odudu seed user`; then a sign-in asking for the four scopes
in another order. The pre-approved pair is listed `openid` then `profile`, by
their `display_order` of `0` and `5`, the optional pair `offline_access` then
`billing`, by `0` and `10`, each with its text where it has one, escaped:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"client_id":"consent-portal","name":"Consent <Portal>","redirect_uris":["https://portal.demo.example/callback"],"token_endpoint_auth_method":"none","consent_required":true}' \
  http://localhost:3000/admin/tenants/demo/clients > /dev/null
PROFILE=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:3000/admin/tenants/demo/scopes?name=profile" | jq -r '.items[0].id')
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"consent_text":"Your name & <picture>","display_order":5}' \
  http://localhost:3000/admin/tenants/demo/scopes/$PROFILE > /dev/null
docker compose exec -T odudu node dist/main.js seed user --tenant demo \
  --username grace --password 'correct-horse-battery-8c2' > /dev/null
```

```bash
AUTH_SESSION_ID=$(curl -sS -c consent.jar -b consent.jar \
  'http://localhost:3000/tenants/demo/protocol/openid-connect/auth?response_type=code&client_id=consent-portal&redirect_uri=https%3A%2F%2Fportal.demo.example%2Fcallback&scope=openid%20billing%20profile%20offline_access&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256' \
  | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)
curl -sS -D - -c consent.jar -b consent.jar \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=grace' --data-urlencode 'password=correct-horse-battery-8c2' \
  http://localhost:3000/tenants/demo/login-actions/authenticate
```

```
HTTP/1.1 200 OK
x-request-id: 01a1872c-1278-7130-8b7e-42001f96dec7
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' https://portal.demo.example; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 1596
Date: Thu, 29 Oct 2026 10:19:34 GMT
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
<h1><bdi>Consent &lt;Portal&gt;</bdi> is asking for access</h1>
<p class="tenant"><bdi>demo</bdi></p>
</header>
<form method="post" action="/tenants/demo/login-actions/consent">
  <input type="hidden" name="auth_session_id" value="01a1872c-125d-73ac-a52c-a254e4260d7e">
  <ul>
  <li><bdi>openid</bdi></li>
  <li><bdi>Your name &amp; &lt;picture&gt;</bdi></li>
  </ul>
  <label><input type="checkbox" name="scope" value="offline_access"> <bdi>offline_access</bdi> — grants ongoing access, even while you are not present</label>
  <label><input type="checkbox" name="scope" value="billing"> <bdi>See and pay your invoices</bdi></label>
  <button type="submit" name="decision" value="allow">Allow</button>
  <button type="submit" name="decision" value="deny" class="secondary">Deny</button>
</form>
</main>
</body>
</html>
```

The `openid` guard, against `scope-guard-demo` made for it, on the same
`openid` scope the built-in admin client section above names:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"scope-guard-demo"}' http://localhost:3000/admin/tenants -o /dev/null
OPENID=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:3000/admin/tenants/scope-guard-demo/scopes?name=openid" | jq -r '.items[0].id')
```

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/scope-guard-demo/scopes/$OPENID
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1872c-1318-7bad-ba39-118acd503a78
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 285
Date: Thu, 29 Oct 2026 10:19:35 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"openid is deleted along with every client’s assignment of it, this tenant’s built-in admin client’s included, and could lock out every administrator of this tenant","instance":"01a1872c-1318-7bad-ba39-118acd503a78"}
```

**Search** is `?name=`, the same prefix match `GET /roles` describes, over
`client_scopes.name_search`. Whose `demo` held the eight scopes a tenant is
provisioned with, each cut down with `jq` to the fields that show the point;
then a cursor minted under `?name=p` replayed under `?name=o`:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/scopes?name=O" \
  | jq -c '{items: [.items[] | {name}]}'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/scopes?name=p&limit=1" \
  | jq -c '{items: [.items[] | {name}], next}'
```

```
{"items":[{"name":"offline_access"},{"name":"openid"}]}
{"items":[{"name":"phone"}],"next":"eyJhZnRlciI6IjAxYTE4NzJjLTBmMGItN2NlNC1iOTBhLWI1ZDNlZmM1NjVlMiIsInNvcnQiOiJwaG9uZSIsImNvbGxlY3Rpb24iOiJzY29wZXMiLCJ0ZW5hbnRJZCI6IjAxYTE4NzJjLTBmMDEtN2ZkYS1iZDE4LTM1ZTQxNWE3YzhiMyIsImZpbHRlcnMiOiJBbkY0THhTZFRNWjMxMEJpUjZFN3pGYWFCQ1hDcnZIMGFDVjZ2ZzJRUmg4In0.jXwBP0Ubo9WIakOq3puylBmh8BBRMx-EQY9IHwFU9ss"}
```

```bash
CURSOR=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/scopes?name=p&limit=1" | jq -r .next)
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/scopes?limit=1&name=p&cursor=$CURSOR" \
  | jq -c '{items: [.items[] | {name}], next}'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/scopes?limit=1&name=o&cursor=$CURSOR"
```

```
{"items":[{"name":"profile"}],"next":null}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","errors":[{"path":"cursor","message":"is invalid or expired"}],"instance":"01a1872c-1384-7172-83de-d8fe26e704bc"}
```

## How many a tenant defines

A tenant defines at most 1000 scopes: discovery and `/authorize` read the set,
so it is bounded by the model rather than paged. On `perf-demo`, after `scope-1`
to `scope-992` (the tenant provisions eight of its own), the next create:

```bash
P=http://localhost:3000/admin/tenants/perf-demo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"perf-demo"}' http://localhost:3000/admin/tenants -o /dev/null
for i in $(seq 1 992); do
  curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
    -d "{\"name\":\"scope-$i\"}" "$P/scopes" -o /dev/null
done
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/scopes?limit=1" -o /dev/null -w '%{http_code}\n'
```

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"name":"scope-extra"}' "$P/scopes"
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1872c-873d-7229-862a-8b6d8636b835
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 152
Date: Thu, 29 Oct 2026 10:20:04 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"a tenant defines at most 1000 scopes","instance":"01a1872c-873d-7229-862a-8b6d8636b835"}
```

## The most scopes marked for every new client

A new client is assigned every scope marked with a `default_client_assignment`,
by an administrator, dynamic registration or `odudu seed`, so the marks are held
to the same 200 as what a client carries: marking another, on `POST /scopes` or by
`PATCH`, is refused with `409` once 200 are marked, and changing a marked scope
between `default` and `optional`, or unmarking one, is not. The count is taken
under a lock on the tenant's row, as the 1,000-scope limit's is. A tenant import
that marks more is refused with `400` at `document.scopes`.

Against `scope-limit-docs`, with 192 more marked scopes created through `POST
/scopes` beside the 8 the tenant is provisioned with, and `$SID` (`reports:read`)
still unmarked:

```bash
P=http://localhost:3000/admin/tenants/scope-limit-docs
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"scope-limit-docs"}' http://localhost:3000/admin/tenants -o /dev/null
for i in $(seq 1 192); do
  curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
    -d "{\"name\":\"marked-$i\",\"default_client_assignment\":\"optional\"}" "$P/scopes" -o /dev/null
done
SID=$(curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"reports:read"}' "$P/scopes" | jq -r .id)
```

```bash
docker compose exec -T postgres psql -U odudu -d odudu -tA -c "select count(*) from client_scopes s join tenants t on t.id = s.tenant_id where t.name = 'scope-limit-docs' and s.default_client_assignment is not null"
docker compose exec -T postgres psql -U odudu -d odudu -tA -c "select default_client_assignment is null from client_scopes where id = '$SID'"
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"one-too-many","default_client_assignment":"default"}' "$P/scopes"
curl -sS -D - -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"default_client_assignment":"optional"}' "$P/scopes/$SID"
```

```
200
t
HTTP/1.1 409 Conflict
x-request-id: 01a1872c-ba90-7a34-b8e0-40f8ccc705b6
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 167
Date: Thu, 29 Oct 2026 10:20:17 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"at most 200 scopes are assigned to every new client","instance":"01a1872c-ba90-7a34-b8e0-40f8ccc705b6"}HTTP/1.1 409 Conflict
x-request-id: 01a1872c-bae3-78a2-955c-9bc78dcc4732
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 167
Date: Thu, 29 Oct 2026 10:20:18 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"at most 200 scopes are assigned to every new client","instance":"01a1872c-bae3-78a2-955c-9bc78dcc4732"}
```

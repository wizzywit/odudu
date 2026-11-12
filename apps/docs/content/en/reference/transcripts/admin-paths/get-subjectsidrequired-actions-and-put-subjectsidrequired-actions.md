---
title: "A subject's required actions: read and set"
description: "Reading a subject's required actions requires view-users, and replacing them requires manage-users."
---

# A subject's required actions: read and set

This page covers `GET /subjects/:id/required-actions` and `PUT /subjects/:id/required-actions`.

The read requires `view-users`, the write `manage-users`. Sets a subject's
required actions wholesale — an action left out of the list is one the
caller clears, not one left alone.

**`If-Match` is mandatory here, not optional.** This route replaces an
authorization-bearing list whole, so a stale write reinstates exactly what
another administrator has just removed; the header comes from the matching
`GET`, which answers an `ETag` over the same list. Absent, the request is
refused with `428 Precondition Required` and nothing is changed; stale,
with `412`. The list is read under the same lock the replacement runs
under, so two callers sent at once are serialised — the second sees what
the first wrote rather than matching the same pre-write state.

On `grace`, who was created through `POST /subjects` and so carries
`update-password` and nothing else. The read first, for the `ETag` the write
needs:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d7ef-2be7-7a2e-bbc5-4646e22c3169/required-actions
```

```
HTTP/1.1 200 OK
x-request-id: 01a0d7ef-47de-7e63-b9e4-f21b023efd84
cache-control: no-store
etag: "b6a877586a3e8e6eec8a74fd3ec35d6463a777d4a4f379aa095140acd8edcc10"
content-type: application/json; charset=utf-8
content-length: 31
Date: Tue, 27 Oct 2026 01:30:13 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"actions":["update-password"]}
```

The same write twice: without the header, then with it.

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"actions": ["configure-totp"]}' \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d7ef-2be7-7a2e-bbc5-4646e22c3169/required-actions

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "b6a877586a3e8e6eec8a74fd3ec35d6463a777d4a4f379aa095140acd8edcc10"' \
  -d '{"actions": ["configure-totp"]}' \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d7ef-2be7-7a2e-bbc5-4646e22c3169/required-actions
```

The reply to the second is the set as it now stands — `update-password` is
gone, cleared by being left out — and a fresh `ETag` for the next write:

```
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace a subject’s required actions","instance":"01a0d7ef-47f4-770e-84d7-b7570de8508e"}
HTTP/1.1 200 OK
x-request-id: 01a0d7ef-62d6-749d-815d-05486997038e
cache-control: no-store
etag: "eef964de74a02f6ce5f1ed1b1aa5e6a4f65aee68bfd955a4db04374af8ec513b"
content-type: application/json; charset=utf-8
content-length: 30
Date: Tue, 27 Oct 2026 01:30:13 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"actions":["configure-totp"]}
```

Replaying the first `ETag`, now one generation stale, changes nothing:

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "b6a877586a3e8e6eec8a74fd3ec35d6463a777d4a4f379aa095140acd8edcc10"' \
  -d '{"actions": ["configure-totp"]}' \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d7ef-2be7-7a2e-bbc5-4646e22c3169/required-actions
```

```
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0d7ef-62f8-7819-a402-6a7987acd136"}
```

## Three actions that ask more of a person

The list names any of `verify-email`, `update-password`, `configure-totp`, `configure-passkey`, `generate-recovery-codes`,
`update-profile` and `accept-terms`, which is the order a sign-in asks for them, and the read sorts them by name. An action that
cannot be owed is refused with `409` and a `type` that names why, and the whole list is refused with it: `no-email` for
`verify-email` on a subject with no address, `terms-not-configured` for `accept-terms` while the tenant has no `terms_uri`, and
`no-editable-profile-fields` for `update-profile` where a person may edit no profile field, which no tenant does yet, so it is not
shown. A subject whose address is already verified can still be owed `verify-email`: the next sign-in clears it without a page. The
set is the same for a mailed link's `actions-email`, except that it takes only `update-password`, `configure-totp`,
`configure-passkey` and `generate-recovery-codes`, and refuses the others with `400`.

The run below is the one [An address, a profile and the terms at sign-in](../request-paths/more-required-actions.md) makes, in its
tenant `more-demo`, with `lin` holding no address and `grace` holding one. Its sign-in half is on that page:

```bash
GRACE=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/admin/tenants/more-demo/subjects?username=grace" | jq -r '.items[0].id')
LIN=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/admin/tenants/more-demo/subjects?username=lin" | jq -r '.items[0].id')
BASE=http://localhost:3000
put() { # subject id, then the actions as a JSON list
  local etag; etag=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/admin/tenants/more-demo/subjects/$1/required-actions" | grep -i '^etag:' | cut -d' ' -f2 | tr -d '\r')
  curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $etag" -H 'content-type: application/json' \
    -d "{\"actions\":$2}" "$BASE/admin/tenants/more-demo/subjects/$1/required-actions"
  echo
}
put $LIN '["verify-email"]'
put $GRACE '["accept-terms"]'
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1d1ba-a602-78bf-b8b6-04f94702a37b
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 189
Date: Thu, 12 Nov 2026 21:47:12 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#no-email","title":"Conflict","status":409,"detail":"the subject has no email address, so verify-email cannot be owed","instance":"01a1d1ba-a602-78bf-b8b6-04f94702a37b"}
HTTP/1.1 409 Conflict
x-request-id: 01a1d1ba-a62f-79b1-ba80-03c5aa4fef30
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 231
Date: Thu, 12 Nov 2026 21:47:12 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#terms-not-configured","title":"Conflict","status":409,"detail":"the tenant has no terms_uri, so accept-terms cannot be owed; set it with PATCH /settings first","instance":"01a1d1ba-a62f-79b1-ba80-03c5aa4fef30"}
```

With the terms set, as `PATCH /settings` sets them, the same write is accepted:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"terms_uri":"https://example.com/terms","terms_version":"2026-01"}' "$BASE/admin/tenants/more-demo/settings" \
  | jq -c '{terms_uri, terms_version}'
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"terms_uri":"http://example.com/terms"}' "$BASE/admin/tenants/more-demo/settings" | jq -c .
put $GRACE '["accept-terms","update-profile","verify-email"]'
```

```
{"terms_uri":"https://example.com/terms","terms_version":"2026-01"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"1 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"terms_uri","message":"must be an https address, or an http one to this machine, with no fragment"}],"instance":"01a1d1ba-a660-7f28-b4c2-fbe035d4d2cf"}
HTTP/1.1 200 OK
x-request-id: 01a1d1ba-a687-7aad-a45d-afdf3f7c20c8
cache-control: no-store
etag: "3c95abeefed1547300c92fafd42865cf075b9f54e2a070978ecb8418a80d0f6b"
content-type: application/json; charset=utf-8
content-length: 60
Date: Thu, 12 Nov 2026 21:47:12 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"actions":["accept-terms","update-profile","verify-email"]}
```

---
title: 'GET /subjects/:id/profile and PATCH /subjects/:id/profile'
description: "Reading a subject's profile requires view-users, and changing it requires manage-users."
---

# `GET /subjects/:id/profile` and `PATCH /subjects/:id/profile`

The read requires `view-users`, the write `manage-users`. Every OIDC
Core §5.1 claim column `users` carries, in the snake_case a claim itself
uses — `email_verified` and `phone_number_verified` beside them, both
writable here, and `profile_updated_at` last, stamped by the write and
never accepted from one. `email` and `username` are refused with `400`,
naming `PATCH /subjects/:id` above, which is the door that owns each; any
other member this schema does not carry is refused the same way, by ajv,
before either usecase runs. `If-Match` is optional, not mandatory: honoured
against a stale value with `412`, but never required with `428` the way a
replace-the-whole-list route requires it — a profile patches field by
field, so nothing here can reinstate what a concurrent write removed. An
id naming a service or `agent_instance` subject — one with no `users`
row — answers `404`, the same as one that does not exist at all.

**Submitting a different `phone_number` without also setting
`phone_number_verified` in the same request resets it to `false`.** A
different number is not a verified one — the same reasoning that keeps a new
email address from being stored as verified: `PATCH /subjects/:id` holds it as
a pending change until the person follows a mailed link. Resubmitting the same number — an echoed full-object
`PATCH`, say — leaves a verified flag exactly as it was.

After a further rebuild, in a tenant of its own, `profile-demo2`, on a fresh
subject `grace`:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/profile-demo2/subjects/01a0e277-e90a-7876-926a-b433ce61d250/profile
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e547-2b15-7670-ae92-02b8e9908ee0
cache-control: no-store
etag: "89eee16f2b512c80447670ad49fb70fe65db78a9c41a4fa4bf5e3db6d43ee154"
content-type: application/json; charset=utf-8
content-length: 459
Date: Sun, 27 Sep 2026 23:50:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"name":null,"given_name":null,"family_name":null,"middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":null,"phone_number_verified":false,"email_verified":false,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":null}
```

Amending `given_name` and `family_name` stamps `profile_updated_at`:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"given_name": "Grace", "family_name": "Hopper"}' \
  http://localhost:3000/admin/tenants/profile-demo2/subjects/01a0e277-e90a-7876-926a-b433ce61d250/profile
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e547-2b2e-778d-9e34-27579c864153
cache-control: no-store
etag: "aefc948e4d8f2d7760fb5c2128aad70532e78b41c0154c739aa7b0fc6fc34378"
content-type: application/json; charset=utf-8
content-length: 488
Date: Sun, 27 Sep 2026 23:50:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"name":null,"given_name":"Grace","family_name":"Hopper","middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":null,"phone_number_verified":false,"email_verified":false,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":"2026-09-27T23:50:41.728Z"}
```

`email_verified` is set the same way, against the address `PATCH
/subjects/:id` owns (a prior call there set it to `grace@example.com`):

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email_verified": true}' \
  http://localhost:3000/admin/tenants/profile-demo2/subjects/01a0e277-e90a-7876-926a-b433ce61d250/profile
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e547-2b52-728e-8ee6-66c374744e5f
cache-control: no-store
etag: "c259cc5c1665ca05b130f21449a01b5bbcf9c5ccae407ff1c43ed5e0a9dc6985"
content-type: application/json; charset=utf-8
content-length: 487
Date: Sun, 27 Sep 2026 23:50:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"name":null,"given_name":"Grace","family_name":"Hopper","middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":null,"phone_number_verified":false,"email_verified":true,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":"2026-09-27T23:50:41.782Z"}
```

`email` in the same body is refused, naming the route that owns it instead of
`about:blank`'s usual bare wording. In a tenant also named `profile-demo2`
created there for it, on its own `grace`
(`01a0ea55-4091-7b5b-b743-8a713272538b`):

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "someone-else@example.com"}' \
  http://localhost:3080/admin/tenants/profile-demo2/subjects/01a0ea55-4091-7b5b-b743-8a713272538b/profile
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0ea55-40a0-7046-b712-f0de1859b263
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 357
Date: Mon, 28 Sep 2026 23:24:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"email: email is amended through PATCH /admin/tenants/{tenant}/subjects/{id}, not a subject’s profile","errors":[{"path":"email","message":"email is amended through PATCH /admin/tenants/{tenant}/subjects/{id}, not a subject’s profile"}],"instance":"01a0ea55-40a0-7046-b712-f0de1859b263"}
```

Verifying a well-shaped number:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+14155552671", "phone_number_verified": true}' \
  http://localhost:3000/admin/tenants/profile-demo2/subjects/01a0e277-e90a-7876-926a-b433ce61d250/profile
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e547-4bb2-740b-9545-5552114faa8c
cache-control: no-store
etag: "79e6637e8dce86bf009affff462a1ab69fa0cf94d21f3fbfae877ec71c0adb26"
content-type: application/json; charset=utf-8
content-length: 496
Date: Sun, 27 Sep 2026 23:50:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"name":null,"given_name":"Grace","family_name":"Hopper","middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":"+14155552671","phone_number_verified":true,"email_verified":true,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":"2026-09-27T23:50:50.072Z"}
```

Submitting a different number, with no `phone_number_verified` in the
body, resets it — the rule stated above, shown rather than only asserted:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+442083661177"}' \
  http://localhost:3000/admin/tenants/profile-demo2/subjects/01a0e277-e90a-7876-926a-b433ce61d250/profile
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e547-4bed-7ba2-8f0c-93fcf7f89fee
cache-control: no-store
etag: "7fa28e5a48761a7ec3dee2a5022f92b32fef01fa2a10a0f2ac94c3202833766a"
content-type: application/json; charset=utf-8
content-length: 498
Date: Sun, 27 Sep 2026 23:50:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"name":null,"given_name":"Grace","family_name":"Hopper","middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":"+442083661177","phone_number_verified":false,"email_verified":true,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":"2026-09-27T23:50:50.114Z"}
```

After re-verifying that same number, resubmitting it — an echoed
full-object `PATCH`, say, which carries `phone_number` on every call
whether or not it changed — leaves `phone_number_verified` exactly as it
was, because the submitted value is compared against the stored one, not
merely checked for presence:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone_number_verified": true}' \
  http://localhost:3000/admin/tenants/profile-demo2/subjects/01a0e277-e90a-7876-926a-b433ce61d250/profile
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e547-4c11-77a2-b446-fc99f2003d15
cache-control: no-store
etag: "aff9c3a5c78bb68b2afc724e43278c86673c405b56abc4dc47af252e0e9e9799"
content-type: application/json; charset=utf-8
content-length: 497
Date: Sun, 27 Sep 2026 23:50:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"name":null,"given_name":"Grace","family_name":"Hopper","middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":"+442083661177","phone_number_verified":true,"email_verified":true,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":"2026-09-27T23:50:50.143Z"}
```

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+442083661177"}' \
  http://localhost:3000/admin/tenants/profile-demo2/subjects/01a0e277-e90a-7876-926a-b433ce61d250/profile
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e547-4c2d-7def-a747-d1dba8d58b68
cache-control: no-store
etag: "aff9c3a5c78bb68b2afc724e43278c86673c405b56abc4dc47af252e0e9e9799"
content-type: application/json; charset=utf-8
content-length: 497
Date: Sun, 27 Sep 2026 23:50:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"name":null,"given_name":"Grace","family_name":"Hopper","middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":"+442083661177","phone_number_verified":true,"email_verified":true,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":"2026-09-27T23:50:50.143Z"}
```

The `ETag` and `profile_updated_at` are unchanged from the call before —
nothing was written at all, `phone_number` included, since the value it
carried was already there.

`amendProfile` computes the row's final state — this patch's values layered over
what is already there — before writing anything, so verifying a malformed number
is refused without ever reaching `users_verified_phone_is_e164` or writing a
number the caller asked to leave unverified. `isValidE164` mirrors that CHECK,
the same way `isValidBirthdate` mirrors `users_birthdate_shape`. On the `grace`
the `email` refusal above names:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "(415) 555-2671", "phone_number_verified": true}' \
  http://localhost:3080/admin/tenants/profile-demo2/subjects/01a0ea55-4091-7b5b-b743-8a713272538b/profile
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0ea55-40bc-756b-a601-8dff990c69fd
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 321
Date: Mon, 28 Sep 2026 23:24:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"phone_number: phone_number must be E.164-shaped for phone_number_verified to be true","errors":[{"path":"phone_number","message":"phone_number must be E.164-shaped for phone_number_verified to be true"}],"instance":"01a0ea55-40bc-756b-a601-8dff990c69fd"}
```

---
title: 'Domains: register, verify, switch, remove'
description: 'Reads need view-domains and every change manage-domains. A tenant registers a host, proves it with a DNS record and makes it its address.'
---

# Domains: register, verify, switch, remove

This page covers `GET /domains`, `POST /domains`, `GET /domains/passkey-impact`, `GET /domains/:id`, `POST /domains/:id/verify`, `POST /domains/:id/activate`, `POST /domains/:id/deactivate` and `DELETE /domains/:id`.

The three reads, `GET /domains`, `GET /domains/:id` and `GET /domains/passkey-impact`, require
`view-domains`. The five changes, `POST /domains`, `POST /domains/:id/verify`,
`POST /domains/:id/activate`, `POST /domains/:id/deactivate` and
`DELETE /domains/:id`, require `manage-domains`, which carries `view-domains` the way
`manage-users` carries `view-users`.

Every command below was run, in this order, on one stack: a freshly built compose stack on
port 3000 with `odudu seed admin --username ada`, the tenants `demo` and `other` made with
`odudu seed tenant`, the throttles at `10000` and the schedules off. `ADMIN_TOKEN` is a token
from [Getting the token](./getting-the-token.md), made again each time its five minutes ran out,
and the ids, times and `ETag`s are that run's. Two refusals could not be run on a stack with no
DNS record to publish and are described, not shown: `409` `about:blank#domain-verified-elsewhere`,
which needs another tenant's verified host and this tenant's record seen for it, and the
verification of a failed domain once its record is back.

- `POST /domains` with `{"host": "login.acme.com"}` answers `201` with the domain, `pending`,
  and `dns_record`: the `name` (`_odudu-challenge.login.acme.com`) and the `value` the TXT
  record must hold. The host is stored in its lowercase punycode spelling. Refused with a
  problem whose `type` is one of `about:blank#domain-system-tenant`, `domain-no-base-url`,
  `domain-limit`, `domain-already-registered`, `domain-host-ip-literal`,
  `domain-host-localhost`, `domain-host-operator`, `domain-host-reserved` or
  `domain-host-invalid`. Writes `domain.registered`.
- `POST /domains/:id/verify` looks the TXT record up and, when it holds the value, marks the
  domain `verified` and writes `domain.verified`; otherwise it answers the domain still
  `pending`. A tenant looks a host up at most once every 30 seconds and makes at most ten
  lookups a minute; past either, `429` with `Retry-After` and
  `about:blank#domain-verify-throttled`, and no lookup is made. A host another tenant
  verified first is refused here, not at registration, and answers `409` `about:blank#domain-verified-elsewhere` and writes
  `domain.failed`; a domain that is `failed` answers `409` `about:blank#domain-failed` while its record is still not
  seen, and is verified once the record is seen again.
- `POST /domains/:id/activate` makes a verified domain the tenant's address, in one
  transaction that also lets the previous address's tokens stay valid for an hour. An
  unverified domain answers `409` `about:blank#domain-not-verified`; a change of the address
  that landed first answers `409` `about:blank#domain-switch-conflict`. Writes
  `domain.activated`.
- `POST /domains/:id/deactivate` returns the tenant to its path address when the domain is
  its address, without any DNS lookup, and writes `domain.deactivated`. A domain that is not
  the address is answered as it is.
- `DELETE /domains/:id` answers `204` and writes `domain.removed`; the tenant's address is
  refused with `409` `about:blank#domain-canonical`.
- `GET /domains/passkey-impact?canonical=path` (or a host of the tenant's) answers
  `{"subjects": n, "capped": false}`: how many subjects hold a passkey registered under a
  different relying party ID than that address uses, which a switch would hide.

Every domains response carries an `ETag` over which domain, if any, is the tenant's address.
`activate` and `deactivate` require it in `If-Match`: `428` without it, `412` when stale. `GET /domains` pages by host with `limit` and `cursor`.

A tenant export leaves the tenant's domains out, and an import with a `domains` key is
refused as an unknown field, so a host can only be claimed by proving it.

## An empty list

`demo` has no domain, so its address is the path address, and the `ETag` that every domains response carries is the one for "no domain is the address":

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/domains
```

```
HTTP/1.1 200 OK
x-request-id: 01a1a892-7eb0-7a46-a50e-94a1525a6e26
cache-control: no-store
etag: "4c8f0793cefd5ded11e95d1bd8e1cfaf41295a5cdce8231237b0e89fcb8f7cce"
content-type: application/json; charset=utf-8
content-length: 12
Date: Wed, 04 Nov 2026 21:58:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[]}
```

## Register a domain

The answer is the domain, `pending`, and the record to publish. The `value` is a secret nobody else can guess, and the page of a domain that is already verified shows `dns_record` as `null`:

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"host":"login.acme-corp.dev"}' \
  http://localhost:3000/admin/tenants/demo/domains
```

```
HTTP/1.1 201 Created
x-request-id: 01a1a892-7ecb-7237-8da9-eb88abde7f75
cache-control: no-store
etag: "4c8f0793cefd5ded11e95d1bd8e1cfaf41295a5cdce8231237b0e89fcb8f7cce"
content-type: application/json; charset=utf-8
content-length: 293
Date: Wed, 04 Nov 2026 21:58:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"77ffa5aa-b869-4a8f-aed5-e099557cce54","host":"login.acme-corp.dev","state":"pending","canonical":false,"verified_at":null,"last_checked_at":null,"dns_record":{"name":"_odudu-challenge.login.acme-corp.dev","value":"odudu-domain-verification=oluzoqu_ke3-6FCclGwNr0V2y6TcAIsIwIyOsPSKP44"}}
```

Registering the same host again is refused, and so is a host that is not a domain. The host is read in its lowercase spelling first, so `Login.Acme-Corp.dev` is the host already registered. Each refusal is a problem document whose `type` names the rule:

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"host":"login.acme-corp.dev"}' \
  http://localhost:3000/admin/tenants/demo/domains
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1a892-7eeb-79cd-ab6d-bb51f2cd6781
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 185
Date: Wed, 04 Nov 2026 21:58:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#domain-already-registered","title":"Conflict","status":409,"detail":"the tenant has registered this host already","instance":"01a1a892-7eeb-79cd-ab6d-bb51f2cd6781"}
```

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"host":"Login.Acme-Corp.dev"}' \
  http://localhost:3000/admin/tenants/demo/domains
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1a892-7f27-75ce-bd76-87513207142c
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 185
Date: Wed, 04 Nov 2026 21:58:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#domain-already-registered","title":"Conflict","status":409,"detail":"the tenant has registered this host already","instance":"01a1a892-7f27-75ce-bd76-87513207142c"}
```

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"host":"127.0.0.1"}' \
  http://localhost:3000/admin/tenants/demo/domains
```

```
HTTP/1.1 422 Unprocessable Entity
x-request-id: 01a1a892-7f05-7735-9aa7-1b6efb0da627
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 184
Date: Wed, 04 Nov 2026 21:58:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#domain-host-ip-literal","title":"Unprocessable Content","status":422,"detail":"an IP address cannot be a domain","instance":"01a1a892-7f05-7735-9aa7-1b6efb0da627"}
```

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"host":"localhost"}' \
  http://localhost:3000/admin/tenants/demo/domains
```

```
HTTP/1.1 422 Unprocessable Entity
x-request-id: 01a1a892-7f42-7d97-a53d-5fb62f8a124b
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 179
Date: Wed, 04 Nov 2026 21:58:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#domain-host-localhost","title":"Unprocessable Content","status":422,"detail":"localhost cannot be a domain","instance":"01a1a892-7f42-7d97-a53d-5fb62f8a124b"}
```

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"host":"not a host"}' \
  http://localhost:3000/admin/tenants/demo/domains
```

```
HTTP/1.1 422 Unprocessable Entity
x-request-id: 01a1a892-7f58-7ba4-87e3-9d4edff1eedf
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 210
Date: Wed, 04 Nov 2026 21:58:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#domain-host-invalid","title":"Unprocessable Content","status":422,"detail":"the host is not a lowercase, punycode DNS name without a port","instance":"01a1a892-7f58-7ba4-87e3-9d4edff1eedf"}
```

## Read one, and ask for the proof

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/domains/77ffa5aa-b869-4a8f-aed5-e099557cce54
```

```
HTTP/1.1 200 OK
x-request-id: 01a1a892-7f83-7c4b-9f5e-602a04cf1251
cache-control: no-store
etag: "4c8f0793cefd5ded11e95d1bd8e1cfaf41295a5cdce8231237b0e89fcb8f7cce"
content-type: application/json; charset=utf-8
content-length: 293
Date: Wed, 04 Nov 2026 21:58:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"77ffa5aa-b869-4a8f-aed5-e099557cce54","host":"login.acme-corp.dev","state":"pending","canonical":false,"verified_at":null,"last_checked_at":null,"dns_record":{"name":"_odudu-challenge.login.acme-corp.dev","value":"odudu-domain-verification=oluzoqu_ke3-6FCclGwNr0V2y6TcAIsIwIyOsPSKP44"}}
```

The record is not published, so verifying leaves the domain `pending` and notes that it looked, in `last_checked_at`. A second try inside the 30 seconds a host is allowed is refused, and no lookup is made:

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/domains/77ffa5aa-b869-4a8f-aed5-e099557cce54/verify
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/domains/77ffa5aa-b869-4a8f-aed5-e099557cce54/verify
```

```
HTTP/1.1 200 OK
x-request-id: 01a1a892-7f99-797b-83c7-b9b5afaa5366
cache-control: no-store
etag: "4c8f0793cefd5ded11e95d1bd8e1cfaf41295a5cdce8231237b0e89fcb8f7cce"
content-type: application/json; charset=utf-8
content-length: 315
Date: Wed, 04 Nov 2026 21:58:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"77ffa5aa-b869-4a8f-aed5-e099557cce54","host":"login.acme-corp.dev","state":"pending","canonical":false,"verified_at":null,"last_checked_at":"2026-11-04T21:58:55.652Z","dns_record":{"name":"_odudu-challenge.login.acme-corp.dev","value":"odudu-domain-verification=oluzoqu_ke3-6FCclGwNr0V2y6TcAIsIwIyOsPSKP44"}}

HTTP/1.1 429 Too Many Requests
x-request-id: 01a1a892-7fb9-76c8-b9d5-9d1f0912d564
cache-control: no-store
retry-after: 30
content-type: application/problem+json; charset=utf-8
content-length: 235
Date: Wed, 04 Nov 2026 21:58:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#domain-verify-throttled","title":"Too Many Requests","status":429,"detail":"this domain or this tenant was checked too recently; wait for the Retry-After interval","instance":"01a1a892-7fb9-76c8-b9d5-9d1f0912d564"}
```

Without a token the route is refused as every admin route is:

```bash
curl -sS -D - \
  http://localhost:3000/admin/tenants/demo/domains
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1a892-7fce-72a4-9ef3-ee4455825366
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 108
Date: Wed, 04 Nov 2026 21:58:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Unauthorized","status":401,"instance":"01a1a892-7fce-72a4-9ef3-ee4455825366"}
```

## A domain that failed

Three domains were then given to `demo`, and one to `other`, with `odudu seed domain --assume-verified`, which marks a host verified without the DNS proof and refuses to run in production. Nothing publishes a record for any of them, so a recheck with `ODUDU_DOMAIN_RECHECK_FAILURES=1`, which fails a domain at its first miss, fails them all:

```bash
docker compose exec -T odudu odudu seed domain --tenant demo --host old.acme-corp.dev --assume-verified
docker compose exec -T odudu odudu seed domain --tenant demo --host id.acme-corp.dev --assume-verified
docker compose exec -T odudu odudu seed domain --tenant other --host shared.acme-corp.dev --assume-verified
docker compose exec -T -e ODUDU_DOMAIN_RECHECK_FAILURES=1 odudu odudu domains recheck
```

```
{"command":"domain","tenant":"demo","tenantId":"01a1a892-583a-76a8-8675-33fc134e44b2","host":"old.acme-corp.dev","state":"verified","canonical":false,"created":true}
{"command":"domain","tenant":"demo","tenantId":"01a1a892-583a-76a8-8675-33fc134e44b2","host":"id.acme-corp.dev","state":"verified","canonical":false,"created":true}
{"command":"domain","tenant":"other","tenantId":"01a1a892-5a4f-7e0e-a1cb-cbec10cdbbae","host":"shared.acme-corp.dev","state":"verified","canonical":false,"created":true}
{"ran":true,"checked":3,"failed":3,"indeterminate":0,"fellBack":0,"errored":0}
```

The list is ordered by host. A failed domain has no `dns_record`, because the record it was registered with is gone from the page, but the record must still be published at the DNS provider for it to verify again:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/domains
```

```
HTTP/1.1 200 OK
x-request-id: 01a1a892-b6fa-7de8-a715-76b3d905abe8
cache-control: no-store
etag: "4c8f0793cefd5ded11e95d1bd8e1cfaf41295a5cdce8231237b0e89fcb8f7cce"
content-type: application/json; charset=utf-8
content-length: 750
Date: Wed, 04 Nov 2026 21:59:09 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"2f9b6d5d-a1e7-4cb6-af6c-55b6e35e7016","host":"id.acme-corp.dev","state":"failed","canonical":false,"verified_at":"2026-11-04T21:59:08.367Z","last_checked_at":"2026-11-04T21:59:08.996Z","dns_record":null},{"id":"77ffa5aa-b869-4a8f-aed5-e099557cce54","host":"login.acme-corp.dev","state":"pending","canonical":false,"verified_at":null,"last_checked_at":"2026-11-04T21:58:55.652Z","dns_record":{"name":"_odudu-challenge.login.acme-corp.dev","value":"odudu-domain-verification=oluzoqu_ke3-6FCclGwNr0V2y6TcAIsIwIyOsPSKP44"}},{"id":"a1d3e295-1885-4246-b4b7-1b597ede2c4d","host":"old.acme-corp.dev","state":"failed","canonical":false,"verified_at":"2026-11-04T21:59:07.964Z","last_checked_at":"2026-11-04T21:59:08.996Z","dns_record":null}]}
```

Verifying a failed domain answers `409` while its record is still not seen, and verifies it once the record is back:

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/domains/2f9b6d5d-a1e7-4cb6-af6c-55b6e35e7016/verify
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1a892-f4b6-708a-8891-fb35f5e1daa7
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 254
Date: Wed, 04 Nov 2026 21:59:25 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#domain-failed","title":"Conflict","status":409,"detail":"the domain stopped proving ownership and its record is still not there; publish the record again and verify it, or remove it","instance":"01a1a892-f4b6-708a-8891-fb35f5e1daa7"}
```

## Make a domain the address

A fourth domain is verified, and then every way an activation can be refused. Naming a pending domain is refused with its reason once the `ETag` is right, a missing `If-Match` is `428` and a stale one is `412`:

```bash
docker compose exec -T odudu odudu seed domain --tenant demo --host switch.acme-corp.dev --assume-verified
```

```
{"command":"domain","tenant":"demo","tenantId":"01a1a892-583a-76a8-8675-33fc134e44b2","host":"switch.acme-corp.dev","state":"verified","canonical":false,"created":true}
```

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'If-Match: "4c8f0793cefd5ded11e95d1bd8e1cfaf41295a5cdce8231237b0e89fcb8f7cce"' \
  http://localhost:3000/admin/tenants/demo/domains/77ffa5aa-b869-4a8f-aed5-e099557cce54/activate
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1a893-2779-7b2f-b253-52b4207ead60
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 209
Date: Wed, 04 Nov 2026 21:59:38 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#domain-not-verified","title":"Conflict","status":409,"detail":"only a verified domain can become the tenant’s address; verify it first","instance":"01a1a893-2779-7b2f-b253-52b4207ead60"}
```

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/domains/864d4e2c-59ca-4eef-a2c5-0b18f0a8d7bf/activate
```

```
HTTP/1.1 428 Precondition Required
x-request-id: 01a1a892-f682-7733-8993-ee2826e3bbaf
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 183
Date: Wed, 04 Nov 2026 21:59:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace the tenant’s address","instance":"01a1a892-f682-7733-8993-ee2826e3bbaf"}
```

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'If-Match: "0000"' \
  http://localhost:3000/admin/tenants/demo/domains/864d4e2c-59ca-4eef-a2c5-0b18f0a8d7bf/activate
```

```
HTTP/1.1 412 Precondition Failed
x-request-id: 01a1a892-f694-758d-b573-5bd93d5e15f3
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 153
Date: Wed, 04 Nov 2026 21:59:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1a892-f694-758d-b573-5bd93d5e15f3"}
```

Before switching, the number of subjects whose passkeys the switch would hide. `demo` has no passkeys, so it is `0` either way:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/demo/domains/passkey-impact?canonical=switch.acme-corp.dev'
```

```
HTTP/1.1 200 OK
x-request-id: 01a1a892-f6a8-75ab-9a5a-8e68e5a5fd19
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 29
Date: Wed, 04 Nov 2026 21:59:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"subjects":0,"capped":false}
```

With the current `ETag` the switch is made. The answer is the domain, now `canonical`, and the `ETag` is the new one. Removing the domain that is the address is refused:

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'If-Match: "4c8f0793cefd5ded11e95d1bd8e1cfaf41295a5cdce8231237b0e89fcb8f7cce"' \
  http://localhost:3000/admin/tenants/demo/domains/864d4e2c-59ca-4eef-a2c5-0b18f0a8d7bf/activate
```

```
HTTP/1.1 200 OK
x-request-id: 01a1a892-f6ed-7956-abec-295e09b6344d
cache-control: no-store
etag: "1f155fd8e1d4a9ab353f039ba6f3809530f0860cf56b7d048d62ad23c1639f2f"
content-type: application/json; charset=utf-8
content-length: 215
Date: Wed, 04 Nov 2026 21:59:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"864d4e2c-59ca-4eef-a2c5-0b18f0a8d7bf","host":"switch.acme-corp.dev","state":"verified","canonical":true,"verified_at":"2026-11-04T21:59:25.984Z","last_checked_at":"2026-11-04T21:59:25.984Z","dns_record":null}
```

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/domains/864d4e2c-59ca-4eef-a2c5-0b18f0a8d7bf
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1a892-f704-75c3-b1ec-5552bdacdc65
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 203
Date: Wed, 04 Nov 2026 21:59:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#domain-canonical","title":"Conflict","status":409,"detail":"the domain is the tenant’s address; deactivate it before removing it","instance":"01a1a892-f704-75c3-b1ec-5552bdacdc65"}
```

## Page the list

The list pages by host. `limit` bounds a page, and `next` is the cursor for the following one, which the `Link` header carries as well:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/demo/domains?limit=1'
```

```
HTTP/1.1 200 OK
x-request-id: 01a1a892-f72c-7419-b222-9bb7dc9ede6b
cache-control: no-store
etag: "1f155fd8e1d4a9ab353f039ba6f3809530f0860cf56b7d048d62ad23c1639f2f"
link: </admin/tenants/demo/domains?limit=1&cursor=eyJhZnRlciI6ImlkLmFjbWUtY29ycC5kZXYiLCJjb2xsZWN0aW9uIjoiZG9tYWlucyIsInRlbmFudElkIjoiMDFhMWE4OTItNTgzYS03NmE4LTg2NzUtMzNmYzEzNGU0NGIyIiwiZmlsdGVycyI6IlQxUE5vWXdycWd3RFZMdGZtajdMNWUwU3EwMk9FYnFIUEM4UkZoSUN1VVUifQ.0aiTpSwkCW2LFZy1thdMj2h6nUed4sFldi3b6oqWUhA>; rel="next"
content-type: application/json; charset=utf-8
content-length: 486
Date: Wed, 04 Nov 2026 21:59:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"2f9b6d5d-a1e7-4cb6-af6c-55b6e35e7016","host":"id.acme-corp.dev","state":"failed","canonical":false,"verified_at":"2026-11-04T21:59:08.367Z","last_checked_at":"2026-11-04T21:59:08.996Z","dns_record":null}],"next":"eyJhZnRlciI6ImlkLmFjbWUtY29ycC5kZXYiLCJjb2xsZWN0aW9uIjoiZG9tYWlucyIsInRlbmFudElkIjoiMDFhMWE4OTItNTgzYS03NmE4LTg2NzUtMzNmYzEzNGU0NGIyIiwiZmlsdGVycyI6IlQxUE5vWXdycWd3RFZMdGZtajdMNWUwU3EwMk9FYnFIUEM4UkZoSUN1VVUifQ.0aiTpSwkCW2LFZy1thdMj2h6nUed4sFldi3b6oqWUhA"}
```

## Switch back, and remove

The tenant returns to its path address, with the `ETag` it had at the start. Only then can the domain be removed, and a removed one is not found:

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'If-Match: "1f155fd8e1d4a9ab353f039ba6f3809530f0860cf56b7d048d62ad23c1639f2f"' \
  http://localhost:3000/admin/tenants/demo/domains/864d4e2c-59ca-4eef-a2c5-0b18f0a8d7bf/deactivate
```

```
HTTP/1.1 200 OK
x-request-id: 01a1a892-f740-7edb-81aa-15bcc40ee4e9
cache-control: no-store
etag: "4c8f0793cefd5ded11e95d1bd8e1cfaf41295a5cdce8231237b0e89fcb8f7cce"
content-type: application/json; charset=utf-8
content-length: 216
Date: Wed, 04 Nov 2026 21:59:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"864d4e2c-59ca-4eef-a2c5-0b18f0a8d7bf","host":"switch.acme-corp.dev","state":"verified","canonical":false,"verified_at":"2026-11-04T21:59:25.984Z","last_checked_at":"2026-11-04T21:59:25.984Z","dns_record":null}
```

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/domains/864d4e2c-59ca-4eef-a2c5-0b18f0a8d7bf
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/domains/864d4e2c-59ca-4eef-a2c5-0b18f0a8d7bf
```

```
HTTP/1.1 204 No Content
x-request-id: 01a1a892-f756-71e2-964c-02b42d2012a7
cache-control: no-store
Date: Wed, 04 Nov 2026 21:59:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

HTTP/1.1 404 Not Found
x-request-id: 01a1a892-f76a-7c39-98ee-c9dbcfe79278
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 163
Date: Wed, 04 Nov 2026 21:59:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"no domain 864d4e2c-59ca-4eef-a2c5-0b18f0a8d7bf","instance":"01a1a892-f76a-7c39-98ee-c9dbcfe79278"}
```

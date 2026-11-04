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

These calls were not run against a live stack when the page was written, so it shows no
captured output: the sequence below is what each call does, taken from the route table and
the integration tests that drive them.

- `POST /domains` with `{"host": "login.acme.com"}` answers `201` with the domain, `pending`,
  and `dns_record`: the `name` (`_odudu-challenge.login.acme.com`) and the `value` the TXT
  record must hold. The host is stored in its lowercase punycode spelling. Refused with a
  problem whose `type` is one of `about:blank#domain-system-tenant`, `domain-no-base-url`,
  `domain-limit`, `domain-already-registered`, `domain-host-ip-literal`,
  `domain-host-localhost`, `domain-host-operator`, `domain-host-reserved` or
  `domain-host-invalid`. Writes `domain.registered`.
- `POST /domains/:id/verify` looks the TXT record up and, when it holds the value, marks the
  domain `verified` and writes `domain.verified`; otherwise it answers the domain still
  `pending`. A host is looked up at most once every 30 seconds, and a tenant at most ten
  times a minute; past either, `429` with `Retry-After` and
  `about:blank#domain-verify-throttled`, and no lookup is made. A host another tenant
  verified first answers `409` `about:blank#domain-verified-elsewhere` and writes
  `domain.failed`; a domain that is `failed` answers `409` `about:blank#domain-failed`.
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
`activate` and `deactivate` take it in `If-Match`; a stale one is refused with `412`, and
none is required. `GET /domains` pages by host with `limit` and `cursor`.

A tenant export leaves the tenant's domains out, and an import with a `domains` key is
refused as an unknown field, so a host can only be claimed by proving it.

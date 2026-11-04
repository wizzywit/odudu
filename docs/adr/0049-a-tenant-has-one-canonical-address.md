# 0049 — A tenant has one canonical address; both addresses serve for a fixed window after a switch

**Status:** Accepted · 2026-11-04

## Context

Every tenant was reached under the operator's one base address, as
`/tenants/<name>`, and a tenant's issuer was that base plus its name. A customer
who wants its sign-in at `login.acme.com` could not have that. The issuer, the
cookie names and paths, the WebAuthn RP ID and every link Odudu writes follow the
address a tenant is reached at, so a domain is not a routing rule laid over the
existing address: it changes four things at once, and a tenant has to be able to
leave it again, including after it has lost the domain.

An issuer is one string. A token carries it, a resource server compares it, and
RFC 8414 derives a discovery URL from it. A tenant cannot be at two addresses in
that sense.

## Decision

**A tenant has exactly one canonical address:** its path address
(`<base>/tenants/<name>`, the default and the state of every tenant that does
nothing) or one verified domain, served at the root. The issuer, the RP ID and
origin, the cookie names and paths, and the links Odudu writes, mail and brand
assets included, follow it. A tenant may register up to twenty domains, any
number of which are idle.

**A switch is one transaction, in either direction, from the base address.** The
admin API and the console stay on the base address, which is what makes switching
back need nothing from the domain. A switch writes an audit row, records the
address left as a retired issuer with an expiry, and ends the tenant's browser
sessions, since a session cookie is host-only.

**For a fixed window after a switch both addresses serve, and the window is the
ceiling the token endpoint enforces on an access token's lifetime,** 3600
seconds, so what was already issued is never refused while it is still valid. The
address left serves token, userinfo, introspection, revocation, keys, logout and
discovery, each stating the issuer of the address it is read at. It refuses
authorization, registration and reset pages with a `410` page that points to the
canonical address. The tenant accepts the retired issuer on `/userinfo`,
introspection, `id_token_hint` and a client assertion's `aud`, each with its own
expiry, so a second switch inside the window leaves both valid. A resource server
that verifies tokens locally must accept both issuers for the window. Refresh
tokens are bound to the tenant and survive a switch. After the window the address
left serves nothing for that tenant.

**Passkeys are bound to the RP ID of the canonical address.** Each credential
records the RP ID it was registered under. Sign-in offers only credentials whose
RP ID is the canonical one, so a switch hides the others instead of leaving the
browser to fail, and a switch back brings them back. Password sign-in is not
affected. The console says how many people a switch hides passkeys from.

**A host selects a tenant only through a verified row.** A request is served as a
tenant when its host, read as `ODUDU_TRUST_PROXY` allows and from the last
`X-Forwarded-Host` entry when it does, has a verified row that is the canonical
address or inside its window. The mechanism is a rewrite at the edge to the
tenant's `/tenants/<name>` path, so no route that takes `:tenant` changes. A host
with no row is routed exactly as before; a host with a row that is not live
answers a bare refusal on every path. Mail links never read `Host`.

**Ownership is a DNS TXT record, checked again on a schedule.** A tenant
registers a host, publishes a token under `_odudu-challenge.<host>`, and
verification resolves it. Registering claims nothing, several tenants may
register one host, and the first to prove it keeps it. A recheck covers every
verified domain: a lookup that answers no such name or no matching record is a
miss, a resolver error counts as nothing, a page of the walk in which most
lookups are indeterminate counts nothing, and a domain that misses for a set
number of passes fails. A canonical domain that fails returns its tenant to the
path address, so an expired domain bought by somebody else cannot keep serving
the tenant's sign-in.

**The reverse proxy asks `GET /internal/domain-check?domain=<host>`,** which
answers `200` or `404` with no body and no tenant detail, takes no shared secret
and has its own limiter. It must be kept off the public network. Certificates
stay the proxy's work.

## Consequences

A tenant that does no branding of its address is byte-for-byte unchanged: the
existing suites pass without edits. A switch costs every browser session of the
tenant, which the documentation says before the button is pressed. Resource
servers need both issuers for an hour. The edge costs one indexed read per
request on a non-base host and one on the base host's tenant paths, which a cache
could remove and the design does not add until a measurement asks for one: a
cache would have to state its bound and be invalidated on a switch, and would
blur "refused at its expiry".

The verification limits are per process, and so is the check endpoint's limiter,
which a flood of handshakes through the proxy can exhaust for a minute.

## Alternatives rejected

- **Replace the path address on a switch, with no window.** Every token
  already issued would be refused at once, and a resource server could not be
  told in advance.
- **Keep both addresses fully live,** each with its own issuer, RP ID and
  cookies. An issuer is one string, so a token minted at one address is not valid
  at the other; and every issuer and RP ID would have to be tested in two
  states for no gain refresh tokens do not already give.
- **A per-tenant setting for how long both serve.** It buys the same
  two-issuer cost a fixed window has, with a setting that is mostly wrong.
- **An alias, one address spelled two ways.** Impossible for the reason above.
- **Register every route a second time at the root,** reading the tenant from the
  host in each handler. 86 duplicated routes and a second set of tests that
  would drift from the first; the edge rewrite keeps one set.
- **A separate listener per domain.** It breaks the one-process, one-port
  deployment the quick start ships and does nothing for host lookup.
- **Related Origin Requests, to share passkeys across domains.** Browsers count
  about five registrable-domain labels across the whole operator, which does not
  reach 10,000 tenants, and support is unsettled.
- **An operator-wide scheme such as `<tenant>.idp.example` for every tenant.** A
  different feature: wildcard certificates and no proof of ownership. Not placed.
- **Certificates issued inside Odudu.** Placed with many instances (P11), since
  ACME renewal and storage need a lock a single instance does not have.

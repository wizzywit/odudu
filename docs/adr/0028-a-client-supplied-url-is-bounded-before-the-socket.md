# 0028 — A client-supplied URL is bounded before the socket

**Status:** Accepted · 2026-09-18

## Context

Dynamic client registration accepts `jwks_uri`: a URL an unauthenticated
registrant supplies, which this server will later dereference with its own
network position to fetch that client's public keys. `OIDCCRegistrationJwksUri`
in the OIDF Dynamic OP conformance plan requires exactly this — the module
serves its key set over HTTP and expects the OP to fetch it, so refusing
`jwks_uri` and accepting only inline `jwks` was considered and rejected:
this server's conformance target exercises `jwks_uri`, not the inline form.

A repository-wide search for `fetch(`, `undici` and `axios` turns up one
hit — browser-side script inside a rendered page. This server has made no
outbound HTTP request of its own before this task.

The hazard is concrete: a registrant sets `jwks_uri` to
`http://169.254.169.254/latest/meta-data/` or `http://127.0.0.1:5432/`, and
the server fetches it from inside whatever perimeter the deployment sits
in, on the registrant's say-so alone.

## Decision

The rules in design spec section 6 govern every fetch of a client-supplied
URL, split across the two moments such a URL can be refused:

- **`assertFetchableUrl`**, at registration, on shape alone: `https` only,
  no embedded credentials, no DNS lookup. Resolving at registration would
  make a client's registration depend on its key host being reachable at
  that moment, and on DNS still answering the same way later.
- **`assertPublicAddresses`**, by the fetcher, on the addresses a lookup
  actually returns, immediately before connecting. Every resolved address
  is checked — not the first — and the connection is made **to that
  address**, never by re-resolving the hostname. Refused: loopback,
  link-local, private, unspecified, multicast, broadcast, and the
  IETF-reserved, protocol-assignment and carrier-grade-NAT ranges, in both
  IPv4 and IPv6 — checked in the numeric domain (parsed octets or hextets,
  never a string prefix). An IPv4 address embedded in IPv6 is unwrapped and
  checked as IPv4 for five encapsulations: IPv4-mapped and the deprecated
  IPv4-compatible form (dotted or hex, RFC 4291 §2.5.5), IPv4-translated
  (RFC 2765), `/96`-shaped embeddings under the NAT64 well-known and
  local-use prefixes (RFC 6052 §2.2, RFC 8215), and 6to4 (RFC 3056). A
  non-`/96` embedding under those same prefixes — RFC 6052 §2.2 permits
  several other prefix lengths — is not unwrapped and reaches the ordinary
  IPv6 check above unrecognised as IPv4; narrow, and not fixed here
  (parked, `docs/phases/p3a.md`). `::` and `::1` are matched by name, ahead of
  that unwrapping, since both bit patterns collide with the deprecated
  compatible form's own encoding and are reserved for the unspecified and
  loopback addresses specifically (RFC 4291 §2.5.5.1). No other IPv4-in-IPv6
  form is known to this server; one that used a different embedding
  position would still reach the fetcher unrecognised as IPv4, checked only
  as an ordinary IPv6 address against the ranges above.

`assertPublicAddresses` takes an `allowPrivate` option. The compose stack
and the conformance stack both run on private addresses, so a server that
always refused them could never register a client with a `jwks_uri` in
development.

## Consequences

A deployment with the escape hatch on cannot register a `jwks_uri` behind a
public address's disguise for loopback or multicast ranges either — those
stay refused regardless, since the hatch exists for the compose network's
private ranges, not for reaching the host running the container. Wiring
`allowPrivate` from configuration, and refusing it under
`NODE_ENV=production`, is the fetcher's task, not this one; until then the
parameter exists but nothing calls it with `true` outside a test.

A `jwks_uri` behind a private address is unregistrable in production. That
is deliberate: the alternative is a server that will fetch whatever a
registrant points it at, from inside its own network.

## Alternatives rejected

**Validating the hostname and letting the HTTP client resolve again.** This
is the implementation a reviewer would otherwise take as equivalent, and it
is not: the name is resolved once to validate, then resolved a second time
by the HTTP client to connect, and nothing requires the two lookups to
agree. A name can answer safely on the first lookup and point at
`169.254.169.254` on the second, with no control over the interval between
them. Checking the address the connection is actually made to, and
connecting to that address rather than the name, closes this; validating
the name does not.

**A per-realm egress allowlist.** Configuration nobody would maintain: an
operator would need to enumerate every relying party's key host in advance,
per realm, and keep it current as clients rotate `jwks_uri`. The address
ranges a fetch must never reach are fixed and few; a list of ranges it may
reach is neither fixed nor small.

**Refusing `jwks_uri` entirely, accepting only inline `jwks`.** Rejected:
the OIDF Dynamic OP conformance plan's `OIDCCRegistrationJwksUri` module
serves its key set over HTTP and requires the OP to dereference it, so
refusing the URI form outright would make that module unpassable.

# P2a spike log

## CORS: per-request origin decisions

Question: can `@fastify/cors` take an allow/deny decision from the database
per request — for the preflight as well as the real request — or does its
static per-server/per-route model rule that out?

Command run (outside the repository, in `/tmp/cors-spike/`, `fastify@5.12.3`
and `@fastify/cors@11.2.0`):

```
node /tmp/cors-spike/probe.mjs
```

Verbatim output:

```
delegator saw: [
  { method: 'OPTIONS', origin: 'https://app.example' },
  { method: 'OPTIONS', origin: 'https://app.example' }
]
preflight allow-origin: https://app.example
wrong-realm allow-origin: null
```

Conclusion: `verified: @fastify/cors 11.2.0 delegator resolves preflight
asynchronously` — the async delegator function ran for both `OPTIONS`
preflights, returned `https://app.example` for the realm whose simulated
database lookup allowed it, and returned no `access-control-allow-origin`
header at all for the same origin against a different realm, so Task 3 can
read the realm-wide origin union from PostgreSQL inside this delegator on
every request instead of adding a bespoke `onRequest` hook.

## URL.origin normalization

Question: does `URL.origin` drop a scheme's default port (`443` for
`https:`, `80` for `http:`) while keeping every other port, including on an
IPv6 literal host?

Command run:

```
node -e "for (const u of ['https://a.example:443','https://a.example','http://a.example:80','https://a.example:8443','http://[::1]:3000']) console.log(u, '->', new URL(u).origin)"
```

Verbatim output:

```
https://a.example:443 -> https://a.example
https://a.example -> https://a.example
http://a.example:80 -> http://a.example
https://a.example:8443 -> https://a.example:8443
http://[::1]:3000 -> http://[::1]:3000
```

Conclusion: `verified: node -e ... new URL(u).origin` — a scheme's default
port is dropped, every other port (including on an IPv6 literal) is kept, so
`normalizeOrigin` can build directly on `URL.origin` without its own port
table.

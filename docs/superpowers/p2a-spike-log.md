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

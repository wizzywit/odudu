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

## Recursive CTE termination on a cyclic role graph

Question: effective-role resolution runs on every token issuance and will
use a recursive CTE over `role_composites`, whose only cycle guard is
`CHECK (parent_role_id <> child_role_id)` — it refuses self-reference but
not a longer cycle. Does `UNION` (duplicate-eliminating) terminate on a
cyclic composite-role graph where `UNION ALL` does not? Verified against
PostgreSQL 17 (the version the project runs; the brief's example command
also names `postgres:17`), not asserted from documentation.

Container:

```
docker run --rm -d --name cte-spike -e POSTGRES_PASSWORD=spike -p 55432:5432 postgres:17
```

Fixture — a 3-cycle the `parent <> child` CHECK permits: `a` includes `b`,
`b` includes `c`, `c` includes `a`.

Positive run:

```
PGPASSWORD=spike psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE role_composites (parent_role_id text, child_role_id text);
INSERT INTO role_composites VALUES ('a','b'), ('b','c'), ('c','a');

SET statement_timeout = '5s';

WITH RECURSIVE seed AS (SELECT 'a'::text AS role_id),
role_closure AS (
  SELECT role_id FROM seed
  UNION
  SELECT rc.child_role_id FROM role_composites rc
    JOIN role_closure c ON rc.parent_role_id = c.role_id
)
SELECT role_id FROM role_closure ORDER BY role_id;
SQL
```

Verbatim output:

```
CREATE TABLE
INSERT 0 3
SET
 role_id 
---------
 a
 b
 c
(3 rows)
```

Negative control — identical query, `UNION ALL` in place of `UNION`, same
table and same 5s `statement_timeout`, run in the same session immediately
after:

```
PGPASSWORD=spike psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 <<'SQL'
SET statement_timeout = '5s';

WITH RECURSIVE seed AS (SELECT 'a'::text AS role_id),
role_closure AS (
  SELECT role_id FROM seed
  UNION ALL
  SELECT rc.child_role_id FROM role_composites rc
    JOIN role_closure c ON rc.parent_role_id = c.role_id
)
SELECT role_id FROM role_closure ORDER BY role_id;
SQL
```

Verbatim output (command took 5.03s):

```
SET
ERROR:  canceling statement due to statement timeout
```

Conclusion: `verified: UNION terminates on postgres:17; UNION ALL hangs
until statement_timeout cancels it` — on the 3-cycle fixture, `UNION`
returned exactly `a`, `b`, `c` well inside the timeout, and the identical
query with `UNION ALL` ran the full 5s and was cancelled by PostgreSQL. The
control confirms the fixture is a genuine cycle and that `UNION`'s
duplicate elimination, not something incidental to the query shape, is
what empties the frontier. Task 8's recursive CTE must use `UNION`, never
`UNION ALL`, for effective-role closure.

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
header at all for the same origin against a different realm, so
`packages/protocol-oidc/src/view/routes/cors.ts` can read the realm-wide
origin union from PostgreSQL inside this delegator on every request instead
of adding a bespoke `onRequest` hook.

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
PostgreSQL 17 (the version the project runs;
`docs/superpowers/plans/2026-09-14-p2a-identity-model.md`'s example command
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
what empties the frontier. The recursive CTE in
`packages/domain-authz/src/repository/effective-roles.ts` must use `UNION`,
never `UNION ALL`, for effective-role closure.

## SMTP client through the production image

Question: ADR 0002 fixes a single-container shape built by `infra/docker/Dockerfile`,
whose `build` stage bundles the server with `tsup` (everything inlined except
`@node-rs/argon2`, which `noExternal`/`external` carve out because a native
`.node` binary cannot go into an ESM bundle) and whose `runtime` stage ships
only that bundle plus a `--prod` `node_modules`. Does `nodemailer`, the
candidate SMTP client for `@odudu/email`, survive being bundled that way and
actually deliver a message from inside the built image, or does it hit a
`require`/native-binding trap like the one already known to be waiting for
`@node-rs/argon2` in a later phase?

Setup: added `nodemailer@7.0.9` and `@types/nodemailer@7.0.4` to
`apps/server/package.json` (throwaway — removed after this spike, since
`@odudu/email` is the package that owns the SMTP client), wrote
`apps/server/src/smtp-probe.ts` to call `nodemailer`'s `createTransport`
against the sink container below, and temporarily added it as a second
`tsup` entry point (also reverted) so the build stage would emit
`dist/smtp-probe.js` for the probe command to import — the Dockerfile's own
`pnpm --filter @odudu/server build` only knows about `src/main.ts`
otherwise.

Commands run, in order:

```
docker run --rm -d --name smtp-sink -p 1025:1025 axllent/mailpit
docker build -f infra/docker/Dockerfile -t odudu-smtp-spike .
docker run --rm --network host odudu-smtp-spike node -e "import('./dist/smtp-probe.js').then(m => m.probe()).then(console.log)"
docker exec smtp-sink wget -qO- http://127.0.0.1:8025/api/v1/messages
```

Verbatim build output for the entry actually exercised (tsup inside the
`build` stage, `tsup 8.5.1`, target `node24`, ESM):

```
CLI Building entry: src/main.ts, src/smtp-probe.ts
ESM Build start
ESM dist/smtp-probe.js         413.33 KB
ESM dist/smtp-probe.js.map     731.68 KB
ESM dist/main.js               2.60 MB
ESM dist/main.js.map           4.50 MB
ESM ⚡️ Build success in 571ms
```

Verbatim probe output, run against the built image with no source code and
no `devDependencies` present, only the `runtime` stage's `node_modules`:

```
<3a776203-335f-37a7-8569-b321deefb55f@example.test>
```

Verbatim Mailpit confirmation (same message id, correct envelope):

```
{"total":1,"unread":1,"count":1,"messages_count":1,"messages_unread":1,"start":0,"tags":[],"messages":[{"ID":"2RS6oiq5enjIHtOS2MSZQj","MessageID":"3a776203-335f-37a7-8569-b321deefb55f@example.test","Read":false,"From":{"Name":"","Address":"odudu@example.test"},"To":[{"Name":"","Address":"ada@example.test"}],"Cc":null,"Bcc":null,"ReplyTo":[],"Subject":"probe","Created":"2026-09-14T16:35:35.697Z","Username":"","Tags":[],"Size":472,"Attachments":0,"Snippet":"probe"}]}
```

Conclusion: `verified: nodemailer 7.0.9 survives the tsup ESM bundle and
the production image unmodified` — no `noExternal` carve-out was needed
(unlike `@node-rs/argon2`, it ships no native binding), the build produced
no warnings about dynamic `require` or unresolved specifiers, and the
bundled code ran and delivered mail using only the `runtime` stage's
`--prod` install. `@odudu/email` should install exactly `nodemailer@7.0.9`
(with `@types/nodemailer@7.0.4` as a dev dependency), with no
`tsup.config.ts` change required in that package beyond what a normal
dependency already gets — `nodemailer` needs no entry in `nativeExternals`.

This spike answered only whether the client survives bundling and delivers
from the built image; it asked nothing about the version's advisory record,
and 7.0.9 later turned out to carry ten open Dependabot advisories, two of
them High (an `addressparser` denial-of-service and a `raw`-option bypass of
`disableFileAccess`/`disableUrlAccess` enabling arbitrary file read and
SSRF). `packages/email/package.json` now pins `nodemailer@9.1.1`, the
version clearing all ten. The bundling and delivery finding above is
unaffected: 9.1.1 needed no `tsup.config.ts` change and no
`nativeExternals` entry either, so the tsup/runtime-stage conclusion holds
for the pinned version. Choosing a dependency version needs an advisory
check in addition to a bundling spike; this log entry no longer stands as
that check for `nodemailer`.

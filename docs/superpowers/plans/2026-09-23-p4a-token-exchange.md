# P4a — Token exchange (RFC 8693): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client presents a token it holds at `/token` and receives a different one — narrowed in scope, aimed at another audience, recording who acted for whom — and `/token` starts refusing any grant a client is not registered for.

**Architecture:** A fourth grant beside the three that exist. Stage 1 gains a `StructuredRequest` variant and an exhaustive dispatch; a leaf service holds every pure decision (token-type identifiers, scope intersection, audience ceiling, `act` chain); a usecase resolves the subject and actor tokens through the verification each type already has, then mints through the `mintAccessToken` every grant shares. The exchanged grant inherits its subject's `session_id`, so the logout machinery reaches it with no new code.

**Tech Stack:** TypeScript (no `any`), Fastify, Drizzle over PostgreSQL with row-level security, `jose`, Vitest with Testcontainers.

**Spec:** `docs/superpowers/specs/2026-09-23-p4a-token-exchange-design.md`

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the spec and from `CLAUDE.md`.

- **No `any`.** Not as an annotation, not as a cast, not leaked in from `JSON.parse`. Use `unknown` and narrow. No inline `eslint-disable` of `no-explicit-any` or `no-unsafe-*`; `tests/lint/no-any.test.ts` fails the build on one.
- **Tests precede implementation.** Every task writes the failing test first and runs it to see it fail.
- **Integration tests run against real PostgreSQL via Testcontainers**, never a mock.
- **Every repository method is probed with a foreign `tenant_id`.**
- **`SET LOCAL`, never `SET`**, for tenant context — in practice `withTenant`, which binds it via `set_config(..., true)`.
- **No comment block longer than eight lines.** `tests/lint/comment-block-length.test.ts` fails the build, and there is no waiver.
- **Never reference the development process from a comment** — no task numbers, no "the plan", no increment slots. Name the thing instead: not "Task 5's resolver" but "the subject-token resolver".
- **Call a function as `doThing()`, never `void doThing()`.**
- **Layering:** `view` → own model and `shared/view`; `usecase` → repository, service, view models; `repository` → adapter, service; `adapter` → transport, service; `service` → nothing. Domain packages never import protocol packages; protocol packages never import each other.
- **No tool-attribution line in a commit message or a pull request description.** `.githooks/commit-msg` and the `commit-messages` CI job catch the commit half; nothing can see a pull request body, so that half is followed rather than caught.
- **Commit messages:** subject ≤72 characters, body reading as ≤8 lines, blank line between. Enable the hook once per clone with `git config core.hooksPath .githooks`.
- **An increment is finished when CI is green on a pushed commit with a pull request open, and the review that push attracted has been answered.**
- **`README.md` and `docs/request-paths.md` are updated in the same commit as the code** that changes a request, response, branch, error code, endpoint, command or default. Every transcript in `request-paths.md` is real output from a running stack; a fenced block holding a response carries **no language tag**.

## Branch layout

**One branch per increment, merging into the phase branch; one phase pull request into `main`.**

- `p4a-token-exchange` is the **integration branch**. It already carries the spec, the roadmap split and this plan. Nothing is committed to it directly after that; everything arrives by merge.
- Each increment gets `p4a/<n>-<slug>`, branched from the integration branch at its current tip, with its own pull request **into the integration branch**.
- The draft pull request from the integration branch **into `main`** is already open (#27) and stays open until `finishing-a-development-branch`.

`verified:` CI runs on an increment pull request — `.github/workflows/verify.yml` triggers on a bare `pull_request:` with no `branches:` filter and no job carries a draft guard (`sed -n '1,20p' .github/workflows/verify.yml`). This was observed directly on #27, where `verify`, `container`, `conformance` and `commit-messages` all ran and passed.

## File structure

| File                                                           | Responsibility                                                                                                                                                                                       | New?   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `packages/protocol-oidc/src/service/token-exchange.ts`         | Every pure decision: token-type identifiers, request-shape validation, scope intersection, audience ceiling, `act` chain construction and its depth cap. A leaf — imports nothing from this package. | create |
| `packages/protocol-oidc/src/service/token-exchange.test.ts`    | Unit tests for the above.                                                                                                                                                                            | create |
| `packages/protocol-oidc/src/usecase/token-exchange-subject.ts` | Resolving a presented `subject_token`/`actor_token` of each accepted type to one normalised shape. Needs a transaction, so it is a usecase rather than a service.                                    | create |
| `packages/protocol-oidc/src/usecase/token-issuance.ts`         | Stage 1's fourth variant, the exhaustive dispatch, the `grant_types` allowlist, `issueExchangedTokens`, and `mintAccessToken`'s new `act` and `expCeiling` inputs.                                   | modify |
| `packages/protocol-oidc/src/service/errors.ts`                 | Unchanged — every code this phase needs already exists.                                                                                                                                              | —      |
| `packages/protocol-oidc/src/repository/grants.ts`              | The exchanged grant row: two new columns on create, and `byId` returning them.                                                                                                                       | modify |
| `packages/protocol-oidc/src/schema/token-grants.ts`            | `actorSubjectId`, `exchangedFromGrantId`.                                                                                                                                                            | modify |
| `packages/protocol-oidc/src/schema/client-oidc-config.ts`      | `tokenExchangeImpersonationAllowed`.                                                                                                                                                                 | modify |
| `packages/protocol-oidc/src/repository/client-oidc-config.ts`  | Map the new column in `toRecord`.                                                                                                                                                                    | modify |
| `packages/protocol-oidc/src/service/client-metadata.ts`        | `GRANT_TYPES_PERMITTED` gains the URN.                                                                                                                                                               | modify |
| `packages/db/drizzle/0059_token_exchange.sql`                  | The CHECK replacement and three columns.                                                                                                                                                             | create |
| `packages/contracts/src/discovery.ts`                          | `grant_types_supported` gains the URN.                                                                                                                                                               | modify |
| `packages/contracts/src/token.ts`                              | The four dead exports are deleted.                                                                                                                                                                   | modify |
| `apps/server/src/cli/seed.ts`                                  | `seed client --grant-type`, repeatable.                                                                                                                                                              | modify |
| `packages/protocol-oidc/tests/token-exchange.int.test.ts`      | The grant end to end.                                                                                                                                                                                | create |
| `packages/protocol-oidc/tests/grant-allowlist.int.test.ts`     | `/token` refusing an unregistered grant on both authentication paths.                                                                                                                                | create |
| `docs/protocols/rfc8693.md`                                    | The clause table.                                                                                                                                                                                    | create |

## Review Focus

Five things the spec implies and no task's happy path exercises, most likely to bite first. Each has its test placed in the task that owns the code.

1. **A subject token signed by another tenant.** Cross-tenant token confusion is the failure this project probes for everywhere else; exchange is a new door onto it. Expected: refused, no token minted. — Increment 4, Tasks 4.1 and 4.3, once per subject type that carries a signature.
2. **An `actor_token` that is itself expired or revoked while the `subject_token` is live.** The actor is the party gaining rights; validating only the subject would be a rule applied at one door out of two. Expected: `invalid_request`. — Increment 4, Task 4.4.
3. **An exchange presented after the subject's session ended but before any token expired.** The whole safety property of section 9. Expected: refused at exchange, and any already-exchanged token dead at `/introspect` and `/userinfo`. — Increment 5, Task 5.5.
4. **A delegation chain deep enough to matter.** Nesting is unbounded in the RFC and `act` is attacker-influenced in length. Expected: refused past the cap, with the cap named. — Increment 3, Task 3.4.
5. **`scope` requesting something the subject grant never held, spelled to look adjacent** (`reports:read ` with trailing space, duplicate entries, an empty string). Expected: `invalid_scope`, never silent widening. — Increment 3, Task 3.3.

---

## Increment 1 — The grant allowlist and an exhaustive dispatch

Stands alone and merges alone: it adds no grant, and it closes the gap `docs/NEXT.md` has held open since P3b. Doing it first means the fourth grant arrives into a dispatch that cannot silently misroute it.

`verified:` `config.grantTypes` is read exactly once in this package, at `token-issuance.ts:500`, gating refresh-token issuance — `grep -rn "grantTypes" packages/*/src` returns that one hit inside `token-issuance.ts` and nothing in `issueRefreshTokens` or `issueClientCredentialsTokens`.

`verified:` the dispatch tail is three `if`s ending in an unguarded `return issueClientCredentialsTokens(...)` — `sed -n '965,971p' packages/protocol-oidc/src/usecase/token-issuance.ts`.

`verified:` `unauthorizedClient()` already exists and returns `new TokenError('unauthorized_client', 400)` — `sed -n '48,56p' packages/protocol-oidc/src/service/errors.ts`.

### Task 1.1: The dispatch refuses to compile when a grant is unhandled

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts:965-971`
- Test: `packages/protocol-oidc/src/usecase/token-issuance.test.ts`

**Interfaces:**

- Consumes: `StructuredRequest`, the existing discriminated union.
- Produces: nothing new. This is a compile-time guarantee, not a runtime one.

- [ ] **Step 1: Write the failing test**

There is no runtime behaviour to assert here — the point is that a fifth variant fails the build. Pin it with a type-level test, which this repository can run because `typecheck` is a CI job.

Add to `packages/protocol-oidc/src/usecase/token-issuance.test.ts`:

```ts
// A grant added to StructuredRequest with no branch in the dispatch must
// fail typecheck rather than fall through to client_credentials. This
// asserts the helper the dispatch ends with, which is what produces that
// failure.
import { assertNeverGrant } from '#/usecase/token-issuance';

describe('assertNeverGrant', () => {
  it('throws when reached at runtime, which it cannot be if types hold', () => {
    const impossible = { grantType: 'not_a_grant' } as unknown as never;
    expect(() => assertNeverGrant(impossible)).toThrow('unhandled grant type');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/usecase/token-issuance.test.ts -t assertNeverGrant`
Expected: FAIL — `assertNeverGrant` is not exported from `#/usecase/token-issuance`.

- [ ] **Step 3: Write minimal implementation**

In `packages/protocol-oidc/src/usecase/token-issuance.ts`, above `issueTokens`:

```ts
// Reached only if StructuredRequest gains a variant the dispatch below does
// not answer, which is a typecheck failure rather than a runtime one. The
// throw exists because a `never` parameter still needs a body.
export function assertNeverGrant(request: never): never {
  throw new Error(`unhandled grant type: ${JSON.stringify(request)}`);
}
```

Then replace the dispatch tail:

```ts
if (request.grantType === 'authorization_code') {
  return issueAuthorizationCodeTokens(tx, deps, request, client, config);
}
if (request.grantType === 'refresh_token') {
  return issueRefreshTokens(tx, deps, request, client, config);
}
if (request.grantType === 'client_credentials') {
  return issueClientCredentialsTokens(tx, deps, request, client, config);
}
return assertNeverGrant(request);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc/src/usecase/token-issuance.test.ts -t assertNeverGrant`
Expected: PASS

Then confirm the guarantee is real. Temporarily add `| { grantType: 'probe' }` to `StructuredRequest`, run `pnpm typecheck`, and see it fail on `assertNeverGrant(request)`. Remove the probe.

Run: `pnpm typecheck`
Expected: PASS once the probe is removed.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/usecase/token-issuance.ts packages/protocol-oidc/src/usecase/token-issuance.test.ts
git commit -m "Make the grant dispatch exhaustive"
```

### Task 1.2: `/token` refuses a grant the client is not registered for

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts` (inside `issueTokens`, after client authentication, before the dispatch)
- Test: `packages/protocol-oidc/tests/grant-allowlist.int.test.ts` (create)

**Interfaces:**

- Consumes: `ClientOidcConfig.grantTypes: string[]`, `unauthorizedClient()`.
- Produces: no new exports. The refusal is observable only over HTTP.

- [ ] **Step 1: Write the failing test**

Create `packages/protocol-oidc/tests/grant-allowlist.int.test.ts`. Follow the fixture shape of `packages/protocol-oidc/tests/resource-token.int.test.ts` — same imports, same `beforeAll` container start, same `oidcRoutes` registration. The behaviour under test:

```ts
// RFC 6749 §5.2: a client authenticated but not authorized for this grant.
// Before this, `config.grantTypes` gated only whether a refresh token was
// issued, so a client registered for authorization_code alone could still
// obtain a client_credentials token.
describe('[ODUDU-GRANT-ALLOWLIST-01] /token enforces the registered grant list', () => {
  it('refuses client_credentials from a client registered for authorization_code only', async () => {
    const response = await http.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/protocol/openid-connect/token`,
      headers: { authorization: basicAuth(CODE_ONLY_CLIENT, CODE_ONLY_SECRET) },
      payload: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'unauthorized_client' });
  });

  it('still issues client_credentials to a client registered for it', async () => {
    const response = await http.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/protocol/openid-connect/token`,
      headers: { authorization: basicAuth(BOTH_CLIENT, BOTH_SECRET) },
      payload: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('access_token');
  });
});
```

Seed `CODE_ONLY_CLIENT` with `grantTypes: ['authorization_code', 'refresh_token']` and `BOTH_CLIENT` with `['authorization_code', 'refresh_token', 'client_credentials']`, both confidential, both with a `serviceSubjectId`, through `clientOidcConfigRepository(tx).create(...)` as `resource-token.int.test.ts` does.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/grant-allowlist.int.test.ts`
Expected: FAIL — the first case returns 200 with an access token, because nothing checks the list.

- [ ] **Step 3: Write minimal implementation**

In `issueTokens`, immediately after the client and config are resolved and before the dispatch:

```ts
// RFC 6749 §5.2. Until this landed, `config.grantTypes` gated only
// whether a refresh token was issued, so a client could use any grant
// this server implements regardless of what it registered for.
if (!config.grantTypes.includes(request.grantType)) {
  throw unauthorizedClient();
}
```

Import `unauthorizedClient` from `#/service/errors` alongside the codes already imported there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc/tests/grant-allowlist.int.test.ts`
Expected: PASS

Then run the whole package, because this is a behaviour change and existing fixtures may register narrower grant lists than the grants their tests exercise:

Run: `npx vitest run packages/protocol-oidc`
Expected: PASS. Any failure here is a fixture that was relying on the missing check — widen that fixture's `grantTypes`, never the production check.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/usecase/token-issuance.ts packages/protocol-oidc/tests/grant-allowlist.int.test.ts
git commit -m "Refuse a grant the client is not registered for"
```

### Task 1.3: The allowlist holds on the assertion authentication paths too

**Files:**

- Test: `packages/protocol-oidc/tests/grant-allowlist.int.test.ts` (extend)

**Interfaces:**

- Consumes: nothing new.
- Produces: nothing.

This task adds no production code. It exists because the spec's exit criterion says "on every client-authentication path", and because `docs/phases/p3b.md` names a rule applied at one door out of several as this repository's recurring defect. The check sits after authentication and before dispatch, so it should already hold for `private_key_jwt` and mTLS — this proves it rather than assuming it.

- [ ] **Step 1: Write the failing test**

```ts
it('refuses an unregistered grant on the private_key_jwt path', async () => {
  const assertion = await signClientAssertion({
    clientId: PKJWT_CODE_ONLY_CLIENT,
    audience: `${ISSUER}/protocol/openid-connect/token`,
    key: CLIENT_KEY,
  });

  const response = await http.inject({
    method: 'POST',
    url: `/tenants/${TENANT}/protocol/openid-connect/token`,
    payload: new URLSearchParams({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    }).toString(),
  });

  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ error: 'unauthorized_client' });
});
```

Build the assertion the way `packages/protocol-oidc/tests/private-key-jwt.int.test.ts` already does; reuse its helper rather than writing a second one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/grant-allowlist.int.test.ts -t private_key_jwt`
Expected: FAIL initially only if the fixture is wrong; if it passes immediately, that is the correct outcome and the test has done its job as a regression pin. Record which it was in the commit message.

- [ ] **Step 3: Write minimal implementation**

None expected. If the test fails for a reason other than fixture setup, the check has been placed before authentication rather than after it — move it, do not duplicate it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc/tests/grant-allowlist.int.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/tests/grant-allowlist.int.test.ts
git commit -m "Pin the grant allowlist on the assertion path"
```

### Task 1.4: `seed client --grant-type`

**Files:**

- Modify: `apps/server/src/cli/seed.ts:831-835` (the option table) and the client-creation path
- Test: `apps/server/tests/seed.int.test.ts` (extend)

`verified:` the seed suite is `apps/server/tests/seed.int.test.ts`; there is no `seed-client.int.test.ts` — `ls apps/server/tests/`. An earlier draft of this task named one, which is the defect `CLAUDE.md`'s sibling-to-P0 rule exists to catch.

**Interfaces:**

- Consumes: `GRANT_TYPES_PERMITTED` from `@odudu/protocol-oidc`'s client-metadata service.
- Produces: a `--grant-type` option, repeatable, defaulting to today's behaviour when omitted.

`verified:` `seed client` today takes `client-secret`, `token-endpoint-auth-method`, `redirect-uri`, `post-logout-redirect-uri` and `web-origin`, and nothing else — `sed -n '828,840p' apps/server/src/cli/seed.ts`.

`verified:` there are **two** defaults today, chosen by client type: a confidential client gets `['authorization_code', 'refresh_token', 'client_credentials']` and a public one gets `['authorization_code', 'refresh_token']` — `sed -n '390,396p' apps/server/src/cli/seed.ts`. A single default would silently give every public client the `client_credentials` grant it has never had, which this task must not do.

- [ ] **Step 1: Write the failing test**

```ts
it('registers only the grants named by --grant-type', async () => {
  await seedCommand([
    'client',
    '--tenant',
    TENANT,
    '--client-id',
    'narrow',
    '--client-secret',
    'secret',
    '--redirect-uri',
    'https://app.example/cb',
    '--grant-type',
    'authorization_code',
  ]);

  const config = await withTenant(owner.db, TENANT_ID, (tx) =>
    clientOidcConfigRepository(tx).byClientId('narrow'),
  );
  expect(config?.grantTypes).toEqual(['authorization_code']);
});

it('refuses a grant type this server does not implement', async () => {
  await expect(
    seedCommand([
      'client',
      '--tenant',
      TENANT,
      '--client-id',
      'bogus',
      '--client-secret',
      'secret',
      '--redirect-uri',
      'https://app.example/cb',
      '--grant-type',
      'password',
    ]),
  ).rejects.toThrow(/grant-type/u);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/server/tests/seed.int.test.ts`
Expected: FAIL — `--grant-type` is not a known option, so parsing rejects it.

- [ ] **Step 3: Write minimal implementation**

Add to the option table at `seed.ts:831`:

```ts
      'grant-type': { type: 'string', multiple: true },
```

And where the grant list is chosen, replace the unconditional default with:

```ts
// Omitted means the three grants a seeded client has always received, so
// an existing invocation is unchanged. Named means exactly what was
// named, which is the only way to seed a client that may exchange.
const requested = values['grant-type'];
const grantTypes = requested ?? defaultGrantsFor(type);
const unknown = grantTypes.filter((name) => !GRANT_TYPES_PERMITTED.includes(name));
if (unknown.length > 0) {
  throw new OduduError(
    'seed_unknown_grant_type',
    `--grant-type names ${unknown.join(', ')}, which this server does not implement`,
  );
}
```

with the existing type-dependent default extracted beside it, unchanged in behaviour:

```ts
function defaultGrantsFor(type: 'confidential' | 'public'): string[] {
  return type === 'confidential'
    ? ['authorization_code', 'refresh_token', 'client_credentials']
    : ['authorization_code', 'refresh_token'];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/server/tests/seed.int.test.ts`
Expected: PASS

Add a third case pinning the default that this task must not change:

```ts
it('still gives a public client two grants and no client_credentials', async () => {
  await seedCommand([
    'client',
    '--tenant',
    TENANT,
    '--client-id',
    'pub',
    '--public',
    '--redirect-uri',
    'https://app.example/cb',
  ]);
  const config = await withTenant(owner.db, TENANT_ID, (tx) =>
    clientOidcConfigRepository(tx).byClientId('pub'),
  );
  expect(config?.grantTypes).toEqual(['authorization_code', 'refresh_token']);
});
```

- [ ] **Step 5: Update the documents this changes, then commit**

`README.md`: add `--grant-type` to the `seed client` flag list.
`docs/request-paths.md`: the `seed client` section gains the flag, and the "Any admin API" entry's note about what only `psql` can set loses the grant list.

```bash
git add apps/server/src/cli/seed.ts apps/server/tests/seed.int.test.ts README.md docs/request-paths.md
git commit -m "Add seed client --grant-type"
```

### Increment 1 close

- [ ] Open `p4a/1-grant-allowlist` against the integration branch on the first commit, not after the last.
- [ ] `pnpm verify` locally, then `gh pr checks <pr> --watch`.
- [ ] Answer every review thread the push attracted before starting increment 2.
- [ ] Merge into `p4a-token-exchange`.

## Increment 2 — Schema, metadata and discovery

Everything the grant needs to exist as a registrable, advertisable thing, before any of it does anything. Merges alone: after this increment a client may register the URN and discovery advertises it, and `/token` answers `unauthorized_client` for it, because increment 1's allowlist now refuses a grant no dispatch branch handles. That is an honest intermediate state, not a broken one — but it means increment 3 must follow before the phase pull request merges.

`verified:` the next free migration number is `0059` — `ls packages/db/drizzle/ | tail -2` gives `0058_rename_realm_constraint_names.sql` and `meta`.

`verified:` the CHECK to replace is `client_oidc_config_grant_types_check`, `CHECK (grant_types <@ ARRAY['authorization_code', 'refresh_token', 'client_credentials'])` — `sed -n '14,15p' packages/db/drizzle/0007_client_oidc_config.sql`.

`verified:` a second constraint reads the same column by exact array equality — `CHECK (cardinality(redirect_uris) >= 1 OR grant_types = ARRAY['client_credentials'])` at `0007_client_oidc_config.sql:26`. A token-exchange-only client has no redirect URI either, so this constraint has to be considered, not just the first.

`assumption:` replacing a CHECK constraint on `client_oidc_config` needs no table rewrite at this size. **Spike before writing the migration**: in a psql against a test container, `ALTER TABLE ... DROP CONSTRAINT` then `ADD CONSTRAINT ... CHECK (...)` and confirm it completes without a `Seq Scan` cost that would matter, and that `ADD CONSTRAINT` validates existing rows rather than accepting them silently.

### Task 2.1: The migration

**Files:**

- Create: `packages/db/drizzle/0059_token_exchange.sql`
- Test: `packages/db/tests/schema-drift.int.test.ts` (runs as-is; it compares declared Drizzle schema against applied migrations)

**Interfaces:**

- Produces: three columns and one replaced constraint, consumed by tasks 2.2 and 2.3.

- [ ] **Step 1: Write the failing test**

The drift test is the failing test here: declare the columns in Drizzle first (task 2.2 order is inverted for this reason is _not_ the case — declare them in the same task), and the drift test fails until the migration matches. Write the schema changes first:

In `packages/protocol-oidc/src/schema/client-oidc-config.ts`, beside `consentRequired`:

```ts
  // Delegation rides the registered grant list; impersonation — an exchange
  // with no actor_token, where the issued token names the subject and
  // records no actor — needs this as well. Default false: a client that
  // registered before this existed has not asked to impersonate anyone.
  tokenExchangeImpersonationAllowed: boolean('token_exchange_impersonation_allowed')
    .notNull()
    .default(false),
```

In `packages/protocol-oidc/src/schema/token-grants.ts`, beside `sessionId`:

```ts
  // The party recorded in the issued token's `act` claim, so introspection
  // can reproduce it without holding the token. Null for every grant that
  // is not a delegated exchange.
  actorSubjectId: uuid('actor_subject_id'),
  // The grant whose token was presented as `subject_token`. Lineage only:
  // nothing walks it yet, and revoking a parent does not revoke a child.
  exchangedFromGrantId: uuid('exchanged_from_grant_id'),
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/db/tests/schema-drift.int.test.ts`
Expected: FAIL — the declared schema has three columns the applied migrations do not.

- [ ] **Step 3: Write minimal implementation**

Create `packages/db/drizzle/0059_token_exchange.sql`:

```sql
-- The exchange grant's URN joins the registrable list. The constraint is
-- replaced rather than widened in place because a CHECK has no ALTER form;
-- the redirect-uri exemption beside it (0007) is deliberately untouched, so
-- a client registering token-exchange alone must still supply a redirect
-- URI. Narrowing that is a decision for whoever needs such a client.
ALTER TABLE client_oidc_config DROP CONSTRAINT client_oidc_config_grant_types_check;
ALTER TABLE client_oidc_config ADD CONSTRAINT client_oidc_config_grant_types_check
  CHECK (grant_types <@ ARRAY[
    'authorization_code',
    'refresh_token',
    'client_credentials',
    'urn:ietf:params:oauth:grant-type:token-exchange'
  ]);

ALTER TABLE client_oidc_config
  ADD COLUMN token_exchange_impersonation_allowed boolean NOT NULL DEFAULT false;

ALTER TABLE token_grants ADD COLUMN actor_subject_id uuid;
ALTER TABLE token_grants ADD COLUMN exchanged_from_grant_id uuid;
```

No foreign key on either new column: `subjects` and `token_grants` are both tenant-scoped and the composite-key pattern `0026_token_grants_session.sql` uses would need `(tenant_id, id)` uniqueness on the parent, which `token_grants` has and `subjects` may not. Check `subjects` before deciding; if it does have it, add the composite FK with `ON DELETE SET NULL`, matching the session column's precedent.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/db/tests/schema-drift.int.test.ts`
Expected: PASS

Run: `npx vitest run packages/db`
Expected: PASS — including the RLS probes, which must still refuse a foreign tenant on `token_grants`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/drizzle/0059_token_exchange.sql packages/protocol-oidc/src/schema/
git commit -m "Add the token-exchange grant and its two lineage columns"
```

### Task 2.2: The config record carries the new flag

**Files:**

- Modify: `packages/protocol-oidc/src/repository/client-oidc-config.ts` (`toRecord`, and the `ClientOidcConfig` interface)
- Test: `packages/protocol-oidc/tests/client-oidc-config.int.test.ts` (`verified:` confirm the filename with `ls packages/protocol-oidc/tests/` before writing; use the file that already exercises this repository)

**Interfaces:**

- Consumes: the column from task 2.1.
- Produces: `ClientOidcConfig.tokenExchangeImpersonationAllowed: boolean`, read by increment 5.

- [ ] **Step 1: Write the failing test**

```ts
it('defaults token exchange impersonation to refused', async () => {
  const config = await withTenant(owner.db, TENANT_ID, (tx) =>
    clientOidcConfigRepository(tx).byClientId(CLIENT_ID),
  );
  expect(config?.tokenExchangeImpersonationAllowed).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests -t impersonation`
Expected: FAIL — the property is not on the record type, so this is a typecheck failure before it is a runtime one.

- [ ] **Step 3: Write minimal implementation**

Add to the `ClientOidcConfig` interface and to `toRecord`:

```ts
    tokenExchangeImpersonationAllowed: row.tokenExchangeImpersonationAllowed,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc/tests -t impersonation`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/repository/client-oidc-config.ts packages/protocol-oidc/tests/
git commit -m "Carry the impersonation flag on the client config record"
```

### Task 2.3: Registration accepts the URN, and discovery advertises it

**Files:**

- Modify: `packages/protocol-oidc/src/service/client-metadata.ts:35-39`
- Modify: `packages/contracts/src/discovery.ts:107`
- Test: `packages/protocol-oidc/src/service/client-metadata.test.ts`, `packages/contracts/src/discovery.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `GRANT_TYPES_PERMITTED` gains a fourth entry, consumed by task 1.4's validation.

`verified:` `GRANT_TYPES_PERMITTED` is a three-element list whose comment says it mirrors the DB CHECK from migration 0007 — `sed -n '34,39p' packages/protocol-oidc/src/service/client-metadata.ts`.

- [ ] **Step 1: Write the failing test**

```ts
it('accepts the token-exchange grant at registration', () => {
  const outcome = parseClientMetadata({
    redirect_uris: ['https://app.example/cb'],
    grant_types: ['urn:ietf:params:oauth:grant-type:token-exchange'],
  });
  expect(outcome.kind).toBe('ok');
});
```

and in `discovery.test.ts`:

```ts
it('advertises the token-exchange grant', () => {
  expect(discoveryDocument(ISSUER).grant_types_supported).toContain(
    'urn:ietf:params:oauth:grant-type:token-exchange',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/service/client-metadata.test.ts packages/contracts/src/discovery.test.ts`
Expected: FAIL — registration rejects the unknown grant; discovery lists three.

- [ ] **Step 3: Write minimal implementation**

Add `'urn:ietf:params:oauth:grant-type:token-exchange'` to `GRANT_TYPES_PERMITTED` and to `grant_types_supported`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc packages/contracts`
Expected: PASS. Watch for a discovery snapshot test that pins the array exactly; update it, since the document genuinely changed.

- [ ] **Step 5: Update `docs/request-paths.md`'s discovery transcript against a running stack, then commit**

The discovery document is quoted there. Re-run it rather than hand-editing — `docs/request-paths.md` promises real output.

```bash
git add packages/protocol-oidc/src/service/client-metadata.ts packages/contracts/src/discovery.ts packages/protocol-oidc/src/service/client-metadata.test.ts packages/contracts/src/discovery.test.ts docs/request-paths.md
git commit -m "Register and advertise the token-exchange grant"
```

### Task 2.4: Delete the dead token-request schemas

**Files:**

- Modify: `packages/contracts/src/token.ts`, `packages/contracts/src/index.ts`
- Modify: `docs/NEXT.md` (record the ADR 0007 debt against P4c)

**Interfaces:**

- Consumes: nothing.
- Produces: four fewer exports. Nothing imports them.

`verified:` `tokenRequestSchema`, `authorizationCodeGrantSchema`, `refreshTokenGrantSchema` and `clientCredentialsGrantSchema` are exported from `packages/contracts/src/index.ts:8-11` and imported by nothing — `grep -rn "tokenRequestSchema\|authorizationCodeGrantSchema\|refreshTokenGrantSchema\|clientCredentialsGrantSchema" --include="*.ts" packages apps tests tools` returns only that index re-export and the definitions themselves.

- [ ] **Step 1: Write the failing test**

There is no behaviour to test — this is a deletion of unreachable code. The guard is the build: `pnpm typecheck` and `pnpm lint` must stay green, proving nothing depended on them. Record the grep above in the commit body as the evidence.

- [ ] **Step 2: Run the checks before the change, to have a baseline**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Delete**

Remove the four schemas from `packages/contracts/src/token.ts` and their re-exports from `index.ts`. Keep `TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED` and `TokenEndpointAuthMethod` — `verified:` those two _are_ imported, by `packages/protocol-oidc/src/schema/client-oidc-config.ts:2`.

- [ ] **Step 4: Run the checks**

Run: `pnpm typecheck && pnpm lint && npx vitest run packages/contracts`
Expected: PASS

- [ ] **Step 5: Record the debt and commit**

Add to `docs/NEXT.md` under "Decisions still open":

```markdown
**ADR 0007 has never been executed.** Schemas are to be authored in Zod in
`packages/contracts` and compiled with `z.toJSONSchema()` for ajv validation
and OpenAPI. `parseStructure` in `token-issuance.ts` is the real authority
for the token request instead, and the contracts schemas that described it
were deleted in P4a rather than extended with a fourth grant, because a
stale union is worse than an absent one.

- Trigger: **P4c**, which publishes OpenAPI and so must either honour ADR
  0007 or amend it. `verified:` `z.toJSONSchema` exists in Zod 4.6.1 and
  emits draft 2020-12, the dialect OpenAPI 3.1 uses.
```

```bash
git add packages/contracts/src/token.ts packages/contracts/src/index.ts docs/NEXT.md
git commit -m "Delete the unused token-request schemas"
```

### Increment 2 close

- [ ] Branch `p4a/2-schema-and-metadata`, pull request opened on the first commit.
- [ ] `pnpm verify` green locally and in CI; review threads answered.
- [ ] Merge into `p4a-token-exchange`.

## Increment 3 — The leaf service

Every pure decision, with no database and no transaction, unit-tested in isolation. `service` imports nothing in this architecture, so this whole increment is testable without a container and runs in milliseconds.

### Task 3.1: Token type identifiers

**Files:**

- Create: `packages/protocol-oidc/src/service/token-exchange.ts`
- Test: `packages/protocol-oidc/src/service/token-exchange.test.ts`

**Interfaces:**

- Produces:
  - `export const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange'`
  - `export type ExchangeTokenType = 'access_token' | 'refresh_token' | 'id_token'`
  - `export function parseTokenType(raw: string): ExchangeTokenType | 'refused' | 'deferred' | 'unknown'`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseTokenType } from '#/service/token-exchange';

describe('[ODUDU-TOKEN-EXCHANGE-TYPES-01] RFC 8693 §3 token type identifiers', () => {
  it.each([
    ['urn:ietf:params:oauth:token-type:access_token', 'access_token'],
    ['urn:ietf:params:oauth:token-type:refresh_token', 'refresh_token'],
    ['urn:ietf:params:oauth:token-type:id_token', 'id_token'],
  ])('accepts %s', (urn, expected) => {
    expect(parseTokenType(urn)).toBe(expected);
  });

  // Refused on purpose, not unimplemented: this server signs at+jwt,
  // logout+jwt, userinfo+jwt and typ-absent ID tokens, and a type meaning
  // "any JWT this issuer signed" would accept all four interchangeably.
  it('refuses the generic jwt type', () => {
    expect(parseTokenType('urn:ietf:params:oauth:token-type:jwt')).toBe('refused');
  });

  it.each(['urn:ietf:params:oauth:token-type:saml1', 'urn:ietf:params:oauth:token-type:saml2'])(
    'defers %s until SAML assertions exist',
    (urn) => {
      expect(parseTokenType(urn)).toBe('deferred');
    },
  );

  it('treats anything else as unknown', () => {
    expect(parseTokenType('https://example.test/token-type')).toBe('unknown');
    expect(parseTokenType('')).toBe('unknown');
  });

  it('does not accept a type by suffix alone', () => {
    expect(parseTokenType('urn:evil:token-type:access_token')).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/service/token-exchange.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';

export type ExchangeTokenType = 'access_token' | 'refresh_token' | 'id_token';

export type TokenTypeOutcome = ExchangeTokenType | 'refused' | 'deferred' | 'unknown';

const ACCEPTED: Record<string, ExchangeTokenType> = {
  'urn:ietf:params:oauth:token-type:access_token': 'access_token',
  'urn:ietf:params:oauth:token-type:refresh_token': 'refresh_token',
  'urn:ietf:params:oauth:token-type:id_token': 'id_token',
};

const DEFERRED = new Set([
  'urn:ietf:params:oauth:token-type:saml1',
  'urn:ietf:params:oauth:token-type:saml2',
]);

// `:jwt` is refused rather than unimplemented — see
// docs/protocols/rfc8693.md's reading note on the four JWT kinds this
// server signs.
export function parseTokenType(raw: string): TokenTypeOutcome {
  const accepted = ACCEPTED[raw];
  if (accepted !== undefined) return accepted;
  if (raw === 'urn:ietf:params:oauth:token-type:jwt') return 'refused';
  if (DEFERRED.has(raw)) return 'deferred';
  return 'unknown';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc/src/service/token-exchange.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/service/token-exchange.ts packages/protocol-oidc/src/service/token-exchange.test.ts
git commit -m "Parse RFC 8693 token type identifiers"
```

### Task 3.2: The audience ceiling

**Files:**

- Modify: `packages/protocol-oidc/src/service/token-exchange.ts`
- Test: `packages/protocol-oidc/src/service/token-exchange.test.ts`

**Interfaces:**

- Consumes: `parseResource` from `#/service/resource-indicator`.
- Produces: `export function resolveExchangeAudience(input: { resource: string | string[] | undefined; audience: string | string[] | undefined; ceiling: readonly string[]; issuedType: ExchangeTokenType }): { kind: 'ok'; audience: readonly string[] } | { kind: 'invalid_target' }`

`verified:` `parseResource(raw, registered)` accepts one absolute URI with no fragment that appears in `registered`, returns `{ kind: 'invalid_target' }` for an array, and returns `registered` verbatim when `raw` is `undefined` — `packages/protocol-oidc/src/service/resource-indicator.ts`.

- [ ] **Step 1: Write the failing test**

```ts
const CEILING = ['https://api.example', 'https://other.example'];

describe('[ODUDU-TOKEN-EXCHANGE-AUD-01] the exchange audience', () => {
  it('narrows to a named resource inside the ceiling', () => {
    const out = resolveExchangeAudience({
      resource: 'https://api.example',
      audience: undefined,
      ceiling: CEILING,
      issuedType: 'access_token',
    });
    expect(out).toEqual({ kind: 'ok', audience: ['https://api.example'] });
  });

  it('accepts a logical audience without URI parsing', () => {
    const out = resolveExchangeAudience({
      resource: undefined,
      audience: 'https://other.example',
      ceiling: CEILING,
      issuedType: 'access_token',
    });
    expect(out).toEqual({ kind: 'ok', audience: ['https://other.example'] });
  });

  it('refuses a target outside the ceiling', () => {
    expect(
      resolveExchangeAudience({
        resource: 'https://elsewhere.example',
        audience: undefined,
        ceiling: CEILING,
        issuedType: 'access_token',
      }),
    ).toEqual({ kind: 'invalid_target' });
  });

  // RFC 8693 §2.1 permits several; this server issues single-audience
  // tokens, a decision RFC 8707 already made.
  it('refuses more than one target', () => {
    expect(
      resolveExchangeAudience({
        resource: ['https://api.example', 'https://other.example'],
        audience: undefined,
        ceiling: CEILING,
        issuedType: 'access_token',
      }),
    ).toEqual({ kind: 'invalid_target' });
  });

  it('refuses resource and audience naming different targets', () => {
    expect(
      resolveExchangeAudience({
        resource: 'https://api.example',
        audience: 'https://other.example',
        ceiling: CEILING,
        issuedType: 'access_token',
      }),
    ).toEqual({ kind: 'invalid_target' });
  });

  it('accepts resource and audience naming the same target', () => {
    expect(
      resolveExchangeAudience({
        resource: 'https://api.example',
        audience: 'https://api.example',
        ceiling: CEILING,
        issuedType: 'access_token',
      }),
    ).toEqual({ kind: 'ok', audience: ['https://api.example'] });
  });

  // An ID token's aud is the requesting client, fixed by OIDC Core, so
  // naming a target for one is refused rather than ignored.
  it('refuses a target named for an id_token', () => {
    expect(
      resolveExchangeAudience({
        resource: 'https://api.example',
        audience: undefined,
        ceiling: CEILING,
        issuedType: 'id_token',
      }),
    ).toEqual({ kind: 'invalid_target' });
  });

  it('allows an id_token with no target named', () => {
    expect(
      resolveExchangeAudience({
        resource: undefined,
        audience: undefined,
        ceiling: CEILING,
        issuedType: 'id_token',
      }),
    ).toEqual({ kind: 'ok', audience: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/service/token-exchange.test.ts -t AUD`
Expected: FAIL — `resolveExchangeAudience` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
function single(raw: string | string[] | undefined): string | undefined | 'many' {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) return raw.length > 1 ? 'many' : raw[0];
  return raw;
}

export function resolveExchangeAudience(input: {
  resource: string | string[] | undefined;
  audience: string | string[] | undefined;
  ceiling: readonly string[];
  issuedType: ExchangeTokenType;
}): { kind: 'ok'; audience: readonly string[] } | { kind: 'invalid_target' } {
  const resource = single(input.resource);
  const audience = single(input.audience);
  if (resource === 'many' || audience === 'many') return { kind: 'invalid_target' };

  // An ID token is addressed to the client that asked for it; there is no
  // target to choose, so naming one is a mistake rather than a preference.
  if (input.issuedType === 'id_token') {
    return resource === undefined && audience === undefined
      ? { kind: 'ok', audience: [] }
      : { kind: 'invalid_target' };
  }

  if (resource !== undefined && audience !== undefined && resource !== audience) {
    return { kind: 'invalid_target' };
  }

  const named = resource ?? audience;
  if (named === undefined) return { kind: 'ok', audience: input.ceiling };
  if (resource !== undefined) {
    const outcome = parseResource(resource, input.ceiling);
    return outcome.kind === 'invalid_target' ? outcome : { kind: 'ok', audience: outcome.audience };
  }
  return input.ceiling.includes(named)
    ? { kind: 'ok', audience: [named] }
    : { kind: 'invalid_target' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc/src/service/token-exchange.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/service/token-exchange.ts packages/protocol-oidc/src/service/token-exchange.test.ts
git commit -m "Resolve the exchange audience against the client ceiling"
```

### Task 3.3: Scope attenuation

**Files:**

- Modify: `packages/protocol-oidc/src/service/token-exchange.ts`
- Test: `packages/protocol-oidc/src/service/token-exchange.test.ts`

**Interfaces:**

- Produces: `export function attenuateScope(requested: string, granted: readonly string[]): { kind: 'ok'; scope: readonly string[] } | { kind: 'widened' }`

This task owns **Review Focus item 5**.

- [ ] **Step 1: Write the failing test**

```ts
describe('[ODUDU-TOKEN-EXCHANGE-SCOPE-01] scope never widens', () => {
  const GRANTED = ['openid', 'profile', 'reports:read'];

  it('carries the granted scope when none is requested', () => {
    expect(attenuateScope('', GRANTED)).toEqual({ kind: 'ok', scope: GRANTED });
  });

  it('narrows to a requested subset', () => {
    expect(attenuateScope('openid reports:read', GRANTED)).toEqual({
      kind: 'ok',
      scope: ['openid', 'reports:read'],
    });
  });

  it('refuses a scope the subject never held', () => {
    expect(attenuateScope('reports:write', GRANTED)).toEqual({ kind: 'widened' });
  });

  // The failure modes a real caller produces, none of which may widen.
  it('tolerates repeated and padded separators without widening', () => {
    expect(attenuateScope('  openid   openid  ', GRANTED)).toEqual({
      kind: 'ok',
      scope: ['openid'],
    });
  });

  it('refuses a near-miss rather than matching loosely', () => {
    expect(attenuateScope('Reports:read', GRANTED)).toEqual({ kind: 'widened' });
    expect(attenuateScope('reports:read2', GRANTED)).toEqual({ kind: 'widened' });
  });

  it('refuses when one of several requested scopes is not held', () => {
    expect(attenuateScope('openid reports:write', GRANTED)).toEqual({ kind: 'widened' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/service/token-exchange.test.ts -t SCOPE`
Expected: FAIL — `attenuateScope` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// RFC 8693 does not require the issued scope to be a subset of the subject
// token's; this server requires it anyway, because the agent layer's
// attenuation check is the consumer and a widening exchange would make that
// check unenforceable. Case-sensitive, per RFC 6749 §3.3.
export function attenuateScope(
  requested: string,
  granted: readonly string[],
): { kind: 'ok'; scope: readonly string[] } | { kind: 'widened' } {
  const asked = [...new Set(requested.split(' ').filter((entry) => entry !== ''))];
  if (asked.length === 0) return { kind: 'ok', scope: granted };
  const held = new Set(granted);
  return asked.every((entry) => held.has(entry))
    ? { kind: 'ok', scope: asked }
    : { kind: 'widened' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc/src/service/token-exchange.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/service/token-exchange.ts packages/protocol-oidc/src/service/token-exchange.test.ts
git commit -m "Attenuate exchange scope against the subject grant"
```

### Task 3.4: The `act` chain and its depth cap

**Files:**

- Modify: `packages/protocol-oidc/src/service/token-exchange.ts`
- Test: `packages/protocol-oidc/src/service/token-exchange.test.ts`

**Interfaces:**

- Produces:
  - `export interface ActClaim { sub: string; act?: ActClaim }`
  - `export const MAX_DELEGATION_DEPTH = 8`
  - `export function buildActChain(actorSubject: string, priorAct: unknown): { kind: 'ok'; act: ActClaim } | { kind: 'too_deep' } | { kind: 'malformed' }`

This task owns **Review Focus item 4**.

- [ ] **Step 1: Write the failing test**

```ts
describe('[ODUDU-TOKEN-EXCHANGE-ACT-01] the delegation chain', () => {
  it('names the actor when there is no prior chain', () => {
    expect(buildActChain('actor-1', undefined)).toEqual({ kind: 'ok', act: { sub: 'actor-1' } });
  });

  // RFC 8693 §4.1: the outermost act is the current actor, and a consumer
  // MUST consider only that one for access control.
  it('nests a prior chain beneath the current actor', () => {
    expect(buildActChain('actor-2', { sub: 'actor-1' })).toEqual({
      kind: 'ok',
      act: { sub: 'actor-2', act: { sub: 'actor-1' } },
    });
  });

  it('refuses a chain deeper than the cap', () => {
    let act: unknown = { sub: 'root' };
    for (let i = 0; i < MAX_DELEGATION_DEPTH; i += 1) act = { sub: `a${String(i)}`, act };
    expect(buildActChain('one-more', act)).toEqual({ kind: 'too_deep' });
  });

  it('refuses a prior act that is not shaped like one', () => {
    expect(buildActChain('actor', { notSub: 1 })).toEqual({ kind: 'malformed' });
    expect(buildActChain('actor', 'actor-1')).toEqual({ kind: 'malformed' });
    expect(buildActChain('actor', { sub: 'a', act: { notSub: 1 } })).toEqual({ kind: 'malformed' });
  });

  it('refuses a self-referential chain rather than looping', () => {
    const looped: Record<string, unknown> = { sub: 'a' };
    looped.act = looped;
    expect(buildActChain('actor', looped)).toEqual({ kind: 'too_deep' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/service/token-exchange.test.ts -t ACT`
Expected: FAIL — `buildActChain` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface ActClaim {
  sub: string;
  act?: ActClaim;
}

// A cap rather than a tenant setting: the configurable form belongs with
// the agent layer's max_depth, which also owns the chain's other bounds.
export const MAX_DELEGATION_DEPTH = 8;

// `unknown`, not a cast: a prior `act` arrives from a verified token's
// payload, which jose types as JWTPayload's index signature.
function narrowAct(value: unknown, budget: number): ActClaim | 'malformed' | 'too_deep' {
  if (budget <= 0) return 'too_deep';
  if (typeof value !== 'object' || value === null) return 'malformed';
  const sub = (value as { sub?: unknown }).sub;
  if (typeof sub !== 'string' || sub === '') return 'malformed';
  const nested = (value as { act?: unknown }).act;
  if (nested === undefined) return { sub };
  const inner = narrowAct(nested, budget - 1);
  if (inner === 'malformed' || inner === 'too_deep') return inner;
  return { sub, act: inner };
}

export function buildActChain(
  actorSubject: string,
  priorAct: unknown,
): { kind: 'ok'; act: ActClaim } | { kind: 'too_deep' } | { kind: 'malformed' } {
  if (priorAct === undefined) return { kind: 'ok', act: { sub: actorSubject } };
  const inner = narrowAct(priorAct, MAX_DELEGATION_DEPTH - 1);
  if (inner === 'too_deep') return { kind: 'too_deep' };
  if (inner === 'malformed') return { kind: 'malformed' };
  return { kind: 'ok', act: { sub: actorSubject, act: inner } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc/src/service/token-exchange.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/service/token-exchange.ts packages/protocol-oidc/src/service/token-exchange.test.ts
git commit -m "Build the act chain with a bounded depth"
```

### Task 3.5: `may_act` is compared with the party that becomes the actor

**Files:**

- Modify: `packages/protocol-oidc/src/service/token-exchange.ts`
- Test: `packages/protocol-oidc/src/service/token-exchange.test.ts`

**Interfaces:**

- Produces: `export function mayActPermits(mayAct: unknown, actorSubject: string): boolean`

The spec's section 6 and the first review of this branch both turn on this: the check must read the same party the `act` claim records, or it records an authorization nobody made.

- [ ] **Step 1: Write the failing test**

```ts
describe('[ODUDU-TOKEN-EXCHANGE-MAYACT-01] may_act authorises the actor', () => {
  it('permits when absent, since nothing mints it yet', () => {
    expect(mayActPermits(undefined, 'actor-1')).toBe(true);
  });

  it('permits the named actor', () => {
    expect(mayActPermits({ sub: 'actor-1' }, 'actor-1')).toBe(true);
  });

  it('refuses a different actor', () => {
    expect(mayActPermits({ sub: 'actor-1' }, 'actor-2')).toBe(false);
  });

  it('refuses a malformed claim rather than ignoring it', () => {
    expect(mayActPermits({ notSub: 'actor-1' }, 'actor-1')).toBe(false);
    expect(mayActPermits('actor-1', 'actor-1')).toBe(false);
    expect(mayActPermits(null, 'actor-1')).toBe(false);
  });
});
```

Note the asymmetry the first two cases encode: **absent permits, malformed refuses.** A claim that is present but unreadable is a claim the server cannot honour, and honouring it by default would make a typo into a bypass.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/service/token-exchange.test.ts -t MAYACT`
Expected: FAIL — `mayActPermits` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// RFC 8693 §4.4 authorises a party "to become the actor", so the comparison
// is against whoever the issued token will name in `act` — the actor
// token's subject under delegation, the requesting client under
// impersonation. Nothing mints this claim yet; P5's ownership model does.
export function mayActPermits(mayAct: unknown, actorSubject: string): boolean {
  if (mayAct === undefined) return true;
  if (typeof mayAct !== 'object' || mayAct === null) return false;
  const sub = (mayAct as { sub?: unknown }).sub;
  return typeof sub === 'string' && sub === actorSubject;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc/src/service/token-exchange.test.ts && pnpm lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/service/token-exchange.ts packages/protocol-oidc/src/service/token-exchange.test.ts
git commit -m "Compare may_act with the party that becomes the actor"
```

### Increment 3 close

- [ ] Branch `p4a/3-exchange-service`, pull request on the first commit.
- [ ] CI green, review threads answered, merge into `p4a-token-exchange`.

## Increment 4 — Resolving the presented tokens

Turning a `subject_token` or `actor_token` of any accepted type into one normalised shape, with every liveness check the type carries. Needs a transaction, so it is a usecase.

`verified:` `verifyJwt(token, { keys, issuer, audience, typ })` is the verifier; `AUDIENCE_UNCHECKED` and `TYP_ABSENT` are exported symbols for the two cases that need them — `packages/crypto/src/service/sign.ts:72,89,121`.

`verified:` `/introspect` verifies an access token with `typ: 'at+jwt'` and `AUDIENCE_UNCHECKED`, then checks the grant and the session — `packages/protocol-oidc/src/usecase/introspection.ts:80-90`.

`verified:` `refreshTokenRepository(tx).byHash(hash)` is read-only and explicitly "never the thing that marks a token spent" — `packages/protocol-oidc/src/repository/refresh.ts:88-94`.

`assumption:` an ID token verifies through the same `verifyJwt` with `typ: TYP_ABSENT`. **Spike before task 4.3**: `packages/protocol-oidc/src/usecase/authorization-request.ts:789` already verifies an `id_token_hint`; read what it passes and copy it rather than guessing.

### Task 4.1: The normalised shape, and an access token as subject

**Files:**

- Create: `packages/protocol-oidc/src/usecase/token-exchange-subject.ts`
- Test: `packages/protocol-oidc/tests/token-exchange.int.test.ts` (create)

**Interfaces:**

- Produces:

```ts
export interface ResolvedExchangeToken {
  subjectId: string;
  scope: readonly string[];
  sessionId: string | null;
  grantId: string | null;
  act: unknown;
  mayAct: unknown;
  expiresAt: Date | null;
}

export type ResolveOutcome = { kind: 'ok'; token: ResolvedExchangeToken } | { kind: 'refused' };

export interface ResolveDeps {
  issuer: string;
  requestingClientId: string;
  lifespans: SessionLifespans;
  now: Date;
}

export async function resolveExchangeToken(
  tx: TenantScopedDatabase,
  deps: ResolveDeps,
  type: ExchangeTokenType,
  token: string,
): Promise<ResolveOutcome>;
```

`verified:` **no new dependency has to be threaded for session liveness.** `TokenIssuanceDeps` already carries `lifespans: SessionLifespans` (`token-issuance.ts:68`), and `refresh-rotation.ts` — in this same package — imports `sessionRepository` from `@odudu/authn-flows` and calls `liveById(sessionId, lifespans, now)` inside the caller's transaction. Copy that, rather than adding an `isSessionLive` callback: `grep -n "isSessionLive" packages/protocol-oidc/src/usecase/token-issuance.ts packages/protocol-oidc/src/view/routes/token.ts` returns nothing, so an injected predicate would mean changing the route, the composition root and the deps type for something the package can already reach.

`refused` carries no reason on purpose: RFC 8693 §2.2.2 makes every one of them `invalid_request`, and the caller must not be able to tell which check failed — the same discipline `invalidGrant()` already enforces at the code path.

- [ ] **Step 1: Write the failing test**

Create `packages/protocol-oidc/tests/token-exchange.int.test.ts` on the fixture shape of `resource-token.int.test.ts`. First case: a live access token resolves.

```ts
describe('[ODUDU-TOKEN-EXCHANGE-SUBJECT-01] an access token as subject_token', () => {
  it('resolves to its grant subject, scope and session', async () => {
    const { accessToken, grantId, sessionId, subjectId } = await loginAndGetToken();

    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(tx, resolveDeps, 'access_token', accessToken),
    );

    expect(outcome).toMatchObject({
      kind: 'ok',
      token: { subjectId, grantId, sessionId, scope: expect.arrayContaining(['openid']) },
    });
  });

  it('refuses a token whose grant was revoked', async () => {
    const { accessToken, grantId } = await loginAndGetToken();
    await withTenant(app.db, TENANT_ID, (tx) =>
      tokenGrantRepository(tx).revoke(grantId, new Date()),
    );

    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(tx, resolveDeps, 'access_token', accessToken),
    );
    expect(outcome).toEqual({ kind: 'refused' });
  });

  it('refuses a syntactically valid token this tenant did not sign', async () => {
    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(tx, resolveDeps, 'access_token', FOREIGN_TENANT_ACCESS_TOKEN),
    );
    expect(outcome).toEqual({ kind: 'refused' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/token-exchange.int.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
async function resolveAccessToken(
  tx: TenantScopedDatabase,
  deps: ResolveDeps,
  token: string,
): Promise<ResolveOutcome> {
  let payload: JWTPayload;
  try {
    payload = await verifyJwt(token, {
      keys: await signingKeyRepository(tx).listPublishable(),
      issuer: deps.issuer,
      audience: AUDIENCE_UNCHECKED,
      typ: 'at+jwt',
    });
  } catch {
    return { kind: 'refused' };
  }

  const grantId = typeof payload.grant_id === 'string' ? payload.grant_id : null;
  if (grantId === null) return { kind: 'refused' };
  const grant = await tokenGrantRepository(tx).byId(grantId);
  if (grant === null || grant.revokedAt !== null) return { kind: 'refused' };
  if (grant.sessionId !== null && !(await sessionIsLive(tx, deps, grant.sessionId))) {
    return { kind: 'refused' };
  }

  return {
    kind: 'ok',
    token: {
      subjectId: grant.subjectId,
      scope: grant.scope.split(' ').filter((entry) => entry !== ''),
      sessionId: grant.sessionId,
      grantId: grant.id,
      act: payload.act,
      mayAct: payload.may_act,
      expiresAt: typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : null,
    },
  };
}
```

with the one liveness helper both branches share:

```ts
// Checked, never touched: rotation extends the idle window because a user
// is present; an exchange is a third party acting on a delegated token, and
// letting it extend the window would keep a departed user signed in for as
// long as anything downstream stayed busy.
async function sessionIsLive(
  tx: TenantScopedDatabase,
  deps: ResolveDeps,
  sessionId: string,
): Promise<boolean> {
  return (await sessionRepository(tx).liveById(sessionId, deps.lifespans, deps.now)) !== null;
}
```

`listPublishable`, not `active`: a token signed by a key now `rotating` must still verify for its remaining life, which is the entire point of the overlap window.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc/tests/token-exchange.int.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/usecase/token-exchange-subject.ts packages/protocol-oidc/tests/token-exchange.int.test.ts
git commit -m "Resolve an access token presented for exchange"
```

### Task 4.2: A refresh token as subject, read but never spent

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/token-exchange-subject.ts`
- Test: `packages/protocol-oidc/tests/token-exchange.int.test.ts`

**Interfaces:**

- Consumes: `refreshTokenRepository(tx).byHash`, `hashRefreshToken`.
- Produces: no new export; `resolveExchangeToken` gains a branch.

- [ ] **Step 1: Write the failing test**

```ts
describe('[ODUDU-TOKEN-EXCHANGE-SUBJECT-02] a refresh token as subject_token', () => {
  it('resolves without consuming it, so it still refreshes afterwards', async () => {
    const { refreshToken } = await loginAndGetToken();

    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(tx, resolveDeps, 'refresh_token', refreshToken),
    );
    expect(outcome.kind).toBe('ok');

    // RFC 8693 §2.1: "the act of performing a token exchange has no impact
    // on the validity of the subject token".
    const refreshed = await http.inject({
      method: 'POST',
      url: `/tenants/${TENANT}/protocol/openid-connect/token`,
      headers: { authorization: basicAuth(CLIENT_ID, CLIENT_SECRET) },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });
    expect(refreshed.statusCode).toBe(200);
  });

  it('refuses one already consumed by a rotation', async () => {
    const { refreshToken } = await loginAndGetToken();
    await rotateOnce(refreshToken);

    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(tx, resolveDeps, 'refresh_token', refreshToken),
    );
    expect(outcome).toEqual({ kind: 'refused' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/token-exchange.int.test.ts -t SUBJECT-02`
Expected: FAIL — the branch throws or returns `refused` for every refresh token.

- [ ] **Step 3: Write minimal implementation**

```ts
async function resolveRefreshToken(
  tx: TenantScopedDatabase,
  deps: ResolveDeps,
  token: string,
): Promise<ResolveOutcome> {
  // byHash, never consume: an exchange is not a refresh, and spending the
  // caller's own credential to hand it a different one would be a surprise
  // RFC 8693 §2.1 explicitly rules out.
  const record = await refreshTokenRepository(tx).byHash(hashRefreshToken(token));
  if (record === null || record.usedAt !== null) return { kind: 'refused' };
  if (record.expiresAt.getTime() <= deps.now.getTime()) return { kind: 'refused' };

  const grant = await tokenGrantRepository(tx).byId(record.grantId);
  if (grant === null || grant.revokedAt !== null) return { kind: 'refused' };
  if (grant.sessionId !== null && !(await sessionIsLive(tx, deps, grant.sessionId))) {
    return { kind: 'refused' };
  }

  return {
    kind: 'ok',
    token: {
      subjectId: grant.subjectId,
      scope: grant.scope.split(' ').filter((entry) => entry !== ''),
      sessionId: grant.sessionId,
      grantId: grant.id,
      act: undefined,
      mayAct: undefined,
      expiresAt: record.expiresAt,
    },
  };
}
```

`verified:` confirm `RefreshTokenRecord`'s field names (`usedAt`, `expiresAt`, `grantId`) against `packages/protocol-oidc/src/repository/refresh.ts` before writing this — the row is read through a raw `tx.execute`, so the mapped names are worth checking rather than assuming.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc/tests/token-exchange.int.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/usecase/token-exchange-subject.ts packages/protocol-oidc/tests/token-exchange.int.test.ts
git commit -m "Resolve a refresh token for exchange without spending it"
```

### Task 4.3: An ID token as subject, bound to the requesting client

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/token-exchange-subject.ts`
- Test: `packages/protocol-oidc/tests/token-exchange.int.test.ts`

**Interfaces:**

- Consumes: `TYP_ABSENT`.
- Produces: `resolveExchangeToken` gains its third branch, and `ResolveDeps` gains `requestingClientId: string`.

This task owns **Review Focus item 1**.

- [ ] **Step 1: Write the failing test**

```ts
describe('[ODUDU-TOKEN-EXCHANGE-SUBJECT-03] an id_token as subject_token', () => {
  it('resolves when its aud names the requesting client', async () => {
    const { idToken, subjectId } = await loginAndGetToken();
    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(
        tx,
        { ...resolveDeps, requestingClientId: CLIENT_ID },
        'id_token',
        idToken,
      ),
    );
    expect(outcome).toMatchObject({ kind: 'ok', token: { subjectId } });
  });

  // An ID token is an authentication receipt for one client, not a bearer
  // credential for APIs, so a holder that is not its audience may not
  // exchange it. Stricter than RFC 8693 requires.
  it('refuses when another client presents it', async () => {
    const { idToken } = await loginAndGetToken();
    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(
        tx,
        { ...resolveDeps, requestingClientId: OTHER_CLIENT_ID },
        'id_token',
        idToken,
      ),
    );
    expect(outcome).toEqual({ kind: 'refused' });
  });

  it('refuses an id_token signed by another tenant', async () => {
    const outcome = await withTenant(app.db, TENANT_ID, (tx) =>
      resolveExchangeToken(tx, resolveDeps, 'id_token', FOREIGN_TENANT_ID_TOKEN),
    );
    expect(outcome).toEqual({ kind: 'refused' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/token-exchange.int.test.ts -t SUBJECT-03`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
async function resolveIdToken(
  tx: TenantScopedDatabase,
  deps: ResolveDeps,
  token: string,
): Promise<ResolveOutcome> {
  let payload: JWTPayload;
  try {
    payload = await verifyJwt(token, {
      keys: await signingKeyRepository(tx).listPublishable(),
      issuer: deps.issuer,
      audience: deps.requestingClientId,
      typ: TYP_ABSENT,
    });
  } catch {
    return { kind: 'refused' };
  }

  const subjectId = typeof payload.sub === 'string' ? payload.sub : null;
  if (subjectId === null) return { kind: 'refused' };
  const sessionId = typeof payload.sid === 'string' ? payload.sid : null;
  if (sessionId !== null && !(await sessionIsLive(tx, deps, sessionId))) return { kind: 'refused' };

  // An ID token names no grant and carries no scope, so an exchange from
  // one is bounded by the client's own registration rather than by a
  // grant's recorded scope.
  return {
    kind: 'ok',
    token: {
      subjectId,
      scope: [],
      sessionId,
      grantId: null,
      act: payload.act,
      mayAct: payload.may_act,
      expiresAt: typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : null,
    },
  };
}
```

An empty `scope` means `attenuateScope` refuses every request that names one, and carries nothing when none is named. That is deliberate and must be stated in the clause table: an ID token exchange yields a token with no scope unless the flow is extended, which is the honest consequence of an ID token not being a grant.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc/tests/token-exchange.int.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/usecase/token-exchange-subject.ts packages/protocol-oidc/tests/token-exchange.int.test.ts
git commit -m "Resolve an id_token for exchange, bound to its audience"
```

### Task 4.4: An actor token is validated as strictly as the subject

**Files:**

- Test: `packages/protocol-oidc/tests/token-exchange.int.test.ts`

**Interfaces:**

- Consumes: `resolveExchangeToken`, unchanged.
- Produces: nothing.

This task owns **Review Focus item 2**. It adds no production code if the usecase resolves both tokens through the same function — which is the point. If it does not, that is the defect this task exists to find.

- [ ] **Step 1: Write the failing test**

```ts
describe('[ODUDU-TOKEN-EXCHANGE-ACTOR-01] the actor token is checked too', () => {
  it('refuses an expired actor token beside a live subject token', async () => {
    const subject = await loginAndGetToken();
    const actor = await loginAndGetToken();
    await expireAccessToken(actor.grantId);

    const response = await exchange({
      subjectToken: subject.accessToken,
      actorToken: actor.accessToken,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('refuses an actor token whose grant was revoked', async () => {
    const subject = await loginAndGetToken();
    const actor = await loginAndGetToken();
    await withTenant(app.db, TENANT_ID, (tx) =>
      tokenGrantRepository(tx).revoke(actor.grantId, new Date()),
    );

    const response = await exchange({
      subjectToken: subject.accessToken,
      actorToken: actor.accessToken,
    });
    expect(response.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/token-exchange.int.test.ts -t ACTOR-01`
Expected: FAIL until increment 5 wires the route. Mark this task's tests `.skip` with a one-line note, unskip them in task 5.4, and say so in the commit — a test that cannot run yet is worth writing now and worth nobody pretending it passed.

- [ ] **Step 3: Write minimal implementation**

None. If these fail once the route exists, the usecase is resolving the actor token by a different path than the subject — unify them rather than adding a second set of checks.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc/tests/token-exchange.int.test.ts` (after task 5.4)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/tests/token-exchange.int.test.ts
git commit -m "Pin actor-token validation against the subject's"
```

### Increment 4 close

- [ ] Branch `p4a/4-subject-resolution`, pull request on the first commit.
- [ ] CI green, review threads answered, merge.

## Increment 5 — Minting, the grant row, and the session property

The grant becomes real. This is the largest increment and the one whose failure modes matter most.

### Task 5.1: Stage 1 parses the exchange request

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts` (`StructuredRequest`, `parseStructure`)
- Test: `packages/protocol-oidc/src/usecase/token-issuance.test.ts`

**Interfaces:**

- Produces: a fourth `StructuredRequest` variant:

```ts
  | {
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange';
      clientId: string | undefined;
      subjectToken: string;
      subjectTokenType: string;
      actorToken: string | undefined;
      actorTokenType: string | undefined;
      requestedTokenType: string | undefined;
      scope: string;
      resource: string | string[] | undefined;
      audience: string | string[] | undefined;
    }
```

The discriminant is the URN itself, so `config.grantTypes.includes(request.grantType)` from increment 1 works unchanged.

- [ ] **Step 1: Write the failing test**

```ts
describe('[ODUDU-TOKEN-EXCHANGE-PARSE-01] stage 1', () => {
  it('requires subject_token and subject_token_type', () => {
    expect(() => parseStructure({ grant_type: TOKEN_EXCHANGE_GRANT })).toThrow(
      expect.objectContaining({ error: 'invalid_request' }),
    );
    expect(() => parseStructure({ grant_type: TOKEN_EXCHANGE_GRANT, subject_token: 'x' })).toThrow(
      expect.objectContaining({ error: 'invalid_request' }),
    );
  });

  it('requires actor_token_type when actor_token is present', () => {
    expect(() =>
      parseStructure({
        grant_type: TOKEN_EXCHANGE_GRANT,
        subject_token: 'x',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        actor_token: 'y',
      }),
    ).toThrow(expect.objectContaining({ error: 'invalid_request' }));
  });

  it('collapses a repeated audience the way resource is collapsed', () => {
    const parsed = parseStructure({
      grant_type: TOKEN_EXCHANGE_GRANT,
      subject_token: 'x',
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience: ['a', 'b'],
    });
    expect(parsed).toMatchObject({ audience: ['a', 'b'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/usecase/token-issuance.test.ts -t PARSE-01`
Expected: FAIL — `parseStructure` throws `unsupported_grant_type` for the URN.

- [ ] **Step 3: Write minimal implementation**

Add the branch before the final `throw unsupportedGrantType()`, reusing `readResourceField`'s shape for `audience` so both multi-valued parameters collapse identically:

```ts
if (grantType === TOKEN_EXCHANGE_GRANT) {
  const subjectToken = readField(body, 'subject_token');
  const subjectTokenType = readField(body, 'subject_token_type');
  if (subjectToken.length === 0 || subjectTokenType.length === 0) throw invalidRequest();
  const actorToken = readOptionalField(body, 'actor_token');
  const actorTokenType = readOptionalField(body, 'actor_token_type');
  // §2.1 makes actor_token_type REQUIRED when actor_token is present.
  if (actorToken !== undefined && actorTokenType === undefined) throw invalidRequest();
  return {
    grantType,
    clientId: readOptionalField(body, 'client_id'),
    subjectToken,
    subjectTokenType,
    actorToken,
    actorTokenType,
    requestedTokenType: readOptionalField(body, 'requested_token_type'),
    scope: readField(body, 'scope'),
    resource: readResourceField(body),
    audience: readMultiField(body, 'audience'),
  };
}
```

`readMultiField` generalises `readResourceField`, which currently hardcodes `body.resource` — extract it rather than copying, and have `readResourceField` call it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc/src/usecase/token-issuance.test.ts && pnpm typecheck`
Expected: PASS. `typecheck` will now fail at `assertNeverGrant` until task 5.2 adds the dispatch branch — that is increment 1's guarantee working exactly as intended. Add the branch in the same commit as this one if you prefer a green intermediate state; the plan keeps them separate for review clarity, so expect one red typecheck between them and do not push that commit alone.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/usecase/token-issuance.ts packages/protocol-oidc/src/usecase/token-issuance.test.ts
git commit -m "Parse the token-exchange request at stage 1"
```

### Task 5.2: `mintAccessToken` accepts an `act` claim and an expiry ceiling

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts:268-345`
- Test: `packages/protocol-oidc/src/usecase/token-issuance.test.ts`

**Interfaces:**

- Produces: two optional inputs on `mintAccessToken` — `act?: ActClaim` and `expCeiling?: Date`.

- [ ] **Step 1: Write the failing test**

Assert through the exchange integration test rather than unit-testing a private function; the observable behaviour is the minted token's claims.

```ts
it('caps the issued token at the subject token exp', async () => {
  const subject = await loginAndGetToken();
  const subjectExp = decodeExp(subject.accessToken);

  const response = await exchange({ subjectToken: subject.accessToken });
  expect(decodeExp(response.json().access_token)).toBeLessThanOrEqual(subjectExp);
});

it('never extends beyond the configured ttl either', async () => {
  const subject = await loginAndGetToken();
  const response = await exchange({ subjectToken: subject.accessToken });
  const exp = decodeExp(response.json().access_token);
  expect(exp).toBeLessThanOrEqual(nowSeconds() + ACCESS_TOKEN_TTL_SECONDS);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/token-exchange.int.test.ts -t caps`
Expected: FAIL (skipped until the route exists — unskip in task 5.4).

- [ ] **Step 3: Write minimal implementation**

In `mintAccessToken`, replace the `exp` line:

```ts
const ttlExp = iat + input.config.accessTokenTtlSeconds;
// An exchange may not lengthen the credential it was handed; every other
// grant mints from one the client already owns and passes no ceiling.
const ceiling =
  input.expCeiling === undefined ? ttlExp : Math.floor(input.expCeiling.getTime() / 1000);
const exp = Math.min(ttlExp, ceiling);
```

and add `act` to the registered claims object, before `withRegisteredClaimsWinning` is applied, so no mapper can forge it:

```ts
    ...(input.act === undefined ? {} : { act: input.act }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc` (after task 5.4)
Expected: PASS, and every existing grant unchanged — none passes `expCeiling`, so `Math.min(ttlExp, ttlExp)` is `ttlExp`.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/usecase/token-issuance.ts
git commit -m "Let a minted token carry act and an expiry ceiling"
```

### Task 5.3: The grant row, inheriting the session

**Files:**

- Modify: `packages/protocol-oidc/src/repository/grants.ts`
- Test: `packages/protocol-oidc/tests/token-exchange.int.test.ts`

**Interfaces:**

- Consumes: the columns from task 2.1.
- Produces: `NewTokenGrant` gains `actorSubjectId?: string | null` and `exchangedFromGrantId?: string | null`; `TokenGrantRecord` gains both, non-optional and nullable.

- [ ] **Step 1: Write the failing test**

```ts
it('records the actor and the grant it came from, and inherits the session', async () => {
  const subject = await loginAndGetToken();
  const actor = await loginAndGetToken();

  const response = await exchange({
    subjectToken: subject.accessToken,
    actorToken: actor.accessToken,
  });
  const issuedGrantId = decodeClaim(response.json().access_token, 'grant_id');

  const row = await withTenant(app.db, TENANT_ID, (tx) =>
    tokenGrantRepository(tx).byId(issuedGrantId),
  );
  expect(row).toMatchObject({
    subjectId: subject.subjectId,
    actorSubjectId: actor.subjectId,
    exchangedFromGrantId: subject.grantId,
    sessionId: subject.sessionId,
  });
});

it('probes with a foreign tenant id', async () => {
  const row = await withTenant(app.db, OTHER_TENANT_ID, (tx) =>
    tokenGrantRepository(tx).byId(KNOWN_GRANT_ID_IN_TENANT),
  );
  expect(row).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/token-exchange.int.test.ts -t records`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Add both fields to `NewTokenGrant`, to the `insert().values({...})` call and to `toRecord`. Nothing else in `grants.ts` changes — in particular `revokeForSession` is untouched, because an exchanged grant carrying the subject's `session_id` is already inside its `WHERE`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc/tests/token-exchange.int.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/repository/grants.ts packages/protocol-oidc/tests/token-exchange.int.test.ts
git commit -m "Record the actor and lineage on an exchanged grant"
```

### Task 5.4: `issueExchangedTokens`

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts`
- Test: `packages/protocol-oidc/tests/token-exchange.int.test.ts` (unskip tasks 4.4 and 5.2)

**Interfaces:**

- Consumes: everything increments 3 and 4 produced.
- Produces: the dispatch's fourth branch, and the `TokenResponse` gains `issued_token_type`.

- [ ] **Step 1: Write the failing test**

```ts
describe('[ODUDU-TOKEN-EXCHANGE-01] the grant end to end', () => {
  it('delegates: sub is the subject, act names the actor', async () => {
    const subject = await loginAndGetToken();
    const actor = await loginAndGetToken();
    const response = await exchange({
      subjectToken: subject.accessToken,
      actorToken: actor.accessToken,
      resource: 'https://api.example',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.issued_token_type).toBe('urn:ietf:params:oauth:token-type:access_token');
    expect(body.token_type).toBe('Bearer');
    const claims = decode(body.access_token);
    expect(claims.sub).toBe(subject.subjectId);
    expect(claims.act).toEqual({ sub: actor.subjectId });
    expect(claims.aud).toContain('https://api.example');
  });

  it('impersonates only when the client is permitted', async () => {
    const subject = await loginAndGetToken();
    const refused = await exchange({ subjectToken: subject.accessToken });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ error: 'unauthorized_client' });

    await allowImpersonation(CLIENT_ID);
    const allowed = await exchange({ subjectToken: subject.accessToken });
    expect(allowed.statusCode).toBe(200);
    expect(decode(allowed.json().access_token).act).toBeUndefined();
  });

  it('refuses a refused token type with invalid_request', async () => {
    const subject = await loginAndGetToken();
    const response = await exchange({
      subjectToken: subject.accessToken,
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('issues an id_token addressed to the requesting client', async () => {
    const subject = await loginAndGetToken({ scope: 'openid' });
    await allowImpersonation(CLIENT_ID);
    const response = await exchange({
      subjectToken: subject.accessToken,
      requestedTokenType: 'urn:ietf:params:oauth:token-type:id_token',
    });

    const body = response.json();
    expect(body.issued_token_type).toBe('urn:ietf:params:oauth:token-type:id_token');
    expect(decode(body.access_token).aud).toBe(CLIENT_ID);
  });

  it('refuses a target named alongside a requested id_token', async () => {
    const subject = await loginAndGetToken({ scope: 'openid' });
    await allowImpersonation(CLIENT_ID);
    const response = await exchange({
      subjectToken: subject.accessToken,
      requestedTokenType: 'urn:ietf:params:oauth:token-type:id_token',
      resource: 'https://api.example',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_target' });
  });

  it('returns a refresh token in access_token when one is requested', async () => {
    const subject = await loginAndGetToken();
    await allowImpersonation(CLIENT_ID);
    const response = await exchange({
      subjectToken: subject.accessToken,
      requestedTokenType: 'urn:ietf:params:oauth:token-type:refresh_token',
    });
    const body = response.json();
    expect(body.issued_token_type).toBe('urn:ietf:params:oauth:token-type:refresh_token');
    expect(body.access_token).toEqual(expect.any(String));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/token-exchange.int.test.ts`
Expected: FAIL — typecheck fails at `assertNeverGrant`, which is the guarantee doing its job.

- [ ] **Step 3: Write minimal implementation**

```ts
async function issueExchangedTokens(
  tx: TenantScopedDatabase,
  deps: TokenIssuanceDeps,
  request: Extract<StructuredRequest, { grantType: typeof TOKEN_EXCHANGE_GRANT }>,
  client: ClientRecord,
  config: ClientOidcConfig,
): Promise<TokenResponse> {
  // One narrowing for all three type parameters: every non-accepted
  // outcome is invalid_request, so they do not need telling apart here.
  const accepted = (raw: string): ExchangeTokenType => {
    const outcome = parseTokenType(raw);
    if (outcome === 'refused' || outcome === 'deferred' || outcome === 'unknown') {
      throw invalidRequest();
    }
    return outcome;
  };

  const subjectType = accepted(request.subjectTokenType);
  const issuedType =
    request.requestedTokenType === undefined ? 'access_token' : accepted(request.requestedTokenType);

  const resolveDeps: ResolveDeps = {
    issuer: deps.issuer,
    requestingClientId: client.clientId,
    lifespans: deps.lifespans,
    now: deps.clock.now(),
  };
  };
  const subject = await resolveExchangeToken(tx, resolveDeps, subjectType, request.subjectToken);
  if (subject.kind !== 'ok') throw invalidRequest();

  // `actorTokenType` is non-undefined whenever `actorToken` is — stage 1
  // refuses the pair otherwise — but narrow it rather than asserting it.
  const actorType = request.actorTokenType === undefined ? null : accepted(request.actorTokenType);
  const actor =
    request.actorToken === undefined || actorType === null
      ? null
      : await resolveExchangeToken(tx, resolveDeps, actorType, request.actorToken);
  if (actor !== null && actor.kind !== 'ok') throw invalidRequest();

  // Impersonation is the branch with no actor recorded, so it is the one
  // the per-client permission gates.
  if (actor === null && !config.tokenExchangeImpersonationAllowed) throw unauthorizedClient();

  const actorSubject = actor === null ? client.clientId : actor.token.subjectId;
  if (!mayActPermits(subject.token.mayAct, actorSubject)) throw invalidRequest();

  const act = actor === null ? undefined : buildActChain(actorSubject, actor.token.act);
  if (act !== undefined && act.kind !== 'ok') throw invalidRequest();

  const scope = attenuateScope(request.scope, subject.token.scope);
  if (scope.kind === 'widened') throw invalidScope();

  const audience = resolveExchangeAudience({
    resource: request.resource,
    audience: request.audience,
    ceiling: config.audiences,
    issuedType,
  });
  if (audience.kind === 'invalid_target') throw invalidTarget();

  // ... mint through mintAccessToken with act, expCeiling: subject.token.expiresAt,
  //     create the grant row with actorSubjectId, exchangedFromGrantId and
  //     the inherited sessionId, and shape the response per §2.2.1.
}
```

The elided tail follows `issueClientCredentialsTokens` closely — read it and copy its ordering rather than inventing one. Three things it must do that the client-credentials path does not: pass `act` and `expCeiling` to `mintAccessToken`, write the two lineage columns, and set `issued_token_type` on the response.

**The session is checked, never touched.** `resolveExchangeToken` calls `deps.isSessionLive`; nothing here calls `sessionRepository(tx).touch`. An exchange must not extend a departed user's idle window.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc && pnpm typecheck && pnpm lint`
Expected: PASS. Unskip tasks 4.4 and 5.2's tests in this commit.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/usecase/token-issuance.ts packages/protocol-oidc/tests/token-exchange.int.test.ts
git commit -m "Issue exchanged tokens"
```

### Task 5.5: An exchanged token dies with its session, at both doors

**Files:**

- Test: `packages/protocol-oidc/tests/token-exchange.int.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: nothing. This is the phase's safety property, pinned.

This task owns **Review Focus item 3**. It is the single test this phase most needs, because the behaviour it asserts is provided by code nobody wrote — `revokeForSession` reaching a row it has never seen — and a refactor could remove it silently.

- [ ] **Step 1: Write the failing test**

```ts
describe('[ODUDU-TOKEN-EXCHANGE-SESSION-01] an exchanged token dies with the session', () => {
  it('is dead at /introspect and at /userinfo after logout', async () => {
    const subject = await loginAndGetToken({ scope: 'openid profile' });
    await allowImpersonation(CLIENT_ID);
    const exchanged = (await exchange({ subjectToken: subject.accessToken })).json().access_token;

    // Live before, so the assertion after is about the logout and not
    // about the token having been useless all along.
    expect((await introspect(exchanged)).json().active).toBe(true);
    expect((await userinfo(exchanged)).statusCode).toBe(200);

    await endSession(subject.sessionId);

    expect((await introspect(exchanged)).json().active).toBe(false);
    expect((await userinfo(exchanged)).statusCode).toBe(401);
  });

  it('refuses a further exchange once the session has ended', async () => {
    const subject = await loginAndGetToken();
    await allowImpersonation(CLIENT_ID);
    await endSession(subject.sessionId);

    const response = await exchange({ subjectToken: subject.accessToken });
    expect(response.statusCode).toBe(400);
  });

  it('does not extend the session it rides on', async () => {
    const subject = await loginAndGetToken();
    await allowImpersonation(CLIENT_ID);
    const before = await sessionLastSeen(subject.sessionId);

    await advanceClock(60_000);
    await exchange({ subjectToken: subject.accessToken });

    expect(await sessionLastSeen(subject.sessionId)).toEqual(before);
  });

  it('inherits no session from an offline grant, and survives a logout', async () => {
    const subject = await loginAndGetToken({ scope: 'openid offline_access' });
    await allowImpersonation(CLIENT_ID);
    const exchanged = (await exchange({ subjectToken: subject.offlineAccessToken })).json()
      .access_token;

    await endSession(subject.sessionId);
    expect((await introspect(exchanged)).json().active).toBe(true);
  });
});
```

The last case is as important as the first three: inheritance must be inheritance, not a blanket session requirement. An offline grant has no session, and an exchange from one must not invent a dependency the subject never had.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/token-exchange.int.test.ts -t SESSION-01`
Expected: FAIL for the touch case if `touch` was copied from rotation; the others should pass if task 5.3 inherited `sessionId` correctly. A pass here is a result, not a skipped step — record which cases passed first time in the commit body.

- [ ] **Step 3: Write minimal implementation**

Only if a case fails. Do not weaken the test to match behaviour.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol-oidc`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/tests/token-exchange.int.test.ts
git commit -m "Pin that an exchanged token dies with its session"
```

### Increment 5 close

- [ ] Branch `p4a/5-issuance`, pull request on the first commit.
- [ ] CI green, review threads answered, merge.

## Increment 6 — Traceability and the documents

### Task 6.1: Spike `pnpm trace` before trusting it

**Files:**

- None changed by the spike itself.

`docs/NEXT.md` records two defects in `tools/trace`: `parseStatus` throws inside `loadTables` before any id is resolved, so one malformed clause status masks every later problem in every later file; and the summary counts a broken `covered` row as covered, having printed `410 covered` on a failing run.

- [ ] **Step 1: Probe the masking**

Add two deliberately malformed rows to two different files under `docs/protocols/`, run `pnpm trace`, and record whether both are named or only the first.

- [ ] **Step 2: Probe the summary**

Add one `covered` row with no test id — `parse.ts:119` throws on exactly this — and confirm whether the summary still counts it.

- [ ] **Step 3: Decide**

If either defect is real, fix `tools/trace` in this increment: `docs/NEXT.md` triggers it on "whichever change next touches `tools/trace`", and this phase is that change. Collect parse errors rather than throwing on the first, and exclude a row that failed validation from the summary. If both are already fixed, say so in `docs/NEXT.md` and delete the entry.

- [ ] **Step 4: Revert the probes**

Run: `git checkout docs/protocols/ && pnpm trace`
Expected: the census as it stood — 430 covered, 102 gap, 7 deferred, 209 n/a, 4 documented, 56 accepted.

- [ ] **Step 5: Commit any fix**

```bash
git add tools/trace docs/NEXT.md
git commit -m "Report every trace parse error, not just the first"
```

### Task 6.2: The clause table

**Files:**

- Create: `docs/protocols/rfc8693.md`

**Interfaces:**

- Consumes: the test IDs every increment's tests carry — `ODUDU-TOKEN-EXCHANGE-*`, `ODUDU-GRANT-ALLOWLIST-01`.

`verified:` the row format is `| Clause | Level | Requirement | Test ID | Status |`, statuses are `covered` (which requires a test id), `gap`, `deferred: P<n>`, `n/a`, `documented` and `accepted`, and an `accepted`/`documented` row cites a named reading note in the same file — `sed -n '119,126p' docs/protocols/rfc8707.md` and `tools/trace/src/parse.ts:119`.

- [ ] **Step 1: Write the file's header and reading notes first**

Four notes, each of which the table then cites rather than restates:

- **"The four JWT kinds, and why `:jwt` is refused."**
- **"Scope attenuation is this server's policy, not RFC 8693's requirement."** The RFC bounds the issued token's scope nowhere; this cites the umbrella's attenuation invariant.
- **"One target, not many."** §2.1's MAY, declined, inheriting RFC 8707's decision.
- **"An ID token is not a grant."** Exchanging one yields no scope, because an ID token records no grant.

- [ ] **Step 2: Write the table**

Every clause of §2.1, §2.2.1, §2.2.2, §3, §4.1–§4.4. `saml1`/`saml2` rows are `deferred: P8`. `may_act` minting is `deferred: P5`. Enforcement is `covered` against `ODUDU-TOKEN-EXCHANGE-MAYACT-01`.

- [ ] **Step 3: Run the census**

Run: `pnpm trace`
Expected: no error naming `rfc8693.md`; the covered count rises by the number of `covered` rows added.

- [ ] **Step 4: Confirm the table is actually read**

Break one row's test id deliberately, run `pnpm trace`, see it named, restore it. A table nobody validates is a table nobody can trust — and after task 6.1 the tooling can say so.

- [ ] **Step 5: Commit**

```bash
git add docs/protocols/rfc8693.md
git commit -m "Track RFC 8693's clauses"
```

### Task 6.3: The transcripts

**Files:**

- Modify: `docs/request-paths.md`, `README.md`

- [ ] **Step 1: Bring a stack up**

Run the compose stack, seed a tenant, and seed two clients — one with `--grant-type urn:ietf:params:oauth:grant-type:token-exchange`, one without.

- [ ] **Step 2: Capture, do not compose**

Four transcripts, each real output: a delegation exchange showing `act`; an impersonation refusal for a client without the flag; the `requested_token_type=refresh_token` shape, which is the one that surprises readers; and the allowlist refusing a grant. A fenced block holding a response carries **no language tag** — Prettier reformats a tagged one and the bytes stop being the bytes served.

- [ ] **Step 3: Say what the state was**

The impersonation refusal and its success differ only by a column. Show the column, or the transcript proves nothing — the spec's own rule about a precondition a refusal depends on being shown rather than asserted.

- [ ] **Step 4: Update "What is not implemented"**

Remove the two entries this phase closed — no token exchange, and a client obtaining a grant it is not registered for. Add one: the impersonation flag is settable only by `psql`, placed against **P4c**.

- [ ] **Step 5: Commit**

```bash
git add docs/request-paths.md README.md
git commit -m "Transcribe the exchange grant against a live stack"
```

### Task 6.4: `docs/NEXT.md` and the phase note

**Files:**

- Modify: `docs/NEXT.md`
- Create: `docs/phases/p4a.md`

- [ ] **Step 1: Close what this phase closed**

Remove the grant-allowlist entry. Its trigger has fired.

- [ ] **Step 2: Record what this phase inherits forward**

P4c inherits: the impersonation flag needing a surface, ADR 0007's unexecuted status, and the `client.enabled` question still open. P5 inherits: `may_act` minting, the delegation cascade the `exchanged_from_grant_id` column enables, and the configurable chain depth.

- [ ] **Step 3: Write `docs/phases/p4a.md`**

What turned out to be **wrong** while building it — not what was built. If nothing was wrong, the file says so in one line rather than inventing findings.

- [ ] **Step 4: Run the phase-closing pass from `CLAUDE.md`**

All four checks: every "not implemented" marker still true; grep the phase numbers moved; read `NEXT.md`'s headings against closed phases; reconcile the roadmap against the "not implemented" list in both directions.

- [ ] **Step 5: Commit**

```bash
git add docs/NEXT.md docs/phases/p4a.md
git commit -m "Record where P4a leaves the project"
```

### Increment 6 close

- [ ] Branch `p4a/6-traceability`, pull request on the first commit, CI green, threads answered, merge.
- [ ] Whole-branch review on #27.
- [ ] `superpowers:finishing-a-development-branch`.

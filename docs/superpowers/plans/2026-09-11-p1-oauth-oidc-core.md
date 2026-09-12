# P1 OAuth 2.1 / OIDC Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An authorization server that issues signed tokens through five endpoints and three grant types, where every MUST in the traced specifications is mapped to a passing test by a tool that fails CI when the map has a hole.

**Architecture:** Six new packages under the dependency direction P0 established. `crypto` owns keys and signatures; `domain-realm` and `domain-identity` own tenant data and know nothing of OAuth; `authn-flows` owns a persisted login state machine; `protocol-oidc` owns the wire. Token issuance funnels every grant through one eight-stage pipeline in which only stage 3 is grant-specific. A `trace` tool parses clause tables in `docs/protocols/` and cross-references them against the test suite.

**Tech Stack:** Node 24, TypeScript 6.0.3, Fastify 5.12.3, PostgreSQL 17, Drizzle ORM 0.45.2, Zod 4.6.1, Vitest 5.0.0, Testcontainers 12.1.0, jose 6.2.12, @node-rs/argon2 2.2.1, @fastify/formbody 9.0.0, @fastify/cookie 11.1.2, Stryker 10.0.0.

**Spec:** `docs/superpowers/specs/2026-09-11-p1-oauth-oidc-core-design.md`

**Umbrella spec:** `docs/superpowers/specs/2026-09-10-odudu-design.md`

## Global Constraints

Everything in P0's plan still binds. Repeated here because an implementer sees only their own task:

- Node `>=24.0.0`. TypeScript pinned to **6.0.3**, not 7.x — typescript-eslint 8.70.0 declares `typescript: ">=4.8.4 <6.1.0"` and TypeScript 7 silently disables type-aware linting (ADR 0012).
- ESM only. `"type": "module"`, `verbatimModuleSyntax` on.
- **Intra-package imports use Node subpath imports, never relative paths.** Each package declares `"imports": { "#/*": "./src/*.ts" }`; code imports as `#/clock`. Cross-package imports use the package name (`@odudu/kernel`) and resolve only through that package's `index.ts`. Enforced by ESLint `no-restricted-imports` (ADR 0013).
- Every dependency version is exact, no ranges.
- **`pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`.** A package version published in the last 24 hours will not install. If a version in this plan is blocked, either wait or add an explicit entry to `minimumReleaseAgeExclude` **with a comment giving the reason** — never lower the global setting.
- Comments carry only what the code cannot express. Where none is needed, write none (`CLAUDE.md`).
- **Commit messages contain no `Co-Authored-By` or tool-attribution trailers.** A repository hook rejects them.
- Test-driven: the failing test is written and observed failing before implementation.
- Integration tests run against real PostgreSQL via Testcontainers, never a mock. They live in a package's `tests/` directory and are named `*.int.test.ts`. Unit tests sit beside the code as `*.test.ts`.
- Domain packages never import protocol packages. Protocol packages never import each other.
- Layer imports follow ADR 0010: `view` → own model and `shared/view`; `usecase` → repository, service, view models; `repository` → adapter, service; `adapter` → transport, service; `service` → nothing.
- **`SET LOCAL`, never `SET`, for realm context.** Use the existing `withRealm(db, realmId, fn)` from `@odudu/db`; it issues `select set_config('app.realm_id', $1, true)` and returns a `RealmScopedDatabase` that deliberately has no `.transaction()` so nesting fails to compile.
- **Every new tenant table needs `ENABLE` + `FORCE ROW LEVEL SECURITY`, a policy, and a foreign-realm probe.** Task 5 makes this mechanical rather than remembered.
- Every task ends with CI green, the branch merged, and `docs/NEXT.md` updated.

### P1-specific constraints

- **PKCE is mandatory and `S256` only.** `plain` is rejected everywhere, including in discovery metadata.
- **`redirect_uri` matching is exact string comparison** against the registered list. No wildcards, no prefix matching.
- **Access tokens carry `typ: at+jwt`** (RFC 9068). ID tokens do not.
- **The signing algorithm comes from the key record, never from the token header.**
- **Authorization codes and refresh tokens are stored hashed**, never in plaintext.
- **Realm-scoped endpoint paths follow Keycloak's layout**, so that existing OIDC client libraries and the conformance suite need no unusual configuration:
  - `/realms/{realm}/.well-known/openid-configuration`
  - `/realms/{realm}/protocol/openid-connect/auth`
  - `/realms/{realm}/protocol/openid-connect/token`
  - `/realms/{realm}/protocol/openid-connect/userinfo`
  - `/realms/{realm}/protocol/openid-connect/certs`

## Task budget

| Task | Deliverable                                                     | Hours      |
| ---- | --------------------------------------------------------------- | ---------- |
| 1    | `trace` tool + `rfc7636.md` clause table                        | 4–6        |
| 2    | `rfc6749.md` + `rfc6750.md` clause tables                       | 5–6        |
| 3    | `oidc-core.md` clause table                                     | 5–6        |
| 4    | `oidc-discovery.md`, `rfc9068.md`, `rfc9207.md`, `jose.md`      | 4–6        |
| 5    | The tenant-table guard: RLS made mechanical                     | 3–4        |
| 6    | `crypto`: key storage, KEK encryption, JWKS assembly            | 5–6        |
| 7    | `crypto`: signing, verification, algorithm-confusion defenses   | 4–6        |
| 8    | `domain-realm`: clients                                         | 3–4        |
| 9    | `domain-identity`: subjects, users, credentials, Argon2id       | 5–6        |
| 10   | `authn-flows`: sessions and the persisted executor              | 5–6        |
| 11   | `protocol-oidc`: `contracts`, discovery and JWKS endpoints      | 4–5        |
| 12   | `protocol-oidc`: `/authorize` and the redirect boundary         | 5–6        |
| 13   | Login submission, code issuance, and the redirect back          | 5–6        |
| 14   | `protocol-oidc`: `/token` — the pipeline, code + PKCE           | 6          |
| 15   | Refresh rotation, family revocation, `client_credentials`       | 5–6        |
| 16   | `/userinfo` and the claim mapper registry                       | 4–5        |
| 17   | The bootstrap seed CLI                                          | 3–4        |
| 18   | Adversarial suite consolidation; `smoke.sh` end-to-end exchange | 4–5        |
| 19   | Conformance harness; `trace` strict mode; phase close           | 5–6        |
|      | **Total**                                                       | **84–104** |

The spec budgets P1 at 60–100 hours. This lands inside it, at the top. Tasks 1–4 are 18–24 hours of _reading_, which is the single largest uncertainty and also the phase's learning goal.

Nineteen tasks rather than the spec's "roughly fifteen": the spec's items 2 and 9 were each written as "several increments", and this expands them.

## Spikes

`CLAUDE.md` requires every `assumption:` on a load-bearing path to get a spike before the task depending on it. Each spike below is **step 1 of its host task**, timeboxed to 30 minutes, and its finding is recorded in the task's commit message.

| Spike | Assumption                                                             | Host task | If it fails                                         |
| ----- | ---------------------------------------------------------------------- | --------- | --------------------------------------------------- |
| 6     | Vitest's JSON reporter exposes full test titles `trace` can key on     | Task 1    | key on file+name pairs from a custom reporter       |
| 4     | `jose` rejects `alg: none` and algorithm substitution under our config | Task 7    | hand-roll header checks before calling `jose`       |
| 1     | `@node-rs/argon2` works when marked external to the tsup bundle        | Task 9    | the whole bundling path is reconsidered — escalate  |
| 5     | Zod→ajv handles `/token`'s form-encoded body                           | Task 14   | validate with Zod directly at the route boundary    |
| 2     | The conformance suite accepts an `http://` issuer for a local OP       | Task 19   | TLS in compose becomes part of Task 19              |
| 3     | Config OP can be driven unattended through the suite's API             | Task 19   | Config OP joins Basic OP as a documented manual run |

Spike 2 has a second consumer discovered while writing the walkthrough: **`__Host-` cookies require `Secure`, therefore HTTPS.** Task 10 must either serve HTTPS locally or accept a non-`__Host-` cookie name in development. That is the same TLS decision as spike 2, so Task 10 records the choice and Task 19 confirms it.

## File Structure

```
docs/protocols/
├─ rfc6749.md            authorization framework — clause table
├─ rfc6750.md            bearer token usage
├─ rfc7636.md            PKCE
├─ rfc9068.md            JWT access token profile
├─ rfc9207.md            iss parameter
├─ oidc-core.md          OpenID Connect Core 1.0
├─ oidc-discovery.md     OpenID Connect Discovery 1.0
└─ jose.md               only the JWS/JWK clauses we depend on

tools/trace/
├─ package.json          @odudu/trace, private
└─ src/
   ├─ index.ts           CLI entry
   ├─ parse.ts           clause table -> Row[]
   ├─ parse.test.ts
   ├─ suite.ts           vitest JSON report -> TestResult[]
   ├─ suite.test.ts
   ├─ reconcile.ts       Row[] x TestResult[] -> Finding[]
   └─ reconcile.test.ts

packages/crypto/src/
├─ index.ts
├─ schema/signing-keys.ts
├─ service/kek.ts                 wrap/unwrap private JWKs
├─ service/jwks.ts                public JWK set assembly
├─ service/sign.ts                sign / verify, alg from key record
├─ repository/signing-keys.ts
└─ tests/*.int.test.ts

packages/domain-realm/src/
├─ index.ts
├─ schema/clients.ts
├─ service/client.ts              type rules, secret verification
└─ repository/clients.ts

packages/domain-identity/src/
├─ index.ts
├─ schema/{subjects,users,user-credentials}.ts
├─ service/password.ts            Argon2id hash/verify
└─ repository/{subjects,users,credentials}.ts

packages/authn-flows/src/
├─ index.ts
├─ schema/{sessions,authentication-sessions}.ts
├─ service/executor.ts            the state machine
├─ service/authenticators/password.ts
└─ repository/{sessions,authentication-sessions}.ts

packages/contracts/src/
├─ index.ts
├─ authorize.ts                   the /authorize query schema
├─ token.ts                       the /token body schemas, per grant
└─ discovery.ts                   the discovery document shape

packages/protocol-oidc/src/
├─ index.ts
├─ schema/{authorization-codes,token-grants,refresh-tokens,client-oidc-config}.ts
├─ view/routes/{discovery,jwks,authorize,token,userinfo}.ts
├─ usecase/{authorization-request,token-issuance}.ts
├─ service/{pkce,redirect-uri,scope,claims,errors}.ts
└─ repository/{codes,grants,refresh}.ts

apps/server/src/
└─ cli/seed.ts                    bootstrap realm, client, user

infra/conformance/
├─ README.md                      the documented procedure
├─ compose.yaml                   pinned suite + mongo
├─ basic-op.json                  committed test configuration
└─ results/                       committed exports
```

---

### Task 1: The `trace` tool and the first clause table

The smallest specification proves the tool before four large tables depend on it.

**Files:**

- Create: `tools/trace/package.json`, `tools/trace/src/index.ts`, `tools/trace/src/parse.ts`, `tools/trace/src/suite.ts`, `tools/trace/src/reconcile.ts`
- Create: `tools/trace/src/parse.test.ts`, `tools/trace/src/suite.test.ts`, `tools/trace/src/reconcile.test.ts`
- Create: `docs/protocols/rfc7636.md`
- Modify: `pnpm-workspace.yaml` (add `tools/*`), `package.json` (add `trace` script, add it to `verify`)

**Interfaces:**

- Produces: `parseClauseTables(dir: string): Promise<Row[]>` where `Row = { file: string; clause: string; level: 'MUST'|'SHOULD'|'MAY'; requirement: string; testId: string|null; status: Status }` and `Status = { kind: 'covered' } | { kind: 'deferred'; phase: string; reason: string } | { kind: 'na'; reason: string } | { kind: 'gap' }`
- Produces: `readSuite(reportPath: string): TestResult[]` where `TestResult = { id: string; title: string; passed: boolean }`
- Produces: `reconcile(rows: Row[], results: TestResult[]): Finding[]` where `Finding = { severity: 'error'|'warn'; row: Row; message: string }`

- [ ] **Step 1 (spike 6): confirm the Vitest JSON reporter's shape**

Run the existing suite once and look at what a test is actually called in the report:

```bash
npx vitest run --project unit --reporter=json --outputFile=/tmp/trace-probe.json
node -e "const r=require('/tmp/trace-probe.json'); const t=r.testResults[0]; console.log(JSON.stringify({file:t.name, assertion:t.assertionResults[0]},null,2))"
```

Record in the commit message, as `verified:`, the exact field that carries the full test title (expected: `assertionResults[].fullName`, with `status` being `"passed"` or `"failed"`). If the field is absent or truncated, stop and write a tiny custom reporter instead — do not guess.

- [ ] **Step 2: Write the failing parser test**

`tools/trace/src/parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseRows } from '#/parse';

const TABLE = `
# RFC 7636

| Clause | Level | Requirement | Test ID | Status |
| ------ | ----- | ----------- | ------- | ------ |
| 4.1 | MUST | verifier is 43-128 chars | \`RFC7636-4.1-01\` | covered |
| 4.4.1 | MUST | plain is rejected | — | gap |
| 4.2 | SHOULD | use S256 | \`RFC7636-4.2-01\` | deferred: P3 — needs client config |
| 7.2 | MUST | downgrade prevention | — | n/a: implicit removed in OAuth 2.1 |
`;

describe('parseRows', () => {
  it('reads clause, level and test id', () => {
    const rows = parseRows('rfc7636.md', TABLE);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      clause: '4.1',
      level: 'MUST',
      testId: 'RFC7636-4.1-01',
      status: { kind: 'covered' },
    });
  });

  it('reads a gap as having no test id', () => {
    const rows = parseRows('rfc7636.md', TABLE);
    expect(rows[1]).toMatchObject({ testId: null, status: { kind: 'gap' } });
  });

  it('captures the phase and reason from a deferred status', () => {
    const rows = parseRows('rfc7636.md', TABLE);
    expect(rows[2].status).toEqual({
      kind: 'deferred',
      phase: 'P3',
      reason: 'needs client config',
    });
  });

  it('captures the reason from an n/a status', () => {
    const rows = parseRows('rfc7636.md', TABLE);
    expect(rows[3].status).toEqual({
      kind: 'na',
      reason: 'implicit removed in OAuth 2.1',
    });
  });

  it('rejects a status it does not recognise rather than ignoring the row', () => {
    const bad = TABLE.replace('| covered |', '| probably fine |');
    expect(() => parseRows('rfc7636.md', bad)).toThrow(/probably fine/);
  });

  it('rejects a covered row with no test id', () => {
    const bad = TABLE.replace('| `RFC7636-4.1-01` | covered |', '| — | covered |');
    expect(() => parseRows('rfc7636.md', bad)).toThrow(/covered.*test id/i);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run tools/trace/src/parse.test.ts
```

Expected: FAIL — `Cannot find module '#/parse'`.

- [ ] **Step 4: Create the workspace package**

`pnpm-workspace.yaml` — add `tools/*` to the `packages` list, above the existing comment block:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'tools/*'
```

`tools/trace/package.json`:

```json
{
  "name": "@odudu/trace",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "imports": { "#/*": "./src/*.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "bin": { "odudu-trace": "./src/index.ts" }
}
```

Copy `tsconfig.json` from `packages/kernel/tsconfig.json` unchanged.

- [ ] **Step 5: Implement the parser**

`tools/trace/src/parse.ts`:

```ts
export type Status =
  | { kind: 'covered' }
  | { kind: 'deferred'; phase: string; reason: string }
  | { kind: 'na'; reason: string }
  | { kind: 'gap' };

export interface Row {
  file: string;
  clause: string;
  level: 'MUST' | 'SHOULD' | 'MAY';
  requirement: string;
  testId: string | null;
  status: Status;
}

const LEVELS = new Set(['MUST', 'SHOULD', 'MAY']);

function parseStatus(raw: string, where: string): Status {
  if (raw === 'covered') return { kind: 'covered' };
  if (raw === 'gap') return { kind: 'gap' };

  const deferred = /^deferred:\s*(\S+)\s*—\s*(.+)$/u.exec(raw);
  if (deferred) return { kind: 'deferred', phase: deferred[1], reason: deferred[2] };

  const na = /^n\/a:\s*(.+)$/u.exec(raw);
  if (na) return { kind: 'na', reason: na[1] };

  throw new Error(`${where}: unrecognised status ${JSON.stringify(raw)}`);
}

export function parseRows(file: string, markdown: string): Row[] {
  const rows: Row[] = [];

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;

    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
    if (cells.length !== 5) continue;
    if (!LEVELS.has(cells[1])) continue;

    const [clause, level, requirement, testCell, statusCell] = cells;
    const where = `${file} clause ${clause}`;
    const testId = testCell === '—' ? null : testCell.replace(/`/g, '');
    const status = parseStatus(statusCell, where);

    if (status.kind === 'covered' && testId === null) {
      throw new Error(`${where}: status is covered but no test id is given`);
    }

    rows.push({
      file,
      clause,
      level: level as Row['level'],
      requirement,
      testId,
      status,
    });
  }

  return rows;
}
```

- [ ] **Step 6: Run the parser tests**

```bash
npx vitest run tools/trace/src/parse.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 7: Write the failing reconcile test**

`tools/trace/src/reconcile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { reconcile } from '#/reconcile';
import { type Row } from '#/parse';

const row = (over: Partial<Row>): Row => ({
  file: 'rfc7636.md',
  clause: '4.1',
  level: 'MUST',
  requirement: 'r',
  testId: 'RFC7636-4.1-01',
  status: { kind: 'covered' },
  ...over,
});

describe('reconcile', () => {
  it('is silent when a covered row has a passing test', () => {
    const findings = reconcile(
      [row({})],
      [{ id: 'RFC7636-4.1-01', title: '[RFC7636-4.1-01] verifier length', passed: true }],
    );
    expect(findings).toEqual([]);
  });

  it('errors when a covered row references a test that does not exist', () => {
    const findings = reconcile([row({})], []);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error' });
    expect(findings[0].message).toMatch(/no test/i);
  });

  it('errors when the referenced test failed', () => {
    const findings = reconcile(
      [row({})],
      [{ id: 'RFC7636-4.1-01', title: '[RFC7636-4.1-01] x', passed: false }],
    );
    expect(findings[0]).toMatchObject({ severity: 'error' });
    expect(findings[0].message).toMatch(/failed/i);
  });

  it('warns rather than errors on a MUST gap by default', () => {
    const findings = reconcile([row({ testId: null, status: { kind: 'gap' } })], []);
    expect(findings[0]).toMatchObject({ severity: 'warn' });
  });

  it('errors on a MUST gap in strict mode', () => {
    const findings = reconcile([row({ testId: null, status: { kind: 'gap' } })], [], {
      strict: true,
    });
    expect(findings[0]).toMatchObject({ severity: 'error' });
  });

  it('ignores deferred and n/a rows entirely', () => {
    const findings = reconcile(
      [
        row({ testId: null, status: { kind: 'deferred', phase: 'P3', reason: 'r' } }),
        row({ testId: null, status: { kind: 'na', reason: 'r' } }),
      ],
      [],
      { strict: true },
    );
    expect(findings).toEqual([]);
  });
});
```

- [ ] **Step 8: Run it and watch it fail**

```bash
npx vitest run tools/trace/src/reconcile.test.ts
```

Expected: FAIL — `Cannot find module '#/reconcile'`.

- [ ] **Step 9: Implement reconcile and the suite reader**

`tools/trace/src/suite.ts`:

```ts
import { readFile } from 'node:fs/promises';

export interface TestResult {
  id: string;
  title: string;
  passed: boolean;
}

const ID_IN_TITLE = /\[([A-Z0-9]+(?:-[A-Za-z0-9.]+)+)\]/u;

export async function readSuite(reportPath: string): Promise<TestResult[]> {
  const report: unknown = JSON.parse(await readFile(reportPath, 'utf8'));
  const files = (report as { testResults?: unknown[] }).testResults ?? [];
  const results: TestResult[] = [];

  for (const file of files as { assertionResults?: unknown[] }[]) {
    for (const a of (file.assertionResults ?? []) as {
      fullName?: string;
      status?: string;
    }[]) {
      const title = a.fullName ?? '';
      const match = ID_IN_TITLE.exec(title);
      if (!match) continue;
      results.push({ id: match[1], title, passed: a.status === 'passed' });
    }
  }

  return results;
}
```

`tools/trace/src/reconcile.ts`:

```ts
import { type Row } from '#/parse';
import { type TestResult } from '#/suite';

export interface Finding {
  severity: 'error' | 'warn';
  row: Row;
  message: string;
}

export function reconcile(
  rows: Row[],
  results: TestResult[],
  options: { strict?: boolean } = {},
): Finding[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  const findings: Finding[] = [];

  for (const row of rows) {
    const where = `${row.file} §${row.clause}`;

    if (row.status.kind === 'deferred' || row.status.kind === 'na') continue;

    if (row.status.kind === 'gap') {
      if (row.level !== 'MUST') continue;
      findings.push({
        severity: options.strict ? 'error' : 'warn',
        row,
        message: `${where}: MUST has no test`,
      });
      continue;
    }

    const result = row.testId === null ? undefined : byId.get(row.testId);
    if (!result) {
      findings.push({
        severity: 'error',
        row,
        message: `${where}: covered by ${row.testId ?? '?'} but no test carries that id`,
      });
      continue;
    }

    if (!result.passed) {
      findings.push({ severity: 'error', row, message: `${where}: ${row.testId} failed` });
    }
  }

  return findings;
}
```

- [ ] **Step 10: Run the reconcile tests**

```bash
npx vitest run tools/trace/src/reconcile.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 11: Write the CLI entry**

`tools/trace/src/index.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseRows, type Row } from '#/parse';
import { reconcile } from '#/reconcile';
import { readSuite } from '#/suite';

const PROTOCOLS = 'docs/protocols';

async function loadRows(): Promise<Row[]> {
  const files = (await readdir(PROTOCOLS)).filter((f) => f.endsWith('.md'));
  const rows: Row[] = [];
  for (const file of files) {
    rows.push(...parseRows(file, await readFile(join(PROTOCOLS, file), 'utf8')));
  }
  return rows;
}

const strict = process.env.ODUDU_TRACE_STRICT === '1';
const rows = await loadRows();
const results = await readSuite(process.argv[2] ?? 'trace-report.json');
const findings = reconcile(rows, results, { strict });

const counts = {
  covered: rows.filter((r) => r.status.kind === 'covered').length,
  gap: rows.filter((r) => r.status.kind === 'gap').length,
  deferred: rows.filter((r) => r.status.kind === 'deferred').length,
  na: rows.filter((r) => r.status.kind === 'na').length,
};

for (const f of findings) console.error(`${f.severity}: ${f.message}`);
console.log(
  `trace: ${String(counts.covered)} covered, ${String(counts.gap)} gap, ` +
    `${String(counts.deferred)} deferred, ${String(counts.na)} n/a` +
    (strict ? ' (strict)' : ''),
);

if (findings.some((f) => f.severity === 'error')) process.exit(1);
```

- [ ] **Step 12: Wire the scripts**

Root `package.json` — add to `scripts`:

```json
"trace": "vitest run --reporter=json --outputFile=trace-report.json && node tools/trace/src/index.ts trace-report.json",
"verify": "pnpm format:check && pnpm typecheck && pnpm lint && pnpm boundaries && pnpm test && pnpm trace"
```

Add `trace-report.json` to `.gitignore`.

> **Why `trace` is not strict yet.** Every MUST is a `gap` on the day its table is written, so a strict gate would make Tasks 2–4 unmergeable. `ODUDU_TRACE_STRICT=1` is turned on permanently in Task 19, once the gap count is zero. Until then `trace` still fails the build on a dangling test id or a failing referenced test — the two failures that indicate the map is lying rather than incomplete.

- [ ] **Step 13: Write `docs/protocols/rfc7636.md`**

Read RFC 7636 end to end. Produce the file with reading notes and the clause table. Every normative statement gets a row. Test IDs follow `RFC7636-<clause>-<NN>`. Every row starts as `gap` except those genuinely `n/a`. Structure:

```markdown
# RFC 7636 — Proof Key for Code Exchange

**Status in Odudu:** in scope for P1. PKCE is mandatory for every client and
`S256` is the only permitted method.

## Reading notes

[Two or three paragraphs in your own words: what attack this defends, why
`plain` exists in the RFC and why Odudu rejects it, and how the verifier and
challenge relate.]

## Requirements

| Clause | Level | Requirement                                                  | Test ID | Status |
| ------ | ----- | ------------------------------------------------------------ | ------- | ------ |
| 4.1    | MUST  | `code_verifier` is 43–128 characters from the unreserved set | —       | gap    |
| ...    |       |                                                              |         |        |
```

- [ ] **Step 14: Run trace and confirm it reports rather than fails**

```bash
pnpm trace
```

Expected: a line like `trace: 0 covered, N gap, 0 deferred, M n/a`, warnings for each gap, and **exit code 0**.

Confirm it fails when the map lies — temporarily set one row to `covered` with test id `RFC7636-9.9-99`, re-run, expect exit 1 and `no test carries that id`. Revert.

- [ ] **Step 15: Full verify and commit**

```bash
pnpm verify
git add tools/trace docs/protocols/rfc7636.md pnpm-workspace.yaml package.json .gitignore
git commit -m "Add the traceability tool and the PKCE clause table

The tool parses every clause table under docs/protocols and reconciles it
against the test suite: a covered row whose test id matches nothing, or
whose test failed, fails the build. Gaps only warn until the tables are
written, and become fatal in strict mode at the phase gate.

Verified the Vitest JSON reporter carries full test titles in
assertionResults[].fullName before keying on it."
```

---

### Task 2: RFC 6749 and RFC 6750 clause tables

**Files:**

- Create: `docs/protocols/rfc6749.md`, `docs/protocols/rfc6750.md`

**Interfaces:**

- Consumes: the table format and status vocabulary from Task 1.
- Produces: the `RFC6749-*` and `RFC6750-*` test ID namespaces that Tasks 12–16 fill in.

- [ ] **Step 1: Write `docs/protocols/rfc6749.md`**

Read RFC 6749. Every MUST, SHOULD and MAY in sections 2 through 10 gets a row. Sections 4.2 (implicit) and 4.3 (resource owner password credentials) get `n/a` rows citing OAuth 2.1:

```markdown
| 4.2 | MUST | implicit grant issues token in fragment | — | n/a: grant removed in OAuth 2.1 (draft-ietf-oauth-v2-1-15 §10) |
| 4.3 | MUST | resource owner password credentials grant | — | n/a: grant removed in OAuth 2.1 (draft-ietf-oauth-v2-1-15 §10) |
```

Rows that OAuth 2.1 _tightens_ rather than removes stay as normal rows, with the tightening recorded in the requirement text:

```markdown
| 3.1.2.3 | MUST | redirect endpoint selection — OAuth 2.1 requires exact string match, no wildcards | — | gap |
| 4.1.1 | MUST | `code_challenge` — OAuth 2.1 makes PKCE mandatory for all clients | — | gap |
```

The reading notes must state plainly, in your own words, why §4.1.2.1's split between "render an error" and "redirect with an error" exists, because the whole of Task 12 turns on it.

- [ ] **Step 2: Write `docs/protocols/rfc6750.md`**

Shorter. The rows that matter are §2.1 (Authorization Request Header Field), §2.2 (form-encoded body), §2.3 (URI query — which gets an `n/a` row citing OAuth 2.1's removal), §3 (the `WWW-Authenticate` response header and its error codes), and §5's security considerations.

- [ ] **Step 3: Run trace**

```bash
pnpm trace
```

Expected: exit 0, gap count risen by the number of new MUST rows.

- [ ] **Step 4: Verify and commit**

```bash
pnpm verify
git add docs/protocols/rfc6749.md docs/protocols/rfc6750.md
git commit -m "Map RFC 6749 and RFC 6750 clause by clause

Implicit and resource-owner-password rows are recorded n/a against OAuth
2.1's removal of those grants rather than deleted, so the count of what was
considered stays honest."
```

---

### Task 3: The OpenID Connect Core clause table

The longest read in the phase. Scope it: only the clauses reachable from the authorization code flow.

**Files:**

- Create: `docs/protocols/oidc-core.md`

- [ ] **Step 1: Write the table**

Cover sections 2 (ID Token), 3.1 (Authorization Code Flow) in full, 5.1–5.4 (claims, scopes, UserInfo), 15.1 (mandatory-to-implement features), and 16 (security considerations).

Sections 3.2 (Implicit) and 3.3 (Hybrid) get `n/a` rows: `n/a: response types not supported — see docs/superpowers/specs/2026-09-11-p1-oauth-oidc-core-design.md §1`.

Rows that P1 defers rather than omits — `prompt`, `max_age`, `acr_values`, `request` objects, `claims` parameter, pairwise subject identifiers — get `deferred:` rows naming the phase and reason, for example:

```markdown
| 3.1.2.1 | MAY | `prompt=consent` forces the consent screen | — | deferred: P3 — no consent screen exists yet |
| 3.1.2.1 | MAY | `max_age` forces reauthentication | — | deferred: P2 — needs flow tree semantics |
| 8.1 | MAY | pairwise subject identifiers | — | deferred: P3 — needs per-client subject config |
```

- [ ] **Step 2: Cross-check the deferrals against the spec**

Every `deferred:` phase named above must match a line in the spec's §11 "Carried into later phases". If a deferral has no home there, it is a scope gap — stop and raise it rather than inventing a phase.

- [ ] **Step 3: Run trace, verify, commit**

```bash
pnpm trace && pnpm verify
git add docs/protocols/oidc-core.md
git commit -m "Map OpenID Connect Core, scoped to the code flow

Implicit and hybrid are n/a against the response types P1 supports. Request
objects, prompt, max_age and pairwise identifiers are deferred rows naming
the phase that owns them, each cross-checked against the spec's carried-work
list."
```

---

### Task 4: Discovery, RFC 9068, RFC 9207, and the thin JOSE table

**Files:**

- Create: `docs/protocols/oidc-discovery.md`, `docs/protocols/rfc9068.md`, `docs/protocols/rfc9207.md`, `docs/protocols/jose.md`

- [ ] **Step 1: `oidc-discovery.md`**

Every REQUIRED and RECOMMENDED metadata member gets a row. This table is effectively the Config OP conformance plan written out, so it is the one to get exhaustively right.

- [ ] **Step 2: `rfc9068.md`**

Short and dense. The header `typ`, the required claims (`iss`, `exp`, `aud`, `sub`, `client_id`, `iat`, `jti`), the validation rules a resource server must apply, and §4's privacy considerations.

- [ ] **Step 3: `rfc9207.md`**

Very short. The `iss` parameter in the authorization response, the client's obligation to validate it, and the discovery metadata member that advertises it.

- [ ] **Step 4: `jose.md`**

Not a full table. A header stating explicitly that RFC 7515/7517/7518/7519 are consumed through `jose` rather than implemented, followed by only the clauses Odudu depends on directly:

- RFC 7515 §4.1.1 (`alg` header) and §5.2 (validation order) — because algorithm confusion is an adversarial corpus entry
- RFC 7515 §4.1.4 (`kid`) — because `kid` traversal is an adversarial corpus entry
- RFC 7517 §4 (JWK members) — because "no private members in the published JWK Set" is an assertion we own
- RFC 7519 §4.1 (registered claims) and §7.2 (validation)

Everything else gets one `n/a` row: `n/a: implemented by jose 6.2.12, not by Odudu`.

- [ ] **Step 5: Run trace and record the phase's total**

```bash
pnpm trace
```

Write the reported counts into the commit message. This is the number Task 19 must drive to zero gaps.

- [ ] **Step 6: Verify and commit**

```bash
pnpm verify
git add docs/protocols/
git commit -m "Map discovery, JWT access tokens, the iss parameter, and JOSE

The JOSE table deliberately covers only the clauses Odudu depends on
directly — alg and kid handling, JWK members, claim validation — since the
rest is jose's to implement and tracing it would be tracing someone else's
work.

Phase total after this task: N covered, M gap, D deferred, A n/a."
```

---

### Task 5: The tenant-table guard

P1 adds ten tables under row-level security. The design spec names this as a standing obligation and P0's `docs/NEXT.md` records the Drizzle snapshot divergence that makes declaring policies in the schema unsafe. This task makes both mechanical rather than remembered.

**Files:**

- Create: `packages/db/tests/tenant-tables.int.test.ts`
- Create: `packages/testkit/src/realm-probe.ts`
- Modify: `packages/testkit/src/index.ts`, `packages/db/src/schema/realms.ts` (comment only)

**Interfaces:**

- Produces: `expectRealmIsolation(db: Database, opts: { table: string; seed: (tx: RealmScopedDatabase, realmId: string) => Promise<void> }): Promise<void>` — the reusable foreign-realm probe every later task calls once per table.

- [ ] **Step 1: Write the failing guard test**

`packages/db/tests/tenant-tables.int.test.ts`:

```ts
import { createDatabase, runMigrations } from '@odudu/db';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

let database: TestDatabase;
let handle: ReturnType<typeof createDatabase>;

const EXEMPT = new Set(['__drizzle_migrations']);

beforeAll(async () => {
  database = await startTestDatabase();
  await runMigrations(database.adminUrl);
  handle = createDatabase(await createAppRole(database.adminUrl));
}, 120_000);

afterAll(async () => {
  await handle.close();
  await database.stop();
});

it('every table in public is force-RLS with at least one policy', async () => {
  const rows = await handle.db.execute(sql`
    select c.relname            as table_name,
           c.relrowsecurity     as rls_enabled,
           c.relforcerowsecurity as rls_forced,
           count(p.policyname)  as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policies p on p.tablename = c.relname and p.schemaname = 'public'
     where n.nspname = 'public' and c.relkind = 'r'
     group by 1, 2, 3
     order by 1
  `);

  const offenders = (
    rows as unknown as {
      table_name: string;
      rls_enabled: boolean;
      rls_forced: boolean;
      policies: string;
    }[]
  )
    .filter((r) => !EXEMPT.has(r.table_name))
    .filter((r) => !r.rls_enabled || !r.rls_forced || Number(r.policies) === 0);

  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run --project integration packages/db/tests/tenant-tables.int.test.ts
```

Expected: PASS today — `realms` is the only table and it already satisfies this. The test's value is that it fails the moment Task 6 adds `signing_keys` without a policy. Prove that now.

- [ ] **Step 3: Prove the guard actually guards**

Temporarily add a migration `packages/db/drizzle/9999_probe.sql` containing `CREATE TABLE probe_me (id uuid primary key);`, re-run the test, and confirm it **fails** naming `probe_me`. Delete the migration and its snapshot entry, re-run, confirm green. Record this in the commit message — an unproven guard is the exact failure mode P0's smoke test had.

- [ ] **Step 4: Write the reusable foreign-realm probe**

`packages/testkit/src/realm-probe.ts`:

```ts
import { type Database, type RealmScopedDatabase, withRealm } from '@odudu/db';
import { sql } from 'drizzle-orm';
import { expect } from 'vitest';

export interface RealmProbe {
  table: string;
  seed: (tx: RealmScopedDatabase, realmId: string) => Promise<void>;
}

/**
 * Seeds one row in realm A, then asserts realm B's context cannot see it and
 * that a missing realm context sees nothing at all. Every repository that
 * touches a tenant table calls this once.
 */
export async function expectRealmIsolation(db: Database, probe: RealmProbe): Promise<void> {
  const realmA = crypto.randomUUID();
  const realmB = crypto.randomUUID();

  await withRealm(db, realmA, async (tx) => probe.seed(tx, realmA));

  const fromA = await withRealm(db, realmA, async (tx) =>
    tx.execute(sql`select count(*)::int as n from ${sql.identifier(probe.table)}`),
  );
  expect(Number((fromA as unknown as { n: number }[])[0].n)).toBeGreaterThan(0);

  const fromB = await withRealm(db, realmB, async (tx) =>
    tx.execute(sql`select count(*)::int as n from ${sql.identifier(probe.table)}`),
  );
  expect(Number((fromB as unknown as { n: number }[])[0].n)).toBe(0);
}
```

Export it from `packages/testkit/src/index.ts`:

```ts
export { expectRealmIsolation, type RealmProbe } from '#/realm-probe';
```

- [ ] **Step 5: Record the policy convention in the schema**

`packages/db/src/schema/realms.ts` — add above the table:

```ts
// Policies are written as hand-authored SQL in drizzle/, never declared with
// pgPolicy(). meta/0002_snapshot.json records policies: {} while
// realms_isolation exists in every migrated database, so a declarative policy
// would make drizzle-kit generate a CREATE POLICY that fails 42710 against any
// database already carrying it. packages/db/tests/tenant-tables.int.test.ts is
// what stops a new table shipping without one.
```

- [ ] **Step 6: Verify and commit**

```bash
pnpm verify
git add packages/db packages/testkit
git commit -m "Make the row-level-security obligation mechanical

Every table in public must be force-RLS with a policy, asserted against a
live database rather than left to review. Proved the guard by adding an
unprotected table and watching it fail before deleting it.

Policies stay hand-written SQL: the Drizzle snapshot records policies as
empty while realms_isolation exists everywhere, so declaring one would
generate a CREATE POLICY that fails 42710 on an existing database. The
schema now says so where someone would otherwise try."
```

---

### Task 6: `crypto` — key storage, KEK encryption, JWKS assembly

**Files:**

- Create: `packages/crypto/package.json`, `tsconfig.json`, `src/index.ts`
- Create: `src/schema/signing-keys.ts`, `src/service/kek.ts`, `src/service/kek.test.ts`, `src/service/jwks.ts`, `src/service/jwks.test.ts`, `src/repository/signing-keys.ts`
- Create: `packages/db/drizzle/0003_signing_keys.sql`
- Create: `packages/crypto/tests/signing-keys.int.test.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/kernel/src/config.ts`

**Interfaces:**

- Produces: `wrapPrivateJwk(jwk: unknown, kek: Uint8Array): string` and `unwrapPrivateJwk<T>(wrapped: string, kek: Uint8Array): T`
- Produces: `toPublicJwk(jwk: Record<string, unknown>, kid: string, alg: string): Record<string, unknown>` — strips every private member
- Produces: `assembleJwks(keys): { keys: Record<string, unknown>[] }`
- Produces: `SigningKeyRecord = { id: string; realmId: string; kid: string; alg: 'RS256' | 'ES256'; status: 'active' | 'rotating' | 'retired'; publicJwk: Record<string, unknown>; privateJwkEncrypted: string; createdAt: Date; notAfter: Date | null }`
- Produces: `signingKeyRepository(tx: RealmScopedDatabase)` with `listPublishable(): Promise<SigningKeyRecord[]>` (everything not `retired`) and `active(): Promise<SigningKeyRecord>`

- [ ] **Step 1: Scaffold the package**

`packages/crypto/package.json`:

```json
{
  "name": "@odudu/crypto",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "imports": { "#/*": "./src/*.ts" },
  "main": "./src/index.ts",
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": {
    "@odudu/db": "workspace:*",
    "@odudu/kernel": "workspace:*",
    "drizzle-orm": "0.45.2",
    "jose": "6.2.12"
  }
}
```

Copy `tsconfig.json` from `packages/db/tsconfig.json` unchanged.

Install with `pnpm install`. If `jose@6.2.12` is blocked by `minimumReleaseAge`, add it to `minimumReleaseAgeExclude` with a comment naming this task and the publish date you checked.

- [ ] **Step 2: Write the failing KEK test**

`packages/crypto/src/service/kek.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { unwrapPrivateJwk, wrapPrivateJwk } from '#/service/kek';

const KEK = new Uint8Array(32).fill(7);
const JWK = { kty: 'RSA', n: 'abc', e: 'AQAB', d: 'secret-private-exponent' };

describe('KEK wrapping', () => {
  it('round-trips a private JWK', () => {
    expect(unwrapPrivateJwk(wrapPrivateJwk(JWK, KEK), KEK)).toEqual(JWK);
  });

  it('produces different ciphertext each time for the same input', () => {
    expect(wrapPrivateJwk(JWK, KEK)).not.toEqual(wrapPrivateJwk(JWK, KEK));
  });

  it('never leaves the private exponent readable in the wrapped form', () => {
    expect(wrapPrivateJwk(JWK, KEK)).not.toContain('secret-private-exponent');
  });

  it('refuses to unwrap with the wrong key rather than returning garbage', () => {
    const wrong = new Uint8Array(32).fill(8);
    expect(() => unwrapPrivateJwk(wrapPrivateJwk(JWK, KEK), wrong)).toThrow();
  });

  it('refuses to unwrap tampered ciphertext', () => {
    const wrapped = wrapPrivateJwk(JWK, KEK);
    expect(() => unwrapPrivateJwk(wrapped.slice(0, -4) + 'AAAA', KEK)).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => wrapPrivateJwk(JWK, new Uint8Array(16))).toThrow(/32 bytes/);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run packages/crypto/src/service/kek.test.ts`

Expected: FAIL with `Cannot find module '#/service/kek'`.

- [ ] **Step 4: Implement KEK wrapping**

`packages/crypto/src/service/kek.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { OduduError } from '@odudu/kernel';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function assertKek(kek: Uint8Array): void {
  if (kek.length !== 32) {
    throw new OduduError(
      'kek_invalid',
      `Key-encryption key must be 32 bytes, got ${String(kek.length)}`,
    );
  }
}

export function wrapPrivateJwk(jwk: unknown, kek: Uint8Array): string {
  assertKek(kek);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, kek, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(jwk), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function unwrapPrivateJwk<T = unknown>(wrapped: string, kek: Uint8Array): T {
  assertKek(kek);
  const raw = Buffer.from(wrapped, 'base64');
  const decipher = createDecipheriv(ALGORITHM, kek, raw.subarray(0, IV_BYTES));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  const plain = Buffer.concat([
    decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString('utf8')) as T;
}
```

- [ ] **Step 5: Run the KEK tests**

Run: `npx vitest run packages/crypto/src/service/kek.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 6: Write the failing JWKS test**

`packages/crypto/src/service/jwks.test.ts`. The private-member assertion is the one that matters:

```ts
import { describe, expect, it } from 'vitest';
import { assembleJwks, toPublicJwk } from '#/service/jwks';

const PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'];

const rsa = {
  kty: 'RSA',
  n: 'n-value',
  e: 'AQAB',
  d: 'D',
  p: 'P',
  q: 'Q',
  dp: 'DP',
  dq: 'DQ',
  qi: 'QI',
};

describe('[RFC7517-4-01] published JWKs carry no private material', () => {
  it('strips every private member from an RSA key', () => {
    const pub = toPublicJwk(rsa, '2026-09-a', 'RS256');
    for (const member of PRIVATE_MEMBERS) expect(pub).not.toHaveProperty(member);
    expect(pub).toMatchObject({
      kty: 'RSA',
      n: 'n-value',
      e: 'AQAB',
      kid: '2026-09-a',
      alg: 'RS256',
      use: 'sig',
    });
  });

  it('strips private members from every key in an assembled set', () => {
    const set = assembleJwks([
      { kid: 'a', alg: 'RS256', publicJwk: rsa },
      { kid: 'b', alg: 'RS256', publicJwk: rsa },
    ]);
    expect(set.keys).toHaveLength(2);
    for (const key of set.keys) {
      for (const member of PRIVATE_MEMBERS) expect(key).not.toHaveProperty(member);
    }
  });

  it('is an allowlist, so an unknown member cannot leak through', () => {
    expect(toPublicJwk({ ...rsa, surprise: 'leak' }, 'a', 'RS256')).not.toHaveProperty('surprise');
  });
});
```

- [ ] **Step 7: Run it, watch it fail, then implement**

Run: `npx vitest run packages/crypto/src/service/jwks.test.ts` — expect FAIL, module not found.

`packages/crypto/src/service/jwks.ts`:

```ts
// An allowlist, not a denylist: a key type added later must be taught to this
// function explicitly rather than having its private members published by
// default.
const PUBLIC_MEMBERS: Record<string, readonly string[]> = {
  RSA: ['kty', 'n', 'e'],
  EC: ['kty', 'crv', 'x', 'y'],
  OKP: ['kty', 'crv', 'x'],
};

export function toPublicJwk(
  jwk: Record<string, unknown>,
  kid: string,
  alg: string,
): Record<string, unknown> {
  const allowed = PUBLIC_MEMBERS[String(jwk.kty)];
  if (!allowed) throw new Error(`Unsupported key type ${String(jwk.kty)}`);

  const out: Record<string, unknown> = {};
  for (const member of allowed) if (member in jwk) out[member] = jwk[member];
  return { ...out, kid, alg, use: 'sig' };
}

export function assembleJwks(
  keys: { kid: string; alg: string; publicJwk: Record<string, unknown> }[],
): { keys: Record<string, unknown>[] } {
  return { keys: keys.map((k) => toPublicJwk(k.publicJwk, k.kid, k.alg)) };
}
```

Run the test again: PASS, 3 tests. Then mark the RFC 7517 section 4 row in `docs/protocols/jose.md` as `covered` with test id `RFC7517-4-01`.

- [ ] **Step 8: Write the migration**

`packages/db/drizzle/0003_signing_keys.sql`:

```sql
CREATE TABLE signing_keys (
  id                    uuid PRIMARY KEY,
  realm_id              uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  kid                   text NOT NULL,
  alg                   text NOT NULL,
  status                text NOT NULL,
  public_jwk            jsonb NOT NULL,
  private_jwk_encrypted text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  not_after             timestamptz,
  CONSTRAINT signing_keys_kid_unique UNIQUE (realm_id, kid),
  CONSTRAINT signing_keys_status_check CHECK (status IN ('active', 'rotating', 'retired')),
  CONSTRAINT signing_keys_alg_check CHECK (alg IN ('RS256', 'ES256'))
);

ALTER TABLE signing_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY signing_keys_isolation ON signing_keys
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

-- "At most one active key per realm" written where a race cannot violate it.
CREATE UNIQUE INDEX signing_keys_one_active
  ON signing_keys (realm_id) WHERE status = 'active';
```

Add the matching Drizzle schema in `packages/crypto/src/schema/signing-keys.ts` **without** `pgPolicy` — see Task 5's comment — and re-export it from `packages/db/src/schema/index.ts`.

- [ ] **Step 9: Write the failing integration test**

`packages/crypto/tests/signing-keys.int.test.ts` covers round-tripping a key through the repository, `listPublishable` excluding `retired`, the partial unique index, and the realm probe:

```ts
it('excludes retired keys from the published set', async () => {
  const published = await withRealm(handle.db, realmId, async (tx) =>
    signingKeyRepository(tx).listPublishable(),
  );
  expect(published.map((k) => k.kid)).toEqual(['active-kid', 'rotating-kid']);
});

it('refuses a second active key in one realm', async () => {
  await expect(insertActiveKey(realmId)).rejects.toThrow(/signing_keys_one_active/);
});

it('isolates keys by realm', async () => {
  await expectRealmIsolation(handle.db, {
    table: 'signing_keys',
    seed: async (tx, realmId) => {
      await seedRealmAndKey(tx, realmId);
    },
  });
});
```

Run: `npx vitest run --project integration packages/crypto` — expect FAIL, then implement the repository, then PASS.

- [ ] **Step 10: Add the KEK to config**

`packages/kernel/src/config.ts` — add `ODUDU_KEK`, required, base64, decoding to exactly 32 bytes, failing boot with a specific message naming the variable and the actual byte length when it does not. Follow the existing validation style in that file exactly; add a unit test beside it for both the valid and the wrong-length case.

- [ ] **Step 11: Verify and commit**

```bash
pnpm verify
```

```bash
git add packages/crypto packages/db packages/kernel docs/protocols
git commit -m "Store signing keys encrypted, publish only their public halves"
```

Full message body:

```
Private JWKs are AES-256-GCM sealed under a key-encryption key taken from the
environment, behind an interface a KMS adapter can replace later. The
published JWK Set is built from an allowlist of public members rather than by
deleting known private ones, so a key type added later cannot leak by
default.

One active key per realm is a partial unique index, not an application check.
```

---

### Task 7: `crypto` — signing, verification, and the algorithm-confusion defenses

**Files:**

- Create: `packages/crypto/src/service/sign.ts`, `src/service/sign.test.ts`, `src/service/sign.adversarial.test.ts`
- Create: `packages/crypto/stryker.config.json`
- Modify: `packages/crypto/src/index.ts`, root `package.json`

**Interfaces:**

- Consumes: `SigningKeyRecord` and `unwrapPrivateJwk` from Task 6.
- Produces: `signJwt(payload: JWTPayload, opts: { key: SigningKeyRecord; kek: Uint8Array; typ?: string }): Promise<string>`
- Produces: `verifyJwt(token: string, opts: { keys: SigningKeyRecord[]; issuer: string; audience?: string; typ?: string }): Promise<JWTPayload>`

- [ ] **Step 1 (spike 4): find out what `jose` actually rejects**

Do not proceed from documentation. Write the probe and run it:

```bash
cat > /tmp/jose-probe.mjs <<'PROBE'
import { generateKeyPair, SignJWT, jwtVerify, exportJWK } from 'jose';

const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const token = await new SignJWT({ sub: 'a' })
  .setProtectedHeader({ alg: 'RS256', kid: 'k' })
  .setIssuer('iss').setExpirationTime('5m').sign(privateKey);

const [, body] = token.split('.');
const noneHeader = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
try { await jwtVerify(`${noneHeader}.${body}.`, publicKey); console.log('1 alg:none ACCEPTED - STOP'); }
catch (e) { console.log('1 alg:none rejected:', e.code ?? e.message); }

const hsSecret = new TextEncoder().encode(JSON.stringify(await exportJWK(publicKey)));
const forged = await new SignJWT({ sub: 'a' }).setProtectedHeader({ alg: 'HS256', kid: 'k' })
  .setIssuer('iss').setExpirationTime('5m').sign(hsSecret);
try { await jwtVerify(forged, publicKey); console.log('2 confusion ACCEPTED - STOP'); }
catch (e) { console.log('2 confusion rejected:', e.code ?? e.message); }

try { await jwtVerify(token, publicKey, { algorithms: ['ES256'] }); console.log('3 wrong-alg ACCEPTED - STOP'); }
catch (e) { console.log('3 wrong-alg rejected:', e.code ?? e.message); }
PROBE
node /tmp/jose-probe.mjs
```

Record all three outcomes in the commit message as `verified:`. If any line prints `ACCEPTED`, stop: the header must be checked by hand before `jose` is called and this task grows accordingly.

- [ ] **Step 2: Write the failing adversarial test**

`packages/crypto/src/service/sign.adversarial.test.ts`:

```ts
describe('[JOSE-5.2-01] algorithm comes from the key record, never the token header', () => {
  it('rejects alg: none', async () => {
    await expect(
      verifyJwt(tokenWithHeader({ alg: 'none' }), { keys, issuer: ISS }),
    ).rejects.toThrow();
  });

  it('rejects an RS256 public key used as an HS256 secret', async () => {
    await expect(
      verifyJwt(await forgeHs256UsingPublicKey(keys[0]), { keys, issuer: ISS }),
    ).rejects.toThrow(/alg/i);
  });

  it('rejects a header alg that differs from the key record alg', async () => {
    await expect(
      verifyJwt(tokenWithHeader({ alg: 'ES256', kid: keys[0].kid }), { keys, issuer: ISS }),
    ).rejects.toThrow(/alg/i);
  });
});

describe('[JOSE-4.1.4-01] kid is an exact-match lookup, never a path', () => {
  it.each(['../../etc/passwd', '../../../dev/null', "' OR '1'='1", 'a b', ''])(
    'rejects kid %j',
    async (kid) => {
      await expect(
        verifyJwt(tokenWithHeader({ alg: 'RS256', kid }), { keys, issuer: ISS }),
      ).rejects.toThrow(/unknown key|kid/i);
    },
  );

  it('rejects a token with no kid rather than trying every key in turn', async () => {
    await expect(
      verifyJwt(tokenWithHeader({ alg: 'RS256' }), { keys, issuer: ISS }),
    ).rejects.toThrow(/kid/i);
  });
});

describe('[RFC9068-2.1-01] token type confusion', () => {
  it('rejects an ID token where an access token is required', async () => {
    const idToken = await signJwt({ sub: 's' }, { key, kek });
    await expect(verifyJwt(idToken, { keys, issuer: ISS, typ: 'at+jwt' })).rejects.toThrow(/typ/i);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run packages/crypto/src/service/sign.adversarial.test.ts`

Expected: FAIL with `Cannot find module '#/service/sign'`.

- [ ] **Step 4: Implement signing and verification**

`packages/crypto/src/service/sign.ts`:

```ts
import { importJWK, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { OduduError } from '@odudu/kernel';
import { unwrapPrivateJwk } from '#/service/kek';
import { type SigningKeyRecord } from '#/schema/signing-keys';

export async function signJwt(
  payload: JWTPayload,
  opts: { key: SigningKeyRecord; kek: Uint8Array; typ?: string },
): Promise<string> {
  const jwk = unwrapPrivateJwk<Record<string, unknown>>(opts.key.privateJwkEncrypted, opts.kek);
  const privateKey = await importJWK(jwk, opts.key.alg);

  const header: Record<string, string> = { alg: opts.key.alg, kid: opts.key.kid };
  if (opts.typ) header.typ = opts.typ;

  return new SignJWT(payload).setProtectedHeader(header).sign(privateKey);
}

export async function verifyJwt(
  token: string,
  opts: { keys: SigningKeyRecord[]; issuer: string; audience?: string; typ?: string },
): Promise<JWTPayload> {
  const header = decodeProtectedHeaderSafely(token);

  if (typeof header.kid !== 'string' || header.kid.length === 0) {
    throw new OduduError('jwt_kid_missing', 'Token carries no kid');
  }

  // kid is attacker-controlled text. It is matched exactly against the records
  // handed in and never becomes a path, a query fragment, or a cache key.
  const record = opts.keys.find((k) => k.kid === header.kid);
  if (!record) throw new OduduError('jwt_unknown_key', `Unknown key ${header.kid}`);

  if (header.alg !== record.alg) {
    throw new OduduError(
      'jwt_alg_mismatch',
      `Header alg ${String(header.alg)} is not the key's ${record.alg}`,
    );
  }

  if (opts.typ && header.typ !== opts.typ) {
    throw new OduduError('jwt_typ_mismatch', `Expected typ ${opts.typ}, got ${String(header.typ)}`);
  }

  const publicKey = await importJWK(record.publicJwk, record.alg);
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: [record.alg],
    issuer: opts.issuer,
    ...(opts.audience === undefined ? {} : { audience: opts.audience }),
  });

  return payload;
}
```

Write `decodeProtectedHeaderSafely` to parse the first segment as base64url JSON and throw an `OduduError` on anything malformed — a parse failure must never surface as a raw `SyntaxError` from a route handler.

- [ ] **Step 5: Run the adversarial tests**

Run: `npx vitest run packages/crypto/src/service/sign.adversarial.test.ts`

Expected: PASS. Mark the matching rows in `docs/protocols/jose.md` and `docs/protocols/rfc9068.md` as `covered`.

- [ ] **Step 6: Add mutation testing for `crypto` only**

`packages/crypto/stryker.config.json`:

```json
{
  "packageManager": "pnpm",
  "testRunner": "vitest",
  "mutate": ["src/service/**/*.ts", "!src/**/*.test.ts"],
  "thresholds": { "high": 90, "low": 80, "break": 75 },
  "reporters": ["progress", "clear-text"]
}
```

Add `@stryker-mutator/core@10.0.0` and `@stryker-mutator/vitest-runner@10.0.0` as root devDependencies, and the script `"mutate:crypto": "stryker run packages/crypto/stryker.config.json"`.

Run `pnpm mutate:crypto` once and record the surviving-mutant count in the commit message. Do **not** add it to `verify`: the umbrella spec's testing table runs mutation testing per phase, not per push.

- [ ] **Step 7: Verify and commit**

```bash
pnpm verify
```

```bash
git add packages/crypto docs/protocols package.json
git commit -m "Sign and verify with the algorithm the key record declares"
```

Full message body:

```
The token header is untrusted input: kid is matched exactly against the key
records handed in, alg must equal the record's, and typ must equal what the
caller required. jose is then also told which algorithm to accept, so neither
layer alone is load-bearing.

Probed jose directly before relying on it: alg:none, an RS256 public key used
as an HS256 secret, and a mismatched algorithms option are all rejected.
```

---

### Task 8: `domain-realm` — clients

A client here is protocol-agnostic. Redirect URIs and grant types are OAuth vocabulary and belong to `protocol-oidc` (Task 11), because a domain package that knows what a redirect URI is cannot survive SAML at P8.

**Files:**

- Create: `packages/domain-realm/package.json`, `tsconfig.json`, `src/index.ts`
- Create: `src/schema/clients.ts`, `src/service/client.ts`, `src/service/client.test.ts`, `src/repository/clients.ts`
- Create: `packages/domain-realm/tests/clients.int.test.ts`
- Create: `packages/db/drizzle/0004_clients.sql`

**Interfaces:**

- Produces: `ClientRecord = { id: string; realmId: string; clientId: string; name: string; enabled: boolean; type: 'public' | 'confidential'; secretHash: string | null; createdAt: Date }`
- Produces: `clientRepository(tx: RealmScopedDatabase)` with `byClientId(clientId: string): Promise<ClientRecord | null>`
- Produces: `verifyClientSecret(client, presented, compare): Promise<boolean>`

- [ ] **Step 1: Write the migration**

`packages/db/drizzle/0004_clients.sql`:

```sql
CREATE TABLE clients (
  id          uuid PRIMARY KEY,
  realm_id    uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  client_id   text NOT NULL,
  name        text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  type        text NOT NULL,
  secret_hash text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clients_client_id_unique UNIQUE (realm_id, client_id),
  CONSTRAINT clients_realm_id_unique UNIQUE (realm_id, id),
  CONSTRAINT clients_type_check CHECK (type IN ('public', 'confidential')),
  CONSTRAINT clients_secret_matches_type CHECK (
    (type = 'confidential' AND secret_hash IS NOT NULL) OR
    (type = 'public' AND secret_hash IS NULL)
  )
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE ROW LEVEL SECURITY;

CREATE POLICY clients_isolation ON clients
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
```

`clients_secret_matches_type` is the rule "a public client has no secret" written where it cannot be violated. Without it, a public client row carrying a secret is representable and every consumer has to defend against it.

`clients_realm_id_unique` exists so that Task 11's `client_oidc_config` can carry a composite foreign key on `(realm_id, client_id)` — the same denormalization guard used on `users`.

- [ ] **Step 2: Write the failing service test**

`packages/domain-realm/src/service/client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { verifyClientSecret } from '#/service/client';

const compare = async (hash: string, secret: string) => hash === `hashed:${secret}`;

const confidential = {
  id: 'c',
  realmId: 'r',
  clientId: 'web-app',
  name: 'Web',
  enabled: true,
  type: 'confidential' as const,
  secretHash: 'hashed:s3cret',
  createdAt: new Date(),
};
const publicClient = { ...confidential, type: 'public' as const, secretHash: null };

describe('[RFC6749-2.3.1-01] client secret verification', () => {
  it('accepts the correct secret for a confidential client', async () => {
    expect(await verifyClientSecret(confidential, 's3cret', compare)).toBe(true);
  });

  it('rejects a wrong secret', async () => {
    expect(await verifyClientSecret(confidential, 'wrong', compare)).toBe(false);
  });

  it('rejects a confidential client presenting no secret', async () => {
    expect(await verifyClientSecret(confidential, null, compare)).toBe(false);
  });

  it('rejects a public client that presents a secret', async () => {
    expect(await verifyClientSecret(publicClient, 'anything', compare)).toBe(false);
  });

  it('accepts a public client presenting nothing', async () => {
    expect(await verifyClientSecret(publicClient, null, compare)).toBe(true);
  });

  it('rejects a disabled client regardless of secret', async () => {
    expect(await verifyClientSecret({ ...confidential, enabled: false }, 's3cret', compare)).toBe(
      false,
    );
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run packages/domain-realm/src/service/client.test.ts`

Expected: FAIL with `Cannot find module '#/service/client'`.

- [ ] **Step 4: Implement**

`packages/domain-realm/src/service/client.ts`:

```ts
import { type ClientRecord } from '#/schema/clients';

// The comparison function is injected rather than imported: domain-realm must
// not depend on domain-identity, and Task 9's Argon2id verifier is what the
// server passes in.
export async function verifyClientSecret(
  client: ClientRecord,
  presented: string | null,
  compare: (hash: string, secret: string) => Promise<boolean>,
): Promise<boolean> {
  if (!client.enabled) return false;
  if (client.type === 'public') return presented === null;
  if (presented === null || client.secretHash === null) return false;
  return compare(client.secretHash, presented);
}
```

Run the test again: PASS, 6 tests.

- [ ] **Step 5: Write the integration test**

`packages/domain-realm/tests/clients.int.test.ts` covers `byClientId` finding and not finding a client, the unique constraint on `(realm_id, client_id)`, the check constraint rejecting a public client with a secret, and the realm probe:

```ts
it('rejects a public client carrying a secret', async () => {
  await expect(insertClient({ type: 'public', secretHash: 'x' })).rejects.toThrow(
    /clients_secret_matches_type/,
  );
});

it('isolates clients by realm', async () => {
  await expectRealmIsolation(handle.db, {
    table: 'clients',
    seed: async (tx, realmId) => {
      await seedRealmAndClient(tx, realmId);
    },
  });
});
```

Run: `npx vitest run --project integration packages/domain-realm` — expect FAIL, implement the repository, expect PASS.

- [ ] **Step 6: Verify and commit**

```bash
pnpm verify
```

```bash
git add packages/domain-realm packages/db
git commit -m "Add protocol-agnostic client records"
```

Full message body:

```
A client here has an id, a type and a secret. Redirect URIs and grant types
are OAuth vocabulary and live in protocol-oidc, so a SAML service provider at
P8 is a second configuration table rather than a change to this one.

"A public client has no secret" is a check constraint, so the invalid row is
not representable rather than merely unexpected.
```

---

### Task 9: `domain-identity` — subjects, users, credentials, Argon2id

**Files:**

- Create: `packages/domain-identity/package.json`, `tsconfig.json`, `src/index.ts`
- Create: `src/schema/{subjects,users,user-credentials}.ts`, `src/service/password.ts`, `src/service/password.test.ts`, `src/repository/{subjects,users,credentials}.ts`
- Create: `packages/domain-identity/tests/identity.int.test.ts`
- Create: `packages/db/drizzle/0005_subjects.sql`
- Modify: `apps/server/tsup.config.ts`

**Interfaces:**

- Produces: `hashPassword(plain: string): Promise<string>` and `verifyPassword(stored: string, plain: string): Promise<boolean>`
- Produces: `SubjectRecord = { id: string; realmId: string; type: 'user' | 'service' | 'agent_instance'; disabledAt: Date | null }`
- Produces: `userRepository(tx)` with `byUsername(username: string): Promise<{ subject: SubjectRecord; user: UserRecord } | null>`
- Produces: `credentialRepository(tx)` with `passwordFor(subjectId: string): Promise<string | null>`

- [ ] **Step 1 (spike 1): prove `@node-rs/argon2` survives the bundle**

`docs/NEXT.md` carries this as a known risk: `apps/server` builds with tsup and `noExternal: [/.*/]`, and a native `.node` binary cannot be inlined into an ESM bundle.

```bash
pnpm --filter @odudu/domain-identity add @node-rs/argon2@2.2.1
```

Add to `apps/server/tsup.config.ts`, alongside the existing options:

```ts
external: ['@node-rs/argon2'],
```

Then prove it in the container, not on the host:

```bash
pnpm --filter @odudu/server build
docker build -f infra/docker/Dockerfile -t odudu-argon-probe .
docker run --rm --entrypoint node odudu-argon-probe -e "const a=await import('@node-rs/argon2'); const h=await a.hash('x'); console.log(h.slice(0,9), await a.verify(h,'x'))"
```

Expected: `$argon2id` and `true`. Record as `verified:` in the commit message.

If the module is missing from the image, the runtime stage must also copy its `node_modules` — fix that here and say so in the commit. If it cannot be made to work at all, **stop and escalate**: the bundling strategy is a P0 decision and changing it is not this task's call.

- [ ] **Step 2: Write the failing password test**

`packages/domain-identity/src/service/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '#/service/password';

describe('[OIDC-CORE-3.1.2.2-01] password verification', () => {
  it('round-trips a password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword(hash, 'correct-horse-battery-staple')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    expect(await verifyPassword(await hashPassword('a'), 'b')).toBe(false);
  });

  it('produces a different hash for the same password each time', async () => {
    expect(await hashPassword('a')).not.toEqual(await hashPassword('a'));
  });

  it('produces an argon2id hash, not argon2i or argon2d', async () => {
    expect(await hashPassword('a')).toMatch(/^\$argon2id\$/);
  });

  it('returns false rather than throwing on a malformed stored hash', async () => {
    expect(await verifyPassword('not-a-hash', 'a')).toBe(false);
  });
});
```

The last case matters: a value corrupted by a bad migration must fail the login, not crash the endpoint.

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run packages/domain-identity/src/service/password.test.ts`

Expected: FAIL with `Cannot find module '#/service/password'`.

- [ ] **Step 4: Implement**

`packages/domain-identity/src/service/password.ts`:

```ts
import { Algorithm, hash, verify } from '@node-rs/argon2';

const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain, OPTIONS);
  } catch {
    // A hash corrupted by a bad migration must fail the login, not the request.
    return false;
  }
}
```

19 MiB / 2 iterations / 1 lane is the OWASP-recommended Argon2id floor. Cite where you took it from in the commit message; if you cannot cite it, use the library's own defaults and say so rather than inventing numbers.

Run the test again: PASS, 5 tests.

- [ ] **Step 5: Write the migration**

`packages/db/drizzle/0005_subjects.sql`:

```sql
CREATE TABLE subjects (
  id          uuid PRIMARY KEY,
  realm_id    uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  type        text NOT NULL,
  disabled_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subjects_type_check CHECK (type IN ('user', 'service', 'agent_instance')),
  CONSTRAINT subjects_realm_id_unique UNIQUE (realm_id, id)
);

CREATE TABLE users (
  subject_id     uuid PRIMARY KEY REFERENCES subjects(id) ON DELETE CASCADE,
  realm_id       uuid NOT NULL,
  username       text NOT NULL,
  email          text,
  email_verified boolean NOT NULL DEFAULT false,
  CONSTRAINT users_username_unique UNIQUE (realm_id, username),
  CONSTRAINT users_subject_realm_fk FOREIGN KEY (realm_id, subject_id)
    REFERENCES subjects(realm_id, id) ON DELETE CASCADE
);

CREATE TABLE user_credentials (
  id          uuid PRIMARY KEY,
  realm_id    uuid NOT NULL,
  subject_id  uuid NOT NULL,
  type        text NOT NULL,
  secret_data text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_credentials_type_check CHECK (type IN ('password')),
  CONSTRAINT user_credentials_one_password UNIQUE (subject_id, type),
  CONSTRAINT user_credentials_subject_realm_fk FOREIGN KEY (realm_id, subject_id)
    REFERENCES subjects(realm_id, id) ON DELETE CASCADE
);

-- The covering index the umbrella spec section 5 calls for: class-table
-- inheritance puts this join in the hot path of every token issuance.
CREATE INDEX users_lookup ON users (realm_id, username) INCLUDE (subject_id, email, email_verified);

ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects FORCE ROW LEVEL SECURITY;
CREATE POLICY subjects_isolation ON subjects
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_isolation ON users
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY user_credentials_isolation ON user_credentials
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
```

`users.realm_id` and `user_credentials.realm_id` are denormalized so each policy predicate needs no join, and the composite foreign key back to `subjects(realm_id, id)` is what stops the two ever disagreeing. The same pattern repeats on every child table in this phase.

`user_credentials.type` is checked against a one-member list today; P2 widens it to include `totp` and `passkey`. That is an `ALTER ... DROP CONSTRAINT` / `ADD CONSTRAINT` pair in a P2 migration, not a change here.

- [ ] **Step 6: Write the integration tests**

`packages/domain-identity/tests/identity.int.test.ts` covers `byUsername`, the composite-key guard, and one realm probe per table:

```ts
it('refuses a user whose realm differs from its subject', async () => {
  await expect(insertUser({ subjectRealm: realmA, userRealm: realmB })).rejects.toThrow(
    /users_subject_realm_fk/,
  );
});

it.each(['subjects', 'users', 'user_credentials'])('isolates %s by realm', async (table) => {
  await expectRealmIsolation(handle.db, { table, seed: seedFor(table) });
});
```

Run: `npx vitest run --project integration packages/domain-identity` — FAIL, implement, PASS.

- [ ] **Step 7: Confirm the tenant-table guard still passes**

Run: `npx vitest run --project integration packages/db/tests/tenant-tables.int.test.ts`

Expected: PASS. If it fails, a table above is missing its policy — that is the guard from Task 5 doing its job.

- [ ] **Step 8: Verify and commit**

```bash
pnpm verify
```

```bash
git add packages/domain-identity packages/db apps/server/tsup.config.ts pnpm-lock.yaml
git commit -m "Add subjects, users and Argon2id credentials"
```

Full message body:

```
subjects carries all three type values from its first migration, so agent
instances at P5 inherit sessions, grants and revocation instead of
duplicating them. Credentials are typed rows, so P2's TOTP and passkeys are
inserts rather than a migration on users.

@node-rs/argon2 is marked external to the tsup bundle: a native .node binary
cannot be inlined into an ESM bundle. Verified by hashing and verifying
inside the built container image rather than on the host.
```

---

### Task 10: `authn-flows` — sessions and the persisted executor

**Files:**

- Create: `packages/authn-flows/package.json`, `tsconfig.json`, `src/index.ts`
- Create: `src/schema/{sessions,authentication-sessions}.ts`, `src/service/executor.ts`, `src/service/executor.test.ts`, `src/service/authenticators/password.ts`, `src/repository/{sessions,authentication-sessions}.ts`
- Create: `packages/authn-flows/tests/executor.int.test.ts`
- Create: `packages/db/drizzle/0006_sessions.sql`

**Interfaces:**

- Produces: `PendingRequest = { clientId: string; redirectUri: string; scope: string; state: string | null; nonce: string | null; codeChallenge: string; codeChallengeMethod: 'S256' }`
- Produces: `startAuthentication(tx, realmId, request: PendingRequest): Promise<{ authSessionId: string }>`
- Produces: `loadPendingRequest(tx, authSessionId): Promise<PendingRequest | null>`
- Produces: `AuthenticatorResult = { kind: 'success'; subjectId: string } | { kind: 'challenge'; form: 'password' } | { kind: 'failure'; reason: string }`
- Produces: `advance(tx, authSessionId, input: { username?: string; password?: string }): Promise<AuthenticatorResult>`
- Produces: `establishSession(tx, realmId, subjectId): Promise<{ sessionId: string }>` — always a fresh id
- Produces: `sessionCookieName(realm: string, tls: boolean): string`

- [ ] **Step 1: Decide the cookie name, and record why**

`__Host-` requires `Secure`, therefore HTTPS. The compose stack serves plain HTTP today. Pick one and write the reasoning as a comment in `packages/authn-flows/src/index.ts`:

- **(a)** Always `__Host-<realm>-session`, and serve HTTPS locally from this task onward.
- **(b)** `__Host-<realm>-session` when TLS is on, otherwise `<realm>-session` with `Secure` off, plus a boot-time warning whenever the fallback is active.

Recommended: **(b)**. It keeps the production shape correct, keeps local development frictionless, and makes the weaker mode noisy rather than silent. Whichever is chosen, Task 19 confirms it against the conformance suite.

Write the unit test for the choice:

```ts
describe('session cookie naming', () => {
  it('uses the __Host- prefix when TLS is on', () => {
    expect(sessionCookieName('acme', true)).toBe('__Host-acme-session');
  });

  it('drops the prefix without TLS, because browsers reject __Host- without Secure', () => {
    expect(sessionCookieName('acme', false)).toBe('acme-session');
  });
});
```

- [ ] **Step 2: Write the failing executor tests**

`packages/authn-flows/src/service/executor.test.ts`:

```ts
describe('[OIDC-CORE-3.1.2.1-02] the request is parked server-side, not carried by the browser', () => {
  it('returns an opaque id that does not contain the request', async () => {
    const { authSessionId } = await startAuthentication(tx, realmId, request);
    expect(authSessionId).not.toContain(request.redirectUri);
    expect(authSessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('reads the parked request back unchanged', async () => {
    const { authSessionId } = await startAuthentication(tx, realmId, request);
    expect(await loadPendingRequest(tx, authSessionId)).toEqual(request);
  });

  it('refuses an expired authentication session', async () => {
    const { authSessionId } = await startAuthentication(tx, realmId, request);
    clock.advance(31 * 60_000);
    await expect(
      advance(tx, authSessionId, { username: 'ada', password: 'x' }),
    ).resolves.toMatchObject({ kind: 'failure' });
  });
});

describe('[OIDC-CORE-3.1.2.1-03] session fixation', () => {
  it('issues a session id that differs from the pre-authentication one', async () => {
    const { authSessionId } = await startAuthentication(tx, realmId, request);
    const { sessionId } = await establishSession(tx, realmId, subjectId);
    expect(sessionId).not.toEqual(authSessionId);
  });

  it('issues a different session id on every establishment', async () => {
    const first = await establishSession(tx, realmId, subjectId);
    const second = await establishSession(tx, realmId, subjectId);
    expect(first.sessionId).not.toEqual(second.sessionId);
  });
});

describe('[OIDC-CORE-3.1.2.1-04] the password step does not enumerate users', () => {
  it('fails identically for an unknown user and a wrong password', async () => {
    const unknown = await advance(tx, await sessionFor(), { username: 'nobody', password: 'x' });
    const wrong = await advance(tx, await sessionFor(), { username: 'ada', password: 'x' });
    expect(unknown).toEqual(wrong);
  });
});
```

The last test compares whole result objects, so a `reason` string that differs between the two cases fails it. That is the point of writing it that way.

- [ ] **Step 3: Run and watch it fail**

Run: `npx vitest run packages/authn-flows/src/service/executor.test.ts`

Expected: FAIL with `Cannot find module '#/service/executor'`.

- [ ] **Step 4: Implement the executor**

A state machine over a row. In P1 the step list is exactly `['password']`, but it must be a _list_ so that P2 replaces it with a tree without changing any caller.

For the non-enumeration property, verify against a fixed dummy Argon2id hash when the username is unknown, so the two paths cost the same. Write that intent as a comment — it reads as dead code otherwise:

```ts
// Verify against a constant hash when the user does not exist, so an unknown
// username and a wrong password cost the same time as well as returning the
// same result.
const DUMMY_HASH = await hashPassword('odudu-dummy-verification-target');
```

- [ ] **Step 5: Write the migration**

`packages/db/drizzle/0006_sessions.sql` creates `authentication_sessions` and `sessions`, both realm-scoped with `ENABLE`/`FORCE ROW LEVEL SECURITY` and an isolation policy each. `authentication_sessions.pending_request` is `jsonb`; both tables carry `expires_at`. `sessions.subject_id` uses the composite foreign key pattern from Task 9.

- [ ] **Step 6: Integration tests and realm probes**

One `expectRealmIsolation` call per new table, plus a test that a session cannot be resumed from another realm's context. Re-run the Task 5 guard.

- [ ] **Step 7: Verify and commit**

```bash
pnpm verify
```

```bash
git add packages/authn-flows packages/db
git commit -m "Persist the login as a state machine in a row"
```

Full message body:

```
The validated authorization request is parked server-side and the browser
holds only an opaque id, so nothing between the /authorize check and the code
issued can edit scope or redirect_uri. State lives in Postgres rather than
process memory because a multi-step login must survive landing on another
replica.

One authenticator, one linear step: P2 replaces the step list with a tree
without changing callers. A fresh session id is issued on success, and an
unknown username costs the same work as a wrong password.
```

---

### Task 11: `contracts`, discovery, and the JWKS endpoint

The first routes. The Config OP conformance plan is essentially this task.

**Files:**

- Create: `packages/contracts/package.json`, `src/index.ts`, `src/discovery.ts`, `src/authorize.ts`, `src/token.ts`
- Create: `packages/protocol-oidc/package.json`, `src/index.ts`, `src/view/routes/discovery.ts`, `src/view/routes/jwks.ts`
- Create: `packages/protocol-oidc/src/schema/client-oidc-config.ts`, `src/repository/client-oidc-config.ts`
- Create: `packages/db/drizzle/0007_client_oidc_config.sql`
- Modify: `apps/server/src/app.ts`, `apps/server/package.json`

**Interfaces:**

- Produces: `discoveryDocument(opts: { issuer: string }): DiscoveryDocument`
- Produces: `oidcRoutes(deps): FastifyPluginAsync` — the plugin `apps/server` registers
- Produces: `ClientOidcConfig = { clientId: string; realmId: string; redirectUris: string[]; grantTypes: string[]; tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post' | 'none'; audiences: string[]; accessTokenTtlSeconds: number; refreshTokenTtlSeconds: number }`

- [ ] **Step 1: Write the failing discovery test**

Every assertion here corresponds to a row in `docs/protocols/oidc-discovery.md`:

```ts
describe('[OIDC-DISCOVERY-3-01] the discovery document', () => {
  it('advertises only the code response type', () => {
    expect(doc.response_types_supported).toEqual(['code']);
  });

  it('advertises S256 and never plain', () => {
    expect(doc.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('advertises the iss parameter', () => {
    expect(doc.authorization_response_iss_parameter_supported).toBe(true);
  });

  it('advertises exactly the three grant types P1 implements', () => {
    expect([...doc.grant_types_supported].sort()).toEqual([
      'authorization_code',
      'client_credentials',
      'refresh_token',
    ]);
  });

  it('names the issuer with no trailing slash', () => {
    expect(doc.issuer).toBe('https://idp.example/realms/acme');
  });

  it('places every advertised endpoint under the issuer', () => {
    for (const url of [
      doc.authorization_endpoint,
      doc.token_endpoint,
      doc.userinfo_endpoint,
      doc.jwks_uri,
    ]) {
      expect(url.startsWith(`${doc.issuer}/`)).toBe(true);
    }
  });
});

describe('[OIDC-DISCOVERY-3-02] unknown and disabled realms are indistinguishable', () => {
  it.each(['no-such-realm', 'disabled-realm'])('returns 404 for %s', async (realm) => {
    const res = await app.inject({ url: `/realms/${realm}/.well-known/openid-configuration` });
    expect(res.statusCode).toBe(404);
  });
});

describe('[RFC7517-4-02] the published key set carries no private material', () => {
  it('never emits a d member', async () => {
    const res = await app.inject({ url: '/realms/acme/protocol/openid-connect/certs' });
    for (const key of res.json().keys) {
      for (const member of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k']) {
        expect(key).not.toHaveProperty(member);
      }
    }
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run packages/protocol-oidc`

Expected: FAIL, modules not found.

- [ ] **Step 3: Register the Fastify plugins**

Add `@fastify/formbody@9.0.0` and `@fastify/cookie@11.1.2` to `apps/server/package.json` and register them in `app.ts`. Tasks 12 and 14 need both, and plugin registration is an `app.ts` concern rather than a route's.

- [ ] **Step 4: Implement discovery and JWKS**

The JWKS route reads through `signingKeyRepository(tx).listPublishable()` and `assembleJwks` from Task 6. The discovery document is built from the issuer and constants — no database read at all, which is why Config OP is fast.

Run the tests again: PASS.

- [ ] **Step 5: Write the `client_oidc_config` migration**

`packages/db/drizzle/0007_client_oidc_config.sql`, following the same realm-scoped pattern:

```sql
CREATE TABLE client_oidc_config (
  client_id                  uuid PRIMARY KEY,
  realm_id                   uuid NOT NULL,
  redirect_uris              text[] NOT NULL,
  grant_types                text[] NOT NULL,
  token_endpoint_auth_method text NOT NULL,
  audiences                  text[] NOT NULL DEFAULT '{}',
  access_token_ttl_seconds   integer NOT NULL DEFAULT 300,
  refresh_token_ttl_seconds  integer NOT NULL DEFAULT 1209600,
  CONSTRAINT client_oidc_config_client_fk FOREIGN KEY (realm_id, client_id)
    REFERENCES clients(realm_id, id) ON DELETE CASCADE,
  CONSTRAINT client_oidc_config_auth_method_check
    CHECK (token_endpoint_auth_method IN ('client_secret_basic', 'client_secret_post', 'none')),
  CONSTRAINT client_oidc_config_grant_types_check
    CHECK (grant_types <@ ARRAY['authorization_code', 'refresh_token', 'client_credentials']),
  CONSTRAINT client_oidc_config_redirect_uris_present
    CHECK (array_length(redirect_uris, 1) >= 1 OR grant_types = ARRAY['client_credentials'])
);

ALTER TABLE client_oidc_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_oidc_config FORCE ROW LEVEL SECURITY;
CREATE POLICY client_oidc_config_isolation ON client_oidc_config
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
```

The last constraint encodes "every client that can be redirected to has somewhere to be redirected to" — a `client_credentials`-only client legitimately has none.

- [ ] **Step 6: Mark the discovery rows covered and run trace**

Run: `pnpm trace`

The gap count must fall by exactly the number of rows you marked. If it falls by a different number, a row was mis-edited — find it before committing.

- [ ] **Step 7: Verify and commit**

```bash
pnpm verify
```

```bash
git add packages/contracts packages/protocol-oidc packages/db apps/server docs/protocols
git commit -m "Serve discovery and the key set"
```

Full message body:

```
The document advertises only what P1 implements: code alone, S256 alone, and
the three grant types. A client that reads discovery and trusts it cannot ask
this server for a weak flow.

An unknown realm and a disabled one both return 404, so discovery is not a
tenant-enumeration oracle.
```

---

### Task 12: `/authorize` and the redirect boundary

The most security-sensitive ordering decision in the phase.

**Files:**

- Create: `packages/protocol-oidc/src/service/redirect-uri.ts`, `src/service/redirect-uri.test.ts`
- Create: `src/service/authorize-validation.ts`, `src/service/authorize-validation.test.ts`
- Create: `src/usecase/authorization-request.ts`, `src/view/routes/authorize.ts`
- Create: `packages/protocol-oidc/tests/authorize.adversarial.int.test.ts`

**Interfaces:**

- Consumes: `ClientRecord` (Task 8), `ClientOidcConfig` (Task 11), `startAuthentication` (Task 10).
- Produces: `validateAuthorizationRequest(params, client, config): AuthorizeOutcome` where
  `AuthorizeOutcome = { kind: 'ok'; request: PendingRequest } | { kind: 'render'; error: string; description: string } | { kind: 'redirect'; redirectUri: string; error: string; state: string | null }`
- Produces: `isRegisteredRedirectUri(presented: string, registered: readonly string[]): boolean`

- [ ] **Step 1: Write the failing validation-order test**

This tests the _decision_, not the HTTP:

```ts
describe('[RFC6749-4.1.2.1-01] failures before redirect_uri is trusted must not redirect', () => {
  it.each([
    ['unknown client', { ...params, client_id: 'nope' }, null],
    ['disabled client', params, { ...client, enabled: false }],
    ['missing redirect_uri', omit(params, 'redirect_uri'), client],
    ['unregistered redirect_uri', { ...params, redirect_uri: 'https://evil.example/cb' }, client],
    ['trailing slash added', { ...params, redirect_uri: 'https://app.example/callback/' }, client],
    ['path case changed', { ...params, redirect_uri: 'https://app.example/Callback' }, client],
    [
      'extra query parameter',
      { ...params, redirect_uri: 'https://app.example/callback?x=1' },
      client,
    ],
  ])('renders rather than redirects: %s', (_label, p, c) => {
    expect(validateAuthorizationRequest(p, c, config).kind).toBe('render');
  });
});

describe('[RFC6749-4.1.2.1-02] failures after redirect_uri is trusted redirect with state', () => {
  it.each([
    ['bad response_type', { ...params, response_type: 'token' }, 'unsupported_response_type'],
    ['missing code_challenge', omit(params, 'code_challenge'), 'invalid_request'],
    ['plain challenge method', { ...params, code_challenge_method: 'plain' }, 'invalid_request'],
    ['missing challenge method', omit(params, 'code_challenge_method'), 'invalid_request'],
    ['unknown scope', { ...params, scope: 'openid wat' }, 'invalid_scope'],
  ])('redirects with %s', (_label, p, expected) => {
    expect(validateAuthorizationRequest(p, client, config)).toMatchObject({
      kind: 'redirect',
      error: expected,
      state: params.state,
    });
  });
});
```

The trailing-slash, case and extra-query cases exist to catch a "helpful" normalization someone adds later.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run packages/protocol-oidc/src/service/authorize-validation.test.ts`

Expected: FAIL, module not found.

- [ ] **Step 3: Implement, in the specified order**

`packages/protocol-oidc/src/service/redirect-uri.ts`:

```ts
// Exact string comparison, deliberately. OAuth 2.1 requires it, and every
// normalization added here - trailing slashes, case folding, ignoring a query
// string - widens what an attacker can register into.
export function isRegisteredRedirectUri(presented: string, registered: readonly string[]): boolean {
  return registered.includes(presented);
}
```

`packages/protocol-oidc/src/service/authorize-validation.ts`:

```ts
export function validateAuthorizationRequest(
  params: Record<string, string | undefined>,
  client: ClientRecord | null,
  config: ClientOidcConfig | null,
): AuthorizeOutcome {
  // Order is the contract. Everything above the redirect boundary reports by
  // rendering: until redirect_uri is known to belong to a real, enabled
  // client, sending the user there is an open redirect wearing this server's
  // domain. RFC 6749 4.1.2.1 says MUST NOT automatically redirect.
  if (!client || !client.enabled || !config) {
    return { kind: 'render', error: 'invalid_client', description: 'Unknown or disabled client' };
  }

  const redirectUri = params.redirect_uri;
  if (!redirectUri || !isRegisteredRedirectUri(redirectUri, config.redirectUris)) {
    return { kind: 'render', error: 'invalid_request', description: 'Unregistered redirect URI' };
  }

  // Below the boundary: redirect_uri is trusted, so errors go back to it.
  const state = params.state ?? null;
  const reject = (error: string): AuthorizeOutcome => ({
    kind: 'redirect',
    redirectUri,
    error,
    state,
  });

  if (params.response_type !== 'code') return reject('unsupported_response_type');
  if (!params.code_challenge) return reject('invalid_request');
  if (params.code_challenge_method !== 'S256') return reject('invalid_request');
  if (!scopesAreKnown(params.scope)) return reject('invalid_scope');

  return { kind: 'ok', request: toPendingRequest(params, redirectUri) };
}
```

Run the tests again: PASS.

- [ ] **Step 4: Wire the route**

`render` becomes a 400 HTML page; `redirect` becomes a 302; `ok` calls `startAuthentication` from Task 10 and renders the login form.

- [ ] **Step 5: Write the wire-level adversarial test**

`packages/protocol-oidc/tests/authorize.adversarial.int.test.ts` asserts at HTTP level what Step 1 asserted at service level — specifically that **no `location` header exists at all**:

```ts
it('[RFC6749-4.1.2.1-03] emits no location header for an unregistered redirect_uri', async () => {
  const res = await app.inject({ url: authorizeUrl({ redirect_uri: 'https://evil.example/cb' }) });
  expect(res.statusCode).toBe(400);
  expect(res.headers.location).toBeUndefined();
});

it('[RFC6749-4.1.2.1-04] returns state unchanged on a redirected error', async () => {
  const res = await app.inject({ url: authorizeUrl({ response_type: 'token', state: 'xyz 123' }) });
  expect(new URL(res.headers.location as string).searchParams.get('state')).toBe('xyz 123');
});
```

- [ ] **Step 6: Mark rows covered, trace, verify, commit**

```bash
pnpm trace && pnpm verify
```

```bash
git add packages/protocol-oidc docs/protocols
git commit -m "Validate authorization requests in the order the RFC specifies"
```

Full message body:

```
Client and redirect_uri are established before anything is allowed to
redirect. Reporting an unregistered redirect_uri by redirecting to it is the
open redirect, so those failures render instead, and a test asserts no
location header is emitted at all.

Redirect matching is exact string equality. The trailing-slash, path-case and
extra-query cases are tested precisely so that a later normalization cannot be
added quietly.
```

---

### Task 13: The login submission, code issuance, and the redirect back

Task 12 ends with `/authorize` rendering a login form. This task completes the
journey: the form's POST, the SSO session cookie, the authorization code, and
the 302 that carries it home. Without it nothing ever produces a `code`, and
`/token` has nothing to exchange.

**Files:**

- Create: `packages/protocol-oidc/src/schema/authorization-codes.ts`, `src/repository/codes.ts`
- Create: `packages/protocol-oidc/src/service/authorization-code.ts`, `src/service/authorization-code.test.ts`
- Create: `packages/protocol-oidc/src/usecase/login-submission.ts`
- Create: `packages/protocol-oidc/src/view/routes/login.ts`
- Create: `packages/protocol-oidc/tests/login.adversarial.int.test.ts`
- Create: `packages/db/drizzle/0008_authorization_codes.sql`
- Modify: `packages/protocol-oidc/src/view/routes/authorize.ts` (the form it renders must post here and carry a CSRF token)

**Interfaces:**

- Consumes: `advance`, `establishSession`, `loadPendingRequest`, `sessionCookieName` (`@odudu/authn-flows`); `ClientOidcConfig` (Task 11).
- Produces: `issueAuthorizationCode(tx, input): Promise<{ code: string }>` — returns the raw code once; only its hash is stored.
- Produces: `authorizationCodeRepository(tx)` with `create(...)`. The atomic single-use consume lands in Task 14, which owns redemption.
- Produces: `AuthorizationCodeRecord` in `schema/`, carrying every value `/token` must check the redemption against.

**The endpoint path**

`POST /realms/{realm}/login-actions/authenticate`

Deliberately **not** under `/protocol/openid-connect/`. That namespace is the
OIDC wire protocol, and this is our own login UI, which no specification
describes and no client library calls. Keycloak draws the same line. Record
this in a comment so nobody "tidies" it into the protocol namespace later.

- [ ] **Step 1: Write the migration**

`packages/db/drizzle/0008_authorization_codes.sql`:

```sql
CREATE TABLE authorization_codes (
  code_hash             text PRIMARY KEY,
  realm_id              uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  client_id             uuid NOT NULL,
  subject_id            uuid NOT NULL,
  redirect_uri          text NOT NULL,
  scope                 text NOT NULL,
  nonce                 text,
  code_challenge        text NOT NULL,
  code_challenge_method text NOT NULL,
  auth_time             timestamptz NOT NULL,
  expires_at            timestamptz NOT NULL,
  consumed_at           timestamptz,
  grant_id              uuid,
  CONSTRAINT authorization_codes_method_check CHECK (code_challenge_method = 'S256'),
  CONSTRAINT authorization_codes_client_fk FOREIGN KEY (realm_id, client_id)
    REFERENCES clients(realm_id, id) ON DELETE CASCADE,
  CONSTRAINT authorization_codes_subject_fk FOREIGN KEY (realm_id, subject_id)
    REFERENCES subjects(realm_id, id) ON DELETE CASCADE
);

ALTER TABLE authorization_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE authorization_codes FORCE ROW LEVEL SECURITY;

CREATE POLICY authorization_codes_isolation ON authorization_codes
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
```

The primary key is the **hash**. The raw code is never stored, so a backup, a
log, or a SQL injection elsewhere yields nothing redeemable. `grant_id` is
deliberately left without a foreign key — it is filled in during redemption,
after the grant row exists, and a constraint there buys no safety.

Run `npx vitest run --project integration packages/db/tests/tenant-tables.int.test.ts`
afterwards; it fails any table in `public` without `ENABLE` + `FORCE ROW LEVEL
SECURITY` and a policy.

- [ ] **Step 2: Write the failing code-issuance test**

`packages/protocol-oidc/src/service/authorization-code.test.ts`:

```ts
describe('[RFC6749-4.1.2-03] the authorization code is opaque and stored hashed', () => {
  it('returns a high-entropy code', () => {
    const code = generateAuthorizationCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });

  it('returns a different code every time', () => {
    expect(generateAuthorizationCode()).not.toEqual(generateAuthorizationCode());
  });

  it('hashes the code so the stored value cannot be replayed', () => {
    const code = generateAuthorizationCode();
    const hash = hashAuthorizationCode(code);
    expect(hash).not.toContain(code);
    expect(hashAuthorizationCode(code)).toEqual(hash);
  });
});
```

- [ ] **Step 3: Run it, watch it fail, implement**

Run: `npx vitest run packages/protocol-oidc/src/service/authorization-code.test.ts` — expect FAIL, module not found.

Generate with `randomBytes(32).toString('base64url')` and hash with SHA-256.
A code lives 60 seconds: it is redeemed by a backend within a second or two of
the redirect, and a short window shrinks how long an intercepted code is worth
anything.

- [ ] **Step 4: Write the failing login-submission tests**

`packages/protocol-oidc/tests/login.adversarial.int.test.ts`. These run at the
wire level because that is where the defects live:

```ts
describe('[OIDC-CORE-3.1.2.5-01] a successful login produces a code and a redirect', () => {
  it('redirects to the registered redirect_uri with code, state and iss', async () => {
    const res = await submitLogin({ username: 'ada', password: PASSWORD });
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location as string);
    expect(location.origin + location.pathname).toBe('https://app.example/callback');
    expect(location.searchParams.get('code')).toBeTruthy();
    expect(location.searchParams.get('state')).toBe('xyz 123');
    expect(location.searchParams.get('iss')).toBe(`${ISSUER}`);
  });

  it('[RFC9207-2-01] the iss parameter equals the discovery issuer exactly', async () => {
    const doc = (await app.inject({ url: `/realms/acme/.well-known/openid-configuration` })).json();
    const location = new URL((await submitLogin(GOOD)).headers.location as string);
    expect(location.searchParams.get('iss')).toBe(doc.issuer);
  });

  it('never puts the raw code in the database', async () => {
    const code = new URL((await submitLogin(GOOD)).headers.location as string).searchParams.get(
      'code',
    );
    const rows = await allAuthorizationCodes();
    expect(rows.map((r) => r.code_hash)).not.toContain(code);
    expect(rows).toHaveLength(1);
  });
});

describe('[OIDC-CORE-3.1.2.1-05] the login form cannot be driven cross-site', () => {
  it('rejects a submission with no CSRF token', async () => {
    expect((await submitLogin({ ...GOOD, csrf: null })).statusCode).toBe(400);
  });

  it('rejects a submission carrying another session"s CSRF token', async () => {
    expect((await submitLogin({ ...GOOD, csrf: await csrfForAnotherSession() })).statusCode).toBe(
      400,
    );
  });
});

describe('[OIDC-CORE-3.1.2.1-06] the parked request is what binds the code', () => {
  it('ignores scope and redirect_uri resubmitted with the form', async () => {
    const res = await submitLogin({
      ...GOOD,
      extra: { scope: 'openid admin', redirect_uri: 'https://evil.example/cb' },
    });
    const location = new URL(res.headers.location as string);
    expect(location.origin).toBe('https://app.example');
    expect(await scopeOfIssuedCode()).toBe('openid profile');
  });
});

describe('the session cookie', () => {
  it('is HttpOnly, SameSite and Path-scoped', async () => {
    const cookie = (await submitLogin(GOOD)).headers['set-cookie'] as string;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
  });

  it('carries Secure and the __Host- prefix only when TLS is on', async () => {
    expect(await cookieWithTls(true)).toMatch(/^__Host-acme-session=.*Secure/);
    expect(await cookieWithTls(false)).not.toMatch(/Secure/);
    expect(await cookieWithTls(false)).toMatch(/HttpOnly/i);
  });
});

describe('failed and abandoned logins', () => {
  it('re-challenges on a wrong password without issuing a code', async () => {
    const res = await submitLogin({ ...GOOD, password: 'wrong' });
    expect(res.statusCode).toBe(200);
    expect(await countAuthorizationCodes()).toBe(0);
  });

  it('fails an expired authentication session without issuing a code', async () => {
    clock.advance(31 * 60_000);
    expect((await submitLogin(GOOD)).statusCode).toBe(400);
    expect(await countAuthorizationCodes()).toBe(0);
  });
});
```

The resubmitted-`scope` test is the one that proves the parking from
`@odudu/authn-flows` is actually load-bearing. If it passes trivially, check
that the handler really is reading `loadPendingRequest` rather than the body.

- [ ] **Step 5: Run them, watch them fail, implement**

The handler, in order:

1. Read the authentication-session id and the CSRF token from the request; reject a mismatch before anything else.
2. `advance(tx, authSessionId, { username, password })`.
3. On `challenge`, re-render the form; on `failure`, render an error. Neither issues anything.
4. On `success`: `establishSession(...)`, set the cookie with the attributes `@odudu/authn-flows` documents — `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` plus the `__Host-` prefix when TLS is on.
5. `loadPendingRequest(tx, authSessionId)` — **the only source** of `scope`, `redirect_uri`, `nonce`, `state` and `code_challenge`. Never the request body.
6. Issue the code, binding all of the above plus `client_id`, `subject_id` and `auth_time`.
7. 302 to the parked `redirect_uri` with `code`, `state` and `iss`.

`SameSite=Lax` rather than `Strict`: the browser arrives at `/authorize` by a
top-level redirect from the client, and `Strict` would drop the session cookie
on that navigation, breaking single sign-on.

- [ ] **Step 6: Add the realm probe and mark the clause rows**

Add one `expectRealmIsolation` call for `authorization_codes`, imported from
`@odudu/db/testing`. Then mark the rows this task covers in
`docs/protocols/rfc6749.md`, `oidc-core.md` and `rfc9207.md` with the test IDs
your tests carry, and confirm `pnpm trace`'s covered count rises by exactly
that many.

- [ ] **Step 7: Verify and commit**

```bash
npx vitest run packages/protocol-oidc/src
npx vitest run --project integration packages/protocol-oidc
npx vitest run --project integration packages/db/tests/tenant-tables.int.test.ts
pnpm trace
pnpm verify
```

```bash
git add packages/protocol-oidc packages/db docs/protocols
git commit -m "Issue authorization codes and complete the redirect back"
```

Full message body:

```
The login form posts to a path outside the OIDC namespace, because it is our
own UI rather than anything a specification describes or a client library
calls.

Every value bound to the code comes from the request parked server-side at
/authorize, never from the form body — a test resubmits a widened scope and an
attacker-controlled redirect_uri and asserts both are ignored.

Codes are stored as a SHA-256 hash, so a backup or a leaked log yields nothing
redeemable, and they live 60 seconds because a backend redeems them within a
second or two of the redirect.
```

---

### Task 14: `/token` — the pipeline, and the authorization code grant

The centrepiece. Six of the nine adversarial corpus entries live here.

**Files:**

- Create: `packages/protocol-oidc/src/service/pkce.ts`, `src/service/pkce.test.ts`
- Create: `src/service/scope.ts`, `src/service/scope.test.ts`, `src/service/errors.ts`
- Create: `src/usecase/token-issuance.ts`, `src/view/routes/token.ts`
- Create: `src/repository/grants.ts`, `src/schema/token-grants.ts`
- Modify: `src/repository/codes.ts` — add the atomic single-use consume alongside the create the preceding task added
- Create: `packages/protocol-oidc/tests/token-code.adversarial.int.test.ts`
- Create: `packages/db/drizzle/0009_token_grants.sql`

**Interfaces:**

- Consumes: `verifyClientSecret` (Task 8), `verifyPassword` (Task 9), `signJwt` (Task 7), `loadPendingRequest` (Task 10).
- Produces: `verifyPkce(verifier: string, challenge: string, method: 'S256'): boolean`
- Produces: `resolveScope(requested: string, clientAllowed: string[], consented: string[] | null, delegated: string[] | null): string[]`
- Produces: `consumeAuthorizationCode(tx, codeHash: string): Promise<AuthorizationCodeRecord | null>` — atomic, returns `null` when already consumed
- Produces: `issueTokens(tx, ctx): Promise<TokenResponse>`

- [ ] **Step 1 (spike 5): confirm Zod to ajv handles a form-encoded body**

ADR 0007 chose `zod-to-json-schema` with ajv. `/token` is `application/x-www-form-urlencoded`, so every value arrives as a string — a schema expecting a number or boolean will reject valid input.

```bash
cat > /tmp/form-probe.mjs <<'PROBE'
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
const app = Fastify();
await app.register(formbody);
app.post('/t', {
  schema: { body: { type: 'object', required: ['grant_type'],
    properties: { grant_type: { type: 'string' } }, additionalProperties: true } },
}, async (req) => req.body);
const res = await app.inject({ method: 'POST', url: '/t',
  payload: 'grant_type=authorization_code&code=abc',
  headers: { 'content-type': 'application/x-www-form-urlencoded' } });
console.log(res.statusCode, res.body);
PROBE
node /tmp/form-probe.mjs
```

Expected: `200` and the parsed body. Record as `verified:`. If it fails, validate with Zod directly at the route boundary and note the deviation from ADR 0007 in the commit message.

- [ ] **Step 2: Write the failing PKCE test**

`packages/protocol-oidc/src/service/pkce.test.ts`. Use the worked example from RFC 7636 Appendix B so the implementation is checked against the specification's own vector rather than against itself:

```ts
import { describe, expect, it } from 'vitest';
import { verifyPkce } from '#/service/pkce';

// RFC 7636 Appendix B worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('[RFC7636-4.6-01] PKCE verification', () => {
  it("accepts the RFC's own worked example", () => {
    expect(verifyPkce(VERIFIER, CHALLENGE, 'S256')).toBe(true);
  });

  it('rejects a wrong verifier', () => {
    expect(verifyPkce('a'.repeat(43), CHALLENGE, 'S256')).toBe(false);
  });

  it('rejects the challenge presented as the verifier', () => {
    expect(verifyPkce(CHALLENGE, CHALLENGE, 'S256')).toBe(false);
  });

  it('rejects a verifier shorter than 43 characters', () => {
    expect(verifyPkce('short', CHALLENGE, 'S256')).toBe(false);
  });

  it('rejects a verifier longer than 128 characters', () => {
    expect(verifyPkce('a'.repeat(129), CHALLENGE, 'S256')).toBe(false);
  });

  it('rejects an empty verifier', () => {
    expect(verifyPkce('', CHALLENGE, 'S256')).toBe(false);
  });
});
```

- [ ] **Step 3: Run, fail, implement, run**

Run: `npx vitest run packages/protocol-oidc/src/service/pkce.test.ts` — FAIL, module not found.

```ts
import { createHash, timingSafeEqual } from 'node:crypto';

const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

export function verifyPkce(verifier: string, challenge: string, method: 'S256'): boolean {
  if (method !== 'S256') return false;
  if (!VERIFIER_PATTERN.test(verifier)) return false;

  const computed = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Run again: PASS, 6 tests.

- [ ] **Step 4: Write the failing scope test**

```ts
describe('[RFC6749-3.3-01] scope only ever narrows', () => {
  it('intersects requested with client-allowed', () => {
    expect(resolveScope('openid profile admin', ['openid', 'profile'], null, null)).toEqual([
      'openid',
      'profile',
    ]);
  });

  it('cannot widen beyond what the client is allowed', () => {
    expect(resolveScope('admin', ['openid'], null, null)).toEqual([]);
  });

  it('narrows further to what was consented when consent exists', () => {
    expect(resolveScope('openid profile', ['openid', 'profile'], ['openid'], null)).toEqual([
      'openid',
    ]);
  });

  it('narrows further to the delegated set when one exists', () => {
    expect(resolveScope('openid profile', ['openid', 'profile'], null, ['profile'])).toEqual([
      'profile',
    ]);
  });

  it('treats a null consented set as "everything allowed", not "nothing"', () => {
    expect(resolveScope('openid', ['openid'], null, null)).toEqual(['openid']);
  });
});
```

The last case is the trap: P1 has no consent screen, so `null` must mean "not applicable", and a naive intersection with an empty array would issue no scopes at all.

- [ ] **Step 5: Run, fail, implement, run**

All four terms are written now even though two are inert in P1. P5's attenuation check becomes the `delegated` argument with no change to this function.

- [ ] **Step 6: Write the migration**

`packages/db/drizzle/0009_token_grants.sql`:

```sql
CREATE TABLE token_grants (
  id         uuid PRIMARY KEY,
  realm_id   uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  client_id  uuid NOT NULL,
  subject_id uuid NOT NULL,
  scope      text NOT NULL,
  audience   text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT token_grants_realm_id_unique UNIQUE (realm_id, id),
  CONSTRAINT token_grants_client_fk FOREIGN KEY (realm_id, client_id)
    REFERENCES clients(realm_id, id) ON DELETE CASCADE,
  CONSTRAINT token_grants_subject_fk FOREIGN KEY (realm_id, subject_id)
    REFERENCES subjects(realm_id, id) ON DELETE CASCADE
);

ALTER TABLE token_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY token_grants_isolation ON token_grants
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
```

`authorization_codes` is created by the preceding task, which issues the codes; this migration adds only the grant table they are redeemed into. `token_grants_realm_id_unique` exists so the refresh-token table can carry a composite foreign key on `(realm_id, grant_id)`.

- [ ] **Step 7: Write the failing atomic-consumption test**

This one needs the real database — it is the reason the project's non-negotiables forbid a mocked one:

```ts
it('[RFC6749-4.1.2-01] only one of two concurrent redemptions succeeds', async () => {
  const results = await Promise.allSettled([
    withRealm(handle.db, realmId, async (tx) => consumeAuthorizationCode(tx, codeHash)),
    withRealm(handle.db, realmId, async (tx) => consumeAuthorizationCode(tx, codeHash)),
  ]);

  const consumed = results.filter((r) => r.status === 'fulfilled' && r.value !== null);
  expect(consumed).toHaveLength(1);
});
```

- [ ] **Step 8: Run, fail, implement the atomic consume**

```ts
// One statement, not check-then-set: the database picks the winner and the
// loser gets zero rows. Two statements here is a race that a mocked database
// would never show.
export async function consumeAuthorizationCode(
  tx: RealmScopedDatabase,
  codeHash: string,
): Promise<AuthorizationCodeRecord | null> {
  const rows = await tx.execute(sql`
    UPDATE authorization_codes
       SET consumed_at = now()
     WHERE code_hash = ${codeHash}
       AND consumed_at IS NULL
       AND expires_at > now()
    RETURNING *
  `);
  return (rows as unknown as AuthorizationCodeRecord[])[0] ?? null;
}
```

Run again: PASS.

- [ ] **Step 9: Write the failing adversarial suite for `/token`**

`packages/protocol-oidc/tests/token-code.adversarial.int.test.ts`. Each `describe` maps to a corpus entry:

```ts
describe('[RFC6749-4.1.2-02] authorization code replay', () => {
  it('rejects the second redemption', async () => {
    expect((await redeem(code)).statusCode).toBe(200);
    const second = await redeem(code);
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe('invalid_grant');
  });

  it('revokes the tokens issued by the first redemption', async () => {
    const first = (await redeem(code)).json();
    await redeem(code);
    const refreshed = await refresh(first.refresh_token);
    expect(refreshed.statusCode).toBe(400);
  });
});

describe('[RFC6749-4.1.3-01] code substitution across clients', () => {
  it('refuses a code issued to another client', async () => {
    const res = await redeem(code, { as: 'other-app', secret: 'othersecret' });
    expect(res.json().error).toBe('invalid_grant');
  });
});

describe('[RFC7636-4.6-02] PKCE', () => {
  it('refuses a wrong code_verifier', async () => {
    expect((await redeem(code, { verifier: 'x'.repeat(43) })).json().error).toBe('invalid_grant');
  });

  it('refuses a missing code_verifier', async () => {
    expect((await redeem(code, { verifier: null })).json().error).toBe('invalid_grant');
  });
});

describe('[RFC6749-4.1.3-02] redirect_uri must match the one bound to the code', () => {
  it('refuses a different registered redirect_uri', async () => {
    expect((await redeem(code, { redirectUri: SECOND_REGISTERED_URI })).json().error).toBe(
      'invalid_grant',
    );
  });
});

describe('[RFC6749-5.2-01] failures are not an oracle', () => {
  it('returns the same error for every distinct code failure', async () => {
    const errors = await Promise.all(
      [
        redeem('nonexistent'),
        redeem(expiredCode),
        redeem(consumedCode),
        redeem(code, { as: 'other-app' }),
        redeem(code, { verifier: 'wrong'.repeat(10) }),
      ].map(async (p) => (await p).json().error),
    );
    expect(new Set(errors)).toEqual(new Set(['invalid_grant']));
  });
});

describe('[RFC9068-2.2-01] the access token is a typed JWT', () => {
  it('carries typ at+jwt and every required claim', async () => {
    const { access_token } = (await redeem(code)).json();
    const header = JSON.parse(Buffer.from(access_token.split('.')[0], 'base64url').toString());
    const payload = JSON.parse(Buffer.from(access_token.split('.')[1], 'base64url').toString());
    expect(header).toMatchObject({ typ: 'at+jwt', alg: 'RS256' });
    expect(header.kid).toBeTruthy();
    for (const claim of ['iss', 'exp', 'aud', 'sub', 'client_id', 'iat', 'jti']) {
      expect(payload[claim]).toBeDefined();
    }
  });

  it('does not put typ at+jwt on the id token', async () => {
    const { id_token } = (await redeem(code)).json();
    const header = JSON.parse(Buffer.from(id_token.split('.')[0], 'base64url').toString());
    expect(header.typ).not.toBe('at+jwt');
  });
});

describe('[OIDC-CORE-3.1.3.7-01] the id token binds to the request', () => {
  it('carries the nonce from the authorization request', async () => {
    const { id_token } = (await redeem(code)).json();
    expect(decodePayload(id_token).nonce).toBe('n-9f2');
  });

  it('has the client as its audience, not the API', async () => {
    const { id_token } = (await redeem(code)).json();
    expect(decodePayload(id_token).aud).toBe('web-app');
  });
});

describe('[RFC6749-3.2.1-01] client authentication', () => {
  it('returns 401 and WWW-Authenticate for a bad secret', async () => {
    const res = await redeem(code, { secret: 'wrong' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_client');
    expect(res.headers['www-authenticate']).toMatch(/Basic/);
  });

  it('refuses a public client that presents a secret', async () => {
    expect((await redeem(publicCode, { as: 'spa', secret: 'anything' })).statusCode).toBe(401);
  });
});

describe('[RFC6749-5.1-01] token responses are not cached', () => {
  it('sets Cache-Control: no-store', async () => {
    expect((await redeem(code)).headers['cache-control']).toMatch(/no-store/);
  });
});
```

- [ ] **Step 10: Run, fail, implement the pipeline**

`src/usecase/token-issuance.ts` implements the eight stages in order, with the grant-specific stage 3 dispatched by `grant_type`. Keep the stage boundaries visible in the code — a later reader must be able to see the pipeline the spec describes.

Run the suite: PASS.

- [ ] **Step 11: Mark rows covered, trace, verify, commit**

```bash
pnpm trace && pnpm verify
```

```bash
git add packages/protocol-oidc packages/db docs/protocols
git commit -m "Issue tokens for the authorization code grant"
```

Full message body:

```
Eight stages, of which only the third is grant-specific. Code consumption is
one UPDATE with a WHERE on consumed_at, so two concurrent redemptions cannot
both succeed - proved against real Postgres, which is the reason integration
tests here never use a mock.

Every distinct code failure returns invalid_grant, asserted as a set, so the
response cannot tell an attacker which check they failed.

PKCE is checked against RFC 7636's own worked example rather than against our
own implementation.
```

---

### Task 15: Refresh rotation, family revocation, and `client_credentials`

**Files:**

- Create: `packages/protocol-oidc/src/service/refresh.ts`, `src/service/refresh.test.ts`
- Create: `src/repository/refresh.ts`, `src/schema/refresh-tokens.ts`
- Create: `packages/protocol-oidc/tests/refresh.adversarial.int.test.ts`, `tests/client-credentials.int.test.ts`
- Create: `packages/db/drizzle/0010_refresh_tokens.sql`

**Interfaces:**

- Produces: `rotateRefreshToken(tx, presentedHash): Promise<RotationOutcome>` where
  `RotationOutcome = { kind: 'rotated'; grant: TokenGrantRecord; next: string } | { kind: 'reused'; revokedFamily: string } | { kind: 'unknown' }`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE refresh_tokens (
  token_hash  text PRIMARY KEY,
  realm_id    uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  grant_id    uuid NOT NULL,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  replaced_by text,
  CONSTRAINT refresh_tokens_grant_fk FOREIGN KEY (realm_id, grant_id)
    REFERENCES token_grants(realm_id, id) ON DELETE CASCADE
);

CREATE INDEX refresh_tokens_by_grant ON refresh_tokens (realm_id, grant_id);

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY refresh_tokens_isolation ON refresh_tokens
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
```

The family is the grant: `refresh_tokens_by_grant` is what makes revoking it one statement.

- [ ] **Step 2: Write the failing reuse-detection test**

The fourth assertion is the one that actually proves family revocation. A test that stops at the third only proves single-use:

```ts
describe('[RFC6749-10.4-01] refresh token rotation and reuse detection', () => {
  it('issues a new refresh token and retires the old one', async () => {
    const rt2 = (await refresh(rt1)).json().refresh_token;
    expect(rt2).not.toEqual(rt1);
    expect((await refresh(rt1)).statusCode).toBe(400);
  });

  it('revokes the whole family when a used token is presented again', async () => {
    const rt2 = (await refresh(rt1)).json().refresh_token;
    await refresh(rt1); // the reuse
    const afterward = await refresh(rt2); // the live one
    expect(afterward.statusCode).toBe(400);
    expect(afterward.json().error).toBe('invalid_grant');
  });

  it('marks the grant revoked, not merely the tokens', async () => {
    const rt2 = (await refresh(rt1)).json().refresh_token;
    await refresh(rt1);
    expect(await grantRevokedAt(grantId)).not.toBeNull();
  });

  it('refuses a refresh token presented by a different client', async () => {
    expect((await refresh(rt1, { as: 'other-app' })).json().error).toBe('invalid_grant');
  });

  it('[RFC6749-6-01] refuses to widen scope on refresh', async () => {
    expect((await refresh(rt1, { scope: 'openid profile admin' })).json().error).toBe(
      'invalid_scope',
    );
  });

  it('[RFC6749-6-02] permits narrowing scope on refresh', async () => {
    expect((await refresh(rt1, { scope: 'openid' })).json().scope).toBe('openid');
  });

  it('refuses a refresh token whose subject was disabled since issue', async () => {
    await disableSubject(subjectId);
    expect((await refresh(rt1)).json().error).toBe('invalid_grant');
  });
});
```

- [ ] **Step 3: Run, fail, implement rotation**

Detection and revocation must be one transaction: a reuse detected but not revoked because a later statement failed is worse than not detecting it.

- [ ] **Step 4: Write the failing `client_credentials` tests**

```ts
describe('[RFC6749-4.4-01] client credentials grant', () => {
  it('issues an access token for a confidential client', async () => {
    const res = await clientCredentials('batch-job', 's3cret', 'reports:read');
    expect(res.statusCode).toBe(200);
    expect(res.json().scope).toBe('reports:read');
  });

  it('[RFC6749-4.4.3-01] issues no refresh token', async () => {
    expect((await clientCredentials('batch-job', 's3cret')).json().refresh_token).toBeUndefined();
  });

  it('issues no id token, because no person authenticated', async () => {
    expect((await clientCredentials('batch-job', 's3cret')).json().id_token).toBeUndefined();
  });

  it('[RFC6749-4.4-02] refuses a public client', async () => {
    const res = await clientCredentials('spa', null);
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_client');
  });

  it('[RFC6749-3.3-02] refuses scope beyond what the client is allowed', async () => {
    expect((await clientCredentials('batch-job', 's3cret', 'admin')).json().error).toBe(
      'invalid_scope',
    );
  });

  it('sets sub to the client service-account subject', async () => {
    const { access_token } = (await clientCredentials('batch-job', 's3cret')).json();
    expect(decodePayload(access_token).sub).toBe(await serviceSubjectFor('batch-job'));
  });
});
```

These are exit criterion 5 — the OIDF Basic OP plan does not exercise this grant, so this file is its only external proof.

- [ ] **Step 5: Run, fail, implement, run; then the realm probe**

Add `expectRealmIsolation` for `refresh_tokens` and `token_grants`, and re-run the Task 5 guard.

- [ ] **Step 6: Trace, verify, commit**

```bash
pnpm trace && pnpm verify
```

```bash
git add packages/protocol-oidc packages/db docs/protocols
git commit -m "Rotate refresh tokens and revoke the family on reuse"
```

Full message body:

```
A refresh token presented twice means two copies exist and one is a thief's,
and the server cannot tell which request is which. Revoking only the reused
token makes it a coin flip, so the whole family dies and the legitimate user
logs in again. Detection and revocation share one transaction.

The test that proves this presents the still-live successor token after the
reuse. Without that fourth call the suite would only prove single-use.

client_credentials issues no refresh token and no ID token: there is no human
to avoid re-involving, and nobody authenticated.
```

---

### Task 16: `/userinfo` and the claim mapper registry

**Files:**

- Create: `packages/kernel/src/registries/claim-mapper.ts` and its test
- Create: `packages/protocol-oidc/src/service/claims.ts`, `src/service/claims.test.ts`
- Create: `src/view/routes/userinfo.ts`, `tests/userinfo.adversarial.int.test.ts`
- Modify: `packages/kernel/src/index.ts`, `apps/server/src/app.ts`

**Interfaces:**

- Produces: `ClaimMapper = { name: string; scopes: readonly string[]; map(ctx: ClaimContext): Promise<Record<string, unknown>> }`
- Produces: `ClaimMapperRegistry` with `register(m: ClaimMapper): this` and `assemble(scopes: string[], ctx: ClaimContext): Promise<Record<string, unknown>>`

- [ ] **Step 1: Write the failing registry test**

```ts
describe('claim mapper registry', () => {
  it('runs only mappers whose scopes were granted', async () => {
    const claims = await registry.assemble(['openid'], ctx);
    expect(claims).toHaveProperty('sub');
    expect(claims).not.toHaveProperty('email');
  });

  it('runs the email mapper when the email scope is granted', async () => {
    expect(await registry.assemble(['openid', 'email'], ctx)).toHaveProperty('email');
  });

  it('rejects a duplicate mapper name rather than silently replacing it', () => {
    expect(() => registry.register(mapper).register(mapper)).toThrow(/already registered/);
  });

  it('lets a later mapper add claims without dropping an earlier one', async () => {
    const claims = await registry.assemble(['openid', 'profile', 'email'], ctx);
    expect(Object.keys(claims).sort()).toEqual(['email', 'email_verified', 'name', 'sub']);
  });
});
```

Follow the existing `ModuleRegistry` in `packages/kernel/src/registry.ts` for style — duplicate registration there throws `OduduError('module_duplicate', ...)`, and this should mirror it.

- [ ] **Step 2: Run, fail, implement, run**

The standard OIDC claims are registered mappers, not a hardcoded switch. This is the plugin system's first real consumer, placed here on purpose by umbrella spec sections 6 and 8.

- [ ] **Step 3: Write the failing `/userinfo` adversarial tests**

```ts
describe('[RFC6750-3.1-01] bearer token validation', () => {
  it('returns 401 and WWW-Authenticate with no Authorization header', async () => {
    const res = await userinfo(null);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
  });

  it.each([
    ['expired', () => expiredToken],
    ['wrong issuer', () => foreignIssuerToken],
    ['bad signature', () => tamperedToken],
  ])('returns 401 invalid_token for %s', async (_label, token) => {
    const res = await userinfo(token());
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });

  it('[RFC9068-4-01] refuses an ID token presented as a bearer token', async () => {
    expect((await userinfo(idToken)).statusCode).toBe(401);
  });

  it('[RFC6750-2.3-01] refuses a token in the query string', async () => {
    expect((await app.inject({ url: `${USERINFO}?access_token=${validToken}` })).statusCode).toBe(
      401,
    );
  });

  it('[OIDC-CORE-5.3.1-01] returns 403 insufficient_scope without the openid scope', async () => {
    const res = await userinfo(tokenWithoutOpenid);
    expect(res.statusCode).toBe(403);
    expect(res.headers['www-authenticate']).toMatch(/insufficient_scope/);
  });

  it('[OIDC-CORE-5.4-01] omits claims whose scope was not granted', async () => {
    const body = (await userinfo(tokenWithOpenidOnly)).json();
    expect(body).toHaveProperty('sub');
    expect(body).not.toHaveProperty('email');
  });

  it('refuses a token minted by another realm', async () => {
    expect((await userinfo(otherRealmToken)).statusCode).toBe(401);
  });
});
```

- [ ] **Step 4: Run, fail, implement, run**

Validation order: signature by `kid`, then `typ`, then `iss`, then `exp`, then `aud`, then scope. The `typ` check is Task 7's `verifyJwt({ typ: 'at+jwt' })` — do not re-implement it here.

- [ ] **Step 5: Trace, verify, commit**

```bash
pnpm trace && pnpm verify
```

```bash
git add packages/kernel packages/protocol-oidc apps/server docs/protocols
git commit -m "Serve userinfo through registered claim mappers"
```

Full message body:

```
The standard OIDC claims are registered mappers rather than a switch
statement, which makes claim mapping the plugin system's first real consumer
in P1 instead of an abstraction designed and unused until P10.

A token in the query string is refused: OAuth 2.1 drops that form, and query
strings end up in history, Referer headers and access logs.
```

---

### Task 17: The bootstrap seed CLI

**Files:**

- Create: `apps/server/src/cli/seed.ts`, `src/cli/seed.test.ts`
- Create: `apps/server/tests/seed.int.test.ts`
- Modify: `apps/server/package.json`, `infra/docker/Dockerfile`

**Interfaces:**

- Produces: `seed(opts: SeedOptions): Promise<SeedResult>` where `SeedOptions = { realm: string; clientId: string; clientSecret?: string; redirectUris: string[]; username?: string; password?: string }`

- [ ] **Step 1: Write the failing test**

```ts
describe('seed', () => {
  it('creates a realm, a client, a user and a signing key', async () => {
    const result = await seed({
      realm: 'acme',
      clientId: 'web-app',
      clientSecret: 's3cret',
      redirectUris: ['https://app.example/callback'],
      username: 'ada',
      password: 'pw',
    });
    expect(result).toMatchObject({ realm: 'acme', clientId: 'web-app' });
    expect(await countRows('signing_keys')).toBe(1);
  });

  it('is idempotent: running twice does not duplicate or fail', async () => {
    await seed(options);
    await expect(seed(options)).resolves.toMatchObject({ created: false });
    expect(await countRows('clients')).toBe(1);
  });

  it('creates a public client when no secret is given', async () => {
    const result = await seed({ ...options, clientSecret: undefined });
    expect(await clientType(result.clientId)).toBe('public');
  });

  it('refuses a redirect URI that is not absolute', async () => {
    await expect(seed({ ...options, redirectUris: ['/callback'] })).rejects.toThrow(/absolute/);
  });
});
```

Idempotency matters because this runs in `smoke.sh` and in CI, where a second run must not fail the build.

- [ ] **Step 2: Run, fail, implement, run**

Reuse the repositories rather than writing SQL — the point of a seed CLI running through real code paths is that it exercises them.

- [ ] **Step 3: Verify and commit**

```bash
pnpm verify
```

```bash
git add apps/server infra/docker
git commit -m "Add a bootstrap seed command"
```

Full message body:

```
Clients arrived in P1 but the admin API is P4, so something has to create the
first realm, client and user. This runs through the repository layer rather
than raw SQL, so it exercises the same code paths a real caller would.

It is idempotent: smoke.sh and CI both run it more than once.
```

---

### Task 18: Adversarial suite consolidation and the container end-to-end exchange

**Files:**

- Create: `packages/protocol-oidc/tests/cross-realm.adversarial.int.test.ts`
- Modify: `infra/docker/smoke.sh`, `docs/protocols/*` (audience confusion rows)

- [ ] **Step 1: Write the cross-realm and audience-confusion tests**

The two corpus entries with no home in an earlier task:

```ts
describe('[RFC9068-3-01] audience confusion between clients', () => {
  it('refuses an access token minted for another audience', async () => {
    const token = await tokenFor({ client: 'app-a', audience: 'https://api-a.example' });
    expect(await verifyAsResourceServer(token, 'https://api-b.example')).toBe(false);
  });

  it('refuses a token whose audience is the client rather than an API', async () => {
    expect(await verifyAsResourceServer(idTokenFor('app-a'), 'https://api-a.example')).toBe(false);
  });
});

describe('[OIDC-CORE-16.1-01] cross-realm leakage', () => {
  it('cannot redeem realm A code at realm B token endpoint', async () => {
    expect((await redeemAt('realm-b', realmACode)).statusCode).toBe(400);
  });

  it('cannot use a realm A session to authorize in realm B', async () => {
    const res = await authorizeWithCookie('realm-b', realmASessionCookie);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('password'); // challenged, not signed in
  });

  it('cannot refresh a realm A token at realm B', async () => {
    expect((await refreshAt('realm-b', realmARefreshToken)).statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Extend `smoke.sh` with a real token exchange**

P0's lesson: a smoke test that only probes `/health/ready` cannot tell working from broken. Add, after the existing readiness poll and RLS assertions:

```bash
# A container that boots but cannot issue a token is not a working server.
# Every step uses -f or an explicit status check: a silent failure here would
# make the whole assertion vacuous, which is exactly what the RLS check did
# before it was fixed.
set -o pipefail

docker compose -f "$COMPOSE_FILE" exec -T odudu node dist/main.js seed \
  --realm smoke --client smoke-app --client-secret smoke-secret \
  --redirect-uri http://localhost:3000/cb --user smoke --password smoke-password

VERIFIER=$(openssl rand -hex 32)
CHALLENGE=$(printf %s "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')

# Drive the login without a browser: POST the form the authorize endpoint
# would have rendered, then read the code out of the Location header.
CODE=$(curl -sS -f -c /tmp/smoke-jar -b /tmp/smoke-jar -o /dev/null -w '%{redirect_url}' \
  -d username=smoke -d password=smoke-password \
  "http://localhost:3000/realms/smoke/protocol/openid-connect/auth?response_type=code&client_id=smoke-app&redirect_uri=http://localhost:3000/cb&scope=openid&state=s&code_challenge=$CHALLENGE&code_challenge_method=S256" \
  | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')

test -n "$CODE" || { echo "smoke: no authorization code issued"; exit 1; }

ACCESS=$(curl -sS -f -u smoke-app:smoke-secret \
  -d grant_type=authorization_code -d "code=$CODE" \
  -d redirect_uri=http://localhost:3000/cb -d "code_verifier=$VERIFIER" \
  http://localhost:3000/realms/smoke/protocol/openid-connect/token \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

test -n "$ACCESS" || { echo "smoke: no access token issued"; exit 1; }

TYP=$(printf %s "${ACCESS%%.*}" | base64 -d 2>/dev/null | sed -n 's/.*"typ":"\([^"]*\)".*/\1/p')
test "$TYP" = "at+jwt" || { echo "smoke: access token typ was '$TYP', expected at+jwt"; exit 1; }

echo "smoke: full code+PKCE exchange completed against the container"
```

- [ ] **Step 3: Prove the new smoke assertions actually fail when broken**

Temporarily break one thing — set `typ` to `JWT` in `signJwt`'s access-token call — and confirm `smoke.sh` fails on the `typ` check rather than passing. Restore and confirm green. Record this in the commit message.

- [ ] **Step 4: Close the deferred P0 item**

`docs/NEXT.md` records: _"`smoke.sh`'s owner-side INSERT does not use `-v ON_ERROR_STOP=1` and discards output, so a silent insert failure would make the RLS assertion vacuous."_ Fix it here — add `-v ON_ERROR_STOP=1` and stop discarding output — since this task is already editing the file.

- [ ] **Step 5: Verify, run smoke, commit**

```bash
pnpm verify && ./infra/docker/smoke.sh
```

```bash
git add packages/protocol-oidc infra/docker docs/protocols
git commit -m "Prove a full token exchange against the running container"
```

Full message body:

```
P0's smoke test could not distinguish a working RLS grant from a broken one
because it only probed /health/ready. The equivalent trap here is a container
that boots but never issues a token, so the smoke run now drives a complete
code+PKCE exchange and checks the access token's typ.

Proved the new assertions fail when the behaviour is broken before trusting
them. Also closed P0's deferred ON_ERROR_STOP item in the same file.
```

---

### Task 19: The conformance harness

Stands the OpenID Foundation suite up, answers the two open spikes, runs both plans, and wires the non-interactive one into continuous integration. The countable close and the documentation follow in the next two tasks.

**Files:**

- Create: `infra/conformance/README.md`, `compose.yaml`, `basic-op.json`, `config-op.json`, `results/.gitkeep`
- Modify: `.github/workflows/verify.yml`, root `package.json`, `docs/NEXT.md`

- [ ] **Step 1 (spike 2): stand the suite up and find out about TLS**

```bash
git clone --depth 1 --branch release-v5.1.36 \
  https://gitlab.com/openid/conformance-suite.git /tmp/conformance
cd /tmp/conformance && docker compose -f docker-compose-dev.yml up -d
```

Pin whatever release tag is current — record the exact tag used, as `verified:`. Add `extra_hosts: - "localhost:host-gateway"` to each service so the suite can reach the host.

Then answer the two questions and record both answers in `infra/conformance/README.md`:

1. Does a Config OP plan accept `issuer: http://localhost:3000/realms/smoke`, or does it demand HTTPS?
2. If HTTPS is demanded, what is the cheapest route — a self-signed certificate in the compose stack, or a reverse proxy in front of it?

If TLS is required, implement it here and revisit Task 10's cookie decision so the `__Host-` prefix is used in the conformance run.

- [ ] **Step 2 (spike 3): drive Config OP without a browser**

Find out whether a plan can be created and run through the suite's HTTP API with a token rather than the UI. Record the exact calls in `README.md`. If it cannot be automated, say so plainly in the README and move Config OP to the documented-manual path alongside Basic OP — do not fake it in CI.

- [ ] **Step 3: Run Basic OP and commit the export**

Seed a realm, run the plan, export the results JSON, and commit it under `infra/conformance/results/` with the date and the suite version in the filename. Any test the plan fails is a bug to fix before this task closes — not a note in the README.

- [ ] **Step 4: Wire Config OP into CI**

Add a `conformance` job to `.github/workflows/verify.yml` mirroring the existing `container` job's structure. It brings up the stack, seeds, runs the Config OP plan, and fails on any failed test.

---

### Task 20: Closing the MUST gaps and switching traceability to strict

Measured at the end of the adversarial task: **181 MUST-level rows are still `gap`** — rfc6749 69, oidc-core 63, rfc6750 18, rfc9068 9, jose 7, rfc7636 7, oidc-discovery 4, rfc9207 4. Strict mode fails on exactly those, so this is what stands between the phase and its exit criterion.

Only 36 of the 181 even mention a client, relying party or resource server, and several of those are really server duties — so this is not a classification pass that can be absorbed into one increment. It is genuine test-writing against server obligations.

**Size it before starting it.** Triage all 181 first, into: a row a P1 behaviour already satisfies but nothing asserts (write the test); a row about another party's duty (`n/a: client-side guidance`); a row about a feature outside this phase (`deferred: <phase> — <reason>`, and the phase must be one the design spec section 11 names). Report the three counts before writing any test — that number is what tells us whether this is one increment or six.

**Do not reclassify a row merely to make the number fall.** A server MUST that P1 genuinely does not satisfy stays `gap` and becomes a visible, honest decision about the phase's completion — which is the whole reason the apparatus exists.

Six consecutive tasks each marked a row `covered` against a test proving something else. Every row marked here gets its requirement text read against the assertion that is supposed to prove it.

- [ ] **Step 5: Drive the gap count to zero**

```bash
pnpm trace
```

Every remaining `gap` is either a missing test — write it — or genuinely out of scope, in which case it becomes a `deferred:` row naming the phase, cross-checked against the spec's section 11. **No row may be reclassified merely to make the number go down**; if a MUST is unimplemented and in scope, implement it.

- [ ] **Step 6: Turn strict mode on permanently**

Root `package.json`:

```json
"trace": "vitest run --reporter=json --outputFile=trace-report.json && ODUDU_TRACE_STRICT=1 node tools/trace/src/index.ts trace-report.json"
```

Run `pnpm verify`. It must pass. From here, a new MUST row with no test fails the build.

---

### Task 21: Documentation and the phase gate

What a reader needs in order to run P1, and the countable confirmation that it is done.

- [ ] **Step A: Document the request surface**

Update `README.md` with every supported request path, how to run them, how they fit together, and what follows from each — the complete flow of the P1 state, runnable by someone new to the repository. A separate linked markdown document is preferable to bloating the README; the README must link it prominently.

Cover at minimum: the five endpoints and the login submission path; the seed command and its flags; how to obtain a token end to end with real commands; what each grant is for; and what P1 deliberately does not implement.

- [ ] **Step B: Update the published request-path walkthrough**

The artifact at https://claude.ai/code/artifact/029aaa24-d96b-4b6b-97a9-51d4d0ddfb45 was written before any of this existed and its commands are intended-shape, not verified output. Bring it to the current testable state: scopes are `openid`, `profile` and `email`; the login posts to `/realms/{realm}/login-actions/authenticate`; `client_secret_post` is supported; access tokens always carry the issuer in `aud`; and every command should be one that actually runs.

- [ ] **Step 7: Confirm every exit criterion, one at a time**

Do not tick any of these from memory — run the command and paste the result into the commit message:

| #   | Criterion                            | Command                                                                                            |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 1   | verify green including trace         | `pnpm verify`                                                                                      |
| 2   | zero gaps                            | `pnpm trace`                                                                                       |
| 3   | Config OP green in CI                | the `conformance` job                                                                              |
| 4   | Basic OP green with export           | committed results file                                                                             |
| 5   | `client_credentials` proven          | `npx vitest run --project integration packages/protocol-oidc/tests/client-credentials.int.test.ts` |
| 6   | adversarial entries green            | `npx vitest run --project integration -t adversarial`                                              |
| 7   | every table has a policy and a probe | `npx vitest run --project integration packages/db/tests/tenant-tables.int.test.ts`                 |
| 8   | container end-to-end exchange        | `./infra/docker/smoke.sh`                                                                          |

- [ ] **Step 8: Update `docs/NEXT.md`**

Rewrite the "Start here" block for P2. Carry forward, at minimum: the TLS decision and its consequences, the key rotation operation still owed, the `user_credentials.type` constraint that P2 widens, anything the conformance run revealed, and any row still marked `deferred`.

- [ ] **Step 9: Final commit**

```bash
git add infra/conformance .github docs package.json
git commit -m "Close P1: conformance run, and traceability made strict"
```

Full message body:

```
Config OP runs unattended in CI; Basic OP is a documented, reproducible run
with its results exported and committed. The suite version and the TLS
finding are both recorded rather than left to whoever next runs it.

pnpm trace is now strict: an in-scope MUST with no passing test fails the
build. "P1 is done" is a number CI computes, not a judgement.
```

---

## Self-review

Run against the spec after the plan was written.

**1. Spec coverage.** Every decision in spec section 2 maps to a task: 2.1 clients forward (Task 8, 11), 2.2 and 2.3 traced set (Tasks 1–4), 2.4 flow executor and Argon2 (Tasks 9, 10), 2.5 RFC 9068 tokens (Tasks 7, 14), 2.6 seed CLI (Task 17), 2.7 multi-key shape (Task 6), 2.8 conformance (Task 19). Section 3's six packages are Tasks 6–12. All eleven tables in section 4 appear in migrations 0003–0009. The eight pipeline stages are Task 14. Section 6's tooling is Task 1. Section 7's nine corpus entries are distributed across Tasks 7, 12, 14, 15, 16 and 18. All eight exit criteria are checked individually in Task 19 Step 7.

**2. Gaps found and closed during review.**

- The spec's §7 lists audience confusion and cross-realm leakage among the corpus entries, but neither had a natural home in an endpoint task. Task 18 was given both explicitly rather than leaving them to fall between tasks.
- `client_oidc_config` was in the file structure but had no migration. Added to Task 11.
- Nothing created the first signing key, so a seeded realm could not issue a token. Added to Task 17's first test.
- The spec's §9 spike table says spike 5 (Zod→ajv on form bodies) hosts in Task 14, but Task 11 registers `@fastify/formbody` first. The spike stays in Task 14, where the first form-encoded _body schema_ is written; Task 11 only registers the plugin.

**3. Type consistency.** `RealmScopedDatabase`, `withRealm` and `createAppRole` match the existing exports in `packages/db/src/index.ts` and `packages/testkit/src/index.ts` — verified by reading those files, not assumed. `SigningKeyRecord` is defined in Task 6 and consumed with the same member names in Tasks 7, 11 and 16. `ClientRecord` (Task 8) and `ClientOidcConfig` (Task 11) are separate types throughout, never conflated. `PendingRequest` is defined in Task 10 and produced by Task 12's `AuthorizeOutcome`. `AuthenticatorResult` uses `kind` as its discriminant, matching `AuthorizeOutcome` and `RotationOutcome`.

**4. One deliberate inconsistency, flagged rather than fixed.** Task 8's `verifyClientSecret` takes its comparison function by injection because `domain-realm` must not import `domain-identity`. An implementer reading Task 8 alone may find the third parameter odd; the comment in the code says why, and Task 14 is where the real Argon2id comparator is passed in.

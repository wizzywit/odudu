# P0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A monorepo that type-checks, lints, enforces its own architectural boundaries, migrates a real PostgreSQL database, and boots an empty Fastify server in a container — all provable with one command.

**Architecture:** pnpm workspaces with package boundaries enforced by workspace manifests and `dependency-cruiser`. A `kernel` package supplies configuration, an injectable clock, ID generation, an error taxonomy, and the module registry that later becomes the plugin system. A `db` package owns connection and one ordered migration timeline. `apps/server` is a thin composer that registers kernel modules and exposes health endpoints.

**Tech Stack:** Node 24, TypeScript 6.0.3, pnpm 12.3.4, Turborepo 2.10.12, Fastify 5.12.3, PostgreSQL 17, Drizzle ORM 0.45.2, Zod 4.6.1, Vitest 5.0.0, Testcontainers 12.1.0, ESLint 10.10.0 with typescript-eslint 8.70.0, Prettier 3.9.6, dependency-cruiser 18.2.0, pino 10.3.1.

**Spec:** `docs/superpowers/specs/2026-09-10-odudu-design.md`

## Global Constraints

- Node `>=24.0.0`. Enforced by `engines` plus `engine-strict=true`.
- **TypeScript is pinned to 6.0.3, not 7.x.** typescript-eslint 8.70.0 declares `typescript: ">=4.8.4 <6.1.0"`. Installing TypeScript 7 silently disables type-aware linting, which is the entire justification for ADR 0008. Task 1 records this as ADR 0012.
- Every dependency version in this plan is exact, no ranges. Verified against the registry on 2026-09-10.
- ESM only. `"type": "module"` everywhere, `verbatimModuleSyntax` on.
- **Intra-package imports use Node subpath imports, never relative paths.**
  Each package declares `"imports": { "#/*": "./src/*.ts" }`, and code inside it
  imports as `#/clock`. Relative specifiers (`./`, `../`) are forbidden in
  `packages/*/src` and `apps/*/src`. Cross-package imports use the package
  name (`@odudu/kernel`) and resolve only through that package's `index.ts`.
  See ADR 0013. The `tests/boundaries/fixtures` tree keeps its relative
  imports — they exist to trigger boundary violations, and the `boundaries`
  CLI run never scans `tests/`.
- Comments carry only what the code cannot express. Where none is needed, write none. (`CLAUDE.md`)
- Commit messages contain no `Co-Authored-By` or tool-attribution trailers.
- Test-driven: the failing test is written and observed failing before implementation.
- Integration tests run against real PostgreSQL via Testcontainers, never a mock.
- Domain packages never import protocol packages. Protocol packages never import each other.
- Layer imports follow ADR 0010: `view` → own model and `shared/view`; `usecase` → repository, service, view models; `repository` → adapter, service; `adapter` → transport, service; `service` → nothing.
- `SET LOCAL`, never `SET`, for realm context.
- Every task ends with CI green, the branch merged, and `docs/NEXT.md` updated.

## Task budget

| Task | Deliverable                                                         | Hours     |
| ---- | ------------------------------------------------------------------- | --------- |
| 1    | Workspace skeleton, `pnpm verify` green locally                     | 4–6       |
| 2    | GitHub Actions running `pnpm verify`                                | 1–2       |
| 3    | `dependency-cruiser` boundary rules, tested with violating fixtures | 3–4       |
| 4    | `kernel`: config, clock, IDs, errors                                | 3–5       |
| 5    | `kernel`: module registry with lifecycle                            | 2–4       |
| 6    | `db`: connection, migration runner, Testcontainers harness          | 4–6       |
| 7    | Row-level security, `withRealm`, pooled-connection leak test        | 4–5       |
| 8    | `apps/server`: Fastify, health, logging, graceful shutdown          | 3–4       |
| 9    | Dockerfile, compose, container boot proof                           | 3–4       |
|      | **Total**                                                           | **27–40** |

The spec budgeted P0 at 20–30 hours. This plan is above that. The overage is Task 7: proving row-level security and the `SET LOCAL` pooling footgun is real work that the spec's own exit criteria did not name. It is worth doing now — retrofitting tenant isolation onto populated tables is far more expensive — but if hours are tight, Task 7 is the one that could defer to P3 without blocking anything else.

## File Structure

```
odudu/
├─ package.json                      root scripts, shared devDependencies
├─ pnpm-workspace.yaml               workspace globs
├─ .npmrc                            engine-strict
├─ turbo.json                        task graph
├─ tsconfig.base.json                compiler options every package extends
├─ eslint.config.js                  flat config, type-aware
├─ .prettierrc.json / .prettierignore
├─ .dependency-cruiser.cjs           package + layer boundary rules
├─ vitest.config.ts                  unit and integration projects
├─ .env.example
├─ .github/workflows/verify.yml
├─ infra/docker/Dockerfile
├─ infra/docker/compose.yaml
├─ packages/
│  ├─ kernel/
│  │  ├─ package.json, tsconfig.json
│  │  └─ src/
│  │     ├─ index.ts                 public surface
│  │     ├─ version.ts               pipeline proof (Task 1)
│  │     ├─ errors.ts                OduduError taxonomy
│  │     ├─ clock.ts                 Clock interface, system and fake
│  │     ├─ ids.ts                   UUIDv7 generation
│  │     ├─ config.ts                Zod-validated environment loading
│  │     └─ registry.ts              module registry and lifecycle
│  ├─ db/
│  │  ├─ package.json, tsconfig.json, drizzle.config.ts
│  │  └─ src/
│  │     ├─ index.ts
│  │     ├─ client.ts                postgres.js + Drizzle
│  │     ├─ migrate.ts               migration runner
│  │     ├─ tx.ts                    withRealm, SET LOCAL binding
│  │     └─ schema/
│  │        ├─ index.ts              aggregates every domain slice
│  │        └─ realms.ts             the first slice
│  └─ testkit/
│     ├─ package.json, tsconfig.json
│     └─ src/
│        ├─ index.ts
│        └─ postgres.ts              Testcontainers lifecycle, app role setup
└─ apps/server/
   ├─ package.json, tsconfig.json, tsup.config.ts
   └─ src/
      ├─ main.ts                     process entry, signals
      ├─ app.ts                      buildApp, composes modules
      ├─ context.ts                  correlation id, request context
      └─ health.ts                   /health/live, /health/ready
```

Each file has one responsibility. `kernel` holds no I/O beyond reading `process.env`; `db` holds no domain knowledge; `apps/server` holds no logic.

---

### Task 1: Workspace skeleton and the verify pipeline

**Files:**

- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `turbo.json`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`
- Create: `packages/kernel/package.json`, `packages/kernel/tsconfig.json`, `packages/kernel/src/index.ts`, `packages/kernel/src/version.ts`
- Test: `packages/kernel/src/version.test.ts`
- Create: `docs/adr/0012-typescript-6-not-7.md`

**Interfaces:**

- Consumes: nothing.
- Produces: `pnpm verify` (format check, typecheck, lint, test). Workspace package `@odudu/kernel` resolving to `./src/index.ts`. Every later package copies `packages/kernel/tsconfig.json` verbatim.

`version.ts` is deliberately trivial. Its only job is to prove the pipeline runs end to end before anything real depends on it.

- [ ] **Step 1: Confirm corepack works**

```bash
corepack cache clean
corepack prepare pnpm@12.3.4 --activate
pnpm -v
```

Expected: `12.3.4`. If it fails with `MODULE_NOT_FOUND`, the corepack cache is corrupt; `corepack cache clean` is the fix.

- [ ] **Step 2: Write the root `package.json`**

```json
{
  "name": "odudu",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.3.4",
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "typecheck": "turbo run typecheck",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "verify": "pnpm format:check && pnpm typecheck && pnpm lint && pnpm test"
  },
  "devDependencies": {
    "@types/node": "24.13.4",
    "eslint": "10.10.0",
    "prettier": "3.9.6",
    "turbo": "2.10.12",
    "typescript": "6.0.3",
    "typescript-eslint": "8.70.0",
    "vitest": "5.0.0"
  }
}
```

- [ ] **Step 3: Write `pnpm-workspace.yaml` and `.npmrc`**

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

`.npmrc`:

```
engine-strict=true
```

- [ ] **Step 4: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are both off by default and both catch real bugs in code that handles untrusted input. Turning them on later means fixing hundreds of sites at once.

- [ ] **Step 5: Create the kernel package**

`packages/kernel/package.json`:

```json
{
  "name": "@odudu/kernel",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  }
}
```

`packages/kernel/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

Packages export TypeScript source rather than a build output. Nothing consumes them except Vitest and the bundler, so a per-package build step in P0 would be ceremony. Task 9 bundles for the container.

- [ ] **Step 6: Write the failing test**

`packages/kernel/src/version.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { KERNEL_VERSION } from '#/version';

describe('KERNEL_VERSION', () => {
  it('is a semver string', () => {
    expect(KERNEL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 7: Write `vitest.config.ts`, then run the test to verify it fails**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{packages,apps}/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
```

Then:

```bash
pnpm install
pnpm vitest run
```

Expected: FAIL — `Failed to resolve import "./version.js"`.

- [ ] **Step 8: Write the minimal implementation**

`packages/kernel/src/version.ts`:

```ts
export const KERNEL_VERSION = '0.0.0';
```

`packages/kernel/src/index.ts`:

```ts
export { KERNEL_VERSION } from '#/version';
```

- [ ] **Step 9: Run the test to verify it passes**

```bash
pnpm vitest run
```

Expected: PASS, 1 test.

- [ ] **Step 10: Write `eslint.config.js`**

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.turbo/**', '**/coverage/**'] },
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
```

`projectService: true` is what enables type-aware rules without listing every tsconfig by hand.

- [ ] **Step 11: Write Prettier configuration**

`.prettierrc.json`:

```json
{
  "singleQuote": true,
  "semi": true,
  "printWidth": 100,
  "trailingComma": "all"
}
```

`.prettierignore`:

```
dist
coverage
.turbo
pnpm-lock.yaml
```

- [ ] **Step 12: Write `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "typecheck": { "dependsOn": ["^typecheck"] }
  }
}
```

- [ ] **Step 13: Run the whole pipeline**

```bash
pnpm format
pnpm verify
```

Expected: exit 0. Fix anything Prettier or ESLint reports before continuing.

- [ ] **Step 14: Verify the TypeScript pin is actually load-bearing**

```bash
pnpm why typescript
node -e "console.log(require('typescript/package.json').version)"
```

Expected: `6.0.3`. If it reports 7.x, type-aware linting is silently off and the pin has been broken.

- [ ] **Step 15: Write ADR 0012**

`docs/adr/0012-typescript-6-not-7.md`:

```markdown
# 0012 — TypeScript pinned to 6.x, not 7.x

**Status:** Accepted · 2026-09-10

## Context

TypeScript 7.0.2 is the current release. typescript-eslint 8.70.0 declares
a peer range of `typescript: ">=4.8.4 <6.1.0"`.

## Decision

Pin TypeScript to exactly 6.0.3 until typescript-eslint supports 7.x.

## Rationale

Type-aware linting is the sole reason ESLint was chosen over Biome
(ADR 0008). `no-floating-promises` and `no-misused-promises` catch
unawaited asynchronous work in security-critical paths. Installing
TypeScript 7 does not fail loudly; it disables those rules while the lint
still reports success. That failure mode is worse than a build break.

## Consequences

- The TypeScript 7 native compiler's speed is unavailable for now.
- Task 1 step 14 asserts the resolved version, so an accidental upgrade is
  caught rather than silently degrading the lint.
- Revisit when typescript-eslint widens its peer range.
```

- [ ] **Step 16: Update `docs/NEXT.md`**

```markdown
# Next

**Position:** P0.1 complete. Workspace, tooling, and `pnpm verify` green
locally. No CI yet.

**Next increment:** Task 2 — GitHub Actions running `pnpm verify`.

**Verify:** `pnpm verify` exits zero.

**Blocked on:** nothing.
```

- [ ] **Step 17: Commit**

```bash
git add -A
git commit -m "P0.1: workspace skeleton and verify pipeline

pnpm workspaces, Turborepo, TypeScript 6.0.3, ESLint 10 with type-aware
rules, Prettier, Vitest. @odudu/kernel exists with one passing test to
prove the pipeline end to end.

TypeScript is pinned to 6.0.3 because typescript-eslint 8.70.0 caps at
<6.1.0; TypeScript 7 would silently disable type-aware linting. ADR 0012."
```

---

### Task 2: Continuous integration

**Files:**

- Create: `.github/workflows/verify.yml`

**Interfaces:**

- Consumes: `pnpm verify` from Task 1.
- Produces: a required status check named `verify` on every push and pull request.

- [ ] **Step 1: Write the workflow**

`.github/workflows/verify.yml`:

```yaml
name: verify

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: verify-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7

      - name: Enable corepack
        run: corepack enable

      - uses: actions/setup-node@v7
        with:
          node-version: '24'
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm verify
```

`corepack enable` runs before `setup-node` because `cache: pnpm` needs pnpm on the PATH to locate the store.

- [ ] **Step 2: Confirm the lockfile is committed**

```bash
git ls-files pnpm-lock.yaml
```

Expected: `pnpm-lock.yaml`. Without it `--frozen-lockfile` fails on the runner.

- [ ] **Step 3: Push and watch the run**

```bash
git add .github/workflows/verify.yml
git commit -m "P0.2: run pnpm verify in CI on every push and pull request"
git push
gh run watch --exit-status
```

Expected: the run completes green.

- [ ] **Step 4: Prove the check actually fails on a bad commit**

```bash
git checkout -b ci-negative-check
printf 'export const broken: number = "not a number";\n' > packages/kernel/src/broken.ts
git add packages/kernel/src/broken.ts
git commit -m "temp: prove CI catches a type error"
git push -u origin ci-negative-check
gh run watch --exit-status
```

Expected: FAIL at the typecheck step. A CI pipeline nobody has watched fail is not known to work.

- [ ] **Step 5: Delete the negative check**

```bash
git checkout main
git branch -D ci-negative-check
git push origin --delete ci-negative-check
```

- [ ] **Step 6: Update `docs/NEXT.md` and commit**

Set **Position** to "P0.2 complete, CI green and proven to fail on a type error" and **Next increment** to "Task 3 — dependency-cruiser boundary rules".

```bash
git add docs/NEXT.md
git commit -m "P0.2: record CI completion in NEXT"
git push
```

---

### Task 3: Boundary enforcement

**Files:**

- Create: `.dependency-cruiser.cjs`
- Create: `tests/boundaries/fixtures/packages/domain-example/src/leak.ts`
- Create: `tests/boundaries/fixtures/packages/protocol-example/src/thing.ts`
- Create: `tests/boundaries/fixtures/packages/domain-example/src/view/bad-view.ts`
- Create: `tests/boundaries/fixtures/packages/domain-example/src/adapter/some-adapter.ts`
- Test: `tests/boundaries/boundaries.test.ts`
- Modify: root `package.json` — add `boundaries` script and include it in `verify`
- Modify: `.prettierignore`, `eslint.config.js`, `vitest.config.ts` — exclude the fixture tree

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `pnpm boundaries`, and a `.dependency-cruiser.cjs` whose `forbidden` array later tasks extend as new packages appear.

The fixtures are code that is _supposed_ to violate the rules. A linter nobody has watched reject something is not known to work.

- [ ] **Step 1: Install dependency-cruiser**

```bash
pnpm add -Dw dependency-cruiser@18.2.0
```

- [ ] **Step 2: Write the failing test**

`tests/boundaries/boundaries.test.ts`:

```ts
import { cruise } from 'dependency-cruiser';
import { describe, expect, it } from 'vitest';
import config from '../../.dependency-cruiser.cjs';

const FIXTURES = 'tests/boundaries/fixtures';

async function violations(rule: string): Promise<number> {
  const result = await cruise([FIXTURES], { ...config.options, ruleSet: config });
  if (typeof result.output === 'string') throw new Error('expected structured output');
  return result.output.summary.violations.filter((v) => v.rule.name === rule).length;
}

describe('boundary rules', () => {
  it('rejects a domain package importing a protocol package', async () => {
    expect(await violations('no-domain-to-protocol')).toBeGreaterThan(0);
  });

  it('rejects a view importing an adapter', async () => {
    expect(await violations('no-view-to-adapter')).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Write the fixtures**

`tests/boundaries/fixtures/packages/protocol-example/src/thing.ts`:

```ts
export const thing = 'thing';
```

`tests/boundaries/fixtures/packages/domain-example/src/leak.ts`:

```ts
import { thing } from '../../protocol-example/src/thing.js';

export const leaked = thing;
```

`tests/boundaries/fixtures/packages/domain-example/src/adapter/some-adapter.ts`:

```ts
export const fetched = 'fetched';
```

`tests/boundaries/fixtures/packages/domain-example/src/view/bad-view.ts`:

```ts
import { fetched } from '../adapter/some-adapter.js';

export const rendered = fetched;
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
pnpm vitest run tests/boundaries
```

Expected: FAIL — `Cannot find module '../../.dependency-cruiser.cjs'`.

- [ ] **Step 5: Write `.dependency-cruiser.cjs`**

```cjs
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Cycles make packages impossible to reason about or delete independently.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-domain-to-protocol',
      severity: 'error',
      comment:
        'Users do not know what OIDC is. This is what lets SAML arrive without touching identity.',
      from: { path: '(^|/)packages/domain-[^/]+/' },
      to: { path: '(^|/)packages/protocol-[^/]+/' },
    },
    {
      name: 'no-protocol-to-protocol',
      severity: 'error',
      comment: 'Protocols stay independently testable and independently deletable.',
      from: { path: '(^|/)packages/protocol-([^/]+)/' },
      to: { path: '(^|/)packages/protocol-(?!\\1)[^/]+/' },
    },
    {
      name: 'no-view-to-repository',
      severity: 'error',
      from: { path: '/src/(.+/)?view/' },
      to: { path: '/src/(.+/)?repository/' },
    },
    {
      name: 'no-view-to-adapter',
      severity: 'error',
      from: { path: '/src/(.+/)?view/' },
      to: { path: '/src/(.+/)?adapter/' },
    },
    {
      name: 'no-usecase-to-adapter',
      severity: 'error',
      from: { path: '/src/(.+/)?usecase/' },
      to: { path: '/src/(.+/)?adapter/' },
    },
    {
      name: 'service-is-a-leaf',
      severity: 'error',
      comment: 'service holds domain logic and depends on no other layer.',
      from: { path: '/src/(.+/)?service/' },
      to: { path: '/src/(.+/)?(view|usecase|repository|adapter)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'default'] },
  },
};
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm vitest run tests/boundaries
```

Expected: PASS, 2 tests.

- [ ] **Step 7: Wire `boundaries` into `verify` and exclude fixtures everywhere**

In root `package.json`, add the script and extend `verify`:

```json
{
  "scripts": {
    "boundaries": "depcruise --config .dependency-cruiser.cjs apps packages",
    "verify": "pnpm format:check && pnpm typecheck && pnpm lint && pnpm boundaries && pnpm test"
  }
}
```

`boundaries` scans only `apps` and `packages`, so the deliberately-broken fixtures are never linted by the CLI run. Add `tests/boundaries/fixtures` to the `ignores` array in `eslint.config.js` and to `.prettierignore` for the same reason.

The boundary test lives under `tests/`, which Task 1's Vitest glob does not match. Widen `include` in `vitest.config.ts`:

```ts
    include: ['{packages,apps}/*/src/**/*.test.ts', 'tests/**/*.test.ts'],
```

The fixtures are named `.ts`, not `.test.ts`, so they are picked up as modules to cruise but never executed as tests.

- [ ] **Step 8: Run the full pipeline**

```bash
pnpm verify
```

Expected: exit 0.

- [ ] **Step 9: Update `docs/NEXT.md` and commit**

```bash
git add -A
git commit -m "P0.3: enforce package and layer boundaries

dependency-cruiser rules for the package graph (domain must not reach
protocol, protocols must not reach each other) and the five-layer import
direction from ADR 0010. Fixtures under tests/boundaries deliberately
violate two of the rules so the enforcement itself is under test."
git push
```

---

### Task 4: Kernel primitives — errors, clock, IDs, configuration

**Files:**

- Create: `packages/kernel/src/errors.ts`, `packages/kernel/src/clock.ts`, `packages/kernel/src/ids.ts`, `packages/kernel/src/config.ts`, `packages/kernel/src/logger.ts`
- Test: `packages/kernel/src/clock.test.ts`, `packages/kernel/src/ids.test.ts`, `packages/kernel/src/config.test.ts`
- Modify: `packages/kernel/src/index.ts`, `packages/kernel/package.json`
- Create: `.env.example`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `class OduduError extends Error` with `readonly code: ErrorCode`
  - `interface Clock { now(): Date }`, `const systemClock: Clock`, `class FakeClock implements Clock` with `advance(ms: number): void` and `set(at: Date): void`
  - `function newId(): string` — UUIDv7
  - `type Config` and `function loadConfig(env?: NodeJS.ProcessEnv): Config`
  - `interface Logger` — kernel owns the interface; `apps/server` supplies pino

The clock is injectable so that key rotation and token lifetimes are testable in milliseconds rather than days. `Logger` lives here as an interface so that no package below `apps/server` depends on pino.

- [ ] **Step 1: Add dependencies**

```bash
pnpm --filter @odudu/kernel add zod@4.6.1 uuidv7@1.2.1
```

- [ ] **Step 2: Write `errors.ts`**

```ts
export type ErrorCode =
  | 'config_invalid'
  | 'module_duplicate'
  | 'module_unknown_dependency'
  | 'module_cycle'
  | 'module_stop_failed'
  | 'realm_context_missing';

export class OduduError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OduduError';
    this.code = code;
  }
}
```

- [ ] **Step 3: Write the failing clock test**

`packages/kernel/src/clock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FakeClock, systemClock } from '#/clock';

describe('FakeClock', () => {
  it('does not move on its own', () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const first = clock.now();
    const second = clock.now();
    expect(second.getTime()).toBe(first.getTime());
  });

  it('advances by the given milliseconds', () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    clock.advance(90_000);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:01:30.000Z');
  });

  it('returns a copy, so callers cannot mutate the clock', () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    clock.now().setFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });
});

describe('systemClock', () => {
  it('is close to the real time', () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1_000);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

```bash
pnpm vitest run packages/kernel/src/clock.test.ts
```

Expected: FAIL — cannot resolve `./clock.js`.

- [ ] **Step 5: Write `clock.ts`**

```ts
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export class FakeClock implements Clock {
  #current: Date;

  constructor(start: Date) {
    this.#current = new Date(start);
  }

  now(): Date {
    return new Date(this.#current);
  }

  advance(ms: number): void {
    this.#current = new Date(this.#current.getTime() + ms);
  }

  set(at: Date): void {
    this.#current = new Date(at);
  }
}
```

- [ ] **Step 6: Run to verify it passes**

```bash
pnpm vitest run packages/kernel/src/clock.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Write the failing ID test**

`packages/kernel/src/ids.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { newId } from '#/ids';

describe('newId', () => {
  it('produces a UUID with version nibble 7', () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('produces distinct values', () => {
    const ids = new Set(Array.from({ length: 1_000 }, () => newId()));
    expect(ids.size).toBe(1_000);
  });

  it('sorts lexicographically in creation order', () => {
    const ids = Array.from({ length: 100 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
  });
});
```

The third test is the reason UUIDv7 was chosen over v4: lexicographic order matches time order, so B-tree inserts stay at the right edge instead of fragmenting the index.

- [ ] **Step 8: Run to verify it fails**

```bash
pnpm vitest run packages/kernel/src/ids.test.ts
```

Expected: FAIL — cannot resolve `./ids.js`.

- [ ] **Step 9: Write `ids.ts`**

```ts
import { uuidv7 } from 'uuidv7';

export function newId(): string {
  return uuidv7();
}
```

- [ ] **Step 10: Run to verify it passes**

```bash
pnpm vitest run packages/kernel/src/ids.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 11: Write the failing config test**

`packages/kernel/src/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '#/config';
import { OduduError } from '#/errors';

const minimal = { ODUDU_DATABASE_URL: 'postgres://user:pw@localhost:5432/odudu' };

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(minimal);
    expect(config.ODUDU_HTTP_PORT).toBe(3000);
    expect(config.ODUDU_HTTP_HOST).toBe('0.0.0.0');
    expect(config.ODUDU_LOG_LEVEL).toBe('info');
    expect(config.NODE_ENV).toBe('development');
  });

  it('coerces the port from a string', () => {
    expect(loadConfig({ ...minimal, ODUDU_HTTP_PORT: '8080' }).ODUDU_HTTP_PORT).toBe(8080);
  });

  it('rejects a missing database url', () => {
    expect(() => loadConfig({})).toThrow(OduduError);
  });

  it('names every offending key in the message', () => {
    try {
      loadConfig({ ODUDU_DATABASE_URL: 'not-a-url', ODUDU_HTTP_PORT: '70000' });
      expect.unreachable('loadConfig should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(OduduError);
      const message = (error as OduduError).message;
      expect(message).toContain('ODUDU_DATABASE_URL');
      expect(message).toContain('ODUDU_HTTP_PORT');
    }
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(loadConfig(minimal))).toBe(true);
  });
});
```

Reporting every invalid key at once matters operationally: an admin fixing a misconfigured deployment should not discover the problems one restart at a time.

- [ ] **Step 12: Run to verify it fails**

```bash
pnpm vitest run packages/kernel/src/config.test.ts
```

Expected: FAIL — cannot resolve `./config.js`.

- [ ] **Step 13: Write `config.ts`**

```ts
import { z } from 'zod';
import { OduduError } from '#/errors';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ODUDU_HTTP_HOST: z.string().min(1).default('0.0.0.0'),
  ODUDU_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  ODUDU_DATABASE_URL: z.url(),
  ODUDU_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

export type Config = Readonly<z.infer<typeof schema>>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new OduduError('config_invalid', `Invalid configuration — ${detail}`);
  }

  return Object.freeze(parsed.data);
}
```

- [ ] **Step 14: Run to verify it passes**

```bash
pnpm vitest run packages/kernel/src/config.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 15: Write `logger.ts`**

```ts
export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}
```

- [ ] **Step 16: Export everything from `index.ts`**

```ts
export { KERNEL_VERSION } from '#/version';
export { OduduError, type ErrorCode } from '#/errors';
export { type Clock, systemClock, FakeClock } from '#/clock';
export { newId } from '#/ids';
export { type Config, loadConfig } from '#/config';
export { type Logger } from '#/logger';
```

- [ ] **Step 17: Write `.env.example`**

```
NODE_ENV=development
ODUDU_HTTP_HOST=0.0.0.0
ODUDU_HTTP_PORT=3000
ODUDU_DATABASE_URL=postgres://odudu:odudu@localhost:5432/odudu
ODUDU_LOG_LEVEL=info
```

- [ ] **Step 18: Run the full pipeline**

```bash
pnpm verify
```

Expected: exit 0.

- [ ] **Step 19: Update `docs/NEXT.md` and commit**

```bash
git add -A
git commit -m "P0.4: kernel primitives

Error taxonomy, injectable clock with a fake for tests, UUIDv7 ids,
Zod-validated configuration reporting every offending key at once, and a
Logger interface so nothing below apps/server depends on pino."
git push
```

---

### Task 5: Kernel module registry

**Files:**

- Create: `packages/kernel/src/registry.ts`
- Test: `packages/kernel/src/registry.test.ts`
- Modify: `packages/kernel/src/index.ts`

**Interfaces:**

- Consumes: `Config`, `Clock`, `Logger`, `OduduError` from Task 4.
- Produces:
  - `interface ModuleContext { readonly config: Config; readonly clock: Clock; readonly logger: Logger }`
  - `interface OduduModule { readonly name: string; readonly dependsOn?: readonly string[]; start?(ctx: ModuleContext): Promise<void>; stop?(): Promise<void> }`
  - `class ModuleRegistry` with `register(module: OduduModule): this`, `start(ctx: ModuleContext): Promise<void>`, `stop(): Promise<void>`

This is the seed of the plugin system. Because `apps/server` composes itself from registered modules from day one, third-party extensibility in P10 becomes "let others register too" rather than a rewrite (ADR 0003, spec §8).

- [ ] **Step 1: Write the failing test**

`packages/kernel/src/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FakeClock } from '#/clock';
import { loadConfig } from '#/config';
import { OduduError } from '#/errors';
import { type Logger } from '#/logger';
import { ModuleRegistry, type OduduModule } from '#/registry';

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

function context() {
  return {
    config: loadConfig({ ODUDU_DATABASE_URL: 'postgres://u:p@localhost:5432/odudu' }),
    clock: new FakeClock(new Date('2026-01-01T00:00:00.000Z')),
    logger: noopLogger,
  };
}

function recorder(name: string, log: string[], dependsOn?: readonly string[]): OduduModule {
  return {
    name,
    ...(dependsOn ? { dependsOn } : {}),
    start: async () => {
      log.push(`start:${name}`);
    },
    stop: async () => {
      log.push(`stop:${name}`);
    },
  };
}

describe('ModuleRegistry', () => {
  it('starts modules in dependency order', async () => {
    const log: string[] = [];
    const registry = new ModuleRegistry()
      .register(recorder('http', log, ['db']))
      .register(recorder('db', log));

    await registry.start(context());

    expect(log).toEqual(['start:db', 'start:http']);
  });

  it('stops modules in reverse start order', async () => {
    const log: string[] = [];
    const registry = new ModuleRegistry()
      .register(recorder('http', log, ['db']))
      .register(recorder('db', log));

    await registry.start(context());
    log.length = 0;
    await registry.stop();

    expect(log).toEqual(['stop:http', 'stop:db']);
  });

  it('rejects a duplicate module name', () => {
    const registry = new ModuleRegistry().register({ name: 'db' });
    expect(() => registry.register({ name: 'db' })).toThrow(OduduError);
  });

  it('rejects an unknown dependency', async () => {
    const registry = new ModuleRegistry().register({ name: 'http', dependsOn: ['nope'] });
    await expect(registry.start(context())).rejects.toThrow(/nope/);
  });

  it('rejects a dependency cycle', async () => {
    const registry = new ModuleRegistry()
      .register({ name: 'a', dependsOn: ['b'] })
      .register({ name: 'b', dependsOn: ['a'] });
    await expect(registry.start(context())).rejects.toThrow(/cycle/i);
  });

  it('stops every remaining module even when one throws', async () => {
    const log: string[] = [];
    const registry = new ModuleRegistry().register(recorder('db', log)).register({
      name: 'http',
      dependsOn: ['db'],
      start: async () => {},
      stop: async () => {
        throw new Error('socket stuck');
      },
    });

    await registry.start(context());
    await expect(registry.stop()).rejects.toThrow(OduduError);
    expect(log).toContain('stop:db');
  });
});
```

The last test is the one that matters in production: a module that fails to stop must not strand the modules behind it, or shutdown leaks connections.

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm vitest run packages/kernel/src/registry.test.ts
```

Expected: FAIL — cannot resolve `./registry.js`.

- [ ] **Step 3: Write `registry.ts`**

```ts
import { type Clock } from '#/clock';
import { type Config } from '#/config';
import { OduduError } from '#/errors';
import { type Logger } from '#/logger';

export interface ModuleContext {
  readonly config: Config;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface OduduModule {
  readonly name: string;
  readonly dependsOn?: readonly string[];
  start?(ctx: ModuleContext): Promise<void>;
  stop?(): Promise<void>;
}

export class ModuleRegistry {
  readonly #modules = new Map<string, OduduModule>();
  #started: OduduModule[] = [];

  register(module: OduduModule): this {
    if (this.#modules.has(module.name)) {
      throw new OduduError('module_duplicate', `Module "${module.name}" is already registered`);
    }
    this.#modules.set(module.name, module);
    return this;
  }

  async start(ctx: ModuleContext): Promise<void> {
    for (const module of this.#resolveOrder()) {
      await module.start?.(ctx);
      this.#started.push(module);
      ctx.logger.debug({ module: module.name }, 'module started');
    }
  }

  async stop(): Promise<void> {
    const failures: unknown[] = [];

    for (const module of [...this.#started].reverse()) {
      try {
        await module.stop?.();
      } catch (error) {
        failures.push(error);
      }
    }

    this.#started = [];

    if (failures.length > 0) {
      throw new OduduError('module_stop_failed', `${failures.length} module(s) failed to stop`, {
        cause: new AggregateError(failures),
      });
    }
  }

  #resolveOrder(): OduduModule[] {
    const ordered: OduduModule[] = [];
    const state = new Map<string, 'visiting' | 'done'>();

    const visit = (name: string, trail: readonly string[]): void => {
      if (state.get(name) === 'done') return;

      if (state.get(name) === 'visiting') {
        throw new OduduError(
          'module_cycle',
          `Module dependency cycle: ${[...trail, name].join(' -> ')}`,
        );
      }

      const module = this.#modules.get(name);
      if (!module) {
        throw new OduduError(
          'module_unknown_dependency',
          `Module "${trail.at(-1) ?? name}" depends on unregistered module "${name}"`,
        );
      }

      state.set(name, 'visiting');
      for (const dependency of module.dependsOn ?? []) {
        visit(dependency, [...trail, name]);
      }
      state.set(name, 'done');
      ordered.push(module);
    };

    for (const name of this.#modules.keys()) visit(name, []);

    return ordered;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm vitest run packages/kernel/src/registry.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Export from `index.ts`**

Append to `packages/kernel/src/index.ts`:

```ts
export { ModuleRegistry, type ModuleContext, type OduduModule } from '#/registry';
```

- [ ] **Step 6: Run the full pipeline**

```bash
pnpm verify
```

Expected: exit 0.

- [ ] **Step 7: Update `docs/NEXT.md` and commit**

```bash
git add -A
git commit -m "P0.5: module registry with topological start and reverse stop

Cycles and unknown dependencies fail at start rather than at runtime.
Shutdown continues past a failing module and reports the aggregate, so one
stuck module cannot strand the connections behind it.

This registry is the seed of the plugin system described in spec section 8."
git push
```

---

### Task 6: Database package, migrations, and the Testcontainers harness

**Files:**

- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`
- Create: `packages/db/src/index.ts`, `packages/db/src/client.ts`, `packages/db/src/migrate.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/schema/realms.ts`
- Create: `packages/testkit/package.json`, `packages/testkit/tsconfig.json`, `packages/testkit/src/index.ts`, `packages/testkit/src/postgres.ts`
- Test: `packages/db/src/migrate.int.test.ts`
- Modify: `vitest.config.ts` — add the `integration` project
- Modify: root `package.json` — `test:unit`, `test:integration`
- Modify: `packages/kernel/src/config.ts` — add optional `ODUDU_MIGRATIONS_DIR`
- Generated: `packages/db/drizzle/0000_*.sql`

**Interfaces:**

- Consumes: `newId` from Task 4.
- Produces:
  - `type Database = PostgresJsDatabase<typeof schema>`
  - `interface DatabaseHandle { readonly db: Database; readonly sql: Sql; close(): Promise<void> }`
  - `function createDatabase(url: string, options?: { max?: number }): DatabaseHandle`
  - `const MIGRATIONS_DIR: string`, `function runMigrations(db: Database, folder?: string): Promise<void>`
  - `const realms` — the Drizzle table
  - From `@odudu/testkit`: `interface TestDatabase { adminUrl: string; stop(): Promise<void> }`, `function startTestDatabase(): Promise<TestDatabase>`

Integration tests use a real PostgreSQL container. The bugs that matter in an identity provider live in transaction boundaries and constraints, which a mocked database hides (spec §10).

- [ ] **Step 1: Create the two packages**

`packages/db/package.json`:

```json
{
  "name": "@odudu/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "imports": { "#/*": "./src/*.ts" },
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@odudu/kernel": "workspace:*",
    "drizzle-orm": "0.45.2",
    "postgres": "3.4.9"
  },
  "devDependencies": {
    "drizzle-kit": "0.31.10"
  }
}
```

`packages/testkit/package.json`:

```json
{
  "name": "@odudu/testkit",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "imports": { "#/*": "./src/*.ts" },
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@testcontainers/postgresql": "12.1.0",
    "postgres": "3.4.9"
  }
}
```

Both get the same `tsconfig.json` as `packages/kernel/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

Then:

```bash
pnpm install
```

- [ ] **Step 2: Write the schema slice**

`packages/db/src/schema/realms.ts`:

```ts
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const realms = pgTable('realms', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

`packages/db/src/schema/index.ts`:

```ts
export * from '#/schema/realms';
```

Each domain package will add its own slice here as it arrives. The `db` package aggregates them so there is exactly one ordered migration timeline (spec §3).

- [ ] **Step 3: Write the client**

`packages/db/src/client.ts`:

```ts
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from '#/schema/index';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  readonly sql: Sql;
  close(): Promise<void>;
}

export function createDatabase(url: string, options: { max?: number } = {}): DatabaseHandle {
  const sql = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => {},
  });

  return {
    db: drizzle(sql, { schema }),
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
```

- [ ] **Step 4: Write the migration runner**

`packages/db/src/migrate.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { type Database } from '#/client';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function runMigrations(db: Database, folder: string = MIGRATIONS_DIR): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}
```

`folder` is a parameter rather than always `MIGRATIONS_DIR` because Task 9 bundles the server, which invalidates `import.meta.url` relative paths. The container passes an explicit directory.

`packages/db/src/index.ts`:

```ts
export { createDatabase, type Database, type DatabaseHandle } from '#/client';
export { MIGRATIONS_DIR, runMigrations } from '#/migrate';
export * from '#/schema/index';
```

- [ ] **Step 5: Add `ODUDU_MIGRATIONS_DIR` to the config schema**

In `packages/kernel/src/config.ts`, add to the Zod object:

```ts
  ODUDU_MIGRATIONS_DIR: z.string().min(1).optional(),
```

Add to `packages/kernel/src/config.test.ts`:

```ts
it('leaves the migrations directory unset by default', () => {
  expect(loadConfig(minimal).ODUDU_MIGRATIONS_DIR).toBeUndefined();
});
```

`kernel` cannot import `db`, so the default lives at the call site in `apps/server`.

- [ ] **Step 6: Generate the first migration**

`packages/db/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.ODUDU_DATABASE_URL ?? 'postgres://odudu:odudu@localhost:5432/odudu',
  },
});
```

```bash
pnpm --filter @odudu/db run db:generate
git status --short packages/db/drizzle
```

Expected: a new `packages/db/drizzle/0000_*.sql` plus `meta/` files. Open the SQL and read it — generated migrations are committed artifacts you own, not black boxes.

- [ ] **Step 7: Write the Testcontainers harness**

`packages/testkit/src/postgres.ts`:

```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';

export interface TestDatabase {
  readonly adminUrl: string;
  stop(): Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();

  return {
    adminUrl: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}
```

`packages/testkit/src/index.ts`:

```ts
export { startTestDatabase, type TestDatabase } from '#/postgres';
```

- [ ] **Step 8: Write the failing integration test**

`packages/db/src/migrate.int.test.ts`:

```ts
import { newId } from '@odudu/kernel';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';
import { realms } from '#/schema/index';

let container: TestDatabase;
let handle: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  handle = createDatabase(container.adminUrl);
  await runMigrations(handle.db, MIGRATIONS_DIR);
});

afterAll(async () => {
  await handle.close();
  await container.stop();
});

describe('migrations', () => {
  it('creates the realms table with the expected columns', async () => {
    const rows = await handle.sql<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'realms'
      order by column_name
    `;

    expect(rows.map((row) => row.column_name)).toEqual([
      'created_at',
      'display_name',
      'enabled',
      'id',
      'name',
    ]);
  });

  it('round-trips a realm', async () => {
    await handle.db.insert(realms).values({ id: newId(), name: 'acme' });

    const found = await handle.db.select().from(realms);

    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe('acme');
    expect(found[0]?.enabled).toBe(true);
  });

  it('rejects a duplicate realm name', async () => {
    await expect(handle.db.insert(realms).values({ id: newId(), name: 'acme' })).rejects.toThrow();
  });

  it('is idempotent when run a second time', async () => {
    await expect(runMigrations(handle.db, MIGRATIONS_DIR)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 9: Add the integration project to `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{packages,apps}/*/src/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/*.int.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['{packages,apps}/*/src/**/*.int.test.ts'],
          environment: 'node',
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
```

Containers are slow to start and compete for ports, so integration files run one at a time.

- [ ] **Step 10: Run to verify it fails, then passes**

```bash
docker info > /dev/null || echo "start Docker first"
pnpm vitest run --project integration
```

Expected first run: FAIL if step 6 was skipped (`no migrations found`). With the migration generated: PASS, 4 tests.

- [ ] **Step 11: Split the test scripts**

In root `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run --project unit",
    "test:integration": "vitest run --project integration"
  }
}
```

`verify` keeps calling `pnpm test`, so it now requires a running Docker daemon. Note this in `docs/NEXT.md`.

- [ ] **Step 12: Run the full pipeline**

```bash
pnpm verify
```

Expected: exit 0.

- [ ] **Step 13: Update `docs/NEXT.md` and commit**

```bash
git add -A
git commit -m "P0.6: database package, first migration, Testcontainers harness

Drizzle over postgres.js, one ordered migration timeline aggregated from
per-domain schema slices, and a realms table to prove it. Integration tests
run against real PostgreSQL 17 in a container; pnpm verify now requires a
running Docker daemon."
git push
```

---

### Task 7: Row-level security and the realm transaction helper

**Files:**

- Create: `packages/db/src/tx.ts`
- Create: `packages/db/drizzle/0001_row_level_security.sql` (hand-written)
- Test: `packages/db/src/tx.int.test.ts`
- Modify: `packages/db/src/index.ts`, `packages/testkit/src/postgres.ts`
- Modify: `packages/kernel/src/config.ts` — add optional `ODUDU_APP_DATABASE_URL`

**Interfaces:**

- Consumes: `Database`, `DatabaseHandle`, `createDatabase`, `runMigrations`, `realms` from Task 6; `OduduError` from Task 4.
- Produces:
  - `function withRealm<T>(db: Database, realmId: string, fn: (tx: Database) => Promise<T>): Promise<T>`
  - From `@odudu/testkit`: `function createAppRole(adminUrl: string): Promise<string>` returning a connection URL for the restricted role

This implements ADR 0009. The second test is the whole point of the task: it proves the realm setting does not leak between requests sharing a pooled connection.

- [ ] **Step 1: Hand-write the RLS migration**

`packages/db/drizzle/0001_row_level_security.sql`:

```sql
CREATE ROLE odudu_app NOLOGIN;

GRANT USAGE ON SCHEMA public TO odudu_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO odudu_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO odudu_app;

ALTER TABLE realms ENABLE ROW LEVEL SECURITY;
ALTER TABLE realms FORCE ROW LEVEL SECURITY;

CREATE POLICY realms_isolation ON realms
  USING (id = nullif(current_setting('app.realm_id', true), '')::uuid);
```

Three details that matter:

- `odudu_app` is `NOLOGIN`: it is a group role holding privileges. Deployment creates a login user and grants membership, so no password ever appears in a migration.
- `FORCE ROW LEVEL SECURITY` subjects the table owner to the policy too. Superusers still bypass RLS entirely, which is why tests must connect as a non-superuser.
- `current_setting('app.realm_id', true)` returns `NULL` only the first time a backend touches the GUC. Once `set_config` has run on a connection the value reverts to `''` — not `NULL` — at transaction end, for the rest of that connection's life, and casting `''` to `uuid` raises `22P02` instead of filtering. `nullif` collapses both cases to `NULL` before the cast. **Unset context then means zero rows — not all rows, and not an error** — so the policy fails closed.

Register it with drizzle-kit's journal:

```bash
pnpm --filter @odudu/db run db:generate
```

Expected: drizzle-kit picks up the hand-written file and appends it to `drizzle/meta/_journal.json`. If it does not, add the entry by hand and re-run the Task 6 idempotency test to confirm the runner applies it exactly once.

- [ ] **Step 2: Extend the testkit with the restricted role**

Append to `packages/testkit/src/postgres.ts`:

```ts
import postgres from 'postgres';

export async function createAppRole(adminUrl: string): Promise<string> {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });

  try {
    await admin`CREATE USER odudu_svc LOGIN PASSWORD 'odudu_svc'`;
    await admin`GRANT odudu_app TO odudu_svc`;
  } finally {
    await admin.end({ timeout: 5 });
  }

  const url = new URL(adminUrl);
  url.username = 'odudu_svc';
  url.password = 'odudu_svc';
  return url.toString();
}
```

Export it from `packages/testkit/src/index.ts`.

- [ ] **Step 3: Write the failing test**

`packages/db/src/tx.int.test.ts`:

```ts
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';
import { realms } from '#/schema/index';
import { withRealm } from '#/tx';

const REALM_A = newId();
const REALM_B = newId();

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);

  await owner.db.insert(realms).values([
    { id: REALM_A, name: 'alpha' },
    { id: REALM_B, name: 'bravo' },
  ]);

  const appUrl = await createAppRole(container.adminUrl);
  app = createDatabase(appUrl, { max: 1 });
});

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

describe('withRealm', () => {
  it('sees only the bound realm', async () => {
    const rows = await withRealm(app.db, REALM_A, async (tx) => tx.select().from(realms));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('alpha');
  });

  it('does not leak realm context to the next query on a pooled connection', async () => {
    await withRealm(app.db, REALM_A, async (tx) => tx.select().from(realms));

    const rows = await app.db.select().from(realms);

    expect(rows).toEqual([]);
  });

  it('cannot update another realm', async () => {
    await withRealm(app.db, REALM_A, async (tx) => {
      await tx.update(realms).set({ displayName: 'hijacked' }).where(eq(realms.id, REALM_B));
    });

    const [bravo] = await owner.db.select().from(realms).where(eq(realms.id, REALM_B));

    expect(bravo?.displayName).toBeNull();
  });

  it('rejects an empty realm id', async () => {
    await expect(withRealm(app.db, '', async () => undefined)).rejects.toThrow(OduduError);
  });
});
```

Add the imports the test needs at the top:

```ts
import { OduduError } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
```

The pool is `max: 1` on purpose. With a single connection, a session-scoped `SET` would survive into the next query and the second test would return a row. That test is the regression guard the spec calls for.

- [ ] **Step 4: Run to verify it fails**

```bash
pnpm vitest run --project integration packages/db/src/tx.int.test.ts
```

Expected: FAIL — cannot resolve `./tx.js`.

- [ ] **Step 5: Write `tx.ts`**

```ts
import { OduduError } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { type Database } from '#/client';

export async function withRealm<T>(
  db: Database,
  realmId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  if (realmId.length === 0) {
    throw new OduduError('realm_context_missing', 'withRealm requires a realm id');
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.realm_id', ${realmId}, true)`);
    return fn(tx as unknown as Database);
  });
}
```

`set_config(..., true)` is `SET LOCAL` with a bindable parameter — `SET LOCAL` itself does not accept parameters, and string-interpolating a realm id into DDL would be an injection site.

- [ ] **Step 6: Run to verify it passes**

```bash
pnpm vitest run --project integration packages/db/src/tx.int.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Prove the test would catch the mistake**

Temporarily change `true` to `false` in `set_config`:

```bash
pnpm vitest run --project integration packages/db/src/tx.int.test.ts
```

Expected: FAIL on "does not leak realm context". Revert to `true` and confirm green. A regression test nobody has watched fail is not known to work.

- [ ] **Step 8: Add the runtime database URL to the config schema**

In `packages/kernel/src/config.ts`:

```ts
  ODUDU_APP_DATABASE_URL: z.url().optional(),
```

`ODUDU_DATABASE_URL` is the owner connection used for migrations. `ODUDU_APP_DATABASE_URL` is the restricted connection used to serve requests; when unset, the owner connection is used and row-level security is bypassed. Task 9's compose file sets both.

Add to `packages/kernel/src/config.test.ts`:

```ts
it('leaves the application database url unset by default', () => {
  expect(loadConfig(minimal).ODUDU_APP_DATABASE_URL).toBeUndefined();
});
```

- [ ] **Step 9: Export and run the full pipeline**

Append to `packages/db/src/index.ts`:

```ts
export { withRealm } from '#/tx';
```

```bash
pnpm verify
```

Expected: exit 0.

- [ ] **Step 10: Update `docs/NEXT.md` and commit**

```bash
git add -A
git commit -m "P0.7: row-level security and the realm transaction helper

Tenant tables force RLS against a non-superuser role; an unset realm
context yields zero rows rather than every row. withRealm binds the realm
with set_config(..., true), the bindable form of SET LOCAL.

The load-bearing test uses a single pooled connection and asserts the realm
setting does not survive the transaction. Flipping the local flag to false
makes it fail, which was verified by hand."
git push
```

---

### Task 8: The server application

**Files:**

- Create: `apps/server/package.json`, `apps/server/tsconfig.json`
- Create: `apps/server/src/logger.ts`, `apps/server/src/health.ts`, `apps/server/src/app.ts`, `apps/server/src/main.ts`
- Create: `apps/server/src/modules/database.ts`, `apps/server/src/modules/http.ts`
- Test: `apps/server/src/health.test.ts`, `apps/server/src/logger.test.ts`

**Interfaces:**

- Consumes: `loadConfig`, `newId`, `systemClock`, `ModuleRegistry`, `type OduduModule`, `type Logger` from Tasks 4–5; `createDatabase`, `type DatabaseHandle`, `runMigrations`, `MIGRATIONS_DIR` from Task 6.
- Produces:
  - `function createLogger(config: Config, destination?: DestinationStream): PinoLogger`
  - `function buildApp(deps: { database: DatabaseHandle; logger: PinoLogger }): FastifyInstance`
  - `function databaseModule(owner: DatabaseHandle, runtime: DatabaseHandle): OduduModule`
  - `function httpModule(app: FastifyInstance): OduduModule`

The server composes itself from registered modules rather than wiring things inline. That is what makes P10's plugin system additive (spec §8), and it is why Task 5 exists.

- [ ] **Step 1: Create the package**

`apps/server/package.json`:

```json
{
  "name": "@odudu/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "imports": { "#/*": "./src/*.ts" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "dev": "node --watch src/main.ts"
  },
  "dependencies": {
    "@odudu/db": "workspace:*",
    "@odudu/kernel": "workspace:*",
    "close-with-grace": "2.5.0",
    "fastify": "5.12.3",
    "pino": "10.3.1"
  },
  "devDependencies": {
    "pino-pretty": "13.1.3"
  }
}
```

`apps/server/tsconfig.json` is the same three lines as the other packages. Then `pnpm install`.

- [ ] **Step 2: Write the failing logger test**

`apps/server/src/logger.test.ts`:

```ts
import { loadConfig, type Logger } from '@odudu/kernel';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '#/logger';

const config = loadConfig({ ODUDU_DATABASE_URL: 'postgres://u:p@localhost:5432/odudu' });

function capture(): { stream: Writable; lines: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { stream, lines: () => chunks.join('') };
}

describe('createLogger', () => {
  it('redacts the authorization header', () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);

    logger.info({ req: { headers: { authorization: 'Bearer super-secret-token' } } }, 'incoming');

    expect(lines()).not.toContain('super-secret-token');
    expect(lines()).toContain('[redacted]');
  });

  it('redacts the cookie header', () => {
    const { stream, lines } = capture();
    const logger = createLogger(config, stream);

    logger.info({ req: { headers: { cookie: '__Host-alpha-session=abc123' } } }, 'incoming');

    expect(lines()).not.toContain('abc123');
  });

  it('satisfies the kernel Logger interface', () => {
    const kernelLogger: Logger = createLogger(config);
    expect(typeof kernelLogger.child).toBe('function');
  });
});
```

Logging a bearer token is a classic identity-provider incident: tokens end up in log aggregators with far wider access than the token itself was ever meant to have.

- [ ] **Step 3: Run to verify it fails**

```bash
pnpm vitest run apps/server/src/logger.test.ts
```

Expected: FAIL — cannot resolve `./logger.js`.

- [ ] **Step 4: Write `logger.ts`**

```ts
import { type Config } from '@odudu/kernel';
import { pino, type DestinationStream, type Logger as PinoLogger } from 'pino';

export function createLogger(config: Config, destination?: DestinationStream): PinoLogger {
  return pino(
    {
      level: config.ODUDU_LOG_LEVEL,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
      serializers: {
        req: (request: { method: string; url: string; headers: unknown; id: string }) => ({
          id: request.id,
          method: request.method,
          url: request.url,
          headers: request.headers,
        }),
      },
    },
    destination,
  );
}
```

Fastify's default request serializer omits headers entirely, which would make the redaction configuration decorative. Including headers and redacting the sensitive ones is both more useful for debugging and actually exercised by the tests above.

- [ ] **Step 5: Run to verify it passes**

```bash
pnpm vitest run apps/server/src/logger.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing health test**

`apps/server/src/health.test.ts`:

```ts
import { type DatabaseHandle } from '@odudu/db';
import { loadConfig } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { createLogger } from '#/logger';

const config = loadConfig({
  ODUDU_DATABASE_URL: 'postgres://u:p@localhost:5432/odudu',
  ODUDU_LOG_LEVEL: 'silent',
});

function fakeDatabase(behaviour: 'ok' | 'down'): DatabaseHandle {
  const sql = (() => {
    if (behaviour === 'down') return Promise.reject(new Error('connection refused'));
    return Promise.resolve([{ ok: 1 }]);
  }) as unknown as DatabaseHandle['sql'];

  return {
    db: {} as DatabaseHandle['db'],
    sql,
    close: async () => {},
  };
}

function app(behaviour: 'ok' | 'down') {
  return buildApp({
    database: fakeDatabase(behaviour),
    logger: createLogger(loadConfig({ ODUDU_DATABASE_URL: config.ODUDU_DATABASE_URL })),
  });
}

describe('health endpoints', () => {
  it('reports live without touching the database', async () => {
    const response = await app('down').inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('reports ready when the database answers', async () => {
    const response = await app('ok').inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });

  it('reports 503 when the database does not answer', async () => {
    const response = await app('down').inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'unavailable',
      checks: { database: 'failed' },
    });
  });

  it('echoes a correlation id', async () => {
    const response = await app('ok').inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'given-id' },
    });

    expect(response.headers['x-request-id']).toBe('given-id');
  });

  it('generates a correlation id when none is supplied', async () => {
    const response = await app('ok').inject({ method: 'GET', url: '/health/live' });

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

The first test is the important one. **Liveness must not depend on the database**, or a brief database outage causes the orchestrator to kill every healthy process and turn a recoverable incident into an outage.

- [ ] **Step 7: Run to verify it fails**

```bash
pnpm vitest run apps/server/src/health.test.ts
```

Expected: FAIL — cannot resolve `./app.js`.

- [ ] **Step 8: Write `health.ts` and `app.ts`**

`apps/server/src/health.ts`:

```ts
import { type DatabaseHandle } from '@odudu/db';
import { type FastifyInstance } from 'fastify';

export function registerHealth(app: FastifyInstance, deps: { database: DatabaseHandle }): void {
  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await deps.database.sql`select 1`;
      return { status: 'ok', checks: { database: 'ok' } };
    } catch (error) {
      app.log.warn({ err: error }, 'readiness check failed');
      return reply.code(503).send({ status: 'unavailable', checks: { database: 'failed' } });
    }
  });
}
```

`apps/server/src/app.ts`:

```ts
import { type DatabaseHandle } from '@odudu/db';
import { newId } from '@odudu/kernel';
import Fastify, { type FastifyInstance } from 'fastify';
import { type Logger as PinoLogger } from 'pino';
import { registerHealth } from '#/health';

export interface AppDeps {
  readonly database: DatabaseHandle;
  readonly logger: PinoLogger;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    loggerInstance: deps.logger,
    genReqId: () => newId(),
    requestIdHeader: 'x-request-id',
    trustProxy: true,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  registerHealth(app, deps);

  return app;
}
```

- [ ] **Step 9: Run to verify it passes**

```bash
pnpm vitest run apps/server/src/health.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 10: Write the modules**

`apps/server/src/modules/database.ts`:

```ts
import { MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { type OduduModule } from '@odudu/kernel';

export function databaseModule(owner: DatabaseHandle, runtime: DatabaseHandle): OduduModule {
  return {
    name: 'database',

    start: async (ctx) => {
      await runMigrations(owner.db, ctx.config.ODUDU_MIGRATIONS_DIR ?? MIGRATIONS_DIR);
      ctx.logger.info({}, 'migrations applied');
    },

    stop: async () => {
      if (runtime !== owner) await runtime.close();
      await owner.close();
    },
  };
}
```

`apps/server/src/modules/http.ts`:

```ts
import { type OduduModule } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';

export function httpModule(app: FastifyInstance): OduduModule {
  return {
    name: 'http',
    dependsOn: ['database'],

    start: async (ctx) => {
      await app.listen({
        host: ctx.config.ODUDU_HTTP_HOST,
        port: ctx.config.ODUDU_HTTP_PORT,
      });
    },

    stop: async () => {
      await app.close();
    },
  };
}
```

`dependsOn: ['database']` means the socket never opens before migrations have run, so no request can arrive against a half-migrated schema.

- [ ] **Step 11: Write `main.ts`**

```ts
import { createDatabase } from '@odudu/db';
import { loadConfig, ModuleRegistry, systemClock } from '@odudu/kernel';
import closeWithGrace from 'close-with-grace';
import { buildApp } from '#/app';
import { createLogger } from '#/logger';
import { databaseModule } from '#/modules/database';
import { httpModule } from '#/modules/http';

const config = loadConfig();
const logger = createLogger(config);

const owner = createDatabase(config.ODUDU_DATABASE_URL);
const runtime = config.ODUDU_APP_DATABASE_URL
  ? createDatabase(config.ODUDU_APP_DATABASE_URL)
  : owner;

if (runtime === owner) {
  logger.warn({}, 'ODUDU_APP_DATABASE_URL is unset; serving as the owner role bypasses RLS');
}

const app = buildApp({ database: runtime, logger });

const registry = new ModuleRegistry()
  .register(databaseModule(owner, runtime))
  .register(httpModule(app));

closeWithGrace({ delay: 10_000 }, async ({ err }) => {
  if (err) logger.error({ err }, 'shutting down after an unhandled error');
  await registry.stop();
});

await registry.start({ config, clock: systemClock, logger });
logger.info({ port: config.ODUDU_HTTP_PORT }, 'odudu is listening');
```

The warning matters: a deployment that silently bypasses row-level security should say so on every boot.

- [ ] **Step 12: Boot it against a real database**

```bash
docker run --rm -d --name odudu-pg -e POSTGRES_USER=odudu -e POSTGRES_PASSWORD=odudu \
  -e POSTGRES_DB=odudu -p 5432:5432 postgres:17-alpine
ODUDU_DATABASE_URL=postgres://odudu:odudu@localhost:5432/odudu \
  node apps/server/src/main.ts &
sleep 3
curl -fsS localhost:3000/health/ready
```

Expected: `{"status":"ok","checks":{"database":"ok"}}`.

Then stop it and confirm graceful shutdown:

```bash
kill %1
docker rm -f odudu-pg
```

Node 24 runs the TypeScript entry point directly via native type stripping, so no build step is needed for development.

- [ ] **Step 13: Run the full pipeline**

```bash
pnpm verify
```

Expected: exit 0.

- [ ] **Step 14: Update `docs/NEXT.md` and commit**

```bash
git add -A
git commit -m "P0.8: Fastify server composed from kernel modules

Health endpoints where liveness deliberately does not touch the database,
correlation ids echoed on every response, pino with authorization and
cookie headers redacted, and graceful shutdown through the module registry.

The http module depends on the database module, so the socket never opens
against a half-migrated schema."
git push
```

---

### Task 9: Container image, compose stack, and the boot proof

**Files:**

- Create: `apps/server/tsup.config.ts`
- Create: `infra/docker/Dockerfile`, `infra/docker/compose.yaml`, `infra/docker/initdb/01-app-role.sql`, `infra/docker/smoke.sh`
- Modify: `apps/server/package.json` — `build` script, tsup devDependency
- Modify: `turbo.json` — `build` task
- Modify: `.github/workflows/verify.yml` — add the `container` job
- Modify: `.dockerignore` (create)

**Interfaces:**

- Consumes: everything from Tasks 1–8.
- Produces: an image whose `CMD` is `node dist/main.js`, and `infra/docker/smoke.sh` exiting zero when the stack becomes ready.

This closes the P0 exit criterion "an empty server boots in a container".

- [ ] **Step 1: Add the bundler**

```bash
pnpm --filter @odudu/server add -D tsup@8.5.1
```

`apps/server/tsup.config.ts`:

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: true,
  noExternal: [/.*/],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
```

Add to `apps/server/package.json` scripts: `"build": "tsup"`.

Add to `turbo.json` tasks:

```json
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] }
```

- [ ] **Step 2: Build and run the bundle**

```bash
pnpm --filter @odudu/server build
docker run --rm -d --name odudu-pg -e POSTGRES_USER=odudu -e POSTGRES_PASSWORD=odudu \
  -e POSTGRES_DB=odudu -p 5432:5432 postgres:17-alpine
sleep 3
ODUDU_DATABASE_URL=postgres://odudu:odudu@localhost:5432/odudu \
  ODUDU_MIGRATIONS_DIR="$PWD/packages/db/drizzle" \
  node apps/server/dist/main.js &
sleep 3
curl -fsS localhost:3000/health/ready
kill %1; docker rm -f odudu-pg
```

Expected: `{"status":"ok","checks":{"database":"ok"}}`.

**If the bundle fails at runtime** — pino's worker-thread transports are the usual culprit when bundled — do not fight it. Switch to the no-bundler path: delete `tsup.config.ts`, drop the `build` script, and have the Dockerfile run `pnpm deploy --filter @odudu/server --prod /out` and start with `node src/main.ts`, relying on Node 24's native type stripping (already proven in Task 8 step 12). Record whichever path you took in `docs/NEXT.md`, because Task P2 adds `@node-rs/argon2`, a native module that must be external either way.

- [ ] **Step 3: Write `.dockerignore`**

```
node_modules
**/node_modules
**/dist
**/.turbo
**/coverage
.git
```

- [ ] **Step 4: Write the Dockerfile**

`infra/docker/Dockerfile`:

```dockerfile
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @odudu/server build

FROM node:24-alpine AS runtime
RUN addgroup -S odudu && adduser -S -G odudu odudu
WORKDIR /app
COPY --from=build --chown=odudu:odudu /app/apps/server/dist ./dist
COPY --from=build --chown=odudu:odudu /app/packages/db/drizzle ./drizzle
ENV NODE_ENV=production \
    ODUDU_MIGRATIONS_DIR=/app/drizzle \
    ODUDU_HTTP_HOST=0.0.0.0 \
    ODUDU_HTTP_PORT=3000
USER odudu
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

The migrations directory is copied separately and passed explicitly because bundling destroys the `import.meta.url` relative path that `MIGRATIONS_DIR` computes. Running as a non-root user is not optional for a security product.

- [ ] **Step 5: Write the compose stack**

`infra/docker/initdb/01-app-role.sql`:

```sql
CREATE USER odudu_svc LOGIN PASSWORD 'odudu_svc';
```

`infra/docker/compose.yaml`:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: odudu
      POSTGRES_PASSWORD: odudu
      POSTGRES_DB: odudu
    volumes:
      - ./initdb:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U odudu -d odudu']
      interval: 2s
      timeout: 3s
      retries: 30
    ports:
      - '5432:5432'

  odudu:
    build:
      context: ../..
      dockerfile: infra/docker/Dockerfile
    environment:
      ODUDU_DATABASE_URL: postgres://odudu:odudu@postgres:5432/odudu
      ODUDU_APP_DATABASE_URL: postgres://odudu_svc:odudu_svc@postgres:5432/odudu
      ODUDU_LOG_LEVEL: info
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - '3000:3000'
```

Two connection strings, deliberately. Migrations run as the owner; requests are served as `odudu_svc`, which inherits from `odudu_app` and is therefore subject to the row-level security policies from Task 7. Without this split the container would run with RLS bypassed and the isolation proven in Task 7 would not apply in production.

- [ ] **Step 6: Write the smoke script**

`infra/docker/smoke.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

cleanup() { docker compose down -v --remove-orphans; }
trap cleanup EXIT

docker compose up -d --build

for _ in $(seq 1 60); do
  if curl -fsS http://localhost:3000/health/ready > /dev/null 2>&1; then
    echo "odudu became ready"
    exit 0
  fi
  sleep 2
done

echo "odudu did not become ready within 120s" >&2
docker compose logs odudu >&2
exit 1
```

```bash
chmod +x infra/docker/smoke.sh
```

- [ ] **Step 7: Run the smoke test**

```bash
./infra/docker/smoke.sh
```

Expected: `odudu became ready`, exit 0.

- [ ] **Step 8: Confirm RLS is actually active in the container**

```bash
cd infra/docker && docker compose up -d --build && cd -
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu_svc -d odudu -c 'select count(*) from realms;'
docker compose -f infra/docker/compose.yaml down -v
```

Expected: `0`. The table is empty at this point either way, so also confirm the policy exists:

```bash
cd infra/docker && docker compose up -d --build && cd -
docker compose -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c "select policyname from pg_policies where tablename = 'realms';"
docker compose -f infra/docker/compose.yaml down -v
```

Expected: `realms_isolation`.

- [ ] **Step 9: Add the container job to CI**

Append to `.github/workflows/verify.yml`:

```yaml
container:
  runs-on: ubuntu-latest
  timeout-minutes: 20
  steps:
    - uses: actions/checkout@v7
    - name: Build and smoke-test the stack
      run: ./infra/docker/smoke.sh
```

- [ ] **Step 10: Push and watch CI**

```bash
git add -A
git commit -m "P0.9: container image, compose stack, and boot proof

Multi-stage build running as a non-root user. Compose uses two connection
strings: the owner for migrations, a restricted role for serving, so row
level security is genuinely enforced in the container rather than only in
tests.

smoke.sh brings the stack up and waits for readiness; CI runs it on every
push."
git push
gh run watch --exit-status
```

Expected: both jobs green.

- [ ] **Step 11: Close out P0 in `docs/NEXT.md`**

```markdown
# Next

**Position:** P0 complete. All exit criteria met:

- `pnpm verify` green locally and in CI (format, typecheck, lint,
  boundaries, unit, integration)
- the server boots in a container and reports ready; CI proves it on every
  push
- the migration runner is proven, including idempotency
- ADRs 0001–0012 committed
- dependency-cruiser enforces both package and layer boundaries, with
  fixtures proving the rules reject violations

**Next increment:** P1.1 — begin the OAuth 2.1 / OIDC core. Start by
writing `docs/protocols/rfc6749.md` and `docs/protocols/rfc7636.md` with
the clause tables described in spec section 10, before any endpoint code.
The requirement table is what makes "P1 is done" countable.

**Verify:** `pnpm verify` exits zero; `./infra/docker/smoke.sh` exits zero.

**Blocked on:** nothing.

**Known limitations carried into P1:**

- Realm cookies are namespaced rather than host-isolated (spec section 6).
- Only the `realms` table has an RLS policy. Every new tenant table needs
  `ENABLE`/`FORCE ROW LEVEL SECURITY` plus a policy, and a foreign-realm
  probe in the adversarial suite.
- The server bundle inlines all dependencies. P2 introduces
  `@node-rs/argon2`, a native module that must be marked external.
```

```bash
git add docs/NEXT.md
git commit -m "P0: record completion and the limitations carried into P1"
git push
```

---

## Self-review

**Spec coverage.** Every P0 exit criterion in spec §11 maps to a task: `pnpm verify` in CI (Tasks 1–2), container boot (Task 9), migration runner proven (Task 6), ADRs committed (already done, plus 0012 in Task 1), boundaries enforced (Task 3). Spec §3's package topology is realised incrementally — `kernel`, `db`, `testkit`, `apps/server` exist after P0; domain and protocol packages arrive with the phases that need them, and the boundary rules in Task 3 already match their names by pattern so no rule changes are needed when they appear. Spec §4's layering is enforced by Task 3 even though P0 has no feature folders yet, which is deliberate: the rules must predate the code they govern. Spec §5's subject model, key management, and the agent instance tables are **not** in P0 and are correctly deferred to P1–P2; only the tenancy mechanism they depend on is built here. Spec §12's working protocol is honoured by every task ending with `docs/NEXT.md` and a merge.

**Deliberate deferrals, recorded so they are not mistaken for gaps.** No OpenTelemetry — spec §3 lists it, but with no request handlers worth tracing it would be configuration with nothing to observe; it belongs in P1. No `contracts` package — nothing crosses an API boundary yet. No `.editorconfig`, no commit hooks: `pnpm verify` in CI is the enforcement point, and pre-commit hooks that duplicate CI mostly teach people to pass `--no-verify`.

**Type consistency.** `DatabaseHandle` carries `db`, `sql`, and `close` and is used with those three members in Tasks 6, 7, 8, and 9. `Database` is the Drizzle type and is what `withRealm` and `runMigrations` accept. `ModuleContext` supplies `config`, `clock`, and `logger`; `databaseModule` reads `ctx.config.ODUDU_MIGRATIONS_DIR` and `ctx.logger`, `httpModule` reads `ctx.config.ODUDU_HTTP_HOST` and `ctx.config.ODUDU_HTTP_PORT` — all present. `OduduError` codes used across tasks (`config_invalid`, `module_duplicate`, `module_unknown_dependency`, `module_cycle`, `module_stop_failed`, `realm_context_missing`) are all declared in the Task 4 `ErrorCode` union. `createLogger` returns pino's `Logger`, which Task 8's third logger test asserts is assignable to kernel's `Logger`.

**Known risk, flagged rather than hidden.** Task 9 step 2 bundles the server with tsup, and pino's transport machinery is historically awkward under bundlers. The step includes an explicit runtime check and a documented fallback to `pnpm deploy` with Node's native type stripping, which Task 8 step 12 already proves works. The failure is caught by a verification step rather than discovered in production.

# P3b — Sessions, logout and the token surface: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser may hold several concurrent logins, one of them may outlive the browser, ending one delivers to every relying party that used it, and a resource server may ask what a token is still worth.

**Architecture:** Two session cookies split by lifetime carry lists of session ids, resolved as a union; `prompt=select_account` chooses among them. Logout delivers front-channel through frames the page itself declares and back-channel through a queue drained by a command, on the outbox pattern ADR 0024 already established. The token surface makes `aud` derived from a per-client allowlist, adds introspection and revocation against it, and delivers the UserInfo and client-authentication behaviour P3a's registration metadata stored but nothing reads.

**Tech Stack:** TypeScript (no `any`), Fastify, Drizzle over PostgreSQL with row-level security, `jose`, Vitest with Testcontainers.

**Spec:** `docs/superpowers/specs/2026-09-19-p3b-sessions-logout-token-surface-design.md`

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the spec and from `CLAUDE.md`.

- **No `any`.** Not as an annotation, not as a cast, not leaked in from `JSON.parse`. Use `unknown` and narrow. No inline `eslint-disable` of `no-explicit-any` or `no-unsafe-*`; `tests/lint/no-any.test.ts` fails the build on one.
- **Tests precede implementation.** Every task writes the failing test first and runs it to see it fail.
- **Integration tests run against real PostgreSQL via Testcontainers**, never a mock.
- **Every repository method is probed with a foreign `realm_id`.**
- **`SET LOCAL`, never `SET`**, for realm context.
- **No comment block longer than eight lines.** `tests/lint/comment-block-length.test.ts` fails the build, and there is no waiver.
- **Never reference the development process from a comment** — no task numbers, no "the plan", no phase-plan slots. Name the thing instead.
- **Call a function as `doThing()`, never `void doThing()`.**
- **A page renderer is a `*-html.ts` in its package's `view` layer** returning `RenderedPage` and nothing else: no `reply`, no status, no headers. Headers come from `pageHeaders` alone.
- **Layering:** `view` → own model and `shared/view`; `usecase` → repository, service, view models; `repository` → adapter, service; `adapter` → transport, service; `service` → nothing. Domain packages never import protocol packages; protocol packages never import each other.
- **Background work is a command first and a timer second.** The usecase takes `now` as an argument and holds no timer; the loop is an interval, jitter, a call, a logging `catch` and a `stop` that awaits the pass in flight, and nothing else. Test loops with `vi.useFakeTimers()`, never by waiting.
- **No tool-attribution line in a pull request description either** — not "Generated with", not "Co-Authored-By", nothing. `CLAUDE.md` bans it, and unlike the commit half no hook or CI job can see a pull request body, so this one is followed rather than caught. It is the attribution that is banned, not the prose.
- **Commit messages:** subject ≤72 characters, body reading as ≤8 lines, blank line between, **no tool-attribution trailer**. `.githooks/commit-msg` and the `commit-messages` CI job enforce it. Enable the hook once per clone with `git config core.hooksPath .githooks`.
- **An increment is finished when CI is green on a pushed commit with a pull request open, and the review that push attracted has been answered.** See _Branch layout_ below for which pull request that is.
- **`README.md` and `docs/request-paths.md` are updated in the same commit as the code** that changes a request, response, branch, error code, endpoint, command or default. Every transcript in `request-paths.md` is real output from a running stack; a fenced block holding a response carries **no language tag**.

## Branch layout

**One branch per increment, merging into the phase branch; one phase pull request into `main`.**

- `p3b-sessions-logout-token-surface` is the **integration branch**. It already carries the spec, this plan and the roadmap correction. Nothing is committed to it directly after that; everything arrives by merge.
- Each increment gets `p3b/<n>-<slug>`, branched from the integration branch at its current tip, with its own pull request **into the integration branch**.
- One draft pull request from the integration branch **into `main`** opens at the start of the phase and stays open until `finishing-a-development-branch`. It is the whole-branch review CLAUDE.md requires at phase close.

`verified:` CI runs on an increment pull request. `.github/workflows/verify.yml:13` is a bare `pull_request:` with no `branches:` filter, and no job carries a draft guard, so `verify`, `container`, `conformance` and `commit-messages` all run on a pull request targeting the integration branch (`sed -n '1,20p' .github/workflows/verify.yml`).

Why this shape rather than one pull request for the phase: the review a push attracts is answered per increment, and a reviewer reading increment 8 should not be reading it against increments 1 through 7 as well. It also makes "an increment is not finished until CI is green" enforceable at a place that closes, rather than at a branch that stays open for six weeks.

Two things it costs, so nobody discovers them mid-phase. The `conformance` job runs on each increment pull request **and** again on the phase pull request when that increment merges, so conformance minutes roughly double. And the integration branch is not protected — only `main` is — so nothing mechanically prevents merging an increment whose checks are red. The checks are visible on the pull request; honouring them is discipline.

**Each pull request opens on the branch's first commit, not after its last task.**
GitHub refuses a pull request with no commits between head and base, so an increment's
pull request cannot precede its first commit — but it must not wait for its last. Open it
as soon as the first task commits. A branch with no pull request open runs **no CI at
all**, so every task implemented before the pull request exists is a task nobody
checked. P1 ran nineteen increments that way.

```bash
git checkout p3b-sessions-logout-token-surface && git push -u origin HEAD
gh pr create --draft --base main --head p3b-sessions-logout-token-surface \
  --title "P3b — sessions, logout and the token surface" \
  --body "Implements the P3b design spec. Increments merge into this branch one pull request at a time."
```

**Opening an increment:**

```bash
git checkout p3b-sessions-logout-token-surface
git pull
git checkout -b p3b/<n>-<slug>
# ... the increment's first task, through to its commit ...
git push -u origin HEAD
gh pr create --base p3b-sessions-logout-token-surface --head p3b/<n>-<slug> \
  --title "P3b increment <n> — <name>" --body "<tasks> of the P3b plan."
```

The `gh pr create` comes immediately after the **first** task's commit, not after the
increment's last. Pushing again after each subsequent task is what keeps CI on the work.

**Closing one**, after CI is green and the review is answered:

```bash
gh pr merge --merge
git checkout p3b-sessions-logout-token-surface
git pull
```

**After every merge, check the phase pull request itself — its CI and its review threads.**
Both accumulate there and neither is visible from the increment's own pull request:

```bash
gh pr checks 13                       # every job; look for `fail`, do not skim for `pass`
gh api graphql -f query='{ repository(owner:"<owner>", name:"<repo>") { pullRequest(number:13) {
  reviewThreads(first:60) { nodes { isResolved comments(first:1){nodes{databaseId path line body}} } } } } }'
```

Two failures on this phase are why this is written down. Increment 3 was merged while `verify`
was failing, because a `--watch` tail showed four passes and the failure was above the cut —
`gh pr checks` prints every job, so check that none says `fail` rather than that some say
`pass`. And `pnpm verify` is a chain (`format:check && typecheck && lint && boundaries && build
&& test && trace`), so a red first step means **nothing after it ran**: a formatting failure
hides the fact that no test executed at all. Separately, six unresolved review threads built up
on the phase pull request across three increments before anyone looked — the bot reviews that
pull request as increments merge into it, and findings appear there that exist on no increment's
pull request.

Findings raised on the phase pull request are answered the same way as any other: fixed with the
commit named, refuted with the fact that refutes them, or deferred to a recorded owner — and the
thread is resolved. Where they touch increments already merged, they go on their own branch into
the phase branch rather than being folded into whatever increment happens to be open.

A merge commit rather than a squash: the increment's own commits are the record of what was done in what order, and `tools/commit-message` exempts merge subjects from the length rules because their bodies are generated.

## Review Focus

Five input classes the spec implies but that no task's happy path exercises, most likely to bite first. Each line names the task that now carries its test.

1. **A cookie naming a session id that no longer exists, or that is not a uuid at all.** Browsers keep cookies across a database reset and a user can edit one. Resolution must prune the unknown ids and continue with the rest, never throw and never treat the whole cookie as hostile. Tests in **Task 2** (a value that is not a session id) and **Task 4** (an id naming no row).
2. **Two logins racing at the per-browser cap.** Both read the same list, both evict, and one write lands last. Eviction must not lose a session that the other request just created, and must never leave the cookie naming more ids than the cap. Test in **Task 4**.
3. **A relying party whose back-channel endpoint accepts the connection and then never finishes the body.** Without a response timeout the sender's pass hangs and the queue stops draining for every other realm. Test in **Task 18**.
4. **`resource` supplied more than once.** RFC 8707 permits multiple values; this server accepts one. Two values must be `invalid_target`, never a silent first-wins that issues a token for an audience the client did not mean. Test in **Task 22**.
5. **A `claims` parameter carrying very large or deeply nested JSON.** It is attacker-supplied, unauthenticated at `/authorize`, and `JSON.parse` is not bounded. The size must be capped before parsing and the depth rejected after. Test in **Task 39**.

## File structure

**Created**

| File                                                                            | Responsibility                                                                      |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `packages/authn-flows/src/service/session-cookie.ts`                            | The one authority for session cookie names, attributes, list encoding and `Max-Age` |
| `packages/authn-flows/src/service/session-set.ts`                               | Which of a browser's sessions survive, and which is evicted at the cap              |
| `packages/protocol-oidc/src/view/select-account-html.ts`                        | The account chooser page                                                            |
| `packages/protocol-oidc/src/service/logout-token.ts`                            | Logout token claims, per Back-Channel §2.4                                          |
| `packages/protocol-oidc/src/repository/logout-deliveries.ts`                    | The back-channel queue's reads and writes                                           |
| `packages/protocol-oidc/src/usecase/send-logouts.ts`                            | One delivery pass, taking `now`; no timer                                           |
| `apps/server/src/cli/send-logouts.ts`                                           | The operator command                                                                |
| `apps/server/src/modules/logout-sender.ts`                                      | The loop; interval, jitter, call, catch, stop                                       |
| `packages/protocol-oidc/src/service/resource-indicator.ts`                      | RFC 8707 `resource` parsing and allowlist check                                     |
| `packages/protocol-oidc/src/usecase/introspection.ts`                           | What `active` means, including session liveness                                     |
| `packages/protocol-oidc/src/usecase/revocation.ts`                              | RFC 7009                                                                            |
| `packages/protocol-oidc/src/view/routes/introspect.ts`, `revoke.ts`             | Transport for the two                                                               |
| `packages/protocol-oidc/src/service/client-assertion.ts`                        | `private_key_jwt` assertion validation                                              |
| `packages/protocol-oidc/src/repository/assertion-jti.ts`                        | Replay guard                                                                        |
| `packages/crypto/src/service/encrypt.ts`                                        | The repository's first JWE                                                          |
| `packages/protocol-oidc/src/service/claims-request.ts`                          | OIDC Core §5.5 parsing                                                              |
| `docs/protocols/oidc-frontchannel.md`, `rfc7662.md`, `rfc7009.md`, `rfc8707.md` | Clause tables                                                                       |
| `docs/adr/0032`–`0034`                                                          | The three decisions that reject an alternative somebody will propose again          |

**Modified**

| File                                                                     | Change                                                          |
| ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `packages/authn-flows/src/index.ts:6`                                    | `sessionCookieName` grows the persistent name                   |
| `packages/authn-flows/src/repository/sessions.ts`                        | Set reads, eviction, `remembered`                               |
| `packages/kernel/src/page.ts`                                            | `RenderedPage.frames`, `frame-src` derived from it              |
| `packages/protocol-oidc/src/usecase/session-reuse.ts`                    | A decision over a set                                           |
| `packages/protocol-oidc/src/view/routes/{login,consent,logout}.ts`       | Spread the cookie authority instead of hand-matching attributes |
| `packages/protocol-oidc/src/usecase/{logout,userinfo,token-issuance}.ts` | Delivery, JWS/JWE, derived `aud`                                |
| `packages/domain-realm/src/service/realm-settings.ts`                    | Four new settings                                               |
| `apps/server/src/main.ts`, `cli/reap.ts`                                 | The new command, the new retention pass                         |

**Migrations** — 0048 through 0053, in the order the increments need them.

---

## Increment 1 — the cookie authority and the session set

**Branch:** `p3b/1-session-set`, from the integration branch, with a pull request into it.

Everything later in the phase reads this, which is why it is first. The increment ends with a browser able to hold several sessions and every route agreeing on how the cookie is written.

### Task 1: Spike — two `__Host-` cookies, and the size limit

The whole session model rests on two assumptions about browsers. `CLAUDE.md`'s P0 rule requires they be executed rather than reasoned about, before the code that depends on them.

**Files:**

- Create: `docs/superpowers/p3b-spike-cookies.md`

**Interfaces:**

- Produces: the per-browser session cap default that Task 3 writes into migration 0048.

- [ ] **Step 1: Serve a page that sets both cookies**

Write `/tmp/cookie-spike.mjs`:

```js
import { createServer } from 'node:http';

createServer((req, res) => {
  if (req.url === '/set') {
    const ids = Array.from({
      length: Number(new URL(req.url, 'http://x').searchParams.get('n') ?? 10),
    });
    res.setHeader('set-cookie', [
      `__Host-demo-session=${ids.map(() => crypto.randomUUID()).join('.')}; HttpOnly; SameSite=Lax; Path=/; Secure`,
      `__Host-demo-session-persistent=${crypto.randomUUID()}; HttpOnly; SameSite=Lax; Path=/; Secure; Max-Age=2592000`,
    ]);
    res.end('set');
    return;
  }
  res.end(JSON.stringify({ cookie: req.headers.cookie ?? null }));
}).listen(8443);
```

- [ ] **Step 2: Run it behind TLS and read both cookies back**

`__Host-` requires `Secure`, so this needs HTTPS. Use a self-signed certificate and load `https://localhost:8443/set` then `https://localhost:8443/` in a real browser. Record whether **both** cookies come back on the second request.

- [ ] **Step 3: Find where the list stops being sent**

Repeat `/set?n=…` doubling `n` until the cookie stops arriving. Record the largest `n` that survives, and the byte length of the header at that point.

- [ ] **Step 4: Write the findings down**

Record in `docs/superpowers/p3b-spike-cookies.md`: the browser and version, whether two `__Host-` cookies coexist, the observed size ceiling, and **the cap this plan should use** — a round number with at least a factor of four of headroom under the ceiling, since a uuid list is not the only thing a request carries.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/p3b-spike-cookies.md
git commit -m "Record what browsers do with two __Host- session cookies"
```

If two `__Host-` cookies do **not** coexist, stop and raise it: the spec's decision 1 is invalid and the phase needs the `browser_sessions` alternative from section 3 instead.

### Task 2: The cookie authority

**Files:**

- Create: `packages/authn-flows/src/service/session-cookie.ts`
- Create: `packages/authn-flows/src/service/session-cookie.test.ts`
- Modify: `packages/authn-flows/src/index.ts`

**Interfaces:**

- Consumes: `sessionCookieName(realm, tls)` (`packages/authn-flows/src/index.ts:6`).
- Produces: `sessionCookies(input: SessionCookieInput): readonly string[]`, `readSessionIds(header: string | undefined, realm: string, tls: boolean): SessionIds`, `clearedSessionCookies(realm: string, tls: boolean): readonly string[]`, `PERSISTENT_SUFFIX`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { clearedSessionCookies, readSessionIds, sessionCookies } from '#/service/session-cookie';

const A = '0192f2a0-0000-7000-8000-000000000001';
const B = '0192f2a0-0000-7000-8000-000000000002';

describe('sessionCookies', () => {
  it('writes the ephemeral list with no Max-Age and the persistent list with one', () => {
    const written = sessionCookies({
      realm: 'demo',
      tls: true,
      ephemeral: [A],
      persistent: [B],
      persistentMaxAgeSeconds: 2592000,
    });

    expect(written).toEqual([
      `__Host-demo-session=${A}; HttpOnly; SameSite=Lax; Path=/; Secure`,
      `__Host-demo-session-persistent=${B}; HttpOnly; SameSite=Lax; Path=/; Secure; Max-Age=2592000`,
    ]);
  });

  it('drops Secure and the prefix together when TLS is off, and nothing else', () => {
    const written = sessionCookies({
      realm: 'demo',
      tls: false,
      ephemeral: [A],
      persistent: [],
      persistentMaxAgeSeconds: 2592000,
    });

    expect(written[0]).toBe(`demo-session=${A}; HttpOnly; SameSite=Lax; Path=/`);
  });

  it('expires a list that has become empty rather than leaving it in the browser', () => {
    const written = sessionCookies({
      realm: 'demo',
      tls: true,
      ephemeral: [],
      persistent: [B],
      persistentMaxAgeSeconds: 2592000,
    });

    expect(written[0]).toContain('Max-Age=0');
  });
});

describe('readSessionIds', () => {
  it('reads both lists and keeps them apart', () => {
    const header = `__Host-demo-session=${A}; __Host-demo-session-persistent=${B}`;
    expect(readSessionIds(header, 'demo', true)).toEqual({ ephemeral: [A], persistent: [B] });
  });

  it('is empty for an absent header', () => {
    expect(readSessionIds(undefined, 'demo', true)).toEqual({ ephemeral: [], persistent: [] });
  });

  it('drops a value that is not a session id rather than failing the request', () => {
    const header = `__Host-demo-session=${A}.not-a-uuid.`;
    expect(readSessionIds(header, 'demo', true)).toEqual({ ephemeral: [A], persistent: [] });
  });

  it('ignores another realm’s cookie in the same jar', () => {
    const header = `__Host-other-session=${B}; __Host-demo-session=${A}`;
    expect(readSessionIds(header, 'demo', true)).toEqual({ ephemeral: [A], persistent: [] });
  });
});

describe('clearedSessionCookies', () => {
  it('expires both names', () => {
    const cleared = clearedSessionCookies('demo', true);
    expect(cleared).toHaveLength(2);
    expect(cleared.every((c) => c.includes('Max-Age=0'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/authn-flows/src/service/session-cookie.test.ts`
Expected: FAIL — cannot resolve `#/service/session-cookie`.

- [ ] **Step 3: Write the implementation**

```ts
import { sessionCookieName } from '#/index';

export const PERSISTENT_SUFFIX = '-persistent';

const SEPARATOR = '.';

// The ids a browser presents, before any of them has been resolved to a row.
export interface SessionIds {
  readonly ephemeral: readonly string[];
  readonly persistent: readonly string[];
}

export interface SessionCookieInput {
  readonly realm: string;
  readonly tls: boolean;
  readonly ephemeral: readonly string[];
  readonly persistent: readonly string[];
  readonly persistentMaxAgeSeconds: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function persistentName(realm: string, tls: boolean): string {
  return `${sessionCookieName(realm, tls)}${PERSISTENT_SUFFIX}`;
}

// ADR 0020 decides the name and nothing else; these are the attributes it
// names as the caller's to set, in one place so two routes cannot disagree.
function attributes(tls: boolean): string[] {
  return ['HttpOnly', 'SameSite=Lax', 'Path=/', ...(tls ? ['Secure'] : [])];
}

function cookie(name: string, value: string, tls: boolean, maxAge: number | null): string {
  const parts = [`${name}=${value}`, ...attributes(tls)];
  if (maxAge !== null) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

// An empty list is written as an expiry rather than omitted: omitting it
// leaves whatever the browser already holds, which is how a logged-out
// session id survives a logout.
function listCookie(
  name: string,
  ids: readonly string[],
  tls: boolean,
  maxAge: number | null,
): string {
  if (ids.length === 0) return cookie(name, '', tls, 0);
  return cookie(name, ids.join(SEPARATOR), tls, maxAge);
}

export function sessionCookies(input: SessionCookieInput): readonly string[] {
  return [
    listCookie(sessionCookieName(input.realm, input.tls), input.ephemeral, input.tls, null),
    listCookie(
      persistentName(input.realm, input.tls),
      input.persistent,
      input.tls,
      input.persistentMaxAgeSeconds,
    ),
  ];
}

export function clearedSessionCookies(realm: string, tls: boolean): readonly string[] {
  return [
    cookie(sessionCookieName(realm, tls), '', tls, 0),
    cookie(persistentName(realm, tls), '', tls, 0),
  ];
}

function valuesOf(header: string, name: string): readonly string[] {
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    if (pair.slice(0, index).trim() !== name) continue;
    return pair
      .slice(index + 1)
      .trim()
      .split(SEPARATOR)
      .filter((value) => UUID.test(value));
  }
  return [];
}

// A malformed id is dropped rather than refused. A browser keeps cookies
// across a database reset and a person can edit one; a request that fails
// because of a value the server itself wrote months ago is a login nobody
// can complete and nothing explains.
export function readSessionIds(
  header: string | undefined,
  realm: string,
  tls: boolean,
): SessionIds {
  if (header === undefined) return { ephemeral: [], persistent: [] };
  return {
    ephemeral: valuesOf(header, sessionCookieName(realm, tls)),
    persistent: valuesOf(header, persistentName(realm, tls)),
  };
}
```

- [ ] **Step 4: Export it and run the test**

Add to `packages/authn-flows/src/index.ts`:

```ts
export {
  clearedSessionCookies,
  readSessionIds,
  sessionCookies,
  PERSISTENT_SUFFIX,
  type SessionCookieInput,
  type SessionIds,
} from '#/service/session-cookie';
```

Run: `npx vitest run packages/authn-flows/src/service/session-cookie.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/authn-flows/src/service/session-cookie.ts packages/authn-flows/src/service/session-cookie.test.ts packages/authn-flows/src/index.ts
git commit -m "Give the session cookie one authority"
```

### Task 3: `remembered`, the cap, and the settings that reach them

**Files:**

- Create: `packages/db/drizzle/0048_sessions_remembered_and_cap.sql`
- Modify: `packages/authn-flows/src/schema/sessions.ts`
- Modify: `packages/domain-realm/src/schema/realms.ts`
- Modify: `packages/domain-realm/src/service/realm-settings.ts`
- Modify: `packages/domain-realm/src/service/realm-settings.test.ts`

**Interfaces:**

- Consumes: Task 1's cap default.
- Produces: `sessions.remembered`, `realms.maxSessionsPerBrowser`, and the setting name `max_sessions_per_browser`.

- [ ] **Step 1: Write the failing test**

Add to `packages/domain-realm/src/service/realm-settings.test.ts`:

```ts
it('coerces the per-browser session cap', () => {
  expect(coerceRealmSetting('max_sessions_per_browser', '8')).toEqual({
    kind: 'coerced',
    column: 'maxSessionsPerBrowser',
    value: 8,
  });
});

it('refuses a cap that is not an integer', () => {
  expect(coerceRealmSetting('max_sessions_per_browser', 'lots')).toEqual({
    kind: 'invalid_value',
    expected: 'integer',
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/domain-realm/src/service/realm-settings.test.ts`
Expected: FAIL — `unknown_setting`.

- [ ] **Step 3: Write the migration**

`packages/db/drizzle/0048_sessions_remembered_and_cap.sql`. Replace `<CAP>` with the default from Task 1's spike.

```sql
-- Whether this login asked to be remembered. It selects which of the two
-- lifespan pairs the session is measured against, and which cookie carries
-- its id, so it is a property of the login rather than of the browser.
ALTER TABLE sessions ADD COLUMN remembered boolean NOT NULL DEFAULT false;

-- How many live sessions one browser may hold. A login at the cap evicts
-- the least recently active session rather than being refused: a login that
-- fails because of an invisible cookie limit is indistinguishable, to the
-- person in front of it, from a broken server.
ALTER TABLE realms ADD COLUMN max_sessions_per_browser integer NOT NULL DEFAULT <CAP>;

ALTER TABLE realms ADD CONSTRAINT realms_max_sessions_per_browser_range
  CHECK (max_sessions_per_browser BETWEEN 1 AND 32);
```

- [ ] **Step 4: Declare the columns**

In `packages/authn-flows/src/schema/sessions.ts`, add to the table and to `SessionRecord`:

```ts
  remembered: boolean('remembered').notNull().default(false),
```

```ts
remembered: boolean;
```

In `packages/domain-realm/src/schema/realms.ts`:

```ts
  maxSessionsPerBrowser: integer('max_sessions_per_browser').notNull().default(8),
```

- [ ] **Step 5: Add the setting**

In `realm-settings.ts`'s `SETTINGS`, beside the other two session entries:

```ts
  max_sessions_per_browser: { column: 'maxSessionsPerBrowser', type: 'integer' },
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run packages/domain-realm packages/db`
Expected: PASS, including `schema-drift.int.test.ts`, which compares the declarations against a freshly migrated database.

- [ ] **Step 7: Update the documentation**

`docs/request-paths.md` lists the realm settings `seed realm --set` accepts. Add `max_sessions_per_browser` with its range, and note `sessions.remembered` where the session columns are described.

- [ ] **Step 8: Commit**

```bash
git add packages/db/drizzle/0048_sessions_remembered_and_cap.sql packages/authn-flows/src/schema/sessions.ts packages/domain-realm/src docs/request-paths.md
git commit -m "Add the remembered flag and the per-browser session cap"
```

### Task 4: Reading and bounding the set

**Files:**

- Modify: `packages/authn-flows/src/repository/sessions.ts`
- Create: `packages/authn-flows/src/service/session-set.ts`
- Create: `packages/authn-flows/src/service/session-set.test.ts`
- Create: `packages/authn-flows/tests/session-set.int.test.ts`

**Interfaces:**

- Consumes: `sessionRepository(tx)`, `isSessionLive`.
- Produces: `sessionRepository(tx).liveByIds(ids, idleSeconds, now): Promise<SessionRecord[]>`, `.endMany(ids, now): Promise<void>`, and `chooseEvictions(live, cap): readonly string[]`.

- [ ] **Step 1: Write the failing unit test for eviction**

`packages/authn-flows/src/service/session-set.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chooseEvictions } from '#/service/session-set';

function at(id: string, iso: string) {
  return { id, lastActiveAt: new Date(iso) };
}

describe('chooseEvictions', () => {
  it('evicts nothing below the cap', () => {
    expect(chooseEvictions([at('a', '2026-09-19T10:00:00Z')], 3)).toEqual([]);
  });

  it('evicts the least recently active so that admitting one more fits', () => {
    const live = [
      at('a', '2026-09-19T10:00:00Z'),
      at('b', '2026-09-19T09:00:00Z'),
      at('c', '2026-09-19T11:00:00Z'),
    ];
    expect(chooseEvictions(live, 3)).toEqual(['b']);
  });

  it('evicts enough to fit when the browser is already over the cap', () => {
    const live = [
      at('a', '2026-09-19T10:00:00Z'),
      at('b', '2026-09-19T09:00:00Z'),
      at('c', '2026-09-19T11:00:00Z'),
      at('d', '2026-09-19T08:00:00Z'),
    ];
    expect(chooseEvictions(live, 2)).toEqual(['d', 'b']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/authn-flows/src/service/session-set.test.ts`
Expected: FAIL — cannot resolve `#/service/session-set`.

- [ ] **Step 3: Implement it**

```ts
export interface EvictionCandidate {
  readonly id: string;
  readonly lastActiveAt: Date;
}

// Which sessions must go so that one more login fits under the cap. Ordered
// least recently active first, which is both the eviction order and the
// order a caller should report them in.
export function chooseEvictions(
  live: readonly EvictionCandidate[],
  cap: number,
): readonly string[] {
  const surplus = live.length + 1 - cap;
  if (surplus <= 0) return [];
  return [...live]
    .sort((a, b) => a.lastActiveAt.getTime() - b.lastActiveAt.getTime())
    .slice(0, surplus)
    .map((candidate) => candidate.id);
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run packages/authn-flows/src/service/session-set.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing integration test**

`packages/authn-flows/tests/session-set.int.test.ts`, using the container setup idiom from `packages/protocol-oidc/tests/*.int.test.ts` (`startTestDatabase`, `createAppRole`, `runMigrations`, `withRealm`):

```ts
it('returns only the live sessions among the ids given, in no required order', async () => {
  await withRealm(app.db, realmId, async (tx) => {
    const repo = sessionRepository(tx);
    await repo.create({ id: liveId, realmId, subjectId, expiresAt: future, authenticators: [] });
    await repo.create({ id: deadId, realmId, subjectId, expiresAt: past, authenticators: [] });

    const found = await repo.liveByIds([liveId, deadId], 1800, now);

    expect(found.map((s) => s.id)).toEqual([liveId]);
  });
});

it('ignores an id that names no row at all', async () => {
  await withRealm(app.db, realmId, async (tx) => {
    const found = await sessionRepository(tx).liveByIds([liveId, newId()], 1800, now);
    expect(found.map((s) => s.id)).toEqual([liveId]);
  });
});

it('returns an empty list for no ids without touching the database', async () => {
  await withRealm(app.db, realmId, async (tx) => {
    expect(await sessionRepository(tx).liveByIds([], 1800, now)).toEqual([]);
  });
});

it('cannot see a live session belonging to another realm', async () => {
  await withRealm(app.db, otherRealmId, async (tx) => {
    expect(await sessionRepository(tx).liveByIds([liveId], 1800, now)).toEqual([]);
  });
});

it('ends several sessions at once, and ending an already-dead one is a no-op', async () => {
  await withRealm(app.db, realmId, async (tx) => {
    const repo = sessionRepository(tx);
    await repo.endMany([liveId, deadId], now);
    expect(await repo.liveByIds([liveId, deadId], 1800, now)).toEqual([]);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run packages/authn-flows/tests/session-set.int.test.ts`
Expected: FAIL — `liveByIds is not a function`.

- [ ] **Step 7: Implement the repository methods**

In `packages/authn-flows/src/repository/sessions.ts`, importing `inArray` from `drizzle-orm`:

```ts
    // The set read every session consumer uses now that a browser may hold
    // more than one. Liveness is applied in the same pass rather than by the
    // caller, so no caller can forget the idle window.
    async liveByIds(
      ids: readonly string[],
      idleSeconds: number,
      now: Date,
    ): Promise<SessionRecord[]> {
      if (ids.length === 0) return [];
      const rows = await tx.select().from(sessions).where(inArray(sessions.id, [...ids]));
      return rows.map(toRecord).filter((record) => isSessionLive(record, idleSeconds, now));
    },

    async endMany(ids: readonly string[], now: Date): Promise<void> {
      if (ids.length === 0) return;
      await tx.update(sessions).set({ expiresAt: now }).where(inArray(sessions.id, [...ids]));
    },
```

- [ ] **Step 8: Run it**

Run: `npx vitest run packages/authn-flows/tests/session-set.int.test.ts`
Expected: PASS, all five.

- [ ] **Step 9: Add the race the Review Focus names**

Two logins at the cap must not leave the browser holding more ids than the cap, and must not evict a session the other request just created. Add to the integration test:

```ts
it('holds the cap when two logins arrive at once', async () => {
  await seedLiveSessions(cap);

  const [first, second] = await Promise.all([
    withRealm(app.db, realmId, (tx) => admitSession(tx, newId())),
    withRealm(app.db, realmId, (tx) => admitSession(tx, newId())),
  ]);

  await withRealm(app.db, realmId, async (tx) => {
    const live = await sessionRepository(tx).liveByIds([...seeded, first.id, second.id], 1800, now);
    expect(live.length).toBeLessThanOrEqual(cap);
    expect(live.map((s) => s.id)).toEqual(expect.arrayContaining([first.id, second.id]));
  });
});
```

`admitSession` performs the eviction and the insert **in one transaction**, selecting the live rows `for update` so the second transaction reads the first's result rather than the state before it. Implement it that way; if the test passes without the row lock, it is passing by luck of timing.

- [ ] **Step 10: Run the whole package and commit**

Run: `npx vitest run packages/authn-flows`
Expected: PASS.

```bash
git add packages/authn-flows
git commit -m "Read and bound a browser's set of live sessions"
```

### Task 5: The three emission sites converge

**Files:**

- Modify: `packages/protocol-oidc/src/view/routes/login.ts:238-250`
- Modify: `packages/protocol-oidc/src/view/routes/consent.ts:89-101`
- Modify: `packages/protocol-oidc/src/view/routes/logout.ts:51-110`
- Modify: `packages/protocol-oidc/src/index.ts:379,532`
- Modify: `packages/protocol-oidc/src/usecase/logout.ts`
- Create: `packages/protocol-oidc/tests/session-cookie-authority.test.ts`

**Interfaces:**

- Consumes: `sessionCookies`, `readSessionIds`, `clearedSessionCookies`, `liveByIds`.
- Produces: `resolveSessions(realm, header): Promise<SessionRecord[]>` in place of `resolveSession`.

- [ ] **Step 1: Write the failing test that holds routes to the authority**

`packages/protocol-oidc/tests/session-cookie-authority.test.ts`, modelled on `html-response.test.ts`, which already holds view layers to naming no header:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ATTRIBUTES = ['HttpOnly', 'SameSite=Lax', 'Max-Age=', 'Secure'];
const AUTHORITY = 'packages/authn-flows/src/service/session-cookie.ts';

describe('the session cookie has one authority', () => {
  it('is named by no route of its own', async () => {
    const offenders: string[] = [];
    for (const file of await routeFiles()) {
      const source = await readFile(file, 'utf8');
      for (const attribute of ATTRIBUTES) {
        if (source.includes(attribute)) offenders.push(`${file} names ${attribute}`);
      }
    }
    expect(offenders, `only ${AUTHORITY} decides these`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/session-cookie-authority.test.ts`
Expected: FAIL, naming `login.ts`, `consent.ts` and `logout.ts`.

- [ ] **Step 3: Replace the hand-built cookie in `login.ts` and `consent.ts`**

Both build the same array today. Replace each with, keeping the existing `outcome` shape:

```ts
const written = sessionCookies({
  realm: request.params.realm,
  tls: deps.tls,
  ephemeral: outcome.ephemeralSessionIds,
  persistent: outcome.persistentSessionIds,
  persistentMaxAgeSeconds: outcome.persistentMaxAgeSeconds,
});

const reply302 = reply.code(302);
for (const cookie of written) reply302.header('set-cookie', cookie);
return reply302.header('location', outcome.location).send();
```

Until Task 7 introduces remembering, `persistentSessionIds` is always empty and `persistentMaxAgeSeconds` is the realm's `sso_session_max_seconds`; the usecase supplies both.

- [ ] **Step 4: Replace `clearedCookie` in `logout.ts`**

```ts
if (sessionEnded) {
  for (const cookie of clearedSessionCookies(request.params.realm, deps.tls)) {
    reply.header('set-cookie', cookie);
  }
}
```

Delete the local `clearedCookie` helper and the comment at `logout.ts:51` saying the attributes have to match `login.ts`. They no longer can diverge, so the comment stops being true.

- [ ] **Step 5: Resolve the set, not the session**

In `packages/protocol-oidc/src/index.ts:379` and `:532`, replace each `resolveSession` with:

```ts
      resolveSessions: async (realm, header) => {
        const ids = readSessionIds(header, realm.name, tls);
        return withRealm(database.db, realm.id, async (tx) =>
          sessionRepository(tx).liveByIds(
            [...ids.ephemeral, ...ids.persistent],
            realm.ssoSessionIdleSeconds,
            new Date(),
          ),
        );
      },
```

- [ ] **Step 6: Make logout's CSRF check a membership test**

In `handleLogoutConfirmation`, the posted `confirmedSessionId` is now compared against membership in the resolved set:

```ts
const sessions = await deps.resolveSessions(realm, header);
const confirmed = sessions.find((session) => session.id === params.confirmedSessionId);
if (confirmed === undefined) return { kind: 'unauthenticated' };
```

The defence is unchanged — only a browser holding the `HttpOnly` cookie can name a member — and the comment above the field should say membership rather than equality.

- [ ] **Step 7: Run everything that touches a session**

Run: `npx vitest run packages/protocol-oidc packages/authn-flows`
Expected: PASS. `decideLogout` and `decideReuse` still take a single session; Tasks 8 and 10 change that, and this task must not.

- [ ] **Step 8: Update the documentation**

`docs/request-paths.md` shows `set-cookie` headers in its login and logout transcripts. Re-run those sections against a running stack and paste the real output — two headers now, not one. A response block carries no language tag.

- [ ] **Step 9: Commit and push the increment**

```bash
git add packages/protocol-oidc packages/authn-flows docs/request-paths.md
git commit -m "Route every session cookie through one authority"

# The phase pull request, opened once and left open for the whole phase.
git push -u origin p3b-sessions-logout-token-surface
gh pr create --draft --base main --head p3b-sessions-logout-token-surface \
  --title "P3b — sessions, logout and the token surface" \
  --body "Implements docs/superpowers/specs/2026-09-19-p3b-sessions-logout-token-surface-design.md. Increments merge into this branch one pull request at a time."

# This increment's own pull request.
git push -u origin p3b/1-session-set
gh pr create --base p3b-sessions-logout-token-surface --head p3b/1-session-set \
  --title "P3b increment 1 — the cookie authority and the session set" \
  --body "Tasks 1-5 of docs/superpowers/plans/2026-09-19-p3b-sessions-logout-token-surface.md."
gh pr checks --watch
```

Both pull requests open **here**, with the first push, because a branch with no pull request open runs no CI at all. Answer the review this push attracts, merge into the integration branch, and branch Increment 2 from its new tip.

---

## Increment 2 — remember me

**Branch:** `p3b/2-remember-me`, from the integration branch, with a pull request into it.

A realm may offer it, a login may ask for it, and a session that asked is measured against a second pair of lifespans and carried in the persistent cookie.

### Task 6: The second lifespan pair, and which pair applies

**Files:**

- Create: `packages/db/drizzle/0049_realm_remember_me.sql`
- Modify: `packages/domain-realm/src/schema/realms.ts`
- Modify: `packages/domain-realm/src/service/realm-settings.ts`
- Create: `packages/authn-flows/src/service/session-lifespan.ts`
- Create: `packages/authn-flows/src/service/session-lifespan.test.ts`

**Interfaces:**

- Produces: `lifespanFor(realm, remembered): { idleSeconds: number; maxSeconds: number }`, and the settings `remember_me_allowed`, `remember_me_idle_seconds`, `remember_me_max_seconds`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { lifespanFor } from '#/service/session-lifespan';

const realm = {
  ssoSessionIdleSeconds: 1800,
  ssoSessionMaxSeconds: 36000,
  rememberMeIdleSeconds: 604800,
  rememberMeMaxSeconds: 2592000,
};

describe('lifespanFor', () => {
  it('uses the ordinary pair for a login that did not ask to be remembered', () => {
    expect(lifespanFor(realm, false)).toEqual({ idleSeconds: 1800, maxSeconds: 36000 });
  });

  it('uses the remembered pair for one that did', () => {
    expect(lifespanFor(realm, true)).toEqual({ idleSeconds: 604800, maxSeconds: 2592000 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/authn-flows/src/service/session-lifespan.test.ts`
Expected: FAIL — cannot resolve `#/service/session-lifespan`.

- [ ] **Step 3: Write the migration**

```sql
-- A realm may offer "remember me"; a login that takes it is measured
-- against this pair instead of sso_session_*. The ranges and the
-- idle <= max rule are CHECK constraints for the same reason 0028's are:
-- a policy no writer may bypass belongs at the database.
ALTER TABLE realms ADD COLUMN remember_me_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE realms ADD COLUMN remember_me_idle_seconds integer NOT NULL DEFAULT 604800;
ALTER TABLE realms ADD COLUMN remember_me_max_seconds integer NOT NULL DEFAULT 2592000;

ALTER TABLE realms ADD CONSTRAINT realms_remember_me_idle_range
  CHECK (remember_me_idle_seconds BETWEEN 60 AND 31536000);
ALTER TABLE realms ADD CONSTRAINT realms_remember_me_max_range
  CHECK (remember_me_max_seconds BETWEEN 60 AND 31536000);
ALTER TABLE realms ADD CONSTRAINT realms_remember_me_idle_within_max
  CHECK (remember_me_idle_seconds <= remember_me_max_seconds);
```

- [ ] **Step 4: Declare the columns and the settings**

In `realms.ts`, three columns matching the names above. In `realm-settings.ts`'s `SETTINGS`:

```ts
  remember_me_allowed: { column: 'rememberMeAllowed', type: 'boolean' },
  remember_me_idle_seconds: { column: 'rememberMeIdleSeconds', type: 'integer' },
  remember_me_max_seconds: { column: 'rememberMeMaxSeconds', type: 'integer' },
```

- [ ] **Step 5: Implement `lifespanFor`**

```ts
export interface SessionLifespans {
  readonly ssoSessionIdleSeconds: number;
  readonly ssoSessionMaxSeconds: number;
  readonly rememberMeIdleSeconds: number;
  readonly rememberMeMaxSeconds: number;
}

// Which pair a session is measured against. One function so that the
// idle window a request checks and the ceiling its row was created with
// can never come from different pairs.
export function lifespanFor(
  realm: SessionLifespans,
  remembered: boolean,
): { idleSeconds: number; maxSeconds: number } {
  return remembered
    ? { idleSeconds: realm.rememberMeIdleSeconds, maxSeconds: realm.rememberMeMaxSeconds }
    : { idleSeconds: realm.ssoSessionIdleSeconds, maxSeconds: realm.ssoSessionMaxSeconds };
}
```

- [ ] **Step 6: Make `liveByIds` measure each session against its own pair**

`liveByIds` takes one `idleSeconds` today, which is wrong the moment a browser holds a remembered session beside an ordinary one. Change its signature to take the realm's lifespans and apply `lifespanFor(realm, record.remembered)` per record. Update Task 4's tests for the new signature, and add:

```ts
it('measures a remembered session against the remembered idle window', async () => {
  // idle for two days: dead under sso_session_idle_seconds, live under the
  // remembered pair.
  await withRealm(app.db, realmId, async (tx) => {
    const live = await sessionRepository(tx).liveByIds([rememberedId, ordinaryId], realm, now);
    expect(live.map((s) => s.id)).toEqual([rememberedId]);
  });
});
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run packages/authn-flows packages/domain-realm packages/db`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/db/drizzle/0049_realm_remember_me.sql packages/authn-flows packages/domain-realm
git commit -m "Add the remembered session lifespans and pick a pair"
```

### Task 7: The checkbox, and the cookie that outlives the browser

**Files:**

- Modify: `packages/protocol-oidc/src/view/authorize-html.ts`
- Modify: `packages/protocol-oidc/src/usecase/login-submission.ts`
- Modify: `packages/protocol-oidc/src/view/routes/login.ts`
- Modify: `packages/protocol-oidc/src/view/authorize-html.test.ts`
- Create: `packages/protocol-oidc/tests/remember-me.int.test.ts`

**Interfaces:**

- Consumes: `lifespanFor`, `sessionCookies`.
- Produces: `LoginOutcome.ephemeralSessionIds`, `.persistentSessionIds`, `.persistentMaxAgeSeconds`.

- [ ] **Step 1: Write the failing renderer test**

```ts
it('offers remember me when the realm allows it', () => {
  const page = renderAuthorizePage({ ...base, rememberMeAllowed: true });
  expect(page.body).toContain(
    '<input type="checkbox" name="remember_me" id="remember-me" value="true">',
  );
  expect(page.body).toContain('Remember me');
});

it('offers nothing when the realm does not allow it', () => {
  const page = renderAuthorizePage({ ...base, rememberMeAllowed: false });
  expect(page.body).not.toContain('remember_me');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/view/authorize-html.test.ts`
Expected: FAIL — the markup has no checkbox.

- [ ] **Step 3: Render it**

Add the field to the form in `authorize-html.ts`, behind `rememberMeAllowed`. The renderer returns `RenderedPage` and sets no header; nothing else about it changes.

- [ ] **Step 4: Write the failing integration test**

`packages/protocol-oidc/tests/remember-me.int.test.ts`:

```ts
it('carries a remembered login in the persistent cookie, with Max-Age', async () => {
  const response = await postLogin({ remember_me: 'true' });

  const cookies = response.headers['set-cookie'];
  const persistent = cookies.find((c) => c.includes('-session-persistent='));
  expect(persistent).toContain(`Max-Age=${realm.rememberMeMaxSeconds}`);
  expect(cookies.find((c) => c.startsWith(ephemeralName))).toContain('Max-Age=0');
});

it('carries an ordinary login in the ephemeral cookie, with no Max-Age', async () => {
  const response = await postLogin({});

  const cookies = response.headers['set-cookie'];
  expect(cookies.find((c) => c.startsWith(ephemeralName))).not.toContain('Max-Age');
});

it('refuses to remember when the realm does not allow it', async () => {
  await setRealm({ remember_me_allowed: false });

  const response = await postLogin({ remember_me: 'true' });

  const session = await readSession(response);
  expect(session.remembered).toBe(false);
  expect(response.headers['set-cookie'].find((c) => c.includes('-persistent='))).toContain(
    'Max-Age=0',
  );
});
```

The third is the one that matters: `remember_me` arrives in a form body from an unauthenticated browser, so the realm setting is the authority and the field is a request.

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/remember-me.int.test.ts`
Expected: FAIL — no persistent cookie is written.

- [ ] **Step 6: Implement it**

In `login-submission.ts`, read the field, gate it on `realm.rememberMeAllowed`, pass the result to `lifespanFor` for the session's `expiresAt`, store `remembered`, and return the new session's id in `persistentSessionIds` when remembered and `ephemeralSessionIds` otherwise — each list being the browser's surviving ids plus this one, minus anything Task 4's eviction chose.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run packages/protocol-oidc`
Expected: PASS.

- [ ] **Step 8: Update the documentation**

`README.md` and `docs/request-paths.md` both describe the login form and the session cookie. Add remember me: the three settings, the checkbox, which cookie carries the id, and the fact that a realm with `remember_me_allowed=false` ignores the field. Re-run the login transcript.

- [ ] **Step 9: Commit and push**

```bash
git add packages/protocol-oidc README.md docs/request-paths.md
git commit -m "Offer remember me, and carry it in the persistent cookie"
git push
gh pr checks --watch
```

Answer the review, then close the increment:

```bash
gh pr merge --merge
git checkout p3b-sessions-logout-token-surface && git pull
git checkout -b p3b/3-account-selection
```

---

## Increment 3 — account selection

**Branch:** `p3b/3-account-selection`, from the integration branch, with a pull request into it.

### Task 8: `decideReuse` over a set

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/session-reuse.ts`
- Modify: `packages/protocol-oidc/src/usecase/session-reuse.test.ts`

**Interfaces:**

- Produces: `decideReuse(input: ReuseInput): ReuseDecision` where `input.sessions` is a list and the decision gains `{ kind: 'select'; candidates }`.

- [ ] **Step 1: Write the failing test**

```ts
const alice = { id: 's1', subjectId: 'alice', authTime: new Date('2026-09-19T10:00:00Z') };
const bob = { id: 's2', subjectId: 'bob', authTime: new Date('2026-09-19T10:30:00Z') };

describe('decideReuse over a set', () => {
  it('reuses the only live session', () => {
    expect(decideReuse({ sessions: [alice], prompts: new Set(), maxAge: null, now })).toEqual({
      kind: 'reuse',
      sessionId: 's1',
      subjectId: 'alice',
      authTime: alice.authTime,
    });
  });

  it('asks which account when more than one is live, with no prompt at all', () => {
    const decision = decideReuse({ sessions: [alice, bob], prompts: new Set(), maxAge: null, now });
    expect(decision).toEqual({ kind: 'select', candidates: [alice, bob] });
  });

  it('asks which account for prompt=select_account even with one live session', () => {
    const prompts = new Set<PromptValue>(['select_account']);
    expect(decideReuse({ sessions: [alice], prompts, maxAge: null, now }).kind).toBe('select');
  });

  it('refuses under prompt=none when selection would be required', () => {
    const prompts = new Set<PromptValue>(['none']);
    expect(decideReuse({ sessions: [alice, bob], prompts, maxAge: null, now })).toEqual({
      kind: 'refuse',
      error: 'account_selection_required',
    });
  });

  it('refuses login_required under prompt=none with no session', () => {
    const prompts = new Set<PromptValue>(['none']);
    expect(decideReuse({ sessions: [], prompts, maxAge: null, now })).toEqual({
      kind: 'refuse',
      error: 'login_required',
    });
  });

  it('drops a session past max_age from the candidates rather than refusing outright', () => {
    const decision = decideReuse({ sessions: [stale, bob], prompts: new Set(), maxAge: 60, now });
    expect(decision).toEqual({
      kind: 'reuse',
      sessionId: 's2',
      subjectId: 'bob',
      authTime: bob.authTime,
    });
  });

  it('authenticates when prompt=login, whatever is live', () => {
    const prompts = new Set<PromptValue>(['login']);
    expect(decideReuse({ sessions: [alice, bob], prompts, maxAge: null, now }).kind).toBe(
      'authenticate',
    );
  });
});
```

The `max_age` case is the one worth stating out loud: a stale session among several is a candidate that no longer qualifies, not a reason to reject the request.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/usecase/session-reuse.test.ts`
Expected: FAIL — `input.sessions` is not read.

- [ ] **Step 3: Implement it**

```ts
export interface ResolvedSession {
  readonly id: string;
  readonly subjectId: string;
  readonly authTime: Date;
}

export type ReuseDecision =
  | {
      readonly kind: 'reuse';
      readonly sessionId: string;
      readonly subjectId: string;
      readonly authTime: Date;
    }
  | { readonly kind: 'select'; readonly candidates: readonly ResolvedSession[] }
  | { readonly kind: 'authenticate' }
  | { readonly kind: 'refuse'; readonly error: string };

function withinMaxAge(session: ResolvedSession, maxAge: number | null, now: Date): boolean {
  if (maxAge === null) return true;
  return now.getTime() - session.authTime.getTime() < maxAge * 1000;
}

// OIDC Core §3.1.2.1, §3.1.2.3 and §3.1.2.6. `prompt=none` forbids any user
// interface, so wherever this would otherwise ask — for credentials or for
// an account — it refuses instead, with the error that names what it would
// have asked for.
export function decideReuse(input: ReuseInput): ReuseDecision {
  const silent = input.prompts.has('none');
  if (input.prompts.has('login')) {
    return silent ? { kind: 'refuse', error: 'login_required' } : { kind: 'authenticate' };
  }

  const candidates = input.sessions.filter((session) =>
    withinMaxAge(session, input.maxAge, input.now),
  );

  if (candidates.length === 0) {
    return silent ? { kind: 'refuse', error: 'login_required' } : { kind: 'authenticate' };
  }

  const first = candidates[0];
  if (candidates.length === 1 && !input.prompts.has('select_account') && first !== undefined) {
    return {
      kind: 'reuse',
      sessionId: first.id,
      subjectId: first.subjectId,
      authTime: first.authTime,
    };
  }

  return silent
    ? { kind: 'refuse', error: 'account_selection_required' }
    : { kind: 'select', candidates };
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run packages/protocol-oidc/src/usecase/session-reuse.test.ts`
Expected: PASS, all seven.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/usecase/session-reuse.ts packages/protocol-oidc/src/usecase/session-reuse.test.ts
git commit -m "Decide session reuse over a set of sessions"
```

### Task 9: The account chooser page

**Files:**

- Create: `packages/protocol-oidc/src/view/select-account-html.ts`
- Create: `packages/protocol-oidc/src/view/select-account-html.test.ts`

**Interfaces:**

- Consumes: `RenderedPage`, the package's own `escapeHtml`.
- Produces: `renderSelectAccountPage(input: SelectAccountInput): RenderedPage`.

- [ ] **Step 1: Write the failing test**

```ts
const base = {
  realm: 'demo',
  authSessionId: 'a-session',
  accounts: [
    { sessionId: 's1', displayName: 'alice@example.test' },
    { sessionId: 's2', displayName: 'bob@example.test' },
  ],
};

describe('renderSelectAccountPage', () => {
  it('offers one submit per live session, naming the session id', () => {
    const page = renderSelectAccountPage(base);
    expect(page.body).toContain('value="s1"');
    expect(page.body).toContain('value="s2"');
    expect(page.body).toContain('alice@example.test');
  });

  it('offers a way to use another account', () => {
    expect(renderSelectAccountPage(base).body).toContain('name="use_other"');
  });

  it('escapes a display name', () => {
    const page = renderSelectAccountPage({
      ...base,
      accounts: [{ sessionId: 's1', displayName: '<script>alert(1)</script>' }],
    });
    expect(page.body).not.toContain('<script>alert(1)</script>');
    expect(page.body).toContain('&lt;script&gt;');
  });

  it('carries no script and declares no frames', () => {
    const page = renderSelectAccountPage(base);
    expect(page.script).toBeNull();
    expect(page.frames).toEqual([]);
  });

  it('returns a title and a body that is not the whole document', () => {
    const page = renderSelectAccountPage(base);
    expect(page.title).toBe('Choose an account');
    expect(page.body).not.toContain('<html');
    expect(page.html).toContain('<html');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/view/select-account-html.test.ts`
Expected: FAIL — module not found. `page.frames` also does not exist yet; Task 13 adds it, so until then return `frames: []` from this renderer and let the type error stand as the reminder — or land Task 13 first if the executor prefers. Either order works; the tests above are written for the final shape.

- [ ] **Step 3: Implement it**

Follow `consent-html.ts` exactly for structure: a module-level document shell, `escapeHtml` on every interpolated value, one `<form method="post">` posting to the same path, the `auth_session_id` carried in a hidden field, `RenderedPage` returned with `html`, `body`, `title`, `script: null` and `frames: []`.

- [ ] **Step 4: Run it**

Run: `npx vitest run packages/protocol-oidc/src/view/select-account-html.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/view/select-account-html.ts packages/protocol-oidc/src/view/select-account-html.test.ts
git commit -m "Render the account chooser"
```

### Task 10: Selection on the wire

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/authorization-request.ts`
- Modify: `packages/protocol-oidc/src/view/routes/authorize.ts`
- Create: `packages/protocol-oidc/tests/select-account.int.test.ts`

**Interfaces:**

- Consumes: `decideReuse`, `renderSelectAccountPage`.
- Produces: the `select` outcome on the authorize path, and its POST handler.

- [ ] **Step 1: Write the failing integration test**

```ts
it('shows the chooser when a browser holds two live sessions', async () => {
  const response = await authorize({ cookie: twoSessions });
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('Choose an account');
});

it('shows the chooser for prompt=select_account with one live session', async () => {
  const response = await authorize({ cookie: oneSession, prompt: 'select_account' });
  expect(response.body).toContain('Choose an account');
});

it('redirects with account_selection_required under prompt=none', async () => {
  const response = await authorize({ cookie: twoSessions, prompt: 'none' });
  expect(response.statusCode).toBe(302);
  expect(new URL(response.headers.location).searchParams.get('error')).toBe(
    'account_selection_required',
  );
});

it('continues the authorization with the chosen session', async () => {
  const chooser = await authorize({ cookie: twoSessions });
  const response = await postSelection({ session_id: aliceSessionId, cookie: twoSessions });
  expect(response.statusCode).toBe(302);
  expect(new URL(response.headers.location).searchParams.get('code')).toBeTruthy();
});

it('refuses a chosen session the cookie does not name', async () => {
  const response = await postSelection({ session_id: strangerSessionId, cookie: twoSessions });
  expect(response.statusCode).toBe(400);
});

it('falls through to the login form when the user asks for another account', async () => {
  const response = await postSelection({ use_other: 'true', cookie: twoSessions });
  expect(response.body).toContain('name="password"');
});
```

The fifth is the security case: the posted session id is a claim from the browser, and the cookie is what authorizes it.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/select-account.int.test.ts`
Expected: FAIL — the ordinary login form is rendered instead.

- [ ] **Step 3: Implement the outcome and the handler**

In `authorization-request.ts`, map `decideReuse`'s `select` to a new outcome carrying the candidates and the authentication session id. In `routes/authorize.ts`, render it with `sendHtml(reply, 200, renderSelectAccountPage(...))`. Add the POST branch: resolve the browser's sessions again, require the posted `session_id` to be a member, and continue the authorization exactly as a reuse would; `use_other` falls through to the login form.

- [ ] **Step 4: Run it**

Run: `npx vitest run packages/protocol-oidc`
Expected: PASS.

- [ ] **Step 5: Resolve the three clause rows**

In `docs/protocols/oidc-core.md`, the three `deferred: P3b` rows for §3.1.2.1 and §3.1.2.6 now have an implementation. Replace the marker with the test id that proves each, in the shape the file's other rows use.

- [ ] **Step 6: Update the documentation**

`docs/request-paths.md` gains an account-selection section with a real transcript: two logins in one browser, the chooser, the selection, the code. `README.md`'s description of the login flow gains the chooser.

- [ ] **Step 7: Run the full verification and push**

```bash
pnpm verify
git add packages/protocol-oidc docs
git commit -m "Choose among a browser's sessions at /authorize"
git push
gh pr checks --watch
```

Answer the review, then close the increment:

```bash
gh pr merge --merge
git checkout p3b-sessions-logout-token-surface && git pull
git checkout -b p3b/4-frontchannel-logout
```

---

## Increment 4 — front-channel logout

**Branch:** `p3b/4-frontchannel-logout`, from the integration branch, with a pull request into it.

### Task 11: Spike — what survives, and the clause table

**Files:**

- Create: `docs/protocols/oidc-frontchannel.md`
- Modify: `packages/protocol-oidc/src/service/client-metadata.test.ts`

**Interfaces:**

- Produces: the clause ids the rest of this increment traces against, and the evidence for the ADR in Task 13.

- [ ] **Step 1: Find out what a framed logout URI can still do**

Serve two origins locally — one standing in for the OP, one for the RP — and load a page on the first that frames a logout endpoint on the second which sets and reads its own cookie. Record, per browser tested: whether the framed request carries the RP's existing cookies, and whether it may set one.

`assumption:` current third-party cookie policy prevents both in the common cross-site case. This decides whether the ADR and the documentation promise delivery or attempts.

- [ ] **Step 2: Read the specification and write the clause table**

Write `docs/protocols/oidc-frontchannel.md` in the shape `docs/protocols/oidc-backchannel.md` already uses: a reading note, then a table of `| section | strength | clause | status |` rows covering OpenID Connect Front-Channel Logout 1.0 §2 (the `frontchannel_logout_uri` and `frontchannel_logout_session_required` metadata), §3 (the `iss` and `sid` parameters) and §5 (the security considerations). Record the spike's finding in the reading note, with the browsers and versions it was run against.

- [ ] **Step 3: Re-trace the three test ids**

`packages/protocol-oidc/src/service/client-metadata.test.ts` carries three `ODUDU-CLIENT-META-FRONTCHANNEL-*` ids, invented because no clause table existed to trace against. Replace each with the real clause id from the table just written.

- [ ] **Step 4: Run the trace tool**

Run: `pnpm trace`
Expected: the new document is picked up and the three ids resolve.

- [ ] **Step 5: Commit**

```bash
git add docs/protocols/oidc-frontchannel.md packages/protocol-oidc/src/service/client-metadata.test.ts
git commit -m "Add the front-channel logout clause table and trace to it"
```

### Task 12: The metadata P3a left unregistered

**Files:**

- Create: `packages/db/drizzle/0050_frontchannel_logout_session_required.sql`
- Modify: `packages/protocol-oidc/src/schema/client-oidc-config.ts`
- Modify: `packages/protocol-oidc/src/service/client-metadata.ts`
- Modify: `packages/protocol-oidc/src/repository/client-oidc-config.ts`
- Modify: `packages/protocol-oidc/src/usecase/client-registration.ts`
- Modify: `packages/protocol-oidc/src/view/routes/client-registration.ts`
- Modify: `packages/protocol-oidc/src/service/client-metadata.test.ts`

**Interfaces:**

- Produces: `ClientOidcConfigRecord.frontchannelLogoutSessionRequired: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
it('accepts frontchannel_logout_session_required and defaults it to false', () => {
  const outcome = parseClientMetadata(ok({ frontchannel_logout_session_required: true }));
  expect(outcome.kind).toBe('ok');
  expect(outcome.metadata.frontchannelLogoutSessionRequired).toBe(true);

  const omitted = parseClientMetadata(ok({}));
  expect(omitted.metadata.frontchannelLogoutSessionRequired).toBe(false);
});

it('refuses a non-boolean frontchannel_logout_session_required', () => {
  expect(parseClientMetadata(ok({ frontchannel_logout_session_required: 'yes' })).kind).toBe(
    'invalid',
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/service/client-metadata.test.ts`
Expected: FAIL — the field is not read.

- [ ] **Step 3: Write the migration**

```sql
-- The front-channel twin of backchannel_logout_session_required, which
-- 0045 added while this one was missed. Front-Channel Logout §2: when true,
-- the logout URI must be called with iss and sid.
ALTER TABLE client_oidc_config
  ADD COLUMN frontchannel_logout_session_required boolean NOT NULL DEFAULT false;
```

- [ ] **Step 4: Thread it through**

Declare the column; add `frontchannel_logout_session_required: z.boolean().optional()` to the metadata schema beside the existing front-channel field; carry it through `parseClientMetadata`, the repository's insert and record, the registration usecase, and the registration response echo — following exactly what `backchannelLogoutSessionRequired` already does at each site.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/protocol-oidc packages/db`
Expected: PASS, including `schema-drift.int.test.ts`.

- [ ] **Step 6: Update the documentation**

`docs/request-paths.md`'s dynamic client registration section lists the accepted metadata. Add the field and re-run that transcript.

- [ ] **Step 7: Commit**

```bash
git add packages/db/drizzle/0050_frontchannel_logout_session_required.sql packages/protocol-oidc docs/request-paths.md
git commit -m "Register frontchannel_logout_session_required"
```

### Task 13: A page declares the origins it frames

**Files:**

- Modify: `packages/kernel/src/page.ts`
- Modify: `packages/kernel/src/page.test.ts`
- Create: `docs/adr/0032-a-page-declares-the-origins-it-frames.md`
- Modify: every `*-html.ts` renderer (they gain `frames: []`)

**Interfaces:**

- Produces: `RenderedPage.frames: readonly string[]`, and `frame-src` derived from it in `pageHeaders`.

- [ ] **Step 1: Write the failing test**

```ts
it('names no frame-src for a page that frames nothing', () => {
  const policy = headerValue(pageHeaders({ ...page, frames: [] }), 'content-security-policy');
  expect(policy).not.toContain('frame-src');
  expect(policy).toContain("default-src 'none'");
});

it('derives frame-src from the origins the page itself carries', () => {
  const policy = headerValue(
    pageHeaders({ ...page, frames: ['https://rp.example', 'https://other.example'] }),
    'content-security-policy',
  );
  expect(policy).toContain('frame-src https://rp.example https://other.example');
});

it('keeps x-frame-options DENY for a page that frames others', () => {
  const headers = pageHeaders({ ...page, frames: ['https://rp.example'] });
  expect(headerValue(headers, 'x-frame-options')).toBe('DENY');
});

it('deduplicates repeated origins rather than repeating them in the policy', () => {
  const policy = headerValue(
    pageHeaders({ ...page, frames: ['https://rp.example', 'https://rp.example'] }),
    'content-security-policy',
  );
  expect(policy).toContain('frame-src https://rp.example;');
  expect(policy.match(/rp\.example/gu)).toHaveLength(1);
});
```

The last matters because the origins come from a row per relying party, and two clients may register logout URIs on one host.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/kernel/src/page.test.ts`
Expected: FAIL — `frames` is not part of `RenderedPage`.

- [ ] **Step 3: Implement it**

In `page.ts`, add to `RenderedPage`:

```ts
  // The exact origins this page's own markup frames. `frame-src` is derived
  // from it, so a policy can never license an origin the markup does not
  // embed, nor refuse one it does — the failure mode ADR 0018's amendment
  // describes for scripts, which is silent for frames in the same way.
  frames: readonly string[];
```

and in `policyFor`, after the script directives:

```ts
const framed = [...new Set(page.frames)];
if (framed.length > 0) directives.push(`frame-src ${framed.join(' ')}`);
```

`x-frame-options: DENY` is untouched: it governs this page being framed, not this page framing others.

- [ ] **Step 4: Add `frames: []` to every renderer**

Each `*-html.ts` in `protocol-oidc`, `authn-flows` and `account` returns a `RenderedPage` and now needs the member. TypeScript will name every site.

- [ ] **Step 5: Write the ADR**

`docs/adr/0032-a-page-declares-the-origins-it-frames.md`, in the shape of ADR 0018 and 0029. It must record: that the alternative was a policy assembled beside the markup, and why that fails silently; that framing a registered URI hands that client a top-navigation primitive, which is **accepted**; that `sandbox` without `allow-same-origin` would remove it and would also remove the cookies that are the whole mechanism, so it is not the answer; and what Task 11's spike found about third-party cookie policy, which is why the documentation says attempts rather than delivery.

- [ ] **Step 6: Run the tests**

Run: `pnpm verify`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/kernel packages/protocol-oidc packages/authn-flows packages/account docs/adr/0032-a-page-declares-the-origins-it-frames.md
git commit -m "Derive frame-src from the page that frames"
```

### Task 14: The logout page frames the session's relying parties

**Files:**

- Modify: `packages/protocol-oidc/src/view/logout-html.ts`
- Modify: `packages/protocol-oidc/src/usecase/logout.ts`
- Modify: `packages/protocol-oidc/src/repository/grants.ts`
- Create: `packages/protocol-oidc/tests/frontchannel-logout.int.test.ts`

**Interfaces:**

- Consumes: `RenderedPage.frames`, `chooseEvictions` is unrelated.
- Produces: `tokenGrantRepository(tx).clientsForSession(sessionId): Promise<ClientLogoutTarget[]>` and the logout page's frame list.

- [ ] **Step 1: Write the failing integration test**

```ts
it('frames the front-channel logout URI of every client that used the session', async () => {
  const page = await endSessionAndRender();

  expect(page).toContain('<iframe src="https://rp-one.example/logout?');
  expect(page).toContain('<iframe src="https://rp-two.example/logout?');
});

it('carries iss, and sid only for a client that required it', async () => {
  const page = await endSessionAndRender();

  const withSession = frameUrl(page, 'rp-one.example');
  expect(withSession.searchParams.get('iss')).toBe(issuer);
  expect(withSession.searchParams.get('sid')).toBe(sessionId);

  const without = frameUrl(page, 'rp-two.example');
  expect(without.searchParams.get('iss')).toBe(issuer);
  expect(without.searchParams.has('sid')).toBe(false);
});

it('keeps a query the client registered, and adds to it', async () => {
  // registered as https://rp-three.example/logout?tenant=a
  const url = frameUrl(await endSessionAndRender(), 'rp-three.example');
  expect(url.searchParams.get('tenant')).toBe('a');
  expect(url.searchParams.get('iss')).toBe(issuer);
});

it('names exactly the framed origins in the policy, and nothing else', async () => {
  const response = await endSession();
  const policy = response.headers['content-security-policy'];
  expect(policy).toContain('frame-src https://rp-one.example https://rp-two.example');
  expect(policy).not.toContain('https://rp-never-used.example');
});

it('frames nothing for a client that registered no front-channel URI', async () => {
  expect(await endSessionAndRender()).not.toContain('rp-no-frontchannel.example');
});

it('frames nothing at all when the session had no grants', async () => {
  const response = await endSessionWithNoGrants();
  expect(response.headers['content-security-policy']).not.toContain('frame-src');
});
```

The third is the Back-Channel §2.2 clause restated for the front channel: a registered query component survives the parameters added to it.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/frontchannel-logout.int.test.ts`
Expected: FAIL — the logout page frames nothing.

- [ ] **Step 3: Add the repository read**

```ts
    // Front-Channel §2 and Back-Channel §2.3's "set of logged-in RPs": the
    // distinct clients that hold a grant issued under this session. No
    // tracking to maintain — the grants are already the record, and
    // token_grants_by_session is the index for it.
    async clientsForSession(sessionId: string): Promise<ClientLogoutTarget[]> {
      const rows = await tx
        .selectDistinct({
          clientId: clientOidcConfig.clientId,
          frontchannelLogoutUri: clientOidcConfig.frontchannelLogoutUri,
          frontchannelLogoutSessionRequired: clientOidcConfig.frontchannelLogoutSessionRequired,
          backchannelLogoutUri: clientOidcConfig.backchannelLogoutUri,
          backchannelLogoutSessionRequired: clientOidcConfig.backchannelLogoutSessionRequired,
        })
        .from(tokenGrants)
        .innerJoin(clientOidcConfig, eq(clientOidcConfig.clientId, tokenGrants.clientId))
        .where(eq(tokenGrants.sessionId, sessionId));
      return rows;
    },
```

- [ ] **Step 4: Build the frame URLs**

A pure function in the service layer, so it is unit-testable without a database:

```ts
// Front-Channel §3. `iss` always; `sid` only where the client registered
// frontchannel_logout_session_required. Built with URL so that a query the
// client registered survives rather than being replaced.
export function frontChannelLogoutUrl(
  registered: string,
  issuer: string,
  sessionId: string,
  sessionRequired: boolean,
): string {
  const url = new URL(registered);
  url.searchParams.set('iss', issuer);
  if (sessionRequired) url.searchParams.set('sid', sessionId);
  return url.toString();
}
```

- [ ] **Step 5: Render the frames**

`logout-html.ts` takes the built URLs, emits one `<iframe src="…">` each with every value through `escapeHtml`, and returns them as `frames` — as **origins**, since that is what `frame-src` matches:

```ts
  frames: urls.map((url) => new URL(url).origin),
```

- [ ] **Step 6: Run it**

Run: `npx vitest run packages/protocol-oidc`
Expected: PASS.

- [ ] **Step 7: Resolve the clause rows and document it**

Mark the Front-Channel §2 and §3 rows implemented with their test ids. In `docs/request-paths.md`, replace the front-channel entry in "what is not implemented" with a real transcript of the logout page, and say plainly — per Task 11's spike — that framing is an attempt, not a guarantee, with the reason. `README.md`'s logout section gains the same sentence.

- [ ] **Step 8: Push**

```bash
pnpm verify
git add packages/protocol-oidc docs
git commit -m "Frame each relying party's front-channel logout URI"
git push
gh pr checks --watch
```

Answer the review, then close the increment:

```bash
gh pr merge --merge
git checkout p3b-sessions-logout-token-surface && git pull
git checkout -b p3b/5-backchannel-logout
```

---

## Increment 5 — back-channel logout

**Branch:** `p3b/5-backchannel-logout`, from the integration branch, with a pull request into it.

Copied from the outbox, which is ADR 0024's split already built once: `email_outbox` (0043), `sendMailCommand` (`apps/server/src/main.ts:33`) and `outboxModule` (`apps/server/src/modules/outbox.ts:88`). Read all three before starting.

### Task 15: The queue

**Files:**

- Create: `packages/db/drizzle/0051_backchannel_logout_deliveries.sql`
- Create: `packages/protocol-oidc/src/schema/logout-deliveries.ts`
- Create: `packages/protocol-oidc/src/repository/logout-deliveries.ts`
- Create: `packages/protocol-oidc/tests/logout-deliveries.int.test.ts`

**Interfaces:**

- Produces: `logoutDeliveryRepository(tx)` with `enqueue`, `claimDue`, `markDelivered`, `markFailed`.

- [ ] **Step 1: Write the failing integration test**

```ts
it('returns a due delivery and not one scheduled for later', async () => {
  await repo.enqueue([dueRow, laterRow]);
  const claimed = await repo.claimDue(now, 10);
  expect(claimed.map((d) => d.id)).toEqual([dueRow.id]);
});

it('does not return a delivery already marked delivered', async () => {
  await repo.markDelivered(dueRow.id, now);
  expect(await repo.claimDue(now, 10)).toEqual([]);
});

it('backs a failed delivery off rather than retrying it immediately', async () => {
  await repo.markFailed(dueRow.id, now, 'connect ECONNREFUSED');
  const again = await repo.claimDue(now, 10);
  expect(again).toEqual([]);
  expect(await repo.claimDue(new Date(now.getTime() + 60_000), 10)).toHaveLength(1);
});

it('stops retrying after the attempt limit', async () => {
  await exhaustAttempts(dueRow.id);
  expect(await repo.claimDue(farFuture, 10)).toEqual([]);
});

it('cannot see another realm's deliveries', async () => {
  await withRealm(app.db, otherRealmId, async (tx) => {
    expect(await logoutDeliveryRepository(tx).claimDue(now, 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/logout-deliveries.int.test.ts`
Expected: FAIL — the table does not exist.

- [ ] **Step 3: Write the migration**

Model it on `0043_email_outbox.sql`, including the realm-leading indexes and the RLS policy:

```sql
-- One row per relying party that must be told a session ended. Written in
-- the same transaction that ends the session, so a delivery cannot be lost
-- to a crash between the two, and drained by `odudu send-logouts`.
CREATE TABLE backchannel_logout_deliveries (
  id uuid PRIMARY KEY,
  realm_id uuid NOT NULL REFERENCES realms (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  endpoint text NOT NULL,
  logout_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);

ALTER TABLE backchannel_logout_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE backchannel_logout_deliveries FORCE ROW LEVEL SECURITY;

CREATE POLICY backchannel_logout_deliveries_isolation ON backchannel_logout_deliveries
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

CREATE INDEX backchannel_logout_deliveries_pending
  ON backchannel_logout_deliveries (realm_id, next_attempt_at)
  WHERE delivered_at IS NULL;

CREATE INDEX backchannel_logout_deliveries_by_delivered
  ON backchannel_logout_deliveries (realm_id, delivered_at);
```

The logout token is stored rather than minted at send time: it is signed at the moment the session ended, and re-minting later would date it from the attempt rather than the event.

- [ ] **Step 4: Write the schema and repository**

Follow `packages/email/src/repository/outbox.ts` for shape, including its attempt limit and backoff. `claimDue` selects `for update skip locked` so two passes cannot claim the same row.

- [ ] **Step 5: Run it**

Run: `npx vitest run packages/protocol-oidc/tests/logout-deliveries.int.test.ts`
Expected: PASS, all five.

- [ ] **Step 6: Commit**

```bash
git add packages/db/drizzle/0051_backchannel_logout_deliveries.sql packages/protocol-oidc
git commit -m "Add the back-channel logout delivery queue"
```

### Task 16: The logout token

**Files:**

- Create: `packages/protocol-oidc/src/service/logout-token.ts`
- Create: `packages/protocol-oidc/src/service/logout-token.test.ts`

**Interfaces:**

- Consumes: `signJwt` from `@odudu/crypto`.
- Produces: `logoutTokenClaims(input): LogoutTokenClaims`, `LOGOUT_TOKEN_TYP`, `LOGOUT_TOKEN_LIFETIME_SECONDS`.

- [ ] **Step 1: Write the failing test**

```ts
describe('logoutTokenClaims', () => {
  const claims = logoutTokenClaims({
    issuer: 'https://op.example/realms/demo',
    audience: 'rp-one',
    subject: 'subject-1',
    sessionId: 'session-1',
    now: new Date('2026-09-19T10:00:00Z'),
  });

  it('carries iss, aud, iat, exp and jti', () => {
    expect(claims.iss).toBe('https://op.example/realms/demo');
    expect(claims.aud).toBe('rp-one');
    expect(claims.iat).toBe(1789812000);
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('carries the events member, as an object containing the empty object', () => {
    expect(claims.events).toEqual({
      'http://schemas.openid.net/event/backchannel-logout': {},
    });
  });

  it('carries both sub and sid', () => {
    expect(claims.sub).toBe('subject-1');
    expect(claims.sid).toBe('session-1');
  });

  it('carries no nonce', () => {
    expect('nonce' in claims).toBe(false);
  });

  it('expires within two minutes', () => {
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(120);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/service/logout-token.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

```ts
import { newId } from '@odudu/kernel';

export const LOGOUT_TOKEN_TYP = 'logout+jwt';
export const LOGOUT_TOKEN_LIFETIME_SECONDS = 120;

const EVENT = 'http://schemas.openid.net/event/backchannel-logout';

export interface LogoutTokenClaims {
  readonly iss: string;
  readonly aud: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
  readonly sub: string;
  readonly sid: string;
  readonly events: Readonly<Record<string, Record<string, never>>>;
}

// Back-Channel Logout §2.4. `nonce` is prohibited, the event member's value
// is the empty object, and §4's short expiry is two minutes.
export function logoutTokenClaims(input: LogoutTokenInput): LogoutTokenClaims {
  const iat = Math.floor(input.now.getTime() / 1000);
  return {
    iss: input.issuer,
    aud: input.audience,
    iat,
    exp: iat + LOGOUT_TOKEN_LIFETIME_SECONDS,
    jti: newId(),
    sub: input.subject,
    sid: input.sessionId,
    events: { [EVENT]: {} },
  };
}
```

Signing uses `signJwt` with `typ: LOGOUT_TOKEN_TYP`, the same way the ID token is signed.

- [ ] **Step 4: Run it**

Run: `npx vitest run packages/protocol-oidc/src/service/logout-token.test.ts`
Expected: PASS.

- [ ] **Step 5: Resolve the clause rows**

Eleven `deferred: P3b` rows in `docs/protocols/oidc-backchannel.md` §2.4 are now implemented. Mark each with the test id above that proves it. The encryption rows (§2.4's "may also be encrypted" and the `iss` replication beside it) stay deferred, with a one-line reason: JWE arrives in Increment 8, and nothing has asked for an encrypted logout token.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol-oidc/src/service/logout-token.ts packages/protocol-oidc/src/service/logout-token.test.ts docs/protocols/oidc-backchannel.md
git commit -m "Mint the back-channel logout token"
```

### Task 17: Ending a session enqueues its deliveries

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/logout.ts`
- Modify: `packages/protocol-oidc/src/index.ts`
- Create: `packages/protocol-oidc/tests/logout-enqueue.int.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it('enqueues one delivery per client that registered a back-channel URI', async () => {
  await endSession();
  expect(await pendingFor(sessionId)).toEqual([
    { clientId: 'rp-one', endpoint: 'https://rp-one.example/backchannel' },
  ]);
});

it('enqueues nothing for a client that registered none', async () => {
  await endSession();
  expect((await pendingFor(sessionId)).map((d) => d.clientId)).not.toContain('rp-no-backchannel');
});

it('enqueues in the same transaction that ends the session', async () => {
  await expect(endSessionWithEnqueueFailing()).rejects.toThrow();
  expect(await sessionIsStillLive(sessionId)).toBe(true);
});

it('enqueues nothing twice when logout is called twice', async () => {
  await endSession();
  await endSession();
  expect(await pendingFor(sessionId)).toHaveLength(1);
});
```

The third is the point of the increment: if enqueueing fails, the session must not have ended.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/logout-enqueue.int.test.ts`
Expected: FAIL — nothing is enqueued.

- [ ] **Step 3: Implement it**

`endSession` already runs "one transaction: ends the session row and revokes every grant whose session_id is that session". Extend that same transaction: read `clientsForSession`, mint a logout token per client with a back-channel URI, and enqueue them. Its comment says what the transaction does; update it rather than adding a second one.

- [ ] **Step 4: Run it**

Run: `npx vitest run packages/protocol-oidc`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc
git commit -m "Enqueue back-channel deliveries when a session ends"
```

### Task 18: The delivery pass

**Files:**

- Create: `packages/protocol-oidc/src/usecase/send-logouts.ts`
- Create: `packages/protocol-oidc/src/usecase/send-logouts.test.ts`

**Interfaces:**

- Produces: `sendLogouts(deps, now): Promise<{ delivered: number; failed: number }>`, taking its transport and its `now` as arguments and holding no timer.

- [ ] **Step 1: Write the failing test**

```ts
describe('sendLogouts', () => {
  it('posts logout_token as form encoding, and marks the row delivered on 200', async () => {
    const transport = recordingTransport({ status: 200 });
    const result = await sendLogouts({ ...deps, transport }, now);

    expect(transport.calls[0]).toMatchObject({
      url: 'https://rp-one.example/backchannel',
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      body: `logout_token=${encodeURIComponent(token)}`,
    });
    expect(result).toEqual({ delivered: 1, failed: 0 });
  });

  it('retries a 503, which is recoverable', async () => {
    const result = await sendLogouts({ ...deps, transport: transportWith(503) }, now);
    expect(result).toEqual({ delivered: 0, failed: 1 });
    expect(await nextAttemptOf(rowId)).toBeInstanceOf(Date);
  });

  it('does not retry a 400, which is not', async () => {
    await sendLogouts({ ...deps, transport: transportWith(400) }, now);
    expect(await isRetryable(rowId)).toBe(false);
  });

  it('abandons a relying party that accepts the connection and never answers', async () => {
    const transport = hangingTransport();
    const result = await sendLogouts({ ...deps, transport }, now);

    expect(transport.aborted).toBe(true);
    expect(result).toEqual({ delivered: 0, failed: 1 });
  });

  it('keeps draining after one relying party fails', async () => {
    const result = await sendLogouts({ ...deps, transport: failsFirstOnly() }, now);
    expect(result).toEqual({ delivered: 1, failed: 1 });
  });

  it('delivers nothing and touches nothing when the queue is empty', async () => {
    expect(await sendLogouts({ ...deps, transport: neverCalled }, now)).toEqual({
      delivered: 0,
      failed: 0,
    });
  });
});
```

The fourth is the Review Focus item: without a response timeout one relying party stops the queue draining for every realm. The transport carries both a connect and a response deadline, as `apps/server/src/client-key-transport.ts` already does — read it rather than inventing a second policy.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/usecase/send-logouts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

One pass: claim due rows, post each, mark delivered or failed. §2.5's two SHOULDs are a pair — a recoverable failure is delayed and retried, and everything else is not retransmitted — so classify the outcome before deciding. No timer, no interval, `now` as an argument.

- [ ] **Step 4: Run it**

Run: `npx vitest run packages/protocol-oidc/src/usecase/send-logouts.test.ts`
Expected: PASS, all six.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc/src/usecase/send-logouts.ts packages/protocol-oidc/src/usecase/send-logouts.test.ts
git commit -m "Drain the back-channel logout queue in one pass"
```

### Task 19: The command and the loop

**Files:**

- Create: `apps/server/src/cli/send-logouts.ts`
- Create: `apps/server/src/modules/logout-sender.ts`
- Create: `apps/server/src/modules/logout-sender.test.ts`
- Modify: `apps/server/src/main.ts`

- [ ] **Step 1: Write the failing loop test**

Model it on `apps/server/src/scheduler.test.ts` and `modules/outbox.ts`'s own tests:

```ts
it('runs a pass on each tick', async () => {
  vi.useFakeTimers();
  const run = vi.fn().mockResolvedValue(undefined);
  const module = logoutSenderModule({ run, intervalMs: 60_000, jitterMs: 0 });
  await module.start();

  await vi.advanceTimersByTimeAsync(60_000);
  expect(run).toHaveBeenCalledTimes(1);
});

it('runs again after a pass throws', async () => {
  vi.useFakeTimers();
  const run = vi.fn().mockRejectedValueOnce(new Error('rp exploded')).mockResolvedValue(undefined);
  await logoutSenderModule({ run, intervalMs: 60_000, jitterMs: 0 }).start();

  await vi.advanceTimersByTimeAsync(60_000);
  await vi.advanceTimersByTimeAsync(60_000);

  expect(run).toHaveBeenCalledTimes(2);
});

it('refuses to start when the schedule is configured with no interval', () => {
  expect(() => logoutSenderModule({ run, intervalMs: 0, jitterMs: 0 })).toThrow(
    /ODUDU_LOGOUT_SENDER_INTERVAL_MS/u,
  );
});
```

The second asserts a **later run**, not that the error was logged: "the run fired" says nothing about whether the loop is still alive.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/server/src/modules/logout-sender.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the command**

`apps/server/src/cli/send-logouts.ts`, copying `cli/send-mail.ts`: open the database, iterate the realms, call `sendLogouts` with `new Date()`, return counts. All the logic is here, none of it in the loop.

- [ ] **Step 4: Write the loop**

`apps/server/src/modules/logout-sender.ts`, copying `modules/outbox.ts`: an interval, its jitter, a call, a `catch` that logs, a `stop` that awaits the pass in flight. Nothing else. It decides at construction what cannot change per tick and refuses to start otherwise, naming the variable and the switch that turns the schedule off.

- [ ] **Step 5: Wire it in**

In `main.ts`, beside the `reap` and `send-mail` branches:

```ts
if (process.argv[2] === 'send-logouts') {
  ...
    console.log(JSON.stringify(await sendLogoutsCommand()));
  ...
}
```

and register `logoutSenderModule` beside `outboxModule`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run apps/server`
Expected: PASS.

- [ ] **Step 7: Document the command**

`README.md` lists the commands and the environment variables that schedule them. Add `odudu send-logouts`, its interval variable, and the sentence that external scheduling is a supported configuration rather than a fallback — as `odudu reap` already says.

- [ ] **Step 8: Commit**

```bash
git add apps/server README.md
git commit -m "Add the send-logouts command and its schedule"
```

### Task 20: Retention, discovery and the close of the increment

**Files:**

- Modify: `apps/server/src/cli/reap.ts`
- Modify: `packages/protocol-oidc/src/usecase/discovery.ts`
- Modify: `packages/protocol-oidc/tests/discovery.int.test.ts`
- Modify: `docs/request-paths.md`

- [ ] **Step 1: Write the failing discovery test**

```ts
it('advertises back-channel logout, with session support', async () => {
  const document = await discovery();
  expect(document.backchannel_logout_supported).toBe(true);
  expect(document.backchannel_logout_session_supported).toBe(true);
});

it('advertises front-channel logout, with session support', async () => {
  const document = await discovery();
  expect(document.frontchannel_logout_supported).toBe(true);
  expect(document.frontchannel_logout_session_supported).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/discovery.int.test.ts`
Expected: FAIL — the members are absent.

- [ ] **Step 3: Advertise them**

Add the four members to the discovery document. They were deliberately absent while nothing read the columns; now something does.

- [ ] **Step 4: Add the retention pass**

In `reap.ts`, beside the outbox's own retention: a delivered row past its window, and one that has spent its attempts and been visible to an operator for its own longer window. Add the test alongside the existing retention tests.

- [ ] **Step 5: Resolve the remaining clause rows**

The §2.1, §2.3, §2.5 and §4 rows in `docs/protocols/oidc-backchannel.md` now have implementations. Mark each with its test id. Anything still deferred keeps a reason.

- [ ] **Step 6: Replace the "not implemented" entry**

`docs/request-paths.md`'s "Front-channel and back-channel logout" bullet under "Endpoints that do not exist at all" is no longer true. Replace it with a real transcript: a login, two clients, a logout, the framed page, and the queue drained by `odudu send-logouts` with its real output. Name the stack the counts were captured against.

- [ ] **Step 7: Verify and push**

```bash
pnpm verify
git add apps/server packages/protocol-oidc docs
git commit -m "Advertise logout, and reap delivered logout rows"
git push
gh pr checks --watch
```

Answer the review, then close the increment:

```bash
gh pr merge --merge
git checkout p3b-sessions-logout-token-surface && git pull
git checkout -b p3b/6-token-surface
```

---

## Increment 6 — audience, `resource`, introspection and revocation

**Branch:** `p3b/6-token-surface`, from the integration branch, with a pull request into it.

### Task 21: Spike — RFC 7662 §2.2, and three clause tables

**Files:**

- Create: `docs/protocols/rfc7662.md`, `docs/protocols/rfc7009.md`, `docs/protocols/rfc8707.md`

- [ ] **Step 1: Read the specifications**

```bash
curl -s https://www.rfc-editor.org/rfc/rfc7662.txt > /tmp/rfc7662.txt
curl -s https://www.rfc-editor.org/rfc/rfc7009.txt > /tmp/rfc7009.txt
curl -s https://www.rfc-editor.org/rfc/rfc8707.txt > /tmp/rfc8707.txt
```

- [ ] **Step 2: Settle the spike**

`assumption:` RFC 7662 §2.2 permits answering `{"active": false}` to an authenticated caller not authorized for the token, rather than requiring an error. Find the sentence, quote it in `rfc7662.md`'s reading note, and record whether the assumption held.

If it did **not** hold, stop: the spec's decision 3 needs revisiting before `/introspect` is built, and the alternative it rejected — an explicit error — becomes the behaviour.

- [ ] **Step 3: Write the three clause tables**

In the shape the existing `docs/protocols/` documents use. Every row a `MUST`/`SHOULD`/`MAY` with its section, and a status that is either a test id or `deferred: <phase>` with a reason. Rows this increment will implement start as deferred and are resolved by the task that implements them.

- [ ] **Step 4: Run the trace tool and commit**

```bash
pnpm trace
git add docs/protocols/rfc7662.md docs/protocols/rfc7009.md docs/protocols/rfc8707.md
git commit -m "Add clause tables for introspection, revocation and resource"
```

### Task 22: `resource`, parsed and checked

**Files:**

- Create: `packages/protocol-oidc/src/service/resource-indicator.ts`
- Create: `packages/protocol-oidc/src/service/resource-indicator.test.ts`

**Interfaces:**

- Produces: `parseResource(raw: string | string[] | undefined, registered: readonly string[]): ResourceOutcome`.

- [ ] **Step 1: Write the failing test**

```ts
const registered = ['https://api.example', 'https://reports.example'];

describe('parseResource', () => {
  it('accepts a single registered value', () => {
    expect(parseResource('https://api.example', registered)).toEqual({
      kind: 'ok',
      audience: ['https://api.example'],
    });
  });

  it('falls back to every registered audience when none is asked for', () => {
    expect(parseResource(undefined, registered)).toEqual({ kind: 'ok', audience: registered });
  });

  it('refuses two values rather than taking the first', () => {
    expect(parseResource(['https://api.example', 'https://reports.example'], registered)).toEqual({
      kind: 'invalid_target',
    });
  });

  it('refuses a value the client did not register', () => {
    expect(parseResource('https://elsewhere.example', registered)).toEqual({
      kind: 'invalid_target',
    });
  });

  it('refuses a value carrying a fragment, which RFC 8707 §2 forbids', () => {
    expect(parseResource('https://api.example#x', registered)).toEqual({ kind: 'invalid_target' });
  });

  it('refuses a relative reference', () => {
    expect(parseResource('/api', registered)).toEqual({ kind: 'invalid_target' });
  });

  it('refuses everything for a client that registered no audience', () => {
    expect(parseResource('https://api.example', [])).toEqual({ kind: 'invalid_target' });
  });
});
```

The third is the Review Focus item. Fastify gives a repeated query parameter as an array, so this function must see both values — do not narrow the parameter to `string` at the route.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/service/resource-indicator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

```ts
export type ResourceOutcome =
  | { readonly kind: 'ok'; readonly audience: readonly string[] }
  | { readonly kind: 'invalid_target' };

// RFC 8707 §2: an absolute URI, no fragment. This server accepts one value,
// so two is a refusal rather than a choice — a token minted for the first of
// two named audiences is a token for an audience the client did not mean.
export function parseResource(
  raw: string | string[] | undefined,
  registered: readonly string[],
): ResourceOutcome {
  if (raw === undefined) {
    return registered.length === 0
      ? { kind: 'invalid_target' }
      : { kind: 'ok', audience: registered };
  }
  if (Array.isArray(raw)) return { kind: 'invalid_target' };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { kind: 'invalid_target' };
  }
  if (parsed.hash !== '') return { kind: 'invalid_target' };
  if (!registered.includes(raw)) return { kind: 'invalid_target' };
  return { kind: 'ok', audience: [raw] };
}
```

- [ ] **Step 4: Run it and commit**

Run: `npx vitest run packages/protocol-oidc/src/service/resource-indicator.test.ts`
Expected: PASS, all seven.

```bash
git add packages/protocol-oidc/src/service/resource-indicator.ts packages/protocol-oidc/src/service/resource-indicator.test.ts
git commit -m "Parse and check the resource indicator"
```

### Task 23: `resource` at `/authorize`, carried on the code

**Files:**

- Create: `packages/db/drizzle/0052_authorization_codes_resource.sql`
- Modify: `packages/protocol-oidc/src/schema/authorization-codes.ts`
- Modify: `packages/protocol-oidc/src/repository/codes.ts`
- Modify: `packages/protocol-oidc/src/usecase/authorization-request.ts`
- Create: `packages/protocol-oidc/tests/resource-authorize.int.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it('records the requested resource on the code', async () => {
  const code = await authorizeWith({ resource: 'https://api.example' });
  expect(await resourceOf(code)).toEqual(['https://api.example']);
});

it('redirects with invalid_target for an unregistered resource', async () => {
  const response = await authorize({ resource: 'https://elsewhere.example' });
  expect(new URL(response.headers.location).searchParams.get('error')).toBe('invalid_target');
});

it('redirects with invalid_target for two resources', async () => {
  const response = await authorizeRaw(
    'resource=https://api.example&resource=https://reports.example',
  );
  expect(new URL(response.headers.location).searchParams.get('error')).toBe('invalid_target');
});

it('records every registered audience when no resource is asked for', async () => {
  const code = await authorizeWith({});
  expect(await resourceOf(code)).toEqual(registeredAudiences);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/resource-authorize.int.test.ts`
Expected: FAIL — the column does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- The audience this code will mint a token for, resolved at /authorize
-- against the client's registered list. Stored rather than re-derived at
-- /token so that the two cannot disagree about what the user approved.
ALTER TABLE authorization_codes ADD COLUMN resource text[] NOT NULL DEFAULT '{}';
```

- [ ] **Step 4: Thread it through**

Declare the column, carry it in the code repository's insert and record, and call `parseResource` in `authorization-request.ts` before the code is minted — the refusal is a redirect with `error=invalid_target`, on the path every other authorize-time refusal already takes.

- [ ] **Step 5: Run it and commit**

Run: `npx vitest run packages/protocol-oidc packages/db`
Expected: PASS.

```bash
git add packages/db/drizzle/0052_authorization_codes_resource.sql packages/protocol-oidc
git commit -m "Accept the resource indicator at /authorize"
```

### Task 24: `aud` derived, at `/token`

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts:365-398`
- Create: `packages/protocol-oidc/tests/resource-token.int.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it('mints an access token whose aud is the resource the code carried', async () => {
  const token = await redeem(codeForResource('https://api.example'));
  expect(decode(token.access_token).aud).toEqual(['https://api.example', issuer]);
});

it('accepts a resource at /token that narrows the code's audience', async () => {
  const token = await redeemWith(codeForAll, { resource: 'https://api.example' });
  expect(decode(token.access_token).aud).toEqual(['https://api.example', issuer]);
});

it('refuses a resource at /token that the code did not carry', async () => {
  const response = await redeemWith(codeForResource('https://api.example'), {
    resource: 'https://reports.example',
  });
  expect(response.json().error).toBe('invalid_target');
});

it('mints a client_credentials token for the resource asked for', async () => {
  const token = await clientCredentials({ resource: 'https://api.example' });
  expect(decode(token.access_token).aud).toEqual(['https://api.example', issuer]);
});
```

The second and third are the rule together: `/token` may narrow what the code carried and may never widen it.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/resource-token.int.test.ts`
Expected: FAIL — `aud` is the client's whole registered list regardless.

- [ ] **Step 3: Implement it**

`mintAccessToken` currently reads `input.config.audiences` directly. Give it the resolved audience instead, computed from the code's stored `resource` intersected with any `resource` on the token request, and refuse with `invalid_target` when the intersection is empty. The issuer is still appended, as it is today — nothing about `rfc9068.md`'s reading changes.

- [ ] **Step 4: Run it**

Run: `npx vitest run packages/protocol-oidc`
Expected: PASS.

- [ ] **Step 5: Resolve the clause rows**

The two `deferred: P3b` rows in `docs/protocols/rfc9068.md` are about `aud` being derived. Mark them with the test ids above, and resolve the RFC 8707 rows this task implements.

- [ ] **Step 6: Advertise and document**

Discovery gains nothing for RFC 8707 — there is no registered metadata member for it — so say so in `rfc8707.md`'s reading note rather than leaving a reader to wonder. `docs/request-paths.md`'s "No `resource` or `audience` request parameter" bullet is replaced by a real transcript.

- [ ] **Step 7: Commit**

```bash
git add packages/protocol-oidc docs
git commit -m "Derive aud from the resource indicator"
```

### Task 25: `id_token_hint` verified against an audience at `/authorize`

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/authorization-request.ts`
- Create: `packages/protocol-oidc/tests/id-token-hint-audience.int.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it('accepts a hint minted for the requesting client', async () => {
  const response = await authorize({ id_token_hint: hintFor('client-a'), client_id: 'client-a' });
  expect(response.statusCode).toBe(302);
});

it('refuses a hint minted for another client', async () => {
  const response = await authorize({ id_token_hint: hintFor('client-b'), client_id: 'client-a' });
  expect(new URL(response.headers.location).searchParams.get('error')).toBe('invalid_request');
});

it('refuses a hint from another realm even when its signature verifies', async () => {
  const response = await authorize({ id_token_hint: hintFromOtherRealm, client_id: 'client-a' });
  expect(new URL(response.headers.location).searchParams.get('error')).toBe('invalid_request');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/id-token-hint-audience.int.test.ts`
Expected: FAIL — the second passes today, because the audience is unchecked.

- [ ] **Step 3: Implement it**

`subjectOfIdTokenHint` verifies with `AUDIENCE_UNCHECKED`. Replace it with the requesting client's id as the expected audience. The comment beside the call explains why it was unchecked; replace it with nothing, since it no longer is.

- [ ] **Step 4: Run it and commit**

Run: `npx vitest run packages/protocol-oidc`
Expected: PASS.

```bash
git add packages/protocol-oidc
git commit -m "Verify id_token_hint against the requesting client at /authorize"
```

### Task 26: The same check at `/logout`

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/logout.ts:131`
- Create: `packages/protocol-oidc/tests/logout-hint-audience.int.test.ts`

This is a separate task because it is a separate call site with a different rule: at `/logout` the `client_id` parameter is optional, and §2 already requires the pair to agree when both are present.

- [ ] **Step 1: Write the failing integration test**

```ts
it('ends the session for a hint naming the client that asked', async () => {
  const response = await logout({ id_token_hint: hintFor('client-a'), client_id: 'client-a' });
  expect(response.statusCode).toBe(302);
});

it('asks for confirmation for a hint minted for another client, rather than ending anything', async () => {
  const response = await logout({ id_token_hint: hintFor('client-b'), client_id: 'client-b' });
  expect(response.statusCode).toBe(200);
  expect(await sessionIsStillLive(sessionId)).toBe(true);
});

it('asks for confirmation when no client_id accompanies the hint', async () => {
  const response = await logout({ id_token_hint: hintFor('client-a') });
  expect(response.statusCode).toBe(200);
});
```

The third is the decision this task must make explicitly: with no `client_id`, there is no audience to check against, so the hint proves nothing and the page asks.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/logout-hint-audience.int.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement it**

Pass the expected audience into `subjectOfIdTokenHint` from `handleLogoutRequest`. The existing `disagreeing` check stays: it covers the case where the pair is present and disagrees, which is §4's "neither half is used".

- [ ] **Step 4: Run it, document it, commit**

Run: `npx vitest run packages/protocol-oidc`
Expected: PASS.

`docs/request-paths.md`'s RP-initiated logout section describes the hint's handling; update it and re-run the transcript.

```bash
git add packages/protocol-oidc docs/request-paths.md
git commit -m "Verify id_token_hint against the client at /logout"
```

### Task 27: What `active` means

**Files:**

- Create: `packages/protocol-oidc/src/usecase/introspection.ts`
- Create: `packages/protocol-oidc/src/usecase/introspection.test.ts`

**Interfaces:**

- Produces: `introspect(deps, input, now): Promise<IntrospectionResponse>`.

- [ ] **Step 1: Write the failing test**

```ts
describe('introspect', () => {
  it('describes a live token to a caller named in its audience', async () => {
    const response = await introspect(deps, { token, caller: 'https://api.example' }, now);
    expect(response).toMatchObject({
      active: true,
      scope: 'openid profile',
      client_id: 'client-a',
      sub: 'subject-1',
      aud: ['https://api.example', issuer],
      token_type: 'Bearer',
    });
  });

  it('answers inactive to a caller not in its audience', async () => {
    const response = await introspect(deps, { token, caller: 'https://elsewhere.example' }, now);
    expect(response).toEqual({ active: false });
  });

  it('answers inactive for a token whose grant was revoked', async () => {
    expect(await introspect(deps, { token: revokedToken, caller }, now)).toEqual({ active: false });
  });

  it('answers inactive for a token whose session has ended, before its exp', async () => {
    expect(await introspect(deps, { token: loggedOutToken, caller }, now)).toEqual({
      active: false,
    });
  });

  it('keeps an offline token active, since it has no session to end', async () => {
    expect((await introspect(deps, { token: offlineToken, caller }, now)).active).toBe(true);
  });

  it('answers inactive for a token that does not parse, without saying why', async () => {
    expect(await introspect(deps, { token: 'not-a-token', caller }, now)).toEqual({
      active: false,
    });
  });

  it('answers inactive for a token signed by another realm', async () => {
    expect(await introspect(deps, { token: foreignRealmToken, caller }, now)).toEqual({
      active: false,
    });
  });
});
```

The fourth is the whole point of the endpoint: an `at+jwt` is self-contained and nothing consults anything before accepting one, so introspection is what makes a logout real inside the token's hour. The fifth is its boundary — an `offline_access` grant has no session and must not be reported dead because of one.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/usecase/introspection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Verify the token against the realm's own keys, load its grant, and answer `{ active: false }` — with no other member — whenever verification fails, the grant is revoked, the session named by `sid` is not live, or the caller is not in `aud`. Every "no" produces the identical response, so the endpoint cannot be used to tell one reason from another.

- [ ] **Step 4: Run it and commit**

Run: `npx vitest run packages/protocol-oidc/src/usecase/introspection.test.ts`
Expected: PASS, all seven.

```bash
git add packages/protocol-oidc/src/usecase/introspection.ts packages/protocol-oidc/src/usecase/introspection.test.ts
git commit -m "Decide what an introspected token is still worth"
```

### Task 28: `/introspect`

**Files:**

- Create: `packages/protocol-oidc/src/view/routes/introspect.ts`
- Create: `packages/protocol-oidc/tests/introspect.int.test.ts`
- Modify: `packages/protocol-oidc/src/index.ts`
- Modify: `packages/protocol-oidc/src/usecase/discovery.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it('describes a token to the resource server that authenticated', async () => {
  const response = await introspect({ token, auth: basic('api-client', 'secret') });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ active: true });
});

it('refuses an unauthenticated call with 401', async () => {
  const response = await introspect({ token, auth: null });
  expect(response.statusCode).toBe(401);
  expect(response.json().error).toBe('invalid_client');
});

it('answers 200 with active false to an authenticated caller with no claim to the token', async () => {
  const response = await introspect({ token, auth: basic('other-client', 'secret') });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ active: false });
});

it('rate-limits repeated bad secrets, as /token does', async () => {
  for (let i = 0; i < limit + 1; i += 1)
    await introspect({ token, auth: basic('api-client', 'wrong') });
  const response = await introspect({ token, auth: basic('api-client', 'wrong') });
  expect(response.statusCode).toBe(429);
});

it('answers no-store', async () => {
  const response = await introspect({ token, auth: basic('api-client', 'secret') });
  expect(response.headers['cache-control']).toBe('no-store');
});

it('advertises the endpoint in discovery', async () => {
  expect((await discovery()).introspection_endpoint).toBe(
    `${issuer}/protocol/openid-connect/token/introspect`,
  );
});
```

The fourth matters: a new endpoint taking a `client_secret` is a new place to guess one, and ADR 0023's limiter exists for exactly that. Reuse it rather than adding a second.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/introspect.int.test.ts`
Expected: FAIL — no such route.

- [ ] **Step 3: Implement the route**

Transport only: authenticate with the same helper `/token` uses, call `introspect`, send JSON with `cache-control: no-store`. No decisions in the route.

- [ ] **Step 4: Run it and commit**

Run: `npx vitest run packages/protocol-oidc`
Expected: PASS.

```bash
git add packages/protocol-oidc
git commit -m "Serve token introspection"
```

### Task 29: `/revoke`

**Files:**

- Create: `packages/protocol-oidc/src/usecase/revocation.ts`
- Create: `packages/protocol-oidc/src/view/routes/revoke.ts`
- Create: `packages/protocol-oidc/tests/revoke.int.test.ts`
- Modify: `packages/protocol-oidc/src/usecase/discovery.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it('revokes a refresh token and answers 200', async () => {
  const response = await revoke({ token: refreshToken, auth: client });
  expect(response.statusCode).toBe(200);
  expect((await redeemRefresh(refreshToken)).json().error).toBe('invalid_grant');
});

it('answers 200 for a token that does not exist, per §2.2', async () => {
  expect((await revoke({ token: 'nonsense', auth: client })).statusCode).toBe(200);
});

it('answers 200 for an already-revoked token', async () => {
  await revoke({ token: refreshToken, auth: client });
  expect((await revoke({ token: refreshToken, auth: client })).statusCode).toBe(200);
});

it('refuses to revoke a token issued to another client', async () => {
  const response = await revoke({ token: refreshToken, auth: otherClient });
  expect(response.statusCode).toBe(400);
  expect(response.json().error).toBe('invalid_grant');
});

it('revokes the whole grant when an access token is presented', async () => {
  await revoke({ token: accessToken, auth: client });
  expect(await introspectActive(accessToken)).toBe(false);
});

it('refuses an unauthenticated call', async () => {
  expect((await revoke({ token: refreshToken, auth: null })).statusCode).toBe(401);
});

it('advertises the endpoint in discovery', async () => {
  expect((await discovery()).revocation_endpoint).toBe(`${issuer}/protocol/openid-connect/revoke`);
});
```

The second and third are RFC 7009's own rule — an invalid token is not an error, because telling a caller which token strings exist is the leak the endpoint would otherwise create. The fourth is the boundary: that rule applies to unknown tokens, not to somebody else's.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/revoke.int.test.ts`
Expected: FAIL — no such route.

- [ ] **Step 3: Implement it**

The usecase resolves the presented token to its grant — a refresh token by its row, an access token by its `jti`/grant claim — and revokes the grant. The route authenticates and calls it.

- [ ] **Step 4: Resolve the clause rows and document**

Mark the RFC 7662 and RFC 7009 rows this increment implemented. Replace `docs/request-paths.md`'s "Token introspection (RFC 7662) and revocation (RFC 7009)" bullet with two real transcripts, including one showing a logged-out session's access token reported inactive before its `exp` — the sentence that bullet makes, now demonstrated. `README.md` gains both endpoints.

- [ ] **Step 5: Verify and push**

```bash
pnpm verify
git add packages/protocol-oidc docs README.md
git commit -m "Serve token revocation"
git push
gh pr checks --watch
```

Answer the review, then close the increment:

```bash
gh pr merge --merge
git checkout p3b-sessions-logout-token-surface && git pull
git checkout -b p3b/7-client-authentication
```

---

## Increment 7 — `private_key_jwt` and mTLS

**Branch:** `p3b/7-client-authentication`, from the integration branch, with a pull request into it.

### Task 30: The client assertion

**Files:**

- Create: `packages/protocol-oidc/src/service/client-assertion.ts`
- Create: `packages/protocol-oidc/src/service/client-assertion.test.ts`

**Interfaces:**

- Produces: `parseClientAssertion(body, now, expected): AssertionOutcome`, `CLIENT_ASSERTION_TYPE`.

- [ ] **Step 1: Write the failing test**

```ts
describe('parseClientAssertion', () => {
  it('accepts a well-formed assertion and reports the client it claims to be', () => {
    expect(parseClientAssertion(body(validClaims), now, expected)).toEqual({
      kind: 'ok',
      clientId: 'client-a',
      jti: validClaims.jti,
      expiresAt: new Date(validClaims.exp * 1000),
    });
  });

  it('refuses an assertion type it does not define', () => {
    expect(
      parseClientAssertion(
        { ...body(validClaims), client_assertion_type: 'urn:other' },
        now,
        expected,
      ).kind,
    ).toBe('unsupported');
  });

  it('refuses an assertion whose iss and sub disagree', () => {
    expect(
      parseClientAssertion(body({ ...validClaims, sub: 'client-b' }), now, expected).kind,
    ).toBe('invalid');
  });

  it('refuses one whose aud is not this token endpoint', () => {
    expect(
      parseClientAssertion(body({ ...validClaims, aud: 'https://elsewhere' }), now, expected).kind,
    ).toBe('invalid');
  });

  it('refuses one that has expired', () => {
    expect(parseClientAssertion(body(expiredClaims), now, expected).kind).toBe('invalid');
  });

  it('refuses one with no jti, since replay cannot be detected without it', () => {
    const { jti, ...withoutJti } = validClaims;
    expect(parseClientAssertion(body(withoutJti), now, expected).kind).toBe('invalid');
  });

  it('refuses one whose exp is further out than the ceiling', () => {
    expect(parseClientAssertion(body({ ...validClaims, exp: farFuture }), now, expected).kind).toBe(
      'invalid',
    );
  });
});
```

The last two exist together: replay detection needs a `jti` to remember and a bounded window to remember it for. An assertion valid for a year is one the guard must remember for a year.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/service/client-assertion.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Parse and validate the claims **without** verifying the signature — the key is not known until the client is resolved, and resolving it requires a network fetch this function must not perform. It reports which client the assertion claims to be; Task 33 verifies that claim.

- [ ] **Step 4: Run it and commit**

Run: `npx vitest run packages/protocol-oidc/src/service/client-assertion.test.ts`
Expected: PASS, all seven.

```bash
git add packages/protocol-oidc/src/service/client-assertion.ts packages/protocol-oidc/src/service/client-assertion.test.ts
git commit -m "Validate a private_key_jwt client assertion's claims"
```

### Task 31: The three nits in the key fetcher

**Files:**

- Modify: `packages/protocol-oidc/src/repository/client-keys.ts`
- Modify: `packages/protocol-oidc/src/repository/client-keys.test.ts`

These are recorded in `docs/NEXT.md` as harmless while the fetcher is wired to nothing. This increment is what makes them matter, so they are fixed before the call site exists rather than after.

- [ ] **Step 1: Write the failing tests**

```ts
it('dates the cache entry from when the fetch finished, not when it started', async () => {
  const keys = clientKeySet({ ...deps, fetch: slowFetch(30_000), now: clock });
  await keys.forClient(client);
  expect(cacheEntryFor(client).expiresAt.getTime()).toBe(clock.now().getTime() + ttlMs);
});

it('makes one request when two verifications race for the same uri', async () => {
  const fetch = countingFetch();
  const keys = clientKeySet({ ...deps, fetch });
  await Promise.all([keys.forClient(client), keys.forClient(client)]);
  expect(fetch.calls).toBe(1);
});

it('does not re-fetch a uri that just failed, until the negative entry expires', async () => {
  const fetch = failingFetch();
  const keys = clientKeySet({ ...deps, fetch });
  await expect(keys.forClient(client)).rejects.toThrow();
  await expect(keys.forClient(client)).rejects.toThrow();
  expect(fetch.calls).toBe(1);
});

it('re-fetches once the negative entry expires, and succeeds', async () => {
  const fetch = failsThenSucceeds();
  const keys = clientKeySet({ ...deps, fetch, now: clock });
  await expect(keys.forClient(client)).rejects.toThrow();
  clock.advance(negativeTtlMs + 1);
  await expect(keys.forClient(client)).resolves.toBeDefined();
});

it('gives a failure a shorter life than a success', () => {
  expect(NEGATIVE_CACHE_TTL_MS).toBeLessThan(CACHE_TTL_MS);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run packages/protocol-oidc/src/repository/client-keys.test.ts`
Expected: FAIL on all five.

- [ ] **Step 3: Implement the three fixes**

Compute `expiresAt` after the fetch resolves; hold a map of in-flight promises keyed by URI and return the existing one rather than starting a second; and write a negative entry on failure with its own shorter TTL. The umbrella spec §6 calls this last one "a failure is not a permanent cache miss".

- [ ] **Step 4: Run them and commit**

Run: `npx vitest run packages/protocol-oidc/src/repository/client-keys.test.ts`
Expected: PASS.

```bash
git add packages/protocol-oidc/src/repository/client-keys.ts packages/protocol-oidc/src/repository/client-keys.test.ts
git commit -m "Cache client key fetches correctly before wiring them up"
```

### Task 32: The replay guard

**Files:**

- Create: `packages/db/drizzle/0053_client_assertion_jti.sql`
- Create: `packages/protocol-oidc/src/repository/assertion-jti.ts`
- Create: `packages/protocol-oidc/tests/assertion-jti.int.test.ts`
- Modify: `apps/server/src/cli/reap.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it('admits a jti the first time', async () => {
  expect(await repo.claim('client-a', 'jti-1', expiresAt)).toBe(true);
});

it('refuses the same jti from the same client', async () => {
  await repo.claim('client-a', 'jti-1', expiresAt);
  expect(await repo.claim('client-a', 'jti-1', expiresAt)).toBe(false);
});

it('admits the same jti from a different client', async () => {
  await repo.claim('client-a', 'jti-1', expiresAt);
  expect(await repo.claim('client-b', 'jti-1', expiresAt)).toBe(true);
});

it('cannot see a jti claimed in another realm', async () => {
  await withRealm(app.db, otherRealmId, async (tx) => {
    expect(await assertionJtiRepository(tx).claim('client-a', 'jti-1', expiresAt)).toBe(true);
  });
});

it('reaps a claim past its expiry', async () => {
  await repo.claim('client-a', 'jti-1', past);
  expect(await reapAssertionJtis(now)).toBe(1);
});
```

The third is the boundary that makes the unique constraint composite: a `jti` is unique per issuer, and two clients may pick the same one.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/assertion-jti.int.test.ts`
Expected: FAIL — the table does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- Every jti a client assertion has spent, until that assertion could no
-- longer be replayed. The primary key is what rejects a replay: a second
-- insert of the same (realm, client, jti) conflicts rather than being
-- looked up and raced.
CREATE TABLE client_assertion_jti (
  realm_id uuid NOT NULL REFERENCES realms (id) ON DELETE CASCADE,
  client_id text NOT NULL,
  jti text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (realm_id, client_id, jti)
);

ALTER TABLE client_assertion_jti ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_assertion_jti FORCE ROW LEVEL SECURITY;

CREATE POLICY client_assertion_jti_isolation ON client_assertion_jti
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

CREATE INDEX client_assertion_jti_expiry ON client_assertion_jti (realm_id, expires_at);
```

- [ ] **Step 4: Implement `claim` and the retention pass**

`claim` inserts and reports whether the insert happened — `on conflict do nothing` with `returning`, so the check and the write are one statement and a race cannot admit two. Add the retention pass to `reap.ts` beside the others, with its test.

- [ ] **Step 5: Run it and commit**

Run: `npx vitest run packages/protocol-oidc apps/server packages/db`
Expected: PASS.

```bash
git add packages/db/drizzle/0053_client_assertion_jti.sql packages/protocol-oidc apps/server
git commit -m "Refuse a replayed client assertion"
```

### Task 33: `private_key_jwt` at `/token`

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts:230-290`
- Modify: `packages/protocol-oidc/src/usecase/discovery.ts`
- Create: `packages/protocol-oidc/tests/private-key-jwt.int.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it('issues a token to a client that signed with a key from its jwks_uri', async () => {
  const response = await token({ assertion: signedBy(clientKey) });
  expect(response.statusCode).toBe(200);
});

it('issues a token to a client that registered inline jwks', async () => {
  const response = await token({ client: inlineJwksClient, assertion: signedBy(inlineKey) });
  expect(response.statusCode).toBe(200);
});

it('refuses an assertion signed by a key the client does not publish', async () => {
  const response = await token({ assertion: signedBy(strangerKey) });
  expect(response.statusCode).toBe(401);
  expect(response.json()).toEqual(refusal);
});

it('answers the same refusal when the jwks_uri does not answer', async () => {
  const response = await token({ client: unreachableJwksClient, assertion: signedBy(clientKey) });
  expect(response.json()).toEqual(refusal);
});

it('cannot be used to tell a reachable jwks_uri from an unreachable one', async () => {
  const unreachable = await token({ client: unreachableJwksClient, assertion: signedBy(clientKey) });
  const badSignature = await token({ assertion: signedBy(strangerKey) });

  expect(unreachable.json()).toEqual(badSignature.json());
  expect(unreachable.statusCode).toBe(badSignature.statusCode);
});

it('never reports the address guard's own reasoning', async () => {
  const response = await token({ client: clientWithPrivateJwksUri, assertion: signedBy(clientKey) });
  expect(response.json()).toEqual(refusal);
  expect(JSON.stringify(response.json())).not.toMatch(/loopback|private|link-local|blocked/iu);
});

it('refuses a replayed assertion', async () => {
  const assertion = signedBy(clientKey);
  expect((await token({ assertion })).statusCode).toBe(200);
  expect((await token({ assertion })).statusCode).toBe(401);
});

it('refuses a client_secret from a client registered for private_key_jwt', async () => {
  expect((await token({ auth: basic('pkj-client', 'secret') })).statusCode).toBe(401);
});

it('advertises private_key_jwt in token_endpoint_auth_methods_supported', async () => {
  expect((await discovery()).token_endpoint_auth_methods_supported).toContain('private_key_jwt');
});
```

Those cases are one requirement stated several ways, and it is the reason registration-time dereferencing was reverted in P3a. **Every failure answers the same bytes** — the guard refused the address, the host did not answer, the key set did not parse, the signature did not verify — one `invalid_client` with one description, bound to a single `refusal` constant the tests compare against. Two distinct messages are themselves the oracle: a caller registers the `jwks_uri` and reads from the difference whether that address was reachable and served parseable JWKS. The reason is logged, where only an operator sees it.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/private-key-jwt.int.test.ts`
Expected: FAIL — the method is not accepted.

- [ ] **Step 3: Implement it**

In the client-authentication branch of `token-issuance.ts`: parse the assertion, resolve the client, refuse unless its registered method is `private_key_jwt`, claim the `jti`, fetch its key set through `clientKeySet`, and verify. **One refusal and no others** — the same response whatever failed — with the specific reason passed to the logger rather than to the caller.

The rate limit does not apply: `isSharedSecretMethod` (`client-secret-throttle.ts:11`) already excludes this method, and its comment says why — possession of a key is not a secret that can be guessed.

- [ ] **Step 4: Run it and commit**

Run: `npx vitest run packages/protocol-oidc`
Expected: PASS.

```bash
git add packages/protocol-oidc
git commit -m "Authenticate a client by private_key_jwt"
```

### Task 34: Proxy-header mTLS

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts`
- Create: `packages/protocol-oidc/src/service/tls-client-auth.ts`
- Create: `packages/protocol-oidc/src/service/tls-client-auth.test.ts`
- Create: `packages/protocol-oidc/tests/tls-client-auth.int.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the failing unit test**

```ts
describe('tlsClientSubject', () => {
  it('reads the subject from the header when the proxy is trusted', () => {
    expect(tlsClientSubject(headers, { trustProxy: true })).toBe('CN=client-a,O=Example');
  });

  it('reads nothing when the proxy is not trusted, whatever the header says', () => {
    expect(tlsClientSubject(headers, { trustProxy: false })).toBeNull();
  });

  it('reads nothing when the header is absent', () => {
    expect(tlsClientSubject({}, { trustProxy: true })).toBeNull();
  });

  it('reads nothing when the header appears twice', () => {
    expect(tlsClientSubject(duplicated, { trustProxy: true })).toBeNull();
  });
});
```

The second is the whole security property, and the fourth is how it is defeated: a duplicated header is a client that got its own value past a proxy that appended one, so neither is trusted.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/service/tls-client-auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the failing integration test**

```ts
it('authenticates a client whose registered subject matches the header', async () => {
  expect((await token({ headers: certHeader('CN=client-a,O=Example') })).statusCode).toBe(200);
});

it('refuses when the registered subject differs', async () => {
  expect((await token({ headers: certHeader('CN=someone-else') })).statusCode).toBe(401);
});

it('refuses the method entirely when ODUDU_TRUST_PROXY is off', async () => {
  const server = await startServer({ ODUDU_TRUST_PROXY: false });
  expect((await token({ server, headers: certHeader('CN=client-a,O=Example') })).statusCode).toBe(
    401,
  );
});
```

- [ ] **Step 4: Implement it**

Read the header only when `config.ODUDU_TRUST_PROXY` is true; compare against the client's registered subject; refuse otherwise. With the flag off the method is refused rather than downgraded — an untrusted header is an authentication bypass, not a degraded mode.

- [ ] **Step 5: Run everything, document, push**

`README.md`'s deployment section states what `ODUDU_TRUST_PROXY` governs. Add that it now also gates mTLS client authentication, and that the proxy must strip the header from inbound requests — a sentence that, if unwritten, is the whole vulnerability.

```bash
pnpm verify
git add packages/protocol-oidc README.md docs
git commit -m "Authenticate a client by a proxy-supplied certificate subject"
git push
gh pr checks --watch
```

Answer the review, then close the increment:

```bash
gh pr merge --merge
git checkout p3b-sessions-logout-token-surface && git pull
git checkout -b p3b/8-userinfo-claims-close
```

---

## Increment 8 — UserInfo, the `claims` parameter, and the close

**Branch:** `p3b/8-userinfo-claims-close`, from the integration branch, with a pull request into it.

### Task 35: Spike — JWE algorithms and key selection

**Files:**

- Create: `docs/superpowers/p3b-spike-jwe.md`

- [ ] **Step 1: Check what `jose` supports for the registered pairs**

`assumption:` `jose` supports the `alg`/`enc` pairs `parseClientMetadata` admits for `userinfo_encrypted_response_alg` and `userinfo_encrypted_response_enc`. Write a throwaway script that encrypts to a public JWK with each admitted pair and records which succeed.

- [ ] **Step 2: Check that a client's encryption key is selectable without ambiguity**

`assumption:` a client's JWKS names an encryption key unambiguously by `use: 'enc'` or by `alg`. Construct three key sets — one with a single `use: 'enc'` key, one with two, and one with none — and record what selection rule answers correctly for each.

- [ ] **Step 3: Write the findings down and narrow the metadata if needed**

Record in `docs/superpowers/p3b-spike-jwe.md`: the supported pairs, the selection rule, and what happens with two candidates. If a pair the metadata admits cannot be produced, narrow `AUTH`-style permitted sets in `client-metadata.ts` in Task 37 rather than failing at response time.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/p3b-spike-jwe.md
git commit -m "Record which JWE pairs and key selections are available"
```

### Task 36: Signed UserInfo

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/userinfo.ts`
- Modify: `packages/protocol-oidc/src/view/routes/userinfo.ts`
- Create: `packages/protocol-oidc/tests/userinfo-signed.int.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it('answers JSON for a client that registered no signing algorithm', async () => {
  const response = await userinfo({ client: plainClient });
  expect(response.headers['content-type']).toContain('application/json');
});

it('answers application/jwt for a client that registered one', async () => {
  const response = await userinfo({ client: signingClient });
  expect(response.headers['content-type']).toContain('application/jwt');
});

it('signs with iss and aud as members', async () => {
  const claims = decode((await userinfo({ client: signingClient })).body);
  expect(claims.iss).toBe(issuer);
  expect(claims.aud).toBe(signingClient.clientId);
});

it('carries the same claims the JSON response would have', async () => {
  const signed = decode((await userinfo({ client: signingClient })).body);
  const plain = (await userinfo({ client: plainClient })).json();
  expect(signed.sub).toBe(plain.sub);
  expect(signed.email).toBe(plain.email);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/userinfo-signed.int.test.ts`
Expected: FAIL — JSON is returned regardless.

- [ ] **Step 3: Implement it**

The usecase reads `userinfoSignedResponseAlg` from the client's configuration and returns either a claims object or a signed JWT, and the route chooses the content type from which it got. `iss` and `aud` are added as members of the signed form only — §5.3.2 requires them there and the JSON form has never carried them.

- [ ] **Step 4: Run it and commit**

Run: `npx vitest run packages/protocol-oidc`
Expected: PASS.

```bash
git add packages/protocol-oidc
git commit -m "Sign the UserInfo response when a client registered an algorithm"
```

### Task 37: The first JWE

**Files:**

- Create: `packages/crypto/src/service/encrypt.ts`
- Create: `packages/crypto/src/service/encrypt.test.ts`
- Modify: `packages/crypto/src/index.ts`

**Interfaces:**

- Produces: `encryptCompact(payload, key, alg, enc): Promise<string>`, `selectEncryptionKey(jwks, alg): JWK | null`.

- [ ] **Step 1: Write the failing test**

```ts
describe('encryptCompact', () => {
  it('produces a five-part compact JWE the holder of the private key can read', async () => {
    const jwe = await encryptCompact('{"sub":"s1"}', publicKey, 'RSA-OAEP-256', 'A256GCM');
    expect(jwe.split('.')).toHaveLength(5);
    expect(await decryptWith(privateKey, jwe)).toBe('{"sub":"s1"}');
  });

  it('names alg and enc in the protected header', async () => {
    const header = protectedHeaderOf(
      await encryptCompact(payload, publicKey, 'RSA-OAEP-256', 'A256GCM'),
    );
    expect(header).toMatchObject({ alg: 'RSA-OAEP-256', enc: 'A256GCM' });
  });

  it('sets cty for a nested JWT, so a reader knows the plaintext is a JWS', async () => {
    const header = protectedHeaderOf(
      await encryptCompact(signedJwt, publicKey, alg, enc, { nested: true }),
    );
    expect(header.cty).toBe('JWT');
  });

  it('refuses an algorithm the spike did not confirm', async () => {
    await expect(encryptCompact(payload, publicKey, 'unsupported', 'A256GCM')).rejects.toThrow();
  });
});

describe('selectEncryptionKey', () => {
  it('chooses the key marked for encryption', () => {
    expect(selectEncryptionKey(mixedJwks, 'RSA-OAEP-256')?.kid).toBe('enc-1');
  });

  it('chooses nothing when the set has no encryption key', () => {
    expect(selectEncryptionKey(signingOnlyJwks, 'RSA-OAEP-256')).toBeNull();
  });

  it('chooses nothing when two candidates are equally good', () => {
    expect(selectEncryptionKey(twoEncKeys, 'RSA-OAEP-256')).toBeNull();
  });
});
```

The last follows the spike: an ambiguous choice is refused rather than resolved by ordering, because the order a client's JWKS happens to arrive in is not a decision.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/crypto/src/service/encrypt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

`CompactEncrypt` from `jose`, with the algorithms the spike confirmed and no others. Export both functions from `packages/crypto/src/index.ts`.

- [ ] **Step 4: Run it and commit**

Run: `npx vitest run packages/crypto`
Expected: PASS.

```bash
git add packages/crypto
git commit -m "Encrypt a compact JWE, and choose the key for it"
```

### Task 38: Encrypted and nested UserInfo

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/userinfo.ts`
- Create: `packages/protocol-oidc/tests/userinfo-encrypted.int.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it('encrypts without signing when only encryption was registered', async () => {
  const response = await userinfo({ client: encryptOnlyClient });
  expect(response.headers['content-type']).toContain('application/jwt');
  expect(JSON.parse(await decrypt(response.body)).sub).toBe(subjectId);
});

it('signs then encrypts when both were registered, producing a nested JWT', async () => {
  const response = await userinfo({ client: signAndEncryptClient });
  const inner = await decrypt(response.body);
  expect(protectedHeaderOf(response.body).cty).toBe('JWT');
  expect(decode(inner).iss).toBe(issuer);
});

it('fails the request rather than falling back to JSON when the key cannot be retrieved', async () => {
  const response = await userinfo({ client: unreachableJwksClient });
  expect(response.statusCode).toBe(500);
  expect(response.body).not.toContain(subjectId);
});
```

The third is the one to get right: a client asked for encryption, and answering in clear text because a fetch failed publishes the claims it asked to have protected.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/userinfo-encrypted.int.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement it**

Sign first when both are registered, then encrypt the result with `cty: JWT`; encrypt the JSON directly when only encryption is registered. The client's key comes through the same `clientKeySet` Increment 7 wired.

- [ ] **Step 4: Resolve the clause rows and document**

The six §5.3.2 rows in `docs/protocols/oidc-core.md` are now implemented; mark each with its test id. Discovery gains `userinfo_signing_alg_values_supported` and the two encryption members. Replace the "No signed or encrypted UserInfo responses" bullet in `docs/request-paths.md` with a real transcript.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol-oidc docs
git commit -m "Encrypt the UserInfo response, nesting a signed one"
```

### Task 39: Parsing the `claims` parameter

**Files:**

- Create: `packages/protocol-oidc/src/service/claims-request.ts`
- Create: `packages/protocol-oidc/src/service/claims-request.test.ts`

**Interfaces:**

- Produces: `parseClaimsRequest(raw: string | undefined): ClaimsRequestOutcome`, `MAX_CLAIMS_PARAMETER_BYTES`.

- [ ] **Step 1: Write the failing test**

```ts
describe('parseClaimsRequest', () => {
  it('is empty for an absent parameter', () => {
    expect(parseClaimsRequest(undefined)).toEqual({
      kind: 'ok',
      request: { idToken: {}, userinfo: {} },
    });
  });

  it('reads an essential claim in the id_token member', () => {
    const outcome = parseClaimsRequest('{"id_token":{"auth_time":{"essential":true}}}');
    expect(outcome.request.idToken.auth_time).toEqual({ essential: true });
  });

  it('reads a claim requested with a specific value', () => {
    const outcome = parseClaimsRequest('{"id_token":{"sub":{"value":"subject-1"}}}');
    expect(outcome.request.idToken.sub).toEqual({ essential: false, value: 'subject-1' });
  });

  it('reads a claim requested with a set of acceptable values', () => {
    const outcome = parseClaimsRequest('{"userinfo":{"acr":{"values":["gold","silver"]}}}');
    expect(outcome.request.userinfo.acr).toEqual({ essential: false, values: ['gold', 'silver'] });
  });

  it('reads a null entry as a voluntary request for the claim', () => {
    const outcome = parseClaimsRequest('{"userinfo":{"email":null}}');
    expect(outcome.request.userinfo.email).toEqual({ essential: false });
  });

  it('refuses a parameter that is not an object', () => {
    expect(parseClaimsRequest('"nope"').kind).toBe('invalid');
  });

  it('refuses a parameter that is not JSON at all', () => {
    expect(parseClaimsRequest('{').kind).toBe('invalid');
  });

  it('refuses a parameter larger than the cap, without parsing it', () => {
    const huge = `{"id_token":{${'"x":null,'.repeat(200000)}"y":null}}`;
    expect(parseClaimsRequest(huge)).toEqual({ kind: 'invalid', reason: 'too_large' });
  });

  it('refuses a deeply nested parameter', () => {
    const deep = '{"id_token":{"sub":' + '{"value":'.repeat(200) + '"x"' + '}'.repeat(200) + '}}';
    expect(parseClaimsRequest(deep).kind).toBe('invalid');
  });
});
```

The last two are the Review Focus item: this parameter is attacker-supplied and unauthenticated at `/authorize`, and `JSON.parse` is bounded by nothing. The size is checked **before** parsing, which is why that test asserts the reason rather than only the kind.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/src/service/claims-request.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Check the byte length against `MAX_CLAIMS_PARAMETER_BYTES` first, then `JSON.parse` into `unknown` and narrow — never `any`, and never a cast. Depth is checked while narrowing, since a valid §5.5 document is only three levels deep.

- [ ] **Step 4: Run it and commit**

Run: `npx vitest run packages/protocol-oidc/src/service/claims-request.test.ts`
Expected: PASS, all nine.

```bash
git add packages/protocol-oidc/src/service/claims-request.ts packages/protocol-oidc/src/service/claims-request.test.ts
git commit -m "Parse the claims request parameter"
```

### Task 40: Honouring it

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/authorization-request.ts`
- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts`
- Modify: `packages/protocol-oidc/src/usecase/userinfo.ts`
- Modify: `packages/protocol-oidc/src/repository/codes.ts`
- Create: `packages/protocol-oidc/tests/claims-parameter.int.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it('includes auth_time in the ID token when requested as essential', async () => {
  const token = await flow({ claims: '{"id_token":{"auth_time":{"essential":true}}}' });
  expect(decode(token.id_token).auth_time).toEqual(expect.any(Number));
});

it('omits auth_time when it was not requested and max_age was not used', async () => {
  const token = await flow({});
  expect('auth_time' in decode(token.id_token)).toBe(false);
});

it('serves the authorization when sub is requested with the value of the live session', async () => {
  const response = await authorize({ claims: subClaim(aliceSubjectId), cookie: aliceSession });
  expect(response.statusCode).toBe(302);
  expect(new URL(response.headers.location).searchParams.get('code')).toBeTruthy();
});

it('refuses under prompt=none when sub names somebody other than the live session', async () => {
  const response = await authorize({
    claims: subClaim(bobSubjectId),
    cookie: aliceSession,
    prompt: 'none',
  });
  expect(new URL(response.headers.location).searchParams.get('error')).toBe('login_required');
});

it('asks for a login when sub names somebody not currently signed in', async () => {
  const response = await authorize({ claims: subClaim(bobSubjectId), cookie: aliceSession });
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain('name="password"');
});

it('returns a requested claim from UserInfo when its scope was granted', async () => {
  const body = await userinfoAfter({
    claims: '{"userinfo":{"email":null}}',
    scope: 'openid email',
  });
  expect(body.email).toBe('alice@example.test');
});

it('does not return a requested claim whose scope was not granted', async () => {
  const body = await userinfoAfter({ claims: '{"userinfo":{"email":null}}', scope: 'openid' });
  expect('email' in body).toBe(false);
});

it('refuses an unparsable claims parameter with invalid_request', async () => {
  const response = await authorize({ claims: '{' });
  expect(new URL(response.headers.location).searchParams.get('error')).toBe('invalid_request');
});
```

The seventh is the one that must never regress: the parameter is not a path around consent, and a comment saying so would not have caught it.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol-oidc/tests/claims-parameter.int.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement it**

Parse at `/authorize`, apply the `sub` rule to the session decision there, store the request on the code — a `text` column beside `resource`, in migration 0052's shape — and honour it at token issuance and at UserInfo by intersecting with the granted scopes before consulting `standardClaimMappers`.

- [ ] **Step 4: Resolve the clause rows and advertise**

The two §5.5-dependent rows in `docs/protocols/oidc-core.md` get their test ids. Discovery gains `claims_parameter_supported: true`. Replace the "No `claims` request parameter" bullet in `docs/request-paths.md` with a transcript.

- [ ] **Step 5: Run it and commit**

Run: `pnpm verify`
Expected: PASS.

```bash
git add packages/protocol-oidc docs
git commit -m "Honour the claims request parameter"
```

### Task 41: The consent transcript this phase inherited

**Files:**

- Modify: `docs/request-paths.md`

The consent section is derived rather than observed, which `docs/NEXT.md` records as P3b's to close — not P4b's — because this phase re-runs the transcripts around that request path anyway.

- [ ] **Step 1: Bring up a clean stack**

```bash
docker compose -f infra/compose.yml down -v
docker compose -f infra/compose.yml up -d
```

The section's state depends on what ran before it, so it starts from nothing and the document says which stack it was captured against.

- [ ] **Step 2: Replay the document from the top to the consent section**

Run every command in order. The consent section's own plan calls for an anonymously self-registered client; register one with the real endpoint rather than seeding it.

- [ ] **Step 3: Replace the section with what actually happened**

Paste real output. A fenced block holding a response carries **no language tag** — Prettier reformats a tagged one and the bytes stop being the bytes served.

- [ ] **Step 4: Run the documentation tests**

Run: `npx vitest run tests/docs`
Expected: PASS. These compare what the document asserts against what the server serves.

- [ ] **Step 5: Commit**

```bash
git add docs/request-paths.md
git commit -m "Capture the consent transcript against a running stack"
```

### Task 42: The pass that closes the phase

**Files:**

- Modify: `docs/NEXT.md`, `docs/superpowers/specs/2026-09-10-odudu-design.md`, `docs/request-paths.md`, `README.md`
- Create: `docs/phases/p3b.md`

Run this after the whole-branch review and before `finishing-a-development-branch`. It is `CLAUDE.md`'s four checks, each of which has already gone wrong once.

- [ ] **Step 1: Read every "what is not implemented" marker, and ask whether it is still true**

`tests/docs/not-implemented-placement.test.ts` only knows whether a marker is present. This phase closed eight of them; read the section and check each remaining one still describes the server.

- [ ] **Step 2: Grep the phase numbers this phase moved**

```bash
grep -rn "P3b" docs/ README.md | grep -v phases/p3b.md
```

Every hit is either resolved work that should now name a test, or work this phase did not do that needs a new owner.

- [ ] **Step 3: Read `docs/NEXT.md`'s headings against the phases that have closed**

A section addressed to a closed phase is overdue for a decision or a move. Rewrite the file to carry only four things: where the project stands, what the next phase inherits, decisions still open, and what the final review deferred. What this phase found goes to `docs/phases/p3b.md`.

- [ ] **Step 4: Reconcile the roadmap in both directions**

Every item the "not implemented" list places in a phase, and every phase criterion naming the work placed against it. This is the check that found five omissions in section 11 already, and it found the `claims` parameter one phase late.

- [ ] **Step 5: Record what turned out to be wrong**

`docs/phases/p3b.md` records what each increment found and, specifically, what turned out to be **wrong** — the thing no spec, plan or close note keeps. The four spikes' answers belong here if any of them contradicted its assumption.

- [ ] **Step 6: Verify, push, and merge the last increment**

```bash
pnpm verify
git add docs README.md
git commit -m "Close P3b: reconcile the documents against what shipped"
git push
gh pr checks --watch
gh pr merge --merge
```

- [ ] **Step 7: Take the phase pull request out of draft**

```bash
git checkout p3b-sessions-logout-token-surface && git pull
gh pr ready
gh pr checks --watch
```

The whole-branch review happens on this pull request. Answer it, then use `superpowers:finishing-a-development-branch`.

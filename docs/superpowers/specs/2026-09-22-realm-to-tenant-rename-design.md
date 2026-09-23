# Renaming realm to tenant — design

**Status:** Approved · 2026-09-22

## 1. What this is

Every occurrence of `realm` in this repository becomes `tenant`: identifiers,
database table and columns, the row-level-security GUC, the URL path, and all
fifty-four documents. Because the URL path is part of the issuer, this changes the
`iss` claim in every token and the discovery URL every relying party fetches.

The concept does not change. A tenant is what a realm was — an isolated set of
users, clients, sessions and keys, with row-level security enforcing the
boundary. Nothing about the model, the schema's shape, or the protocol surface
is being redesigned. This is a rename and should stay one.

## 2. Why the word changes

`realm` is Keycloak's term and this server is not Keycloak. `tenant` is what the
thing is, in the vocabulary a reader arrives with. That is the whole
justification; there is no technical driver, and the work should be judged on
whether it leaves the repository saying one thing consistently rather than on
any behavioural improvement.

## 3. The decisions this spec fixes

**3.1 Full scope, including the wire.** The URL path becomes
`/tenants/{tenant}`, so `realmIssuer`'s output changes and with it `iss` in
every ID Token, access token and Logout Token, the `iss` authorization-response
parameter (RFC 9207), and the value `/userinfo` verifies against.

**3.2 A hard cutover, because nothing is deployed.** `README.md` places
"Published images and a release process" in P12; there are no published
artefacts and no relying parties integrating against this server. So there is no
dual-serving, no deprecation window, and no transitional second issuer.

This is worth recording as a decision rather than a circumstance, because it is
the only reason the design is simple. OIDC Discovery §4.3 requires a discovery
document's `issuer` to be identical to the URL used to reach it, so serving
`/realms/` and `/tenants/` from one issuer value would be non-conformant; a real
transition would need two issuers per tenant, with `/userinfo` and
`/introspect` accepting either, for a published window. **If this rename is ever
repeated on a deployed system, that is the design it needs.**

**3.3 All fifty-four documents, with the fourteen ADRs annotated once.** Living
documents are renamed because they describe what the server does now. Historical
documents — ADRs, phase notes, archived specs and plans — are also renamed,
because code comments cite ADRs as live explanations and a reader following
"see ADR 0033" must not find a table that no longer exists under that name. Each
ADR gains one dated line recording that it was written when the concept was
called a realm.

**3.4 The database rename goes all the way to the GUC.** The table, all thirty
`realm_id` columns, and `app.realm_id` become `tenants`, `tenant_id` and
`app.tenant_id`, which means rewriting all thirty-one row-level-security
policies and `packages/db/src/tx.ts`'s two `set_config` calls.

## 4. The naming rule

Four case-preserving substitutions, applied everywhere:

| From     | To        |
| -------- | --------- |
| `realm`  | `tenant`  |
| `Realm`  | `Tenant`  |
| `realms` | `tenants` |
| `REALM`  | `TENANT`  |

No English word contains `realm` as a substring. That is true and it is the
wrong guard: the false positives come from **other vocabularies**, where the
word is spelled the same and means something that is not a tenant. RFC 7235
§4.1's `WWW-Authenticate` auth-param is one, Keycloak's own concept is
another, and §5 below carries both. Where the word is this project's own,
every compound follows from the stem: `realmId` → `tenantId`,
`RealmScopedDatabase` → `TenantScopedDatabase`, `withRealm` → `withTenant`,
`expectCrossRealmMethodProbe` → `expectCrossTenantMethodProbe`, and the package
`domain-realm` → `domain-tenant`.

## 5. What a mechanical substitution must not touch

Six places carry the risk, and each is called out because a tool would produce
something that looks correct and is not.

**5.1 The row-level-security policies.** A column rename updates a policy's
stored expression; a GUC name is a string literal inside
`current_setting('app.realm_id', true)` and is not touched by anything. A policy
rewritten wrongly **silently stops isolating** rather than failing — the worst
failure mode this schema has.

**5.2 The transcripts.** `docs/request-paths.md` contains 262 lines with
`realms/`, and the document's standing promise is that every command in it was
executed and every response is real output. A find-replace would make it assert
bytes that were never served — a falsehood that looks entirely fine in review.
These are **re-captured against a running stack**, never substituted.

**5.3 The conformance configurations.** `infra/conformance`'s three profiles
hardcode `https://proxy/realms/conformance/...`. Changing them is trivial;
the point is that the suite must **pass** against the new paths, which is the
external proof that the wire change is correct.

**5.4 The ADR annotations.** Fourteen dated notes, written by hand, not
generated.

**5.5 Another specification's vocabulary.** `realm` in a `WWW-Authenticate`
header is RFC 7235 §4.1's auth-param, naming an HTTP protection space and
not a tenant; the three challenge constants on `/token`, `/userinfo` and
`/register` keep it. `realm_access` is Keycloak's role claim, and the
comparative prose that says Odudu emits neither it nor `resource_access` has
to keep spelling it. These are the substitution's real false positives, and
they need **byte-exact** assertions to catch — a `toMatch(/^Bearer/)` or a
`toContain` on the error parameter passes against a wrong auth-param name.

**5.6 Comment citations of frozen migration filenames.** The fifty-six
migrations that predate this change are replayed in order on a fresh
database and recorded in `meta/_journal.json` by stem, so their names cannot
move. A comment citing one, rewritten, points at a file that does not exist
and reads perfectly. Check the files just substituted for these immediately,
while the set is small enough to look at.

## 6. Increments

Five, planned as one branch and one pull request each, each ending green and
independently mergeable.

**They were not, and could not be.** `withRealm`, `RealmScopedDatabase` and
`realms` are consumed by every application package, so nothing between the
schema and the protocol package compiles while the two ends disagree on the
name: there is no cut in the dependency graph that leaves both sides
building. The work ran as one branch and one pull request, with the five
below as its ordering rather than as its merge units. Anything that renames
a type the whole repository imports has this shape, and the honest planning
unit for it is the branch.

**6.1 Spike, then the schema.** Establish by execution what Postgres does:
whether `ALTER TABLE RENAME COLUMN` rewrites dependent policy expressions,
whether `FORCE ROW LEVEL SECURITY` survives a table rename, and what renaming
the GUC actually costs. Then the migration, the Drizzle schema, and
`packages/db` including `tx.ts`.

Ordering requirement: `packages/db/tests/rls-policy.int.test.ts` enumerates
every table in `public` and asserts row security is enabled, forced and
policied, reading each policy's `qual`. Its expectations change in this
increment, so it is **updated first and watched to fail**, then the migration
lands and it is watched to pass. Updating it alongside the migration would let a
wrong policy and a wrong expectation agree with each other.

The increment ends by re-running `packages/db`'s own probes. Every other
package's foreign-tenant probes run with that package, because they cannot
compile until it is renamed; the full sweep is the last step of the rename.
Those probes already exist as a stated non-negotiable — this is re-running
suites, not writing them.

**6.2 Domain packages.** `domain-realm` (renamed to `domain-tenant`),
`domain-identity`, `account`, `authn-flows`.

**6.3 Protocol packages and the wire.** `protocol-oidc`, `contracts`, the
fourteen distinct paths its routes register — seventeen handlers, because
`/userinfo`, `/authorize` and `/logout` each take two methods — the six page
embeddings of a path, five form actions and one `fetch` URL, and
`realmIssuer`. This is the increment where `iss` changes. The integration suites
are the detector for a missed string literal, because a broken form action is
invisible to the type checker.

**6.4 Server and tooling.** `apps/server`, the CLI, `tools/`, and the
`infra/conformance` profiles.

**6.5 Documentation.** All fifty-four markdown files, the fourteen ADR annotations,
and the re-captured transcripts.

## 7. What proves it worked

In ascending order of strength:

1. `pnpm verify` green — the mechanical floor.
2. Every foreign-tenant probe passing — isolation intact.
3. The conformance suite passing against `/tenants/` — the wire is correct by
   the OIDF's own tests rather than by our reading of them.
4. **No occurrence of the stem except where it is not this project's word.**
   That is the one check that proves the rename is complete rather than
   merely working.

The fourth is `tests/lint/no-realm.test.ts`, enforced the way the `any` ban
and the comment-length ceiling are rather than remembered. A bare grep is
not enough for it, because the legitimate occurrences §5 enumerates are real
and permanent, so the test is built in two parts:

- **Whole-file records**, listed by path: `packages/db/drizzle/`, this spec,
  its plan and its spike, the dated OIDF result exports and the README
  quoting them, the P2a and P2b spike logs, and the backfill test that seeds
  the schema as of migration 39. Rewriting any of these would falsify a
  record of something already done.
- **Occurrence-level patterns**, which are cut out of a line before the
  question is asked again of what is left — so a legitimate token never
  vouches for the rest of the line it sits on. They are the auth-param in
  §5.5, both emitted and named; `realm_access`; a migration's filename,
  numbered or in backticks; and the single dated line each pre-rename ADR
  carries.
- **A prose unit naming Keycloak**, in Markdown under `docs/` only. This is
  the one exemption that clears a line rather than a token, because the
  sentence naming the other product is rarely the sentence carrying the
  word. It is what admits §5.5's comparative passages.

A rename that is 99% done is a repository that says two things, which is
worse than either name alone.

## 8. What this does not do

No behaviour changes. No schema shape changes beyond names. No endpoint is
added, removed or moved other than by its path segment. No open question
recorded in `docs/NEXT.md` is resolved here — this phase inherits them
unchanged, under new names.

## 9. Risks

**A wrongly rewritten policy admits cross-tenant reads and no test says so.**
Mitigated by the ordering in 6.1, by `rls-policy.int.test.ts` reading every
table rather than a list, and by the foreign-tenant probes. This is the risk
that justifies putting the schema in its own increment.

**A missed URL string breaks a flow that only an integration test exercises.**
Mitigated by 6.3's suites and by the conformance run in 6.4.

**A re-captured transcript that was actually edited.** Mitigated by `tests/docs`
comparing documents against what the server serves, and by the rule that a
response block is pasted from a terminal rather than written.

**The rename is judged done while a name survives somewhere.** Mitigated by 7.4
being a test rather than a final grep somebody remembers to run.

# P4a — renaming the tenant concept

What this work found, and specifically what turned out to be **wrong**. In
the shape the earlier notes established: this file is the running record the
specs and the umbrella spec's close note do not keep. What shipped is a
rename; what it means for anyone deploying or consuming the server is in
[docs/NEXT.md](../NEXT.md).

The concept a tenant is was previously called a `realm`, Keycloak's word for
it. Nothing about the model, the schema's shape or the protocol surface
changed. The design spec for the change is the one document in this
repository still written in the old vocabulary throughout, because it names
what is being renamed from; `tests/lint/` allows it that, by whole file.

## The shape of this work's defects

P0's were claims about third-party behaviour asserted from documentation.
P2b's were claims about this repository asserted from memory. P3a's were
claims about what a specification requires, read as prose. P3b's were claims
about its own code, mostly in the explanations rather than the behaviour.

**These were claims about the safety of a mechanical substitution.** The
rule — four case-preserving substitutions of a stem no English word contains
— was correct, and every defect came from somewhere the stem was not this
project's word at all, or from somewhere the file's meaning was that it must
not change. A substitution's failures are not typos: they are places where
the tool was right about the letters and wrong about the referent, and each
one reads perfectly in the diff.

## The word belongs to other specifications too

The guard this work leaned on was "no English word contains the stem, so
there are no false positives". That is true, and it is not the hazard. The
hazard is **another specification's vocabulary**, where the word names
something that is not a tenant.

In a `WWW-Authenticate` header it is RFC 7235 §4.1's auth-param, naming an
HTTP protection space. The substitution rewrote all three of this server's
challenge constants, and the server emitted a challenge no HTTP client
parses as that auth-param, on `/token`, `/userinfo` and `/register`.

It survived that far because **no test asserted the header's bytes**. The
assertions were `toMatch(/^Bearer/)` and a `toContain` on the error
parameter, and both pass against the wrong auth-param name as readily as
against the right one. A test that checks a header's shape is not a test
that checks a header. There are now byte-exact assertions on all three
(`packages/protocol-oidc/tests/token-code.adversarial.int.test.ts`,
`userinfo.adversarial.int.test.ts` and `client-registration.int.test.ts`),
which is the only form that could have caught it.

The same hazard fired in prose, where the word is Keycloak's own concept and
that concept really does carry the name. Ten comparative passages named it
correctly before the substitution and incorrectly after. One went further
and produced `tenant_access`, a claim name in no system at all — Keycloak
emits `realm_access`, Odudu emits neither, and the passage existed to say so.

## A frozen filename is not an identifier

The fifty-six migrations that predate this work are replayed in order on a
fresh database, so they create the old table before
`0057_rename_realm_to_tenant.sql` renames it, and `meta/_journal.json`
records each one by its stem. They cannot be rewritten.

What can be rewritten, silently, is a **comment citing one**.
`0022_realm_account_settings.sql` becomes a pointer to a file that does not
exist, in a sentence that reads correctly and cites a plausible name. This
fired four times and was caught four times, each by a check run immediately
after substituting rather than at the end — the only interval at which the
set of files just touched is still small enough to look at.

`tests/lint/` allows the old stem where it spells a migration's filename,
and only there: numbered, or in backticks, where a document is naming a file
rather than an identifier.

## The rename could not be staged

The plan of record was five increments, each independently mergeable and
each ending green. That was not achievable, for a structural reason:
`withTenant`, `TenantScopedDatabase` and the `tenants` table are consumed by
every application package, so **nothing between the schema and the protocol
package can compile** while the two ends disagree on the name. There is no
cut in the dependency graph that leaves both sides building.

So the work ran as one branch and one pull request. Anything that renames a
type the whole repository imports has the same shape, and the honest
planning unit for it is the branch, not the increment.

## What Postgres carries through a rename, and what it does not

Established by execution before the migration was written
([the spike](../superpowers/rename-spike-postgres.md)):

- `ALTER TABLE RENAME COLUMN` **does** rewrite a policy's column reference.
  A policy's `qual` is a parsed expression tree holding the column by OID,
  resolved lazily on deparse.
- `relrowsecurity` and `relforcerowsecurity` **do** survive
  `ALTER TABLE RENAME TO`. They are properties of the table's `pg_class`
  row, not of its name.
- The GUC name **does not** change. It is a string literal inside
  `current_setting(...)`, with no OID to resolve against, and nothing
  rewrites it.

That third answer is why all 31 row-level-security policies are dropped and
recreated in `0057_rename_realm_to_tenant.sql` rather than carried by the
rename. Carrying them would have left every policy filtering on a setting
that nothing sets — which is not a failure but **silent loss of tenant
isolation**, the worst failure mode this schema has.

Postgres also keeps a **constraint's** name when its table is renamed. After
`0057_rename_realm_to_tenant.sql`, 46 constraints and one index still
carried the old word, and a constraint name reaches a user in the error text
of a violation; `0058_rename_realm_constraint_names.sql` renames them.

The count is worth a sentence of its own. An earlier estimate of roughly 106
came from querying `pg_constraint` in a PostgreSQL 18 container, where
not-null constraints are catalogued as rows of their own. This repository
pins PostgreSQL 17, where they are not. A catalog query is only an answer
about the version it was run against, and a spike container that drifts from
the pinned one answers a question nobody asked.

## Re-capturing a transcript finds more than it was run to find

`docs/request-paths.md` promises that every command in it was executed and
every response is real output, so it was re-captured against a running stack
rather than substituted. That turned up **eleven** discrepancies, and only
six were this work's:

- six wrong `content-length` values;
- a Logout Token whose base64url payload still decoded to the old issuer —
  invisible to a reader and to a substitution alike, because the old name is
  not spelled anywhere in the encoded bytes on the page;
- five ID tokens asserting an `auth_time` claim the server does not emit
  unless it is asked for;
- a claim that the CLI has no `web_origins` flag, long after
  `seed client --web-origin` shipped;
- sections asserting a precondition a refusal depends on rather than showing
  it.

Five of those predate this work. The document had been maintained by hand
across four phases, and the drift had accumulated in exactly the places a
reader cannot check: an encoded payload, a byte count, and a claim about a
neighbouring tool. Re-running it is the only thing that finds any of them,
and it is cheaper than it looks.

## One character wider

`tenant` is one character longer than the word it replaced, and twenty files
drifted past Prettier's print width because of it. Every one of them sat
inside a scope that was itself clean — a substitution's own diff always
looks formatted, because each file it touched was formatted before it. The
drift is visible only repository-wide, which is where the check has to run.

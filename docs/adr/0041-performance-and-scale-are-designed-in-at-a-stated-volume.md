# 0041 — Performance and scale are designed in, at a stated volume

**Status:** Accepted · 2026-10-06

## Context

Performance had one home in the roadmap, P11, at the end of the roadmap.
Everything built before P11 was built without a volume in mind. As a result,
whether a list query used an index, whether an endpoint's page size was
bounded, or whether a console page re-rendered the whole form on every
keystroke depended on whoever wrote that code. It was never a rule anyone
could check.

That arrangement treats scale as a property you add at the end. It is not.
Once a feature has shipped, its query shape and its data model are hard to
change. An unbounded read or a missing index is cheap to avoid while the
code is being written and expensive to find once tenants depend on it.

The admin console showed the same gap on the client side. It was built
without `useMemo`, `useCallback` or `React.memo`, and without the React
Compiler. Nobody decided against them; nobody decided at all.

## Decision

**Every increment is designed for, and where it can be, tested at, a
stated volume.** The volume is the same for every phase:

| Quantity                  | Design volume |
| ------------------------- | ------------- |
| Subjects in one tenant    | 1,000,000     |
| Clients in one tenant     | 10,000        |
| Tenants                   | 10,000        |
| Audit events, all tenants | 100,000,000   |

A phase spec states, for each path it adds, how that path behaves at this
volume. Where nothing else covers the path, it states how that behaviour is
checked. A path the spec cannot place against this volume is a design
question for the brainstorm, not something to find out in P11.

These rules hold from now on.

**The server**

- **Every collection read is bounded.** It is either keyset-paginated under
  `MAX_LIMIT` or fixed in size by the model, for example a subject's
  authenticators. No route returns "all rows".
- **Every list, search and lookup path is served by an index.** A query plan
  that scans a tenant's whole table at design volume is a defect in the
  increment that wrote it.
- **No per-row queries in a loop.** A list endpoint makes a constant number
  of queries, whatever its page size.
- **Every in-process structure is bounded**, as ADR 0023 already requires
  of the throttles. The bound is stated where the structure is declared.

**The console**

- **The React Compiler is on.** Its lint findings fail the build. Hand-written
  `useMemo`, `useCallback` and `React.memo` are not needed and are not added;
  an exception is a measured one, with a comment pointing at the measurement.
- **Nothing renders an unbounded collection.** A list is paged from the
  server or virtualised. A picker over a large collection searches the
  server instead of loading everything.
- **The entry chunk has a byte budget.** It is enforced beside the existing
  lint that keeps heavy modules out of the entry.

P11 still owns everything that needs replicas or load: HA, the documented
p99 for `/token` and `/userinfo`, shared bounds, and rolling upgrades.
This decision does not move that work. It stops the earlier phases from
building things P11 would have to undo.

## Consequences

- Each rule that can be checked is checked by a test, so the claim cannot
  quietly go stale.
  - The query-plan check seeds a tenant at a volume where the planner
    prefers an index whenever one fits, then fails on a sequential scan
    for every list and search path.
  - The console's checks are the compiler's lint and the chunk budget.
- The tests seed more data than before, so CI runs longer. The seeding
  generates rows in SQL rather than through the API, to keep that cost in
  seconds.
- A phase spec gets one more section to write. A spec that leaves it empty
  must say why.

## Alternatives rejected

- **Leave performance to P11.** That is how things stood, and it is what
  produced this ADR. Measuring at the end finds problems in shipped data
  models, which is the most expensive place to find them.
- **Hand-written memoisation in the console.** It is easy to get wrong:
  dependencies go stale, and the cheap value gets memoised while the
  expensive one does not. It also spreads optimisation code through views
  that are meant only to render. The compiler applies memoisation
  everywhere and flags the code it cannot handle safely.
- **A smaller design volume (100,000 subjects per tenant).** It is cheaper
  to seed, but it hides the plan changes that happen between 10^5 and
  10^6 rows, which is where a missing index starts to cost seconds.
- **A larger one (10,000,000 subjects per tenant, 1,000,000,000 audit
  events).** It would force audit-table partitioning now. That decision
  belongs to P11's retention and HA work, which can make it against
  measured growth.

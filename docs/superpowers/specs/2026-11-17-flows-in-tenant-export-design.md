# Flows in the tenant export and import: design

Status: proposed, 2026-11-17. A small increment after P4f, not a phase. The
owner decided it is done now, keyed by flow name, with the published theme and
images staying on P7.

## Intent

A tenant export carries the default sign-in flow and nothing else of the flows
feature. Import then restores the default flow, drops every other flow and
leaves each client following the default. A client that was pinned to a
stricter flow silently runs a weaker one after a move between installations.
The placement of this gap on P7 ("with the document's move between
installations") gave no topic reason: flows, `client_oidc_config.flow_id` and
step settings were shipped by P4f, and P4f already put step `settings` into the
document. The owner asked for it now.

## Goals

- An export carries every flow of the tenant, each by name, and each client's
  flow by name.
- An import restores them in one transaction, so a client ends on the flow it
  ran before.
- A document exported before this change still imports, as it did.
- The roadmap, section 11, `docs/NEXT.md` and the test that maps them say the
  flows are done and keep the published theme, the clients' themes and the
  images on P7, so that part is not lost.

## Non-goals

- The published theme, a client's theme and uploaded images (they stay on P7:
  binary assets, ADR 0046).
- A document version bump: every earlier addition was additive under version 1.
- Flows in subjects' or other tables, MCP (it does not carry the document) and
  the CLI.

## The document

- `flow` stays as it is: the default flow's steps.
- New `flow_name`: the default flow's name, `"default"` when absent. The default
  is the row marked `is_default`, never found by name, and any flow can be
  made the default or renamed (`makeDefault`, `replace` in
  `packages/authn-flows/src/repository/flows.ts`), so its name is not fixed.
- New `flows`: `[{ name, steps }]`, the tenant's other flows, sorted by name,
  at most the per-tenant limit minus one, `[]` when absent. A step has the
  fields the default flow's steps have, including `settings`.
- Each exported client gains `flow`: the name of the flow its `flow_id` names
  (a named flow or the default's name), or `null` when it follows the default.
  `null` when absent.
- The root and a client stay strict objects, so an older server refuses a newer
  document by naming the unknown key, as it did for every earlier addition.

## Import

- Validation, before anything is written: each named flow is checked with the
  same rules as the default flow (`validateFlowSteps` and a flow that starts a
  login), with problems at `document.flows[i]`; names are valid flow names, unique
  within the document, different from `flow_name`; the count is within the
  limit; a client whose `flow` names no flow of the document, nor `flow_name`,
  is refused like any other dangling reference.
- Writing, inside the existing import transaction: the default flow's steps and
  name, then the named flows, then the clients with the id of the flow their
  name resolves to (the default's id when it names `flow_name`).
- The `tenant.import` audit row's counts gain `flows`.

## Placement and documentation

- `apps/docs/content/en/roadmap.md` (the P7 bullet), section 11's P7 row in
  `docs/superpowers/specs/2026-09-10-odudu-design.md` and the row in
  `docs/NEXT.md` lose the sign-in flows, and keep the published theme, the
  clients' themes and the images they use; `tests/docs/roadmap-section-11.test.ts`
  is updated so the P7 mapping still names those; `docs/phases/p4f.md` gets a
  pointer to this increment's note; the CHANGELOG gains an Added entry.
- The export and import guide text and the transcripts `get-export.md` and
  `post-admintenant-imports.md` (re-run on a live stack, preconditions stated),
  the console's export panel text and its console-shots records.

## Approaches considered

- A (chosen): add `flows`, `flow_name` and `clients[].flow` as optional members
  under version 1. Smallest change that keeps every earlier document valid.
- B: leave it on P7. Rejected by the owner: the reason given was not a topic
  reason and the cost is about one increment.
- C: key by id. Rejected by the owner: ids are tenant-local random values.

## Scale

Bounded: at most 19 named flows of at most 20 steps and the client cap already
bounds the clients; the export reads the flows with one query and the clients
as it does.

## Left to the builder

The names of the schema constants, the helper that maps a flow id to its name,
and the wording of the refusals.

## Verified in this repository

- The document: `packages/contracts/src/admin/tenant-document.ts` (version `1`,
  `flow`, strict objects, `message_overrides` `.default([])` as the precedent).
- Export reads the default only: `packages/protocol-admin/src/usecase/tenant-export.ts:710`.
- Import writes the default and builds clients: `tenant-import.ts:397-456`; it
  always creates a new tenant in one transaction.
- Flow checks: `tenant-import-validation.ts:469` (`flowAndSmtpProblems`).
- A client may be pinned to any flow row, the default included:
  `packages/protocol-admin/src/usecase/clients.ts:966`.
- Placement: `docs/phases/p4f.md:1101-1102`, `docs/NEXT.md:259-260`,
  `apps/docs/content/en/roadmap.md:100`, `tests/docs/roadmap-section-11.test.ts:362`.

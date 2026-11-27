# 0061 — The assistant's write surface: tiers, human-only operations and the coverage guard

**Status:** Accepted · 2026-11-27

## Context

The assistant's Act mode offers 12 write tools, all content that grants nothing (ADR 0059,
ADR 0060). An administrator who asked it to delete a group was refused, and ruled on
2026-11-27 that Act covers everything the console can do, each write approved on a card,
removals and security changes asked once more, every write audited. The console makes 94
non-GET admin calls and the assistant offers 12.

Three facts decide the shape of the work (each observed in the code, listed in the plan's
"What was read"):

- The door's write allowlist (`AGENT_WRITE_ROUTES`) and the tool list are shared with every
  outside MCP agent that holds `mcp:write`, and an outside agent has a budget but no approval
  step. A route added there is handed to all of them.
- The API already refuses a lot per route: built-in roles and clients, a role above the
  caller's own capabilities, a default or pinned flow, an active domain or key, the last
  administrator, a tenant with live sessions, and per-call bounds on the batch deletes.
- Roles and groups already carry a derived `admin_reach`, group ancestors included, so
  "reaches an administrator capability" is a predicate that exists.

Left alone, the assistant would also gain a second list to forget: the tools it must not
have are a regex (`OWN_RECORD`) that no registry shows, and the routes it cannot call are
whatever no tool happens to cover.

## Decision

**Every console write is in exactly one of four tiers**, and a tier is decided by the server
from the tool and its target, never by the model:

| Tier | Meaning                                                         | What a person does                                                                                                |
| ---- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A    | Creates or edits something inert or restorable                  | Answers the card                                                                                                  |
| B    | Removes something the API already guards                        | Answers the card, then confirms the removal; the card shows what depends on it                                    |
| C    | Changes who can sign in, what a token carries or what goes live | Answers the card, which is a set-diff where the call replaces a list, and types the target's name in the decision |
| X    | Human-only                                                      | Does it in the console; the assistant may prefill the form                                                        |

A tool of tier A to C is never `auto` and has no "allow for this conversation" control. A
write budget per tier keeps a burst of A from spending what C needs.

**The assistant has a door list of its own**, `ASSISTANT_WRITE_ROUTES`, keyed on the grant
being the built-in assistant client's, and a tool has an `audience` (`all` or `assistant`) that
the MCP endpoint's tool list and the SDK catalogue skip. A route in the assistant's list is
refused for an outside token holding `mcp:write`, so nothing reaches an outside agent without
the confirmation step that class needs.

**A tier can rise by target.** A C or B call whose target reaches an administrator capability
(`admin_reach` of a role or group, the subject's admin capabilities, `subtree_admin_reach`
for a group delete), is the owner, a built-in client, or roots the conversation's own grant, is
X: refused at proposal and at the door with a constant denial.

### The human-only set

The owner's rulings of 2026-11-27 are the first three rows. "May overturn" says whether the
owner may later move the row to a tool once what it waits for exists.

| Group id                 | Routes                                                                                                                                                                                                                         | Reason                                                                                                                                                              | May overturn                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `secret-returned`        | confidential `POST ~/clients`, `POST ~/clients/:id/secret`, `POST ~/registration-tokens`, `POST ~/subjects/:id/password`                                                                                                       | The one-time secret would pass through model context, stored messages, trace, export and the provider. The assistant prefills the console form; the person submits. | Yes, with a reveal channel that bypasses the model |
| `secret-supplied`        | `PUT ~/smtp`                                                                                                                                                                                                                   | The relay password would arrive through chat; a redirected relay captures every mailed link.                                                                        | Yes, with the same channel or a person-typed field |
| `admin-capability-reach` | Any role, group, composite, default, group-role, subject role or group change whose target reaches an administrator capability; changes to or deletion of an administrator or the owner                                        | Escalation and lockout. Decided on the server per target, not by tool name.                                                                                         | Yes, once a delegated-administrator rule exists    |
| `own-session`            | `DELETE ~/sessions` (tenant-wide)                                                                                                                                                                                              | No "except mine" parameter: it ends the approver's session and the run.                                                                                             | Yes, once the route can exclude the caller         |
| `self-authority`         | `PUT ~/assistant/settings`, the nine `agent_*` fields of `PATCH ~/settings`, `PATCH ~/clients/:id` of `odudu-assistant` and `odudu-admin`, `PATCH ~/settings` `audit_retention_days`, `DELETE ~/agents/:id` of its own lineage | The assistant's own mode, budget, write allowance, evidence                                                                                                         | No                                                 |
| `control-plane`          | The nine `~/assistant/conversations*` routes                                                                                                                                                                                   | The approval decision must not be reachable by the model                                                                                                            | No                                                 |
| `tenant-lifecycle`       | `PATCH ~` with `enabled`, `DELETE ~`                                                                                                                                                                                           | A disable ends every session, the conversation's included; delete loses the tenant                                                                                  | No                                                 |
| `instance-level`         | `POST /admin/tenants`, `POST /admin/tenant-imports`                                                                                                                                                                            | No tenant to bind a grant to, and the import answers fresh secrets once. Placed, not refused.                                                                       | Yes, with an instance-write door                   |
| `binary-body`            | `POST ~/theme/assets`                                                                                                                                                                                                          | A raw image body; the model has no bytes                                                                                                                            | No                                                 |
| `verified-claims`        | `email_verified`, `phone_number_verified` in `PATCH ~/subjects/:id/profile`                                                                                                                                                    | Relying parties trust them; only the mail flow sets them                                                                                                            | No                                                 |

`POST ~/subjects/bulk` is not human-only: it is a tier C tool with a batch bound (ruling of
2026-11-27, coordinator-resolved; the owner may overturn).

### The coverage guard

`tests/lint/mcp-tool-coverage.test.ts` is extended, not duplicated. A second lint file would
hold a second registry that must agree with the first.

1. `catalogue.ts` gains a `human-only` kind. Each entry is `{ routes, kind, why, group, note }`
   where `why` is a closed union (`secret-in-response`, `secret-in-request`,
   `admin-capability-reach`, `own-session`, `self-authority`, `control-plane`,
   `tenant-lifecycle`, `instance-level`, `binary-body`, `verified-claims`) and `group` is a
   group id of the table above. The free-text reason stays as `note`.
2. The test reads this ADR: every `group` is a backticked id in the table, and every id in the
   table is used by at least one entry. A group renamed or dropped in either place fails.
3. Every non-GET route is exactly one of: a tool, a `human-only` entry, or a withheld entry.
   A `human-only` entry with a tool fails (now-has-tool); a route that no longer exists fails
   (stale). A ratchet constant lists the writes still withheld for the MCP endpoint and not yet
   assistant tools; each increment removes entries and the last one asserts it empty, then the
   constant is deleted.
4. The same for the 90 reads: a read is a tool or a withheld entry with a closed `why`
   (`secret-or-one-time-value`, `binary-download`, `whole-tenant-download`,
   `personal-data-beyond-need`, `rendered-page`, `volume-at-scale`,
   `assistant-control-plane`, `auditor-text-rule`, `injection-surface`) and a decision that
   names an ADR or a document that exists.
5. What the assistant lacks is a registered list, `ASSISTANT_WITHHELD`, with a reason and a
   decision each, replacing the `OWN_RECORD` regex. A test requires a read tool whose route is
   under `audit`, `agents` or `assistant` to be in it. The chat bridge resolves a call through
   the same assistant tool set the model was offered.
6. `docs/protocols/mcp-route-classes.md` gains an "Assistant" column (`tier A..C`, `human-only:
<group>`, `no: <why>`), generated from the registries and asserted by
   `tests/docs/mcp-route-classes.test.ts`. The assertion that every access-changing,
   credential and destructive route is placed on the MCP phase and has no tool becomes "has no
   tool of audience `all`".
7. Tier belongs with the assistant: a test that every plan has a tier, that the console's
   removal set equals the B and C tools, that a C tool declares its confirmation and that no
   policy is `auto`.

## Consequences

- The decide route's body is strict (`{ approve }`). A typed name is one additive optional
  field and the card gains `tier` and the name to type; the tier itself needs no wire change,
  because the server loads the stored card's tool when it decides.
- A replacing PUT has no ETag, so a card read at proposal can differ from the state fifteen
  minutes later. For those routes the plan's read is re-run when the approval is spent and
  compared with the card; a difference closes the approval as not run.
- A confidential client cannot be created by a tool: the tool refuses any
  `token_endpoint_auth_method` other than `none` at proposal, because an omitted one defaults
  to `client_secret_basic`.
- Everything not possible now is placed, not dropped: the reveal channel, tenant creation and
  import through an instance-write door, the delegated-administrator rule and sessions without
  the caller. The roadmap and section 11 carry them on their own phase, and the plan states
  what each waits for.
- Until cross-tenant Act merges, the new tools inherit its limit; the first increment starts
  after it, because both touch the door and the approval files.

## Rejected

- **A second lint file (`assistant-reach.test.ts`):** its rules duplicate what the coverage test
  asserts (a route is a tool or an entry, denied reads equal the door's list, kinds are
  closed), and two registries drift.
- **A `PENDING` ledger of routes waiting for a tool:** the withheld list already is that list,
  and "recorded and left standing" is the outcome this project refuses. The ratchet constant
  shrinks and is deleted.
- **Reusing the shared MCP write door for the new tools:** hands tier B and C to every outside
  agent, which has no approval step.
- **One tier per tool name:** a role's `PUT` is C for one role and X for another. The target
  decides.
- **Step-up (`auth_time`) as the second confirmation of C:** the API has no precedent; `confirm`
  naming the target does (tenant delete, built-in scope delete).
- **Putting a secret on a one-time stream part now:** it needs a path that keeps it out of
  messages, trace, export, compaction and the report. That is a spike, placed for later.

## Amendment 2026-11-27: a human-only write is never a bare no

**Decision (owner).** When the assistant will not do a write, the person gets the way to do it
themselves: the console area, the controls to use in order, what they need, what the assistant
prepared for them and why it does not do this itself. This holds for a human-only entry, for a
write whose tool is designed but not built yet, and for a write the person's own capability or
the tenant's settings forbid.

**One record per entry, in the same registry.** Each `human-only` entry, and each route still
on the ratchet list of withheld writes, carries `guidance`:

| Field          | Content                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | Stable, such as `sessions.end-all`; what a refusal names                                                                                                            |
| `kind`         | `human-only` or `not-yet`                                                                                                                                           |
| `area`, `path` | The console area and the console route the steps start from                                                                                                         |
| `controls`     | The exact control names in the order a person meets them, each a name the docs `console-labels` evidence maps to the console source                                 |
| `steps`        | Three to seven plain steps                                                                                                                                          |
| `needs`        | The capability the person must hold                                                                                                                                 |
| `prepare`      | `form` (the field names the assistant can prefill, never a secret), `link` (the page only) or `none`; for a secret-returning create, where the secret is shown once |
| `reason`       | One line, why the assistant does not do it                                                                                                                          |
| `variants`     | Different steps when the person's capability, Act being off for the tenant or an Ask-only cross-tenant conversation forbids the write                               |

**Behaviour.** A read-only tool, `console_howto`, answers by operation, guidance id or a
free-text topic with at most five records. The assistant's instructions say to call it
whenever a person asks for something outside Act, and a server refusal of a write as
human-only is a structured `human_only` result that carries the guidance id, so the model
answers with the steps and not with a generic refusal. The console draws the answer from the
result, not from the model's words: a numbered list with each control name as the console
shows it, a button that opens the page, and the prefilled draft where one exists. The record
holds no secret and none enters the model's context; for a secret-returning create the form is
prepared without it and the answer says where it will be shown once.

**Guard.** `tests/lint/mcp-tool-coverage.test.ts` fails an entry whose record is incomplete
(steps outside three to seven, no controls, no capability, a multi-line reason, a field named
like a secret in `prepare`). `apps/docs/tests/guidance-labels.test.ts` fails a control that is
not a name in the `console-labels` evidence, and a path that is not a console route, so a label
the console drops breaks the build. A golden task in the assistant's eval set asks to end
every session and to set a person's password and asserts the answer carries steps.

**Rejected.** A guidance table kept in the docs only (the model cannot reach it and nothing
ties it to the registry); guidance written into the refusal text (it would be the model's
paraphrase of the steps, where a rendered result is exact).

## Amendment 2026-11-27: the assistant reads the audit trail, minus its own record

**Decision (owner).** `list_audit` and `count_audit` are assistant tools, offered when the
person holds `view-audit`, because explaining an event is a profile the assistant is built
for. ADR 0058's boundary rule (the assistant never reads its own audit or trace) still holds,
and is kept on the server instead of by hiding the trail: the audit list and count routes,
when called with an assistant grant, apply one predicate that removes the assistant's own
record, and the same predicate is applied to both, so a count cannot disclose a row the list
hides.

**The own record** is every event whose actor is the built-in assistant client, its grant or
an agent instance rooted in a conversation, every event whose `action` begins `assistant.`
(turn, approval, config, text read, conversation delete and export, report), and the rows
that record the assistant's own reads. It is one registered predicate, `OWN_RECORD_FILTER`,
read by the list, the count and the test, not a regex over route names. It is a mandatory
`AND` in the query: a filter, a cursor, a date range or a request for `event_type` or
`actor_client_id` of the assistant cannot widen it, and such a request answers an empty page
and a zero count, not an error that confirms a row exists.

**What changes in the guard.** `ASSISTANT_WITHHELD` no longer holds `GET ~/audit` or
`GET ~/audit/count`; it keeps the guard that a read tool under `agents` or `assistant` must be
in it, and the audit routes carry the Assistant column value `yes, minus own record`.
`auditor-text-rule` leaves the closed reason set. `GET ~/audit/export` stays withheld (volume
at scale, a person fetches it with their own token). The free text these two tools return
(usernames, client names, `detail`) is registered in the injection coverage as planted, and
the answer is paged under `MAX_LIMIT`.

**Rejected.** _Hide the whole trail from the assistant_ (the earlier decision in this ADR):
the stated rule is about its own rows, the mechanism hid everything, and "explain this event"
needs the trail. _Filter in the tool layer or the console:_ a bypass through a second route
or a count would remain; the door is where the person's rights are already applied.

## Amendment 2026-11-27: what the groundwork fixed

**A removal of wording is tier B.** `clear_message_override` removes what the audit row keeps
the text of and the console already asked twice for, so its plan is tier B and the console
reads the tier from the card, not from a list of tools of its own.

**The re-read set is every replacing PUT.** A tool sends the `ETag` it reads as it makes the
call, which guards the call against a race and not against what changed since the card, so a
`PUT` whose route carries a mandatory `If-Match` is re-read when its approval is spent as well,
and a difference closes the approval as not run (`state_moved`). `mcp-route-classes.md` lists
each PUT route and what it says of `If-Match`.

**Tier C has its own counters.** A change of tier C is counted on a column of the grant and one
of the daily window beside the ordinary ones, under the same limits, so a burst of tier A cannot
spend what it needs. The window and the grant are separate; the share of an agent instance is
not, and the assistant acts as no instance.

**A target that cannot be judged is human-only.** A session is not read yet, so a change to
one fails closed as `own-session` until the removal increment reads it.

**What carries the precondition to the write.** The re-read is made in the assistant and the
spend is a separate transaction, so a change between them is not seen by the re-read. It is
refused by the route instead: a content write tool sends the `if_match` of its approved input,
which the digest binds (`write-tool.ts`, `theme-write.ts`), or a create that the route refuses
for what exists (`createOnly`). A test holds every PUT tool to one of the two, so a later PUT
tool that carries neither fails the build until it carries an etag on the write.

**The tier is judged again as the approval is spent.** A role that gained an administrator
composite, or a subject who joined an administrator group, while a B or C approval waited
closes the approval as not run (`human_only` in the audit row). The facts also count the roles
and groups a body grants, beside the record it names. A card stored without a tier is read as
tier C, which no decision satisfies, and a settled approval answers `409` before the text is
checked.

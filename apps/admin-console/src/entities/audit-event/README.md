# audit-event

What more than one area draws of an audit row: the event as the server writes
it, the page read of the trail, and the table, the dialog and the actor that
show it. The Audit trail, every record's Activity tab and the overview strip
read the same rows, so they share these.

## Rules owned

- Who an actor is and why a name may be absent. A caller from elsewhere (a
  system administrator, or a token another tenant issued) is shown as what it
  is and never named, because the API resolves a name only within the row's
  own tenant and only for a caller who holds `view-users` (ADR 0037).
- What a request label groups. The label is the last six characters of the
  request id, and it marks only the rows loaded, because the server cannot
  filter by request; the caller can set the id, so it is a correlation, not
  evidence.
- How a detail is read: scalars as text, a `before`/`after` pair as one
  change, nesting laid out to three levels and JSON below, at most 100
  entries with the rest counted, and a long value cut until asked for whole.

The wire's field names are kept (`actor_origin`, `request_id`): the rules read
them as they come. The one table (`auditColumns`) and its four-cell summary
(`auditSummaryColumns`) are built from the same cell functions.

Imports `shared` only. The trail's filters, its export and its page are
`pages/audit`'s; a record's Activity tab is `features/record-activity`.

`use-cases/auditCalls.ts` and `resourceHandle.ts` only re-export, so other slices
and the views reach the repository and the rules through a use-case, as the
layering requires. `adapter/fixtures/audit-page-next.json` is a contract example
with an invented cursor, not a captured response. `useAuditTable`, `useAuditDetail` and `auditActorOf` hand
each view what it shows.

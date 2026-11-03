# scope

What more than one area reads or writes of a scope: its record as the server
states it, where it lives in the console, the list to pick one from and the
assignment of a scope to a client.

## Rules owned

- One address for the scopes list, a scope, a new scope and the trail above a
  scope.
- Assigning a scope to a client (`default` or `optional`) and withdrawing it
  are one call each, `PUT` and `DELETE scopes/:id/clients/:clientId`, whichever
  side of the pair the page shows. The answer is the client's scope list alone,
  which is all `manage-tenant` may be told of it.

The wire's field names are kept (`default_client_assignment`, `consent_text`).

Imports `shared` only. Creating, editing and removing a scope, its roles and
its claim mappers are `pages/scopes`'. The assignment calls reach other slices
through `use-cases/scopeCalls`: use-cases may not import adapters and an index
may not export them.

`use-cases/scopeCalls.ts` only re-exports the assignment calls, for the same
reason; `use-cases/scopePicker.ts` does the same for `useScopePicker`.

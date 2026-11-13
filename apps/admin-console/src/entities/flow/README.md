# flow

What more than one area reads of a tenant's sign-in flows: the list as the
server answers it, with how many clients name each, and the name of its record
in the console's cache.

## Rules owned

- One read of the flows list, which a tenant's own Sign-in flow page and the
  Sign-in flow choice on a client both show. A tenant holds at most 20 flows, so
  the list has no next page.
- One name for the list's cache record and for each flow's, so a change to a
  flow reads both again.

The wire's field names are kept (`is_default`, `client_count`).

Imports `shared` only. Creating, editing, deleting and promoting a flow are
`pages/flow`'. `use-cases/flowList.ts` only re-exports, so other slices reach
the repository and the adapter through a use-case, as the layering requires.

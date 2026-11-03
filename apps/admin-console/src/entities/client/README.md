# client

What more than one area reads of a client: its record as the server lists it,
where it lives in the console and the list to pick one from.

## Rules owned

- One address for the clients list, a client, a new client and the trail above
  a client.
- A client is offered by its name with its client id and type after it
  ("billing · confidential"), because two clients may share a name and the
  client id is what a person knows an application by.

The wire's field names are kept (`client_id`, `service_account_admin_reach`):
the capability rules read them as they come.

Imports `shared` only. Creating, configuring, rotating the secret of and
removing a client are `pages/clients`'. The list read stays in
`shared/adapter/directory`, since an entity cannot import another slice's
adapter and the administrator grant reads the same page.

`use-cases/clientPicker.ts` only re-exports `useClientPicker`, so other slices
reach the repository through a use-case, as the layering requires.

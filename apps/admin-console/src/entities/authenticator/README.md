# authenticator

The values an authenticator setting may take and the words a person reads
for them: algorithm, code length and period, user verification, resident
key and the size of a recovery set.

## Rules owned

- Which choices a setting offers, from the contracts' own lists.
- How each choice is worded, shared by the settings page and the sign-in
  flow's step editor.

Imports `@odudu/contracts/admin` only. Its index publishes services only, so
a service may import it for values (`console-service-entity-index-type-only`).

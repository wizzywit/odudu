# administrator

What it takes to add an administrator to a tenant, which more than one area
does: the calls it makes, what each needs, how its role is found and what
it must be given.

## Rules owned

- An administrator is added in up to three calls, made in order and resumable
  between them: the subject is created, the holdings are granted, and the
  one-time password is issued last.
- What each request needs of the caller, and so what a resumed step still
  asks for: the grant and the password need all that is being given.
- The role that grants the console is the one named `tenant-admin` on the
  built-in `odudu-admin` client, never a tenant's own role of that name.
- A grant keeps what the subject already holds, and names Full or at least
  one capability.

Imports `shared` only, and no other entity: what calls the subject
endpoints stays with the slice that makes the calls. Its index holds
services and types only, so a page or feature service may take the rules
from it for values; `console-service-entity-index-type-only` names it as an
exception for that reason.

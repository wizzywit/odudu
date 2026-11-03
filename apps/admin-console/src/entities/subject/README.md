# subject

What more than one area reads or writes of a subject: its record as the
server states it, the one name it is shown under, where it lives in the
console, what it reaches, and the access it is given.

## Rules owned

- One name for a subject: its username, else its kind and id ("service s2");
  a list that names the subject beside its own id reads the username or the
  id alone (`usernameOrId`).
- One address for a subject and for each tab of its record, and which tabs
  exist and in what order.
- The wire subject becomes a camelCase domain subject in one place, the
  adapter; nothing outside reads `created_at`.
- What a subject reaches: the admin capabilities it holds, which of them the
  caller lacks, and what that costs it.
- How a subject's assigned roles split into ordinary roles and the admin
  capabilities among them, and who owns a role.
- Its access records (groups, roles, required actions, held capabilities) and
  the invalidation after a change: a save of roles or groups re-reads what the
  subject holds, its memberships and every list that counts holders.
- The records a subject's sections are saved under, so every page that edits
  one rebases the others.

Imports `shared` only. The profile, credentials, sessions, consents and
grants of one subject are a page's and stay in `pages/subjects`. The access
and role calls reach other slices through `use-cases/subjectCalls`.

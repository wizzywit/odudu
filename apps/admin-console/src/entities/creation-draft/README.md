# creation-draft

A guided creation as far as it has gone: a tenant, or an administrator of
one, kept in the tab's storage so a reload resumes it.

## Rules owned

- What a draft keeps: the typed values and the step, never the one-time
  password.
- Each flow keeps its own progress (creating a tenant, adding an
  administrator to a tenant, adding one of system's own), and a draft belongs
  to the person who typed it: another principal's is not resumed.
- A tenant's creation carries on into the administrator of the tenant it
  created; a finished creation starts fresh once left.
- Who may resume: an administrator whose subject was already created is
  resumed, since a retry would find its username taken and leave it without a
  role; anything less begins afresh.
- Where an administrator's guided step lives: under system administrators for
  system, under the tenant's record for any other.

Imports `shared` only. The calls a step makes, and what each step says, stay
with the page that shows them.

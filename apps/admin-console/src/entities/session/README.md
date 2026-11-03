# session

Who is signed in on this console and what they may do on a tenant.

## Rules owned

- What counts as a different principal (a replaced session) and what is kept
  for the one who left (`draftOwner`).
- When a tenant name is remembered, and what a missing or unknown tenant means.
- Where sign-in sends a person: the login URL, the return path (never outside
  the console), the switch and sign-out destinations.
- How whoami becomes authority, and when a refusal is a missing tenant.
- Whether a principal is in their own tenant or is the subject being read.

- The words and pages of a session in transition: signing in, ended, and signed in
  to another tenant. `widgets/shell` and `pages/console-home` both show them.

Imports `shared` only; the sign-in gate and the home screen live above.

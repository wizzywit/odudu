# session-gate

The gate in front of the console: it reads the session and shows the page for
whatever it finds.

## What it composes

- `entities/session`: the session read, the status pages, `SignedInContext`.

## Rules owned

- When a placeholder is better than a blank page while the session is read.
- The wording of the sign-in question and of the principal-changed page.

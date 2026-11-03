# failure

What the console shows when something it drew fails: a page inside the
shell, the shell itself, or everything above the router.

## What it composes

- `entities/area`: where "Back to overview" goes (`overviewHref`).
- `entities/session`: the reload that asks the unsaved-changes guard first.

## Rules owned

- A failure's id, and what a person may copy: the id, the route as a
  template and the time, never the message, the stack or an address.
- A development build alone shows what the error said.
- Which caught errors are logged: a boundary that draws the id logs it
  itself, the chunk boundary logs what it does not rethrow.
- Reloading from the root skips the unsaved-changes guard; from a route it
  asks first.

# shell

The tenant's frame: rail, header, theme control, pending frame and the gate
every area page stands behind.

## What it composes

- `entities/session` for who is signed in and what they may do, and
  `entities/area` for the catalogue the rail is built from.
- `entities/assistant` for the assistant's button and the gate that opens its
  panel, which the shell places in the rail and the top bar and beside the page.
  The shell decides the gate from whoami (`useAssistantAvailable`), because an
  entity imports no entity. The panel itself is `widgets/assistant-panel`, which
  this widget cannot import: the composition root hands it in as
  `renderAssistantPanel`.

## Rules owned

- Which areas the rail shows, grouped, and which of them a system
  administrator acting on a tenant sees.
- Whether a tenant name is valid for a frame, and what stands in for a page
  while the session is read.
- The rail's collapsed state and the theme choice's cookie.

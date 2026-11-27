# assistant

What the shell and every later assistant screen share: whether the assistant
is offered to this caller, the status it reports, the button that opens the
panel, the one function that turns model text into something safe to draw, and
what the shell hands the panel it draws.

## Rules owned

- **The gate.** Anything about the assistant is asked or drawn only when whoami
  says the deployment has one (`assistant_available`) and the caller holds
  `use-assistant`; then `GET …/assistant/status` decides, and `enabled: false`
  draws nothing. While whoami is out or failed, or the status read fails or is
  refused, there is no button, no panel, no shortcut and no further request
  (`mayUseAssistant`, `assistantView`). In a tenant other than the one signed
  in to, a system administrator also needs `manage-tenants`, and the panel is
  told the tenant it acts in (`actingInOf`); the status read of that tenant
  still decides whether anything is drawn.
- **The shortcut.** Command K on a Mac, Control K elsewhere, with no other
  modifier. It opens the panel, or focuses it when it is open. It does nothing
  while a dialog is open or from anything inside one (`opensAssistant`).
- **Safe text.** `renderSafeMarkdown` is a security control. Its output holds
  only the kinds in `SAFE_NODE_KINDS`: no image, no element made from raw
  HTML (markup is never interpreted, so it is shown as the text it is, in code
  too), no address a click could leave the console by. An external link is its text and its
  address as plain text; a `javascript:`, `data:` or lookalike destination is
  its text alone; a link to a console page (`/console/…`) stays a link. Input,
  nodes and nesting are bounded (ADR 0041). A view maps each node kind to one
  element and nothing else, and never renders model output any other way.
- **Words.** Every string is a key in `ASSISTANT_WORDING`.

Imports `shared` only. The shell decides the gate from whoami and hands it in.
`useRefreshAssistantStatus` reads the status again after a settings save. The index exports `ui`,
`use-cases` and `services` only, and the type `AssistantPanelSlot`. The
conversation, its stream and the approval cards are `widgets/assistant-panel`'s:
the gate takes a `renderPanel` function from the shell and calls it with what
the panel needs (`AssistantPanelSlot`), because an entity cannot import a
widget. The gate keeps the id of the conversation the panel was last open on,
per tenant, so closing the panel and opening it again comes back to it.

`adapter/assistant` reads the status; the conversation's own calls are the
panel's.

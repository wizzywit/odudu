# assistant

What the shell and every later assistant screen share: whether the assistant
is offered to this caller, the status it reports, the button and the panel it
opens from, and the one function that turns model text into something safe to
draw.

## Rules owned

- **The gate.** Anything about the assistant is asked or drawn only when whoami
  says the deployment has one (`assistant_available`) and the caller holds
  `use-assistant`; then `GET …/assistant/status` decides, and `enabled: false`
  draws nothing. While whoami is out or failed, or the status read fails or is
  refused, there is no button, no panel, no shortcut and no further request
  (`mayUseAssistant`, `assistantView`).
- **The shortcut.** Command K on a Mac, Control K elsewhere, with no other
  modifier. It opens the panel, or focuses it when it is open. It does nothing
  while a text field inside a dialog has the focus (`opensAssistant`).
- **Safe text.** `renderSafeMarkdown` is a security control. Its output holds
  only the kinds in `SAFE_NODE_KINDS`: no image, no raw HTML, no address a
  click could leave the console by. An external link is its text and its
  address as plain text; a `javascript:`, `data:` or lookalike destination is
  its text alone; a link to a console page (`/console/…`) stays a link. Input,
  nodes and nesting are bounded (ADR 0041). A view maps each node kind to one
  element and nothing else, and never renders model output any other way.
- **Words.** Every string is a key in `ASSISTANT_WORDING`.

Imports `shared` and the session entity's index. The index exports `ui`,
`use-cases` and `services` only. The conversation, its stream and the
approval cards are `widgets/assistant-panel`'s; `AssistantPanel` here is the
frame it fills.

`adapter/assistant` reads the status and creates and loads a conversation
against the contract. The streamed message route is not read here: the
gateway already forwards `POST …/messages` unbuffered
(`packages/console-gateway/src/view/routes/proxy.ts`), and the panel reads it
with `fetch`, not through the buffered `Gateway`.

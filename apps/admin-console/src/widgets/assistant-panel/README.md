# assistant-panel

The conversation with the assistant, docked beside the page or laid over it.

## What it composes

- `entities/assistant` for the gate that opens it (`AssistantPanelSlot` is what
  the shell hands it), `renderSafeMarkdown` for every word of an answer, and the
  status the assistant reports (modes, models, provider).
- `shared/api/transport` for every call: the stream is read through
  `gateway.stream`, which carries the same console header, subject and refusals
  as every other call, and the chat client (`@ai-sdk/react`) sees only a
  transport built over it.

## Rules owned

- **One chat client, here.** `ai` and `@ai-sdk/react` are imported by this
  widget's `adapter/` and `repository/` folders alone, for the client half of the stream: no key, no model choice.
  `.dependency-cruiser.cjs` (`ai-sdk-only-in-assistant`) says so.
- **A turn's end is read from its last part.** The chat client stops reading
  at an error part, so `adapter/deferError.ts` holds that part back until the
  stream's closing `data-turn_end` has been passed on. Without it a turn that
  stopped on an allowance would show as a failure.
- **State is a word.** `services/panelState.ts` is the one place that says what
  the panel is doing (connecting, thinking, tool, waiting, stopped, step limit,
  budget, failed, finished); the status line, the notices and the controls read
  it. The status line is a polite live region and never holds a token of an
  answer.
- **Where the person is is sent as three short values** from the router
  (`services/pageContext.ts`), never as text a person typed.
- **The meter says what the server said.** The server sends the share of a
  level at which it warned and the level that refused, and no usage figures, so
  the meter shows only that, and nothing before it has said anything. A
  warning and a refusal are kept across turns until one ends well.
- **Another tenant.** For a system administrator acting in another tenant
  (`AssistantPanelSlot.actingIn`) the panel names the tenant for as long as it is
  open, draws Act disabled with the reason, and starts every conversation in
  Ask. The server binds the conversation to the tenant of the address, so the
  panel sends nothing more. Its first-run notice is its own, and is remembered
  apart from the one for the administrator's own tenant.
- **The person's own conversations.** A panel opened with none remembered asks
  the server for the latest one that is not archived and shows it
  (`useAssistantChat`); one whose sign-in ended (`continuable: false`) is read
  only, as is an archived one, and the composer gives way to a `ReadOnlyBar`.
  A message refused as `conversation-ended` is drawn as never sent
  (`unlessEnded`), not as a failure. The Conversations view
  (`ui/ConversationsView`, `use-cases/useConversations`) shares the panel's
  grid cell with the chat and swaps with it by transform and opacity only, so
  nothing is laid out again and the chat, and an answer running in it, stays
  mounted. Its rows are a react-aria `GridList`; a pick while an answer runs
  waits on **Stop and switch** or **Keep waiting**. Archive acts at once and is
  offered back; delete is asked about; export saves a file through
  `shared/api/adapter/files`. Nothing here keeps a second copy of what the
  server holds: the two lists are `useListPages` reads, read again after a change.
- **Kept mounted.** The panel is a lazy chunk, loaded when first opened, and
  stays mounted when closed, so putting it away never ends an answer; only Stop
  does (and leaving the tenant shell).
- **Docked or over the page** follows the shell's own width (`DOCK_MIN_WIDTH`,
  the number the shell's stylesheet asks about). Over the page it is a dialog:
  the page behind is out of reach, Tab stays inside, Escape closes.

Approval cards, the activity feed and the profiles are later; a change that
waits for a decision is said to wait, and nothing is approved from here yet.

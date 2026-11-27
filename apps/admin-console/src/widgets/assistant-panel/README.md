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
  open and offers Act as the status of that tenant gives it, saying where its
  changes land; each card and removal question names the tenant too. A
  conversation starts in Ask. The server binds the conversation to the tenant
  of the address, so the panel sends nothing more, and a refusal because that
  tenant does not offer Act is worded from the server's detail. Its first-run notice is its own, and is remembered
  apart from the one for the administrator's own tenant.
- **The person's own conversations.** A panel opened with none remembered asks
  the server for the latest one that is not archived and shows it
  (`useAssistantChat`). One reopened after a sign-in takes a message like any
  other: the server carries it on under the new sign-in (`continuable` is
  `true`). It is read only, with a `ReadOnlyBar`, when it is archived or when
  its sign-in was ended for a reason other than signing out. A message refused
  as `conversation-ended` or `conversation-archived` is drawn as never sent
  (`refusedEndOf`, `unlessEnded`), not as a failure; one refused as
  `conversation-access-refused` is a failure that says nothing was sent, and
  the composer stays. The Conversations view
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

- **Act and the approval card.** The mode switch is the person's, kept for a
  conversation about to start and sent to the server for one that has
  (`setMode`). A change that waits is read from the server's list while the
  conversation waits (`repository/useApprovals`), and the card is drawn from
  that stored change, never from the model's words (`ui/ApprovalCard`,
  `ui/ChangeDiff`). The countdown is the server's clock, taken from the
  `Date` of the answer that listed the card (`adapter/approvals`), so a wrong
  browser clock does not stretch or shorten the time. A decision is sent once,
  and the answer is carried on by the stream's resume route only when it was
  accepted. A card the person acted on is kept here, with its change, so the
  outcome can still be drawn after the server stops listing it; a later visit
  has the step's own state only. Nothing approves by expiry, by a default
  focus or by a timer.
- **The activity feed** (`ui/ActivityFeed`, `services/activity-lines`) words a
  step from a phrase table with a fallback from the tool's name; a test over
  the assistant's whole tool list holds every tool to a phrase. A step's time is
  what the stream said (`adapter/watchSteps`), so a step the panel never saw
  begin has none.

The profiles are later.

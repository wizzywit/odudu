import type { AssistantApprovalCard } from '@odudu/contracts/admin';
import type { RegisteredTool, ToolResult } from '@odudu/mcp';
import type { ToolApprovalStatus } from 'ai';
import type { ConversationMode } from '#/repository/conversations';
import type { CardBody } from '#/repository/approvals';
import {
  afterOf,
  beforeOf,
  changedFields,
  cursorOf,
  mayCreate,
  readStepOf,
  targetOf,
  titleOf,
} from '#/service/approval-card';
import { approvalPolicy, ASK_MODE_DENIAL } from '#/service/approval-policy';
import type { CallWrite } from '#/service/tool-bridge';

export type OpenOutcome =
  { kind: 'opened'; card: AssistantApprovalCard } | { kind: 'refused'; reason: 'limit' };

/**
 * What a turn needs to let the model propose changes: to store one for the
 * person, to run one that was approved, and to say when one now waits.
 */
export interface TurnApprovals {
  readonly open: (call: {
    readonly toolCallId: string;
    readonly tool: string;
    readonly input: unknown;
    readonly body: CardBody;
  }) => Promise<OpenOutcome>;
  readonly write: CallWrite;
  /** A change now waits for the person: its card is sent, and the turn will end on it. */
  readonly proposed: (card: AssistantApprovalCard) => void;
}

// What the model reads when a proposal could not be made. Each is true of the
// proposal alone and tells it what to do next.
export const LIMIT_DENIAL =
  'The person already has as many changes waiting for a decision as are allowed, so this was not proposed. ' +
  'Tell them to decide on the waiting ones or let them expire.';
export const UNREADABLE_DENIAL =
  'The current state of what this would change could not be read, so it was not proposed. ' +
  'Say so, and try again only if the person asks.';
export const MISSING_DENIAL =
  'What this would change does not exist, so it was not proposed. Check the id with a read tool.';
export const FAILED_DENIAL = 'This change could not be proposed. Say so, and do not retry it.';

export interface PolicyDeps {
  readonly mode: ConversationMode;
  readonly tools: readonly RegisteredTool[];
  /** Reads with the conversation's own read token, as any other read of the turn. */
  readonly read: (
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<ToolResult>;
  readonly approvals: TurnApprovals;
  readonly signal?: AbortSignal | undefined;
  readonly log?: (event: string, detail: Record<string, unknown>) => void;
}

// A page of overrides holds at most 200 and a tenant at most 500 in all.
const READ_PAGES = 3;

type Found = { kind: 'data'; data: unknown } | { kind: 'missing' } | { kind: 'unreadable' };

// Reads the target the way its plan says, following a cursor where the read is
// a page. An error that is not a 404 is unreadable, which refuses the proposal:
// the person is never asked to approve a change the server could not look at.
async function readTarget(deps: PolicyDeps, tool: string, input: unknown): Promise<Found> {
  const step = readStepOf(tool, input);
  if (step === undefined) return { kind: 'data', data: undefined };
  const rows: unknown[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < READ_PAGES; page += 1) {
    const result = await deps.read(
      step.tool,
      cursor === undefined ? step.args : { ...step.args, cursor },
      deps.signal,
    );
    if (result.isError) {
      return result.structuredContent.error !== undefined &&
        (result.structuredContent.error as { status?: unknown }).status === 404
        ? { kind: 'missing' }
        : { kind: 'unreadable' };
    }
    const data = result.structuredContent.data;
    cursor = cursorOf(tool, result.structuredContent);
    if (cursor === undefined)
      return { kind: 'data', data: rows.length === 0 ? data : [...rows, ...(data as unknown[])] };
    if (!Array.isArray(data)) return { kind: 'unreadable' };
    rows.push(...data);
  }
  return { kind: 'unreadable' };
}

async function propose(
  deps: PolicyDeps,
  entry: RegisteredTool,
  call: { readonly toolCallId: string; readonly input: unknown },
): Promise<ToolApprovalStatus> {
  const names = changedFields(entry, call.input);
  const found = await readTarget(deps, entry.name, call.input);
  if (found.kind === 'missing') return { type: 'denied', reason: MISSING_DENIAL };
  if (found.kind === 'unreadable') return { type: 'denied', reason: UNREADABLE_DENIAL };
  const before = beforeOf(entry.name, names, call.input, found.data);
  if (before === undefined) return { type: 'denied', reason: UNREADABLE_DENIAL };
  if (
    before === null &&
    readStepOf(entry.name, call.input) !== undefined &&
    !mayCreate(entry.name)
  ) {
    return { type: 'denied', reason: MISSING_DENIAL };
  }
  const outcome = await deps.approvals.open({
    toolCallId: call.toolCallId,
    tool: entry.name,
    input: call.input,
    body: {
      title: titleOf(entry.name),
      target: targetOf(entry.name, call.input, found.data),
      before,
      after: afterOf(entry.name, names, call.input),
    },
  });
  if (outcome.kind === 'refused') return { type: 'denied', reason: LIMIT_DENIAL };
  deps.approvals.proposed(outcome.card);
  return 'user-approval';
}

interface HistoryMessage {
  readonly role: string;
  readonly content: unknown;
}

// Whether the call is already in the history the SDK passes: it is then being
// re-checked after the person's decision, not proposed. The re-check must write
// nothing, since the approval it would open exists, and the mode is still judged.
function inHistory(messages: readonly HistoryMessage[], toolCallId: string): boolean {
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      Array.isArray(message.content) &&
      message.content.some(
        (part: { type?: unknown; toolCallId?: unknown }) =>
          part.type === 'tool-call' && part.toolCallId === toolCallId,
      ),
  );
}

/**
 * The SDK's `toolApproval` for a turn: a read runs, a write is refused in Ask
 * mode and, in Act mode, stored for the person to decide before the model hears
 * of it. The reasons returned are what the model reads; the card the person
 * sees is built from the stored call and a read the server made, never from
 * anything the model wrote. The SDK asks again for a call whose decision has
 * come back, and that second question opens nothing.
 */
export function toolApprovalFor(
  deps: PolicyDeps,
): (options: {
  readonly toolCall: {
    readonly toolName: string;
    readonly toolCallId: string;
    readonly input: unknown;
  };
  readonly messages: readonly HistoryMessage[];
}) => Promise<ToolApprovalStatus> {
  const byName = new Map(deps.tools.map((tool) => [tool.name, tool]));
  return async ({ toolCall, messages }) => {
    const entry = byName.get(toolCall.toolName);
    if (entry === undefined) return { type: 'denied', reason: FAILED_DENIAL };
    const verdict = approvalPolicy({
      mode: deps.mode,
      annotations: entry.annotations,
      tool: entry.name,
    });
    if (verdict === 'auto') return undefined;
    if (verdict === 'deny') return { type: 'denied', reason: ASK_MODE_DENIAL };
    if (inHistory(messages, toolCall.toolCallId)) return 'user-approval';
    try {
      return await propose(deps, entry, toolCall);
    } catch (error) {
      deps.log?.('assistant.proposal_failed', {
        tool: entry.name,
        error: error instanceof Error ? error.name : 'unknown',
      });
      return { type: 'denied', reason: FAILED_DENIAL };
    }
  };
}

// The activity routes' reads and the report, for the tenant `tx` is bound to.
// Who may call them is decided by the door and the tenant's auditor setting
// before these run; a conversation that is not this tenant's is not found.
import {
  ACTIVITY_TOOLS_MAX,
  ASSISTANT_REPORTED_MAX,
  REPLAY_ASKED_MAX,
  REPLAY_TURNS_MAX,
  type AssistantActivityConversation,
  type AssistantActivityReplay,
  type AssistantPromptfooCase,
  type ListAssistantActivityQuery,
} from '@odudu/contracts/admin';
import {
  activityRepository,
  type ActivityConversationRow,
  type ActivityPosition,
} from '#/repository/activity';
import type { AssistantTx } from '#/repository/tx';
import {
  askedTextOf,
  replayApprovalOf,
  replayConversationOf,
  replayTurnOf,
  summaryOf,
} from '#/service/activity-view';
import { createMasker } from '#/service/mask-secrets';
import { TEXT_WITHHELD } from '#/service/withhold-text';
import { promptfooCaseOf } from '#/service/promptfoo-case';
import { decodePosition, encodePosition } from '#/service/activity-position';
import { readSettings } from '#/usecase/settings';

type Repository = ReturnType<typeof activityRepository>;

export interface ActivityList {
  readonly items: AssistantActivityConversation[];
  readonly next: string | null;
}

async function summaries(
  repository: Repository,
  rows: readonly ActivityConversationRow[],
  now: Date,
  text: boolean,
): Promise<AssistantActivityConversation[]> {
  const ids = rows.map((row) => row.id);
  const turns = await repository.turnAggregates(ids);
  const slots = await repository.slotTokens(ids);
  const tools = await repository.toolNames(ids, ACTIVITY_TOOLS_MAX);
  const approvals = await repository.approvalCounts(ids);
  return rows.map((row) =>
    summaryOf(row, {
      turns: turns.get(row.id),
      slots: slots.get(row.id),
      tools: tools.get(row.id),
      approvals: approvals.get(row.id),
      now,
      text,
    }),
  );
}

/**
 * A page of the tenant's conversations, newest activity first, each with its
 * counts. The page costs the same handful of queries however many conversations
 * the tenant holds. `undefined` for a cursor that is not one this list wrote.
 */
export async function listActivity(
  tx: AssistantTx,
  query: Omit<ListAssistantActivityQuery, 'cursor' | 'limit'>,
  cursor: string | undefined,
  limit: number,
  text: boolean,
): Promise<ActivityList | undefined> {
  let after: ActivityPosition | undefined;
  if (cursor !== undefined) {
    after = decodePosition(cursor);
    if (after === undefined) return undefined;
  }
  const repository = activityRepository(tx);
  const page = await repository.page(query, after, limit);
  return {
    items: await summaries(repository, page.items, new Date(), text),
    next: page.next === null ? null : encodePosition(page.next),
  };
}

/**
 * One conversation as the trace holds it: its latest turns with their steps,
 * events and the server's reasons, the changes it proposed and what the person
 * asked, masked. `null` when the conversation is not the tenant's.
 */
export async function replayConversation(
  tx: AssistantTx,
  tenantId: string,
  id: string,
  text: boolean,
): Promise<AssistantActivityReplay | null> {
  const repository = activityRepository(tx);
  const row = await repository.byId(id);
  if (row === undefined) return null;
  const settings = await readSettings(tx, tenantId);
  const latest = await repository.latestTurns(id, REPLAY_TURNS_MAX);
  const turns = [...latest.turns].reverse();
  const withheld = !text;
  const turnIds = turns.map((turn) => turn.id);
  const steps = await repository.stepsOf(turnIds);
  const events = await repository.eventsOf(turnIds);
  const approvals = await repository.approvalsOf(id, REPLAY_ASKED_MAX);
  const asked = await repository.askedOf(id, REPLAY_ASKED_MAX);
  // One masker for the person's messages, so a secret in one is hidden in the rest.
  const masker = createMasker({ emails: settings.assistant_mask_emails });
  return {
    conversation: replayConversationOf(row),
    asked: asked.flatMap((message) => {
      const said = askedTextOf(message);
      const masked = withheld || said === null ? null : masker.mask(said);
      return said === null
        ? []
        : [
            {
              at: message.createdAt.toISOString(),
              text: typeof masked === 'string' ? masked : TEXT_WITHHELD,
            },
          ];
    }),
    turns: turns.map((turn) =>
      replayTurnOf(
        turn,
        steps.filter((step) => step.turnId === turn.id),
        events.filter((event) => event.turnId === turn.id),
        withheld,
      ),
    ),
    turns_omitted: Math.max(0, latest.total - turns.length),
    approvals: approvals.map((row) => replayApprovalOf(row, text)),
    text_visible: text,
  };
}

export async function exportPromptfoo(
  tx: AssistantTx,
  tenantId: string,
  id: string,
  text: boolean,
): Promise<{ readonly value: AssistantPromptfooCase; readonly person: string } | null> {
  const replay = await replayConversation(tx, tenantId, id, text);
  return replay === null
    ? null
    : {
        value: promptfooCaseOf(
          replay,
          replay.asked.map((m) => m.text),
        ),
        person: replay.conversation.person,
      };
}

export type ReportOutcome =
  | { readonly kind: 'reported'; readonly at: Date; readonly count: number }
  | { readonly kind: 'already'; readonly at: Date; readonly count: number }
  | { readonly kind: 'full' }
  | { readonly kind: 'missing' };

export interface ReportInput {
  readonly conversationId: string;
  /** The person asking, who may report their own conversation. */
  readonly subjectId: string;
  /** Whether the caller may read other people's conversations now. */
  readonly mayReadOthers: boolean;
  readonly now: Date;
}

/**
 * Keeps a conversation past retention, once. The person it belongs to may, and
 * so may a caller who can read others' conversations; anyone else is told what
 * they are told of a conversation that is not there. A tenant keeps at most
 * ASSISTANT_REPORTED_MAX of them.
 */
export async function reportConversation(
  tx: AssistantTx,
  input: ReportInput,
): Promise<ReportOutcome> {
  const repository = activityRepository(tx);
  const row = await repository.byId(input.conversationId);
  if (row === undefined) return { kind: 'missing' };
  if (row.ownerSubjectId !== input.subjectId && !input.mayReadOthers) return { kind: 'missing' };
  return repository.report(input.conversationId, input.now, ASSISTANT_REPORTED_MAX);
}

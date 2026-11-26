import type { AssistantApprovalCard, AssistantMode } from '@odudu/contracts/admin';
import { approvalCardRepository, type ApprovalCardRow } from '#/repository/approvals';
import { conversationRepository } from '#/repository/conversations';
import { messageRepository } from '#/repository/messages';
import { modeOffered } from '#/service/proposal-rules';
import { settleParts } from '#/service/settle-approvals';
import type { ChatCaller, ChatDeps, DecideResult, WithdrawReason } from '#/usecase/chat-deps';
import { openEntitlements } from '#/usecase/entitlements';

/** A card as the person is shown it, with the expiry by the server's clock. */
export function cardView(row: ApprovalCardRow): AssistantApprovalCard {
  return {
    approval_id: row.approvalId,
    tool_call_id: row.toolCallId,
    tool: row.tool,
    ...row.body,
    expires_at: row.expiresAt.toISOString(),
  };
}

/** The conversation's changes still waiting, or null for one that is not the caller's. */
export async function listApprovals(
  deps: ChatDeps,
  caller: ChatCaller,
  conversationId: string,
): Promise<AssistantApprovalCard[] | null> {
  return deps.transact(caller.tenantId, async (tx) => {
    const record = await conversationRepository(tx).byId(conversationId);
    if (record?.ownerSubjectId !== caller.ownerSubjectId) return null;
    const rows = await approvalCardRepository(tx).pending(conversationId, deps.now());
    return rows.map(cardView);
  });
}

// The card the decision is for, only where the caller owns the conversation
// that holds it: an approval of another conversation, or another person's, is
// reported as not there.
function loadCard(caller: ChatCaller, conversationId: string, approvalId: string) {
  return async (tx: Parameters<Parameters<ChatDeps['transact']>[1]>[0]) => {
    const owner = (await conversationRepository(tx).byId(conversationId))?.ownerSubjectId;
    if (owner !== caller.ownerSubjectId) return undefined;
    const card = await approvalCardRepository(tx).byApproval(approvalId);
    return card?.conversationId === conversationId
      ? { conversationId, tool: card.tool }
      : undefined;
  };
}

/** The caller's decision on one change, recorded by P5's single writer. */
export async function decideCard(
  deps: ChatDeps,
  caller: ChatCaller,
  conversationId: string,
  approvalId: string,
  approve: boolean,
): Promise<DecideResult> {
  if (deps.approvals === undefined) return { kind: 'not_found' };
  return deps.approvals.answer(
    caller,
    { approvalId, approve, now: deps.now() },
    loadCard(caller, conversationId, approvalId),
  );
}

/**
 * Withdraws every change of the conversation that is still waiting, as a
 * denial by its owner: the person sent another message, stopped, or left Act
 * mode, so what they were asked is no longer open. Goes through the same single
 * writer as an answer.
 */
export async function withdrawPending(
  deps: ChatDeps,
  caller: ChatCaller,
  conversationId: string,
  reason: WithdrawReason,
): Promise<number> {
  if (deps.approvals === undefined) return 0;
  const cards = await deps.transact(caller.tenantId, async (tx) => {
    const record = await conversationRepository(tx).byId(conversationId);
    if (record?.ownerSubjectId !== caller.ownerSubjectId) return [];
    return approvalCardRepository(tx).pending(conversationId, deps.now());
  });
  let withdrawn = 0;
  for (const card of cards) {
    const result = await deps.approvals.answer(
      caller,
      { approvalId: card.approvalId, approve: false, now: deps.now(), withdrawn: reason },
      loadCard(caller, conversationId, card.approvalId),
    );
    if (result.kind === 'decided') withdrawn += 1;
  }
  return withdrawn;
}

export interface Settlement {
  readonly waiting: number;
  readonly resumable: number;
  readonly settled: number;
}

/**
 * Brings the last assistant message's pending change parts up to date with the
 * decisions taken, and keeps the result, so a crash after this leaves the
 * stored conversation as the model will read it.
 */
export async function settleLastMessage(
  deps: ChatDeps,
  caller: ChatCaller,
  conversationId: string,
  how: 'resume' | 'message',
): Promise<Settlement> {
  return deps.transact(caller.tenantId, async (tx) => {
    const record = await conversationRepository(tx).byId(conversationId);
    if (record?.ownerSubjectId !== caller.ownerSubjectId) {
      return { waiting: 0, resumable: 0, settled: 0 };
    }
    const messages = messageRepository(tx);
    const last = (await messages.load(conversationId, 1))[0];
    if (last?.role !== 'assistant') return { waiting: 0, resumable: 0, settled: 0 };
    const parts = last.parts as Parameters<typeof settleParts>[0];
    const callIds = parts.flatMap((part) => {
      const id = (part as { toolCallId?: unknown }).toolCallId;
      return typeof id === 'string' ? [id] : [];
    });
    const cards = await approvalCardRepository(tx).forCalls(conversationId, callIds);
    const settled = settleParts(parts, cards, deps.now(), how);
    if (settled.settled > 0) {
      await messages.replaceLast(conversationId, last.seq, {
        role: 'assistant',
        parts: settled.parts,
      });
    }
    return { waiting: settled.waiting, resumable: settled.resumable, settled: settled.settled };
  });
}

export type SetModeOutcome =
  { kind: 'set'; mode: AssistantMode } | { kind: 'not_found' } | { kind: 'not_offered' };

/**
 * Switches one conversation between Ask and Act. It is the person's act from
 * the console and never a tool. Leaving Act withdraws what was waiting, since
 * Ask mode runs no change; Act is refused where the tenant's limits do not
 * offer it or the deployment cannot propose a change.
 */
export async function setConversationMode(
  deps: ChatDeps,
  caller: ChatCaller,
  conversationId: string,
  mode: AssistantMode,
): Promise<SetModeOutcome> {
  const outcome = await deps.transact(caller.tenantId, async (tx) => {
    const record = await conversationRepository(tx).byId(conversationId);
    if (record?.ownerSubjectId !== caller.ownerSubjectId) return 'not_found' as const;
    if (mode === 'act') {
      const limits = await (deps.entitlements ?? openEntitlements(tx)).limits(caller.tenantId);
      if (!modeOffered({ mode, canPropose: deps.approvals !== undefined, modes: limits.modes })) {
        return 'not_offered' as const;
      }
    }
    await conversationRepository(tx).setMode(conversationId, mode);
    return 'set' as const;
  });
  if (outcome !== 'set') return { kind: outcome };
  if (mode === 'ask') await withdrawPending(deps, caller, conversationId, 'mode_changed');
  return { kind: 'set', mode };
}

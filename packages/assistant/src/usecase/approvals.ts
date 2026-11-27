import type { AssistantApprovalCard, AssistantMode } from '@odudu/contracts/admin';
import { approvalCardRepository, type ApprovalCardRow } from '#/repository/approvals';
import { conversationRepository } from '#/repository/conversations';
import { messageRepository } from '#/repository/messages';
import { actsInTenantOf, conversationIsCallers, crossTenant } from '#/service/conversation-access';
import { modeForProfile, profileById } from '#/service/profiles';
import { modeOffered } from '#/service/proposal-rules';
import { settleParts } from '#/service/settle-approvals';
import type { ChatCaller, ChatDeps, DecideResult, WithdrawReason } from '#/usecase/chat-deps';
import { openEntitlements } from '#/usecase/entitlements';
import { targetSide } from '#/usecase/target-side';

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
    if (record === undefined || !conversationIsCallers(record, caller)) return null;
    const rows = await approvalCardRepository(tx).pending(conversationId, deps.now());
    return rows.map(cardView);
  });
}

// The card the decision is for, only where the caller owns the conversation
// that holds it: an approval of another conversation, or another person's, is
// reported as not there.
function loadCard(caller: ChatCaller, conversationId: string, approvalId: string) {
  return async (tx: Parameters<Parameters<ChatDeps['transact']>[1]>[0]) => {
    const record = await conversationRepository(tx).byId(conversationId);
    if (record === undefined || !conversationIsCallers(record, caller)) return undefined;
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
    if (record === undefined || !conversationIsCallers(record, caller)) return [];
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
    if (record === undefined || !conversationIsCallers(record, caller)) {
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
  | { kind: 'set'; mode: AssistantMode }
  | { kind: 'not_found' }
  // The conversation's profile does not run in the mode asked for.
  | { kind: 'profile_refused' }
  // `cause` says the tenant the conversation acts in is the one that does not
  // offer the mode, not the caller's own.
  | { kind: 'not_offered'; cause?: 'target' };

/**
 * Switches one conversation between Ask and Act. It is the person's act from
 * the console and never a tool. Leaving Act withdraws what was waiting, since
 * Ask mode runs no change; Act is refused where the tenant's limits do not
 * offer it, the deployment cannot propose a change or, in another tenant, that
 * tenant does not offer it.
 */
export async function setConversationMode(
  deps: ChatDeps,
  caller: ChatCaller,
  conversationId: string,
  mode: AssistantMode,
): Promise<SetModeOutcome> {
  const checked = await deps.transact(caller.tenantId, async (tx) => {
    const record = await conversationRepository(tx).byId(conversationId);
    if (record === undefined || !conversationIsCallers(record, caller)) return 'not_found' as const;
    const task = profileById(record.profile);
    if (task !== undefined && modeForProfile(task, mode) === null)
      return 'profile_refused' as const;
    if (mode === 'act') {
      const limits = await (deps.entitlements ?? openEntitlements(tx)).limits(caller.tenantId);
      if (!modeOffered({ mode, canPropose: deps.approvals !== undefined, modes: limits.modes })) {
        return 'not_offered' as const;
      }
    }
    return 'checked' as const;
  });
  if (checked !== 'checked') return { kind: checked };
  if (mode === 'act' && !(await targetOffersAct(deps, caller))) {
    return { kind: 'not_offered', cause: 'target' };
  }
  await deps.transact(caller.tenantId, (tx) =>
    conversationRepository(tx).setMode(conversationId, mode),
  );
  if (mode === 'ask') await withdrawPending(deps, caller, conversationId, 'mode_changed');
  return { kind: 'set', mode };
}

/**
 * Whether the tenant a conversation acts in offers Act. A conversation in the
 * caller's own tenant has no other tenant to ask, so it is always offered here.
 */
export async function targetOffersAct(deps: ChatDeps, caller: ChatCaller): Promise<boolean> {
  if (!crossTenant(caller)) return true;
  return (await targetSide(deps, actsInTenantOf(caller))).modes.includes('act');
}

/**
 * Whether a change may still be made in Act: the caller's own tenant and, in
 * another tenant, that tenant offer it now. Asked again when an approved
 * change is about to be spent, since either tenant may have dropped Act since
 * the person approved.
 */
export async function actStillOffered(deps: ChatDeps, caller: ChatCaller): Promise<boolean> {
  const own = await deps.transact(caller.tenantId, async (tx) =>
    (deps.entitlements ?? openEntitlements(tx)).limits(caller.tenantId),
  );
  return own.modes.includes('act') && (await targetOffersAct(deps, caller));
}

import type {
  AssistantConversation,
  AssistantResumedConversation,
  CreateConversationRequest,
} from '@odudu/contracts/admin';
import { conversationRepository } from '#/repository/conversations';
import { conversationIsCallers, crossTenant } from '#/service/conversation-access';
import { MAX_LOAD, messageRepository } from '#/repository/messages';
import { conversationView, visibleMessages } from '#/usecase/conversation-view';
import { runKey } from '#/service/run-key';
import { PAGE_CONTEXT_PART } from '#/service/page-context';
import { FREE_CHAT, profileById } from '#/service/profile';
import type { ChatCaller, ChatDeps } from '#/usecase/chat-deps';

export type CreateOutcome =
  | { kind: 'created'; conversation: AssistantConversation }
  | { kind: 'unknown_profile' }
  // The caller's sign-in cannot be given an assistant's identity: nothing was written.
  | { kind: 'access_refused'; reason: string };

export async function createConversation(
  deps: ChatDeps,
  caller: ChatCaller,
  request: CreateConversationRequest,
): Promise<CreateOutcome> {
  const profile = request.profile ?? FREE_CHAT.id;
  if (profileById(profile) === undefined) return { kind: 'unknown_profile' };
  const id = deps.newId();
  const now = deps.now();
  const mode = request.mode ?? 'ask';
  // A conversation in another tenant reads only until its approvals carry that
  // tenant too, so it is not started in Act.
  if (mode === 'act' && crossTenant(caller)) {
    return { kind: 'access_refused', reason: 'act_not_offered' };
  }
  const outcome = await deps.withAccess(caller, { id, mode, now }, async (tx) => {
    const created = await conversationRepository(tx).create({
      id,
      tenantId: caller.tenantId,
      ownerSubjectId: caller.ownerSubjectId,
      instanceId: deps.instanceIdFor(caller, id, runKey(id, 0)),
      profile,
      mode,
      ...(caller.target !== undefined && crossTenant(caller)
        ? { targetTenantId: caller.target.id }
        : {}),
      now,
    });
    await messageRepository(tx).append(id, {
      role: 'system',
      parts: [{ type: PAGE_CONTEXT_PART, data: request.page_context }],
    });
    return created;
  });
  if (outcome.kind === 'refused') return { kind: 'access_refused', reason: outcome.reason };
  const record = outcome.value;
  return { kind: 'created', conversation: conversationView(record, []) };
}

/**
 * The conversation as its owner sees it, or null for one that is not theirs or
 * not there. It says whether it is hidden and whether a message to it would be
 * answered under the sign-in the caller holds now, so a screen never offers a
 * message field that the server then refuses.
 */
export async function loadConversation(
  deps: ChatDeps,
  caller: ChatCaller,
  id: string,
): Promise<AssistantResumedConversation | null> {
  const loaded = await deps.transact(caller.tenantId, async (tx) => {
    const record = await conversationRepository(tx).byId(id);
    if (record === undefined || !conversationIsCallers(record, caller)) return null;
    const messages = await messageRepository(tx).load(id, MAX_LOAD);
    return { view: conversationView(record, visibleMessages(id, messages)), record };
  });
  if (loaded === null) return null;
  const continuable = deps.continuable === undefined || (await deps.continuable(caller, id));
  return { ...loaded.view, archived: loaded.record.archivedAt !== null, continuable };
}

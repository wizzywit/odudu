import type { AssistantConversation, CreateConversationRequest } from '@odudu/contracts/admin';
import { conversationRepository } from '#/repository/conversations';
import { MAX_LOAD, messageRepository } from '#/repository/messages';
import { conversationView, visibleMessages } from '#/usecase/conversation-view';
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
  const record = await deps.transact(caller.tenantId, async (tx) => {
    const access = await deps.grantAccess(tx, caller, { id, mode, now });
    if (access.kind === 'refused') return access;
    const created = await conversationRepository(tx).create({
      id,
      tenantId: caller.tenantId,
      ownerSubjectId: caller.ownerSubjectId,
      instanceId: deps.instanceIdFor(caller, id),
      profile,
      mode,
      now,
    });
    await messageRepository(tx).append(id, {
      role: 'system',
      parts: [{ type: PAGE_CONTEXT_PART, data: request.page_context }],
    });
    return created;
  });
  if ('kind' in record) return { kind: 'access_refused', reason: record.reason };
  return { kind: 'created', conversation: conversationView(record, []) };
}

/** The conversation as its owner sees it, or null for one that is not theirs or not there. */
export async function loadConversation(
  deps: ChatDeps,
  caller: ChatCaller,
  id: string,
): Promise<AssistantConversation | null> {
  return deps.transact(caller.tenantId, async (tx) => {
    const record = await conversationRepository(tx).byId(id);
    if (record?.ownerSubjectId !== caller.ownerSubjectId) return null;
    const messages = await messageRepository(tx).load(id, MAX_LOAD);
    return conversationView(record, visibleMessages(id, messages));
  });
}

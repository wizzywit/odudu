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
import { FREE_CHAT, modeForProfile, profileById } from '#/service/profiles';
import { openEntitlements } from '#/usecase/entitlements';
import { targetOffersAct } from '#/usecase/approvals';
import type { ChatCaller, ChatDeps } from '#/usecase/chat-deps';

/** The refusal of a conversation started in Act in a tenant that does not offer Act. */
export const TARGET_ACT_NOT_OFFERED = 'target_act_not_offered';

/** The refusal of a conversation started in Act in a tenant whose modes lack Act. */
export const MODE_NOT_OFFERED = 'mode_not_offered';

/** The refusal of a mode the conversation's profile does not run in. */
export const PROFILE_MODE_REFUSED = 'profile_mode_refused';

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
  const task = profileById(request.profile ?? FREE_CHAT.id);
  if (task === undefined) return { kind: 'unknown_profile' };
  const profile = task.id;
  const id = deps.newId();
  const now = deps.now();
  const mode = modeForProfile(task, request.mode);
  if (mode === null) return { kind: 'access_refused', reason: PROFILE_MODE_REFUSED };
  if (mode === 'act' && !(await ownTenantOffersAct(deps, caller))) {
    return { kind: 'access_refused', reason: MODE_NOT_OFFERED };
  }
  if (mode === 'act' && !(await targetOffersAct(deps, caller))) {
    return { kind: 'access_refused', reason: TARGET_ACT_NOT_OFFERED };
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

async function ownTenantOffersAct(deps: ChatDeps, caller: ChatCaller): Promise<boolean> {
  const limits = await deps.transact(caller.tenantId, (tx) =>
    (deps.entitlements ?? openEntitlements(tx)).limits(caller.tenantId),
  );
  return limits.modes.includes('act');
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

import { conversationRepository } from '#/repository/conversations';
import { conversationIsCallers } from '#/service/conversation-access';
import { endedReasonOf, type EndedReason } from '#/service/reattach-reason';
import { runKey } from '#/service/run-key';
import type { AssistantTx } from '#/repository/tx';
import type { ChatCaller, ChatDeps, Reattacher } from '#/usecase/chat-deps';

export type AttachOutcome =
  // The conversation acts under a live grant of this sign-in; `generation` is its run.
  | { readonly kind: 'ready'; readonly generation: number; readonly carriedOn: boolean }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'ended'; readonly reason: EndedReason };

/**
 * Makes sure a message to the caller's conversation acts under a grant of the
 * sign-in the caller holds now. A grant live from this sign-in is left alone.
 * One that ended with an earlier sign-in is replaced by a new grant made from
 * this one, and the conversation moves to the next run, so its agent instance
 * is a new one and never the old one revived. The row is locked throughout.
 * `carriedOn` says it has been carried on before, so what its tools returned
 * may be older than the sign-in it runs under.
 */
export async function attachConversation(
  deps: ChatDeps,
  caller: ChatCaller,
  id: string,
): Promise<AttachOutcome> {
  const step = async (
    tx: AssistantTx,
    reattach: Reattacher | undefined,
  ): Promise<AttachOutcome> => {
    const repository = conversationRepository(tx);
    const record = await repository.lock(id);
    if (record === undefined || !conversationIsCallers(record, caller)) {
      return { kind: 'not_found' as const };
    }
    const ready = (carriedOn: boolean) => ({
      kind: 'ready' as const,
      generation: record.runGeneration,
      carriedOn,
    });
    if (reattach === undefined) return ready(record.grantId !== null);
    const result = await reattach({
      conversationId: id,
      previousGrantId: record.grantId ?? record.id,
      newGrantId: deps.newId(),
      mode: record.mode === 'act' ? 'act' : 'ask',
      archived: record.archivedAt !== null,
      now: deps.now(),
    });
    if (result.kind === 'refused') {
      return { kind: 'ended' as const, reason: endedReasonOf(result.code) };
    }
    if (result.kind === 'live') return ready(record.grantId !== null);
    const generation = record.runGeneration + 1;
    const moved = await repository.rebind(
      id,
      {
        grantId: result.grantId,
        generation,
        instanceId: deps.instanceIdFor(caller, id, runKey(id, generation)),
      },
      record.runGeneration,
    );
    // The row is locked, so the generation cannot have moved; if it did, nothing
    // was bound and the message is not answered under a grant nobody points at.
    if (!moved) throw new Error('the conversation could not be bound to its new grant');
    return { kind: 'ready' as const, generation, carriedOn: true };
  };
  if (deps.reattach === undefined) {
    return deps.transact(caller.tenantId, (tx) => step(tx, undefined));
  }
  return deps.reattach(caller, step);
}

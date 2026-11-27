import { sideOf } from '#/service/conversation-access';
import type { ChatDeps } from '#/usecase/chat-deps';
import { openEntitlements } from '#/usecase/entitlements';
import { readSettings } from '#/usecase/settings';

/** What a tenant offers, read in a transaction of its own, for a conversation that acts in it. */
export async function targetSide(deps: ChatDeps, tenantId: string) {
  return deps.transact(tenantId, async (tx) => {
    const settings = await readSettings(tx, tenantId);
    return sideOf(settings, await (deps.entitlements ?? openEntitlements(tx)).limits(tenantId));
  });
}

import { MAX_DELEGATIONS, type MeCreateDelegationRequest } from '@odudu/contracts/me';
import { isUuid } from '@odudu/kernel';
import type { MeDelegationRecord } from '#/service/delegation';
import { delegationCreatedEvent, delegationRevokedEvent } from '#/service/audit';
import { delegationClients } from '#/service/delegation-rule';
import type { MeCaller } from '#/usecase/admit-me';
import type { MeReadDeps } from '#/usecase/reads';
import type { MeWriteDeps } from '#/usecase/writes';

const actorOf = (caller: MeCaller) => ({ subjectId: caller.subjectId, clientId: caller.clientId });

export type CreateDelegationOutcome =
  | { readonly kind: 'invalid'; readonly field: string; readonly description: string }
  | { readonly kind: 'limit_reached' }
  | { readonly kind: 'ok'; readonly delegation: MeDelegationRecord };

export function createDelegation(
  deps: MeWriteDeps,
  caller: MeCaller,
  request: MeCreateDelegationRequest,
): Promise<CreateDelegationOutcome> {
  return deps.writes.transact(caller.tenantId, async (tx): Promise<CreateDelegationOutcome> => {
    const named = delegationClients(
      await tx.delegationClient(request.client_id),
      await tx.delegationClient(request.actor_client_id),
    );
    if (named.kind === 'refused') {
      return { kind: 'invalid', field: named.field, description: named.description };
    }
    const { client, actor } = named;
    const now = deps.now();
    const delegation = await tx.createDelegation({
      subjectId: caller.subjectId,
      client,
      actor,
      scopeCeiling: request.scope_ceiling,
      expiresAt: new Date(now.getTime() + request.expires_in * 1000),
      now,
      cap: MAX_DELEGATIONS,
    });
    if (delegation === null) return { kind: 'limit_reached' };
    await tx.auditDelegation(delegationCreatedEvent(actorOf(caller), delegation));
    return { kind: 'ok', delegation };
  });
}

export type RevokeDelegationOutcome = { readonly kind: 'not_found' } | { readonly kind: 'revoked' };

export async function revokeDelegation(
  deps: MeWriteDeps,
  caller: MeCaller,
  id: string,
): Promise<RevokeDelegationOutcome> {
  if (!isUuid(id)) return { kind: 'not_found' };
  return deps.writes.transact(caller.tenantId, async (tx): Promise<RevokeDelegationOutcome> => {
    const delegation = await tx.revokeDelegation(caller.subjectId, id, deps.now());
    if (delegation === null) return { kind: 'not_found' };
    await tx.auditDelegation(delegationRevokedEvent(actorOf(caller), delegation));
    return { kind: 'revoked' };
  });
}

export async function listDelegations(
  deps: MeReadDeps,
  caller: MeCaller,
): Promise<{ readonly kind: 'ok'; readonly items: readonly MeDelegationRecord[] }> {
  const items = await deps.reads.delegations(caller.tenantId, caller.subjectId, deps.now());
  return { kind: 'ok', items };
}

import type { AssistantSettings } from '@odudu/contracts/admin';
import type { ConversationMode } from '#/repository/conversations';
import type { AssistantLimits } from '#/service/limits';

// What the rules below read of the caller and of a stored conversation.
interface CallerFacts {
  readonly tenantId: string;
  readonly ownerSubjectId: string;
  readonly target?: { readonly id: string; readonly name: string };
}
interface ConversationFacts {
  readonly tenantId: string;
  readonly ownerSubjectId: string;
  readonly targetTenantId: string | null;
}

/** The tenant a call acts in: the target a system administrator named, else their own. */
export function actsInTenantOf(caller: Pick<CallerFacts, 'tenantId' | 'target'>): string {
  return caller.target?.id ?? caller.tenantId;
}

/** Whether the caller acts in a tenant other than the one they belong to. */
export function crossTenant(caller: Pick<CallerFacts, 'tenantId' | 'target'>): boolean {
  return actsInTenantOf(caller) !== caller.tenantId;
}

/**
 * A conversation is its owner's, at the tenant it was created for and nowhere
 * else: one bound to another tenant, or to none, is reported as not there at a
 * path whose tenant differs, so a path cannot move a conversation.
 */
export function conversationIsCallers(
  record: ConversationFacts,
  caller: Pick<CallerFacts, 'tenantId' | 'ownerSubjectId' | 'target'>,
): boolean {
  return (
    record.ownerSubjectId === caller.ownerSubjectId &&
    (record.targetTenantId ?? record.tenantId) === actsInTenantOf(caller)
  );
}

interface TenantSide {
  readonly enabled: boolean;
  readonly maskEmails: boolean;
  readonly modes: readonly ConversationMode[];
}

/**
 * Where a system administrator uses the assistant in another tenant, the
 * stricter of the two tenants applies and neither overrides the other: both
 * must have it on, either may mask email addresses, and a mode is offered only
 * where both offer it.
 */
export function settingsOfTwo(home: TenantSide, target: TenantSide): TenantSide {
  return {
    enabled: home.enabled && target.enabled,
    maskEmails: home.maskEmails || target.maskEmails,
    modes: home.modes.filter((mode) => target.modes.includes(mode)),
  };
}

/** The parts of a tenant's settings and limits that `settingsOfTwo` weighs. */
export function sideOf(settings: AssistantSettings, limits: AssistantLimits): TenantSide {
  return {
    enabled: settings.assistant_enabled,
    maskEmails: settings.assistant_mask_emails,
    modes: limits.modes,
  };
}

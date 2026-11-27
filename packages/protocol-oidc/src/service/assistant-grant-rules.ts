import { isSystemTenantId } from '@odudu/domain-tenant';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '#/service/mcp-scopes';

export type AssistantMode = 'ask' | 'act';

export type AssistantGrantRefusal =
  | 'grant_not_found'
  | 'subject_mismatch'
  | 'grant_revoked'
  | 'grant_not_console'
  | 'session_required'
  | 'session_ended'
  | 'subject_disabled'
  | 'tenant_disabled'
  | 'assistant_unavailable'
  | 'target_not_allowed'
  | 'target_unavailable'
  | 'target_assistant_disabled'
  | 'owner_lacks_capability'
  | 'scope_widened'
  | ReattachRefusal;

// The most a conversation's grant may hold, which is the most its tokens may
// ever carry. An Act conversation reads the same way until a write has a
// grant of its own, made when the person approves it.
const CEILINGS: Readonly<Record<AssistantMode, readonly string[]>> = {
  ask: [MCP_READ_SCOPE],
  act: [MCP_READ_SCOPE],
};

export function assistantScopeCeiling(mode: AssistantMode): readonly string[] {
  return CEILINGS[mode];
}

// What the grant made for one approved write may hold: the write scope and
// nothing beside it, so the conversation's own read-only grant is never the
// one a write acts on.
export const ASSISTANT_WRITE_CEILING: readonly string[] = [MCP_WRITE_SCOPE];

export interface AssistantGrantGrounds {
  readonly tenantId: string;
  // The `sub` of the verified console principal, which must own the grant.
  readonly expectedSubjectId: string;
  readonly scope: readonly string[];
  readonly mode: AssistantMode;
  // Defaults to the mode's ceiling.
  readonly ceiling?: readonly string[];
  readonly console: {
    readonly tenantId: string;
    readonly subjectId: string;
    readonly revokedAt: Date | null;
    readonly clientId: string;
    readonly sessionId: string | null;
    readonly exchangedFromGrantId: string | null;
  } | null;
  readonly consoleClient: { readonly id: string; readonly builtinAdmin: boolean } | null;
  readonly assistantClient: {
    readonly enabled: boolean;
    readonly builtinAssistant: boolean;
    readonly agentType: boolean;
  } | null;
  readonly tenantEnabled: boolean;
  // Null where the grant is bound to no session.
  readonly sessionLive: boolean | null;
  readonly subjectEnabled: boolean;
  // The tenant a system administrator's conversation acts in, as the caller read
  // it from that tenant: null for one that was not found. Left out for a
  // conversation in the administrator's own tenant.
  readonly target?: AssistantTargetFacts | null;
  // The admin capabilities the console grant's owner holds now, read by the grant's
  // own transaction. A conversation in another tenant needs `manage-tenants` and
  // `use-assistant` here, so the grant does not rest on a route having checked.
  readonly ownerCapabilities?: readonly string[];
}

export interface AssistantTargetFacts {
  readonly id: string;
  readonly enabled: boolean;
  readonly assistantEnabled: boolean;
}

// A target other than the home tenant is the one case a grant reaches across
// tenants, so it is held to three things: the administrator's tenant is the
// system tenant, the target exists and is enabled, and it offers the assistant.
function targetRefusal(grounds: AssistantGrantGrounds): AssistantGrantRefusal | null {
  const { target } = grounds;
  if (target === undefined) return null;
  if (target?.id === grounds.tenantId) return null;
  if (!isSystemTenantId(grounds.tenantId)) return 'target_not_allowed';
  if (!target?.enabled) return 'target_unavailable';
  if (!target.assistantEnabled) return 'target_assistant_disabled';
  const held = grounds.ownerCapabilities ?? [];
  return held.includes('manage-tenants') && held.includes('use-assistant')
    ? null
    : 'owner_lacks_capability';
}

// What must stand before a conversation may have a grant derived from a
// console sign-in, in the order a refusal names them. Only a sign-in of the
// built-in admin client qualifies: a grant of any other client, or one that
// was itself derived, is never offered the assistant's identity.
export function assistantGrantRefusal(
  grounds: AssistantGrantGrounds,
): AssistantGrantRefusal | null {
  const { console: grant, consoleClient, assistantClient } = grounds;
  if (grant?.tenantId !== grounds.tenantId) return 'grant_not_found';
  if (grant.subjectId !== grounds.expectedSubjectId) return 'subject_mismatch';
  if (grant.revokedAt !== null) return 'grant_revoked';
  if (
    consoleClient?.id !== grant.clientId ||
    !consoleClient.builtinAdmin ||
    grant.exchangedFromGrantId !== null
  ) {
    return 'grant_not_console';
  }
  if (grant.sessionId === null) return 'session_required';
  const ceiling = grounds.ceiling ?? assistantScopeCeiling(grounds.mode);
  if (grounds.scope.length === 0 || !grounds.scope.every((entry) => ceiling.includes(entry))) {
    return 'scope_widened';
  }
  if (!grounds.tenantEnabled) return 'tenant_disabled';
  const targeted = targetRefusal(grounds);
  if (targeted !== null) return targeted;
  if (grounds.sessionLive !== true) return 'session_ended';
  if (!grounds.subjectEnabled) return 'subject_disabled';
  if (
    assistantClient?.enabled !== true ||
    !assistantClient.builtinAssistant ||
    !assistantClient.agentType
  ) {
    return 'assistant_unavailable';
  }
  return null;
}

export type ReattachRefusal =
  | 'conversation_grant_missing'
  | 'conversation_grant_not_assistant'
  | 'conversation_archived'
  | 'revoked_for_cause';

export interface ReattachGrounds {
  // The grant behind the verified console token of this request.
  readonly consoleGrantId: string;
  readonly expectedSubjectId: string;
  readonly archived: boolean;
  // The grant the conversation acted under until now, as stored; null where no
  // such grant exists any more.
  readonly previous: {
    readonly subjectId: string;
    readonly isAssistantGrant: boolean;
    readonly revokedAt: Date | null;
    readonly exchangedFromGrantId: string | null;
  } | null;
  // The console grant that one was derived from.
  readonly parent: {
    readonly revokedAt: Date | null;
    readonly revokedCause: string | null;
  } | null;
}

export type ReattachDecision =
  | { readonly kind: 'live' }
  | { readonly kind: 'reattach' }
  | { readonly kind: 'refused'; readonly reason: AssistantGrantRefusal };

// Whether a conversation's grant ended with the person's own sign-in and nothing
// else. Only that is carried on: a grant revoked for any other cause (a reused
// refresh token, an administrator ending the session, a recovered account) is
// never made live again by a later sign-in. The console grant must have been
// revoked as a sign-out, and the conversation's grant at the same instant, which
// is what the sign-out's own cascade stamps; a conversation grant revoked earlier
// for another reason keeps that reason's earlier time and does not match.
function endedWithSignOut(grounds: ReattachGrounds): boolean {
  const { previous, parent } = grounds;
  if (previous?.revokedAt == null || parent?.revokedAt == null) return false;
  return (
    parent.revokedCause === 'sign_out' &&
    previous.revokedAt.getTime() === parent.revokedAt.getTime()
  );
}

/**
 * Whether a message to a conversation can be answered under the sign-in the
 * request came on, and whether that takes a new grant: `live` where the
 * conversation's grant is live and was made from this very sign-in, `reattach`
 * where it ended with a sign-in of the owner's (by sign-out, or by lapsing
 * unrevoked, or while another sign-in still holds it) and a new grant may be made
 * from this one, and a refusal otherwise. What the new grant may hold is the
 * grant rules' own, read from this sign-in alone.
 */
export function reattachDecision(grounds: ReattachGrounds): ReattachDecision {
  const { previous, parent } = grounds;
  const refused = (reason: AssistantGrantRefusal) => ({ kind: 'refused' as const, reason });
  if (previous === null) return refused('conversation_grant_missing');
  if (previous.subjectId !== grounds.expectedSubjectId) return refused('subject_mismatch');
  if (!previous.isAssistantGrant) return refused('conversation_grant_not_assistant');
  if (previous.revokedAt === null && previous.exchangedFromGrantId === grounds.consoleGrantId) {
    return { kind: 'live' };
  }
  if (grounds.archived) return refused('conversation_archived');
  if (previous.revokedAt === null) {
    // Ended without a revocation (the session lapsed) or still held by another
    // sign-in of the owner; a console grant revoked for cause would have taken
    // this one with it.
    const revokedForCause =
      previous.exchangedFromGrantId === null ||
      parent === null ||
      (parent.revokedAt !== null && parent.revokedCause !== 'sign_out');
    return revokedForCause ? refused('revoked_for_cause') : { kind: 'reattach' };
  }
  return endedWithSignOut(grounds) ? { kind: 'reattach' } : refused('revoked_for_cause');
}

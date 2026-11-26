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
  | 'scope_widened';

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

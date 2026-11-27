import type { AssistantTier } from '@odudu/contracts/admin';
import type { HumanOnlyGroup } from '@odudu/mcp';
import { tierOfTool, type TargetKind } from '#/service/approval-card';

export type Tier = AssistantTier;
export type { TargetKind } from '#/service/approval-card';

export interface Target {
  readonly kind: TargetKind;
}

/**
 * What the server read about the record a call names, not anything the model
 * said: the admin capabilities it reaches (through composites, group ancestors
 * and, for a removal, descendants), whether it is the administrator whose
 * conversation this is or their own session, whether it is one of the built-in
 * clients, and whether a session is the one the conversation's grant roots in.
 */
export interface TargetFacts {
  readonly adminReach: readonly string[];
  readonly isOwner: boolean;
  readonly isBuiltinClient: boolean;
  readonly rootsConversationGrant: boolean;
}

/** What a facts reader is asked about: the kind of record, its id and whether the call removes it. */
export interface FactsRequest {
  readonly kind: TargetKind;
  readonly id: string | undefined;
  readonly removes: boolean;
  // Roles and groups the body grants: what they reach counts as the target's.
  readonly granted: readonly { readonly kind: 'role' | 'group'; readonly id: string }[];
}
export type FactsReader = (request: FactsRequest) => Promise<TargetFacts>;

export type TierOutcome = Tier | { readonly x: HumanOnlyGroup };

/**
 * What a call asks of the person. A tool's tier rises to human-only, `x`, when
 * its target reaches an administrator capability, is the administrator
 * themselves, is a client the assistant must never change, or is the session
 * the run depends on. A tier A call never rises: it grants nothing.
 */
export function tierOf(tool: string, target: Target, facts: TargetFacts): TierOutcome {
  return raiseTier(tierOfTool(tool), target, facts);
}

/** `tierOf` for a tier already known, which is where the rule itself is held. */
export function raiseTier(base: Tier, target: Target, facts: TargetFacts): TierOutcome {
  if (base === 'A') return base;
  if (facts.adminReach.length > 0) return { x: 'admin-capability-reach' };
  switch (target.kind) {
    case 'subject':
      return facts.isOwner ? { x: 'admin-capability-reach' } : base;
    case 'client':
      return facts.isBuiltinClient ? { x: 'self-authority' } : base;
    case 'session':
      return facts.isOwner || facts.rootsConversationGrant ? { x: 'own-session' } : base;
    default:
      return base;
  }
}

import type { AssistantMode } from '@odudu/contracts/admin';
import type { RegisteredTool } from '@odudu/mcp';
import { MAX_OUTPUT_TOKENS } from '#/service/request-size';
import type { Slot } from '#/service/slots';

export type ProfileId = 'free-chat' | 'why-cant-sign-in' | 'review-client';

/** The modes a profile runs in: one of them, or either. */
export type ProfileMode = AssistantMode | 'any';

/**
 * What a kind of turn is allowed to do and cost: the modes it runs in, the slot
 * its model comes from, the tools it is given (`'all'` for every tool the mode
 * offers), the sub-agents it may use, the most steps a turn may take before it
 * must answer, the most one model call may write, and the guidance the model
 * reads about the task.
 */
export interface TaskProfile {
  readonly id: ProfileId;
  readonly mode: ProfileMode;
  readonly slot: Slot;
  readonly tools: 'all' | readonly string[];
  readonly subagents: 'allowed' | 'required' | 'never';
  readonly maxSteps: number;
  readonly maxTokens: number;
  readonly guidance: string;
}

// Free chat starts on the standard slot, which every deployment has.
export const FREE_CHAT: TaskProfile = {
  id: 'free-chat',
  mode: 'any',
  slot: 'standard',
  tools: 'all',
  subagents: 'never',
  maxSteps: 8,
  maxTokens: MAX_OUTPUT_TOKENS,
  guidance: '',
};

export const SIGN_IN_TROUBLE = {
  id: 'why-cant-sign-in',
  mode: 'ask',
  slot: 'standard',
  tools: [
    'get_subject',
    'get_subject_lockout',
    'get_subject_required_actions',
    'list_subject_sessions',
    'get_subject_roles',
    'list_subject_effective_roles',
    'get_subject_groups',
    'get_settings',
  ],
  subagents: 'never',
  maxSteps: 8,
  maxTokens: 4096,
  guidance:
    'Find out why this person cannot sign in. Check, in this order, whether the account is active, ' +
    'whether it is locked out and until when, which actions it must still complete before it may sign in ' +
    '(a password change, a second factor, verifying an address), its sessions, and its roles and groups. ' +
    'Name the first thing that explains it, say what the evidence is, and say what an administrator can do ' +
    'about it in the console. If nothing explains it, say so.',
} as const satisfies TaskProfile;

export const REVIEW_CLIENT = {
  id: 'review-client',
  mode: 'ask',
  slot: 'standard',
  tools: [
    'get_client',
    'get_client_installation',
    'list_scopes',
    'get_scope',
    'get_scope_impact',
    'list_client_sessions',
    'list_client_logout_deliveries',
  ],
  subagents: 'never',
  maxSteps: 6,
  maxTokens: 4096,
  guidance:
    'Review how this client is configured. Look at its redirect addresses, the grant types it may use, ' +
    'whether it requires PKCE, whether it is public or confidential, and the scopes it may ask for. ' +
    'Report what is risky or unusual, each with the setting it comes from, and what is fine in a line. ' +
    'Do not propose changes to make: say what to look at.',
} as const satisfies TaskProfile;

export const PROFILES: readonly TaskProfile[] = [FREE_CHAT, SIGN_IN_TROUBLE, REVIEW_CLIENT];

/** The profile a conversation names, or undefined for one this server does not know. */
export function profileById(id: string): TaskProfile | undefined {
  return PROFILES.find((profile) => profile.id === id);
}

/**
 * The mode a conversation of this profile starts in, or null when the mode asked
 * for is one the profile does not run in. With none asked for, an Act-only
 * profile starts in Act and any other in Ask.
 */
export function modeForProfile(
  profile: TaskProfile,
  requested: AssistantMode | undefined,
): AssistantMode | null {
  if (profile.mode === 'any') return requested ?? 'ask';
  if (requested !== undefined && requested !== profile.mode) return null;
  return profile.mode;
}

/**
 * The tools a turn offers: those of the profile, out of those the conversation
 * could use. A profile that is Ask only is offered reads, so it is never wider
 * than its mode. Free chat keeps the writes in Ask, where the approval policy
 * refuses each with a reason the model reads.
 */
export function activeToolsFor(
  profile: TaskProfile,
  offered: readonly RegisteredTool[],
): RegisteredTool[] {
  const named = profile.tools === 'all' ? undefined : new Set(profile.tools);
  return offered.filter(
    (tool) =>
      (profile.mode !== 'ask' || tool.access === 'read') &&
      (named === undefined || named.has(tool.name)),
  );
}

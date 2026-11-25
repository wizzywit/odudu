import { counted } from '#/shared/lib/services/format';
import type { Choice } from '#/shared/lib/services/choice';
import type {
  AgentApproval,
  AgentInstance,
  ApprovalState,
  InstanceState,
  StateTone,
} from '#/pages/agents/types/agent';

export const AGENT_NOUN = { one: 'agent', other: 'agents' } as const;
export const APPROVAL_NOUN = { one: 'approval', other: 'approvals' } as const;

export const AGENTS_RULE =
  'Each row is one run of an agent, acting for the person it is shown against. A run that started another sits above it, so lineage reads from the top down. Revoking a run ends it and every run started beneath it.';

export const NOTHING_YET_AGENTS =
  'No agent has acted in this tenant yet. A run appears here the first time an agent acts for somebody.';

export const APPROVALS_RULE =
  'What agents asked a person to approve, waiting or lately decided. Each is answered by the person it is for, never from here, and the page the person answers on is never listed.';

export const NOTHING_YET_APPROVALS = 'No agent has asked for an approval in this tenant.';

export const APPROVALS_LINK = 'Approvals';
export const AGENTS_LINK = 'Agents';
export const REVOKE_LABEL = 'Revoke';
export const REVOKE_CONFIRM_LABEL = 'Revoke run';
export const STATE_FILTER_LABEL = 'State';
export const OWNER_ONLY_ALL = 'Show every agent';
export const SHOW_DETAILS = 'Show details';
export const HIDE_DETAILS = 'Hide details';
export const NARROW_LABEL = 'Only this owner';

const ANY_STATE = { id: 'any', label: 'Any state' } as const;

export const INSTANCE_STATES: readonly Choice[] = [
  ANY_STATE,
  { id: 'live', label: 'Live' },
  { id: 'expired', label: 'Expired' },
  { id: 'revoked', label: 'Revoked' },
];

export const APPROVAL_STATES: readonly Choice[] = [
  ANY_STATE,
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'denied', label: 'Denied' },
  { id: 'expired', label: 'Expired' },
  { id: 'consumed', label: 'Consumed' },
];

const INSTANCE_TONES: Readonly<Record<InstanceState, StateTone>> = {
  live: 'active',
  expired: 'neutral',
  revoked: 'danger',
};

const APPROVAL_TONES: Readonly<Record<ApprovalState, StateTone>> = {
  pending: 'warning',
  approved: 'active',
  denied: 'danger',
  expired: 'neutral',
  consumed: 'neutral',
};

export function instanceTone(state: InstanceState): StateTone {
  return INSTANCE_TONES[state];
}

export function approvalTone(state: ApprovalState): StateTone {
  return APPROVAL_TONES[state];
}

// What a live run may still write itself; the grant's and the owner's own
// limits are counted elsewhere, so a run that is over says nothing.
export function budgetText(run: AgentInstance): string | null {
  if (run.state !== 'live') return null;
  const writes = counted(run.budget.mutating, 'write', 'writes');
  const creates = counted(run.budget.creates, 'create', 'creates');
  return `${writes} and ${creates} left`;
}

export interface RunEnd {
  label: 'Expires' | 'Expired' | 'Revoked';
  at: string;
}

export function endOf(run: AgentInstance): RunEnd {
  switch (run.state) {
    case 'live':
      return { label: 'Expires', at: run.expiresAt };
    case 'expired':
      return { label: 'Expired', at: run.expiresAt };
    case 'revoked':
      return { label: 'Revoked', at: run.revokedAt ?? run.expiresAt };
  }
}

const SHORT_ID = 8;

export function shortId(id: string): string {
  return id.slice(0, SHORT_ID);
}

export function detachedText(parent: string): string {
  return `Started by run ${shortId(parent)}, which is not on the loaded pages.`;
}

const VIA = { ciba_page: 'on the approval page', console: 'in the console' } as const;

export function approvalDecision(approval: AgentApproval): string {
  const { state, decidedVia } = approval;
  const where = decidedVia === null ? '' : ` ${VIA[decidedVia]}`;
  switch (state) {
    case 'pending':
      return 'Waiting for the person it is for';
    case 'expired':
      return 'Lapsed with no answer';
    case 'approved':
      return `Approved${where}`;
    case 'denied':
      return `Denied${where}`;
    case 'consumed':
      return `Approved${where}, and used`;
  }
}

export function detailsLabel(open: boolean, client: string, id: string): string {
  return `${open ? HIDE_DETAILS : SHOW_DETAILS} of the run of ${client}, ${shortId(id)}`;
}

export function revokeButtonLabel(client: string, id: string): string {
  return `${REVOKE_LABEL} the run of ${client}, ${shortId(id)}`;
}

export function narrowButtonLabel(owner: string): string {
  return `Only the runs acting for ${shortId(owner)}`;
}

export function treeLabel(client: string, id: string): string {
  return `Started by the run of ${client}, ${shortId(id)}`;
}

export const FACTS = {
  actsFor: 'Acts for',
  budget: 'Budget left',
  depth: 'Depth',
  scope: 'Scope',
  runId: 'Run id',
  parent: 'Started by',
  started: 'Started',
  none: 'no run: it began with a person',
  gone: 'The details of this run could not be read.',
} as const;

export const APPROVAL_FACTS = {
  asked: 'Asked',
  expires: 'Expires',
  kind: 'Kind',
  run: 'Run',
  direct: 'none',
} as const;

export function ownerNote(owner: string): string {
  return `Only the runs acting for ${shortId(owner)}.`;
}

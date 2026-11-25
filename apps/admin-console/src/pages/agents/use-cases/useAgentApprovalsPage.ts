import { useAuthority } from '#/entities/session';
import { subjectHref, subjectLinkOf } from '#/entities/subject';
import type { AgentApproval } from '#/pages/agents/types/agent';
import { useApprovalList } from '#/pages/agents/repository/useAgents';
import { agentsHref } from '#/pages/agents/services/addresses';
import {
  AGENTS_LINK,
  APPROVAL_NOUN,
  APPROVAL_STATES,
  approvalDecision,
  approvalTone,
  shortId,
  APPROVALS_RULE,
  NOTHING_YET_APPROVALS,
  STATE_FILTER_LABEL,
} from '#/pages/agents/services/agentText';
import { stateChoice } from '#/pages/agents/services/filters';
import { holds } from '#/shared/lib/services/access';
import type { Choice } from '#/shared/lib/services/choice';
import { statusFilter } from '#/shared/lib/services/filters';
import type { ResourceListState } from '#/shared/lib/services/resourceList';

export interface AgentApprovalsPage {
  list: ResourceListState<AgentApproval>;
  ownerLink: ((id: string) => string) | null;
  state: { label: string; value: string; options: readonly Choice[]; choose: (id: string) => void };
  agentsHref: string;
  text: { noun: typeof APPROVAL_NOUN; rule: string; nothingYet: string; agents: string };
  say: {
    tone: typeof approvalTone;
    decision: typeof approvalDecision;
    short: typeof shortId;
  };
}

export function useAgentApprovalsPage(tenant: string): AgentApprovalsPage {
  const authority = useAuthority(tenant);
  const list = useApprovalList(tenant);
  return {
    list,
    ownerLink: subjectLinkOf(holds(authority, 'view-users'), tenant, subjectHref),
    state: {
      label: STATE_FILTER_LABEL,
      value: stateChoice(list.filters),
      options: APPROVAL_STATES,
      choose: (id) => {
        list.setFilter('state', statusFilter(id));
      },
    },
    agentsHref: agentsHref(tenant),
    text: {
      noun: APPROVAL_NOUN,
      rule: APPROVALS_RULE,
      nothingYet: NOTHING_YET_APPROVALS,
      agents: AGENTS_LINK,
    },
    say: { tone: approvalTone, decision: approvalDecision, short: shortId },
  };
}

import { useAuthority } from '#/entities/session';
import { subjectHref, subjectLinkOf } from '#/entities/subject';
import type { AgentApproval } from '#/pages/agents/types/agent';
import { useApprovalList } from '#/pages/agents/repository/useAgents';
import { agentsHref } from '#/pages/agents/services/addresses';
import {
  AGENTS_LINK,
  APPROVAL_COLUMNS,
  APPROVAL_NOUN,
  APPROVALS_TITLE,
  COPY_LABELS,
  APPROVAL_STATES,
  approvalDecision,
  approvalTone,
  ownerLinkLabel,
  ownerName,
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
  text: {
    noun: typeof APPROVAL_NOUN;
    title: string;
    rule: string;
    nothingYet: string;
    agents: string;
    columns: typeof APPROVAL_COLUMNS;
    copy: typeof COPY_LABELS;
  };
  say: {
    tone: typeof approvalTone;
    decision: typeof approvalDecision;
    ownerName: typeof ownerName;
    ownerLink: typeof ownerLinkLabel;
  };
}

// The gate wraps the page, so it takes the title from here.
export function useApprovalsTitle(): string {
  return APPROVALS_TITLE;
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
      title: APPROVALS_TITLE,
      columns: APPROVAL_COLUMNS,
      copy: COPY_LABELS,
      rule: APPROVALS_RULE,
      nothingYet: NOTHING_YET_APPROVALS,
      agents: AGENTS_LINK,
    },
    say: {
      tone: approvalTone,
      decision: approvalDecision,
      ownerName,
      ownerLink: ownerLinkLabel,
    },
  };
}

import { useRefusal, useAuthority } from '#/entities/session';
import { subjectHref, subjectLinkOf } from '#/entities/subject';
import type { AgentInstance, LineageNode, RevokeCount } from '#/pages/agents/types/agent';
import { useAgentList, useRevokeAgent, useRevokeCount } from '#/pages/agents/repository/useAgents';
import {
  AGENT_NOUN,
  AGENTS_RULE,
  FACTS,
  HIDE_DETAILS,
  NARROW_LABEL,
  SHOW_DETAILS,
  REVOKE_CONFIRM_LABEL,
  REVOKE_LABEL,
  budgetText,
  detachedText,
  detailsLabel,
  endOf,
  instanceTone,
  narrowButtonLabel,
  revokeButtonLabel,
  shortId,
  treeLabel,
  INSTANCE_STATES,
  NOTHING_YET_AGENTS,
  STATE_FILTER_LABEL,
  APPROVALS_LINK,
} from '#/pages/agents/services/agentText';
import { ownerNarrowing, stateChoice, type OwnerNarrowing } from '#/pages/agents/services/filters';
import { lineageOf } from '#/pages/agents/services/lineage';
import {
  countOf,
  revokeDialogOf,
  revokedText,
  revokeFailure,
  revokeRetry,
  revokeTargetOf,
  type ImpactRetry,
  type RevokeDialog,
} from '#/pages/agents/services/revoke';
import { useToast } from '#/shared/lib/repository/useToasts';
import { holds } from '#/shared/lib/services/access';
import type { Choice } from '#/shared/lib/services/choice';
import { statusFilter } from '#/shared/lib/services/filters';
import type { ResourceListState } from '#/shared/lib/services/resourceList';
import { useConfirmedChange, type Confirming } from '#/shared/lib/use-cases/useConfirmedChange';
import { agentApprovalsHref } from '#/pages/agents/services/addresses';

export interface AgentsPage {
  list: ResourceListState<AgentInstance>;
  tree: LineageNode[];
  // Where an owner has its page, or null where the caller may not read subjects.
  ownerLink: ((id: string) => string) | null;
  state: { label: string; value: string; options: readonly Choice[]; choose: (id: string) => void };
  // The owner the list is narrowed to, with the way back to every run.
  owner: OwnerNarrowing | null;
  narrowTo: (owner: string) => void;
  revoke: Confirming<AgentInstance>;
  dialog: RevokeDialog | null;
  retry: ImpactRetry | null;
  approvalsHref: string;
  text: {
    noun: typeof AGENT_NOUN;
    rule: string;
    nothingYet: string;
    approvals: string;
    facts: typeof FACTS;
    revoke: string;
    revokeConfirm: string;
    details: { show: string; hide: string };
    narrow: string;
  };
  // How a run says itself: pure formatters the tree draws with.
  say: {
    budget: typeof budgetText;
    end: typeof endOf;
    tone: typeof instanceTone;
    detached: typeof detachedText;
    short: typeof shortId;
    details: typeof detailsLabel;
    revoke: typeof revokeButtonLabel;
    narrow: typeof narrowButtonLabel;
    tree: typeof treeLabel;
  };
}

export function useAgentsPage(tenant: string): AgentsPage {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const authority = useAuthority(tenant);
  const list = useAgentList(tenant);
  const revoke = useConfirmedChange<AgentInstance, RevokeCount>({
    refusal,
    capability: 'manage-sessions',
    change: useRevokeAgent(tenant),
    failureText: revokeFailure,
    done: (run, ended) => {
      toast.succeeded(revokedText(run.agentClient, ended));
    },
  });
  const target = revokeTargetOf(revoke.asking);
  const count = useRevokeCount(tenant, target.id, target.asked);
  return {
    list,
    tree: lineageOf(list.rows),
    ownerLink: subjectLinkOf(holds(authority, 'view-users'), tenant, subjectHref),
    state: {
      label: STATE_FILTER_LABEL,
      value: stateChoice(list.filters),
      options: INSTANCE_STATES,
      choose: (id) => {
        list.setFilter('state', statusFilter(id));
      },
    },
    owner: ownerNarrowing(list.filters, () => {
      list.setFilter('owner', null);
    }),
    narrowTo: (owner) => {
      list.setFilter('owner', owner);
    },
    revoke,
    dialog: revokeDialogOf(revoke.asking, countOf(count)),
    retry: revokeRetry(count),
    approvalsHref: agentApprovalsHref(tenant),
    text: {
      noun: AGENT_NOUN,
      rule: AGENTS_RULE,
      nothingYet: NOTHING_YET_AGENTS,
      approvals: APPROVALS_LINK,
      facts: FACTS,
      revoke: REVOKE_LABEL,
      revokeConfirm: REVOKE_CONFIRM_LABEL,
      details: { show: SHOW_DETAILS, hide: HIDE_DETAILS },
      narrow: NARROW_LABEL,
    },
    say: {
      budget: budgetText,
      end: endOf,
      tone: instanceTone,
      detached: detachedText,
      short: shortId,
      details: detailsLabel,
      revoke: revokeButtonLabel,
      narrow: narrowButtonLabel,
      tree: treeLabel,
    },
  };
}

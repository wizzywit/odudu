export type InstanceState = 'live' | 'expired' | 'revoked';

// How a state is drawn; each is one of the status tags' tones.
export type StateTone = 'neutral' | 'active' | 'warning' | 'danger';

export type ApprovalState = 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';

// What an instance's own slice of writes has left.
export interface AgentBudget {
  mutating: number;
  creates: number;
}

// One run of an agent: `owner` is the subject it acts for, `agentClient` the
// client it runs under, `parent` the run that started it, if one did.
export interface AgentInstance {
  id: string;
  owner: string;
  agentClient: string;
  parent: string | null;
  depth: number;
  state: InstanceState;
  scope: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  budget: AgentBudget;
}

export interface AgentApproval {
  id: string;
  owner: string;
  agentClient: string;
  instance: string | null;
  kind: string;
  summary: string;
  state: ApprovalState;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedVia: 'ciba_page' | 'console' | null;
}

// What revoking a run ends, as the server counts it.
export interface RevokeCount {
  grants: number;
  instances: number;
}

// A run and the runs started beneath it that are on the loaded pages.
export interface LineageNode {
  instance: AgentInstance;
  children: LineageNode[];
  // The run names a parent that is not among the loaded rows.
  detached: boolean;
}

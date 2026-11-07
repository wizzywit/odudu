export const PLANNED_LABEL = 'Planned';
export const ROADMAP_NEXT = '/roadmap/#next';

// A claim about work that has not shipped. Each quote is a phrase of the
// roadmap's Next or Later lines that the claim repeats word for word, and a
// test fails when either side stops saying it.
export interface Planned {
  id: string;
  title: string;
  claim: string;
  quotes: string[];
}

export const AGENT_ITEMS: Planned[] = [
  {
    id: 'mcp-access-changing-tools',
    title: 'Access-changing and destructive MCP tools',
    claim:
      'Tools that change who can sign in, handle secrets or delete things, each waiting for a confirmation step the agent cannot answer for itself.',
    quotes: ['who can sign in', 'a confirmation step the agent cannot answer for itself'],
  },
  {
    id: 'agent-identity',
    title: 'Agent identity',
    claim: 'Budgets across delegations, and approval for AI agents acting for a person.',
    quotes: ['Budgets', 'approval for AI agents acting for a person'],
  },
];

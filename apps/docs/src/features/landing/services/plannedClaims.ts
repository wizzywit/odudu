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
    id: 'mcp-server',
    title: 'An MCP server',
    claim:
      'The admin API as tools for an AI agent, read-only by default. A guide to protecting an MCP server with Odudu.',
    quotes: [
      'The admin API as tools for an AI agent',
      'read-only by default',
      'a guide to protecting an MCP server with Odudu',
    ],
  },
  {
    id: 'agent-identity',
    title: 'Agent identity',
    claim: 'Budgets and approval for AI agents acting for a person.',
    quotes: ['Budgets', 'approval for AI agents acting for a person'],
  },
];

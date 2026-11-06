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
    id: 'mcp-destructive-tools',
    title: 'Destructive MCP tools',
    claim:
      "The irreversible tools the MCP server withholds today, each needing the owner's separate approval.",
    quotes: ['The irreversible tools', "each needing the owner's separate approval"],
  },
  {
    id: 'agent-identity',
    title: 'Agent identity',
    claim: 'Budgets and approval for AI agents acting for a person.',
    quotes: ['Budgets', 'approval for AI agents acting for a person'],
  },
];

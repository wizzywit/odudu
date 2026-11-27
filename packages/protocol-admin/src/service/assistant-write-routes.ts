import { AGENT_WRITE_ROUTES, type AgentWriteRoute } from '#/service/agent-scope';

// The writes only the built-in assistant client's grant may make, beside the
// ones every agent may. A route here is admitted by the door for that grant
// and for no other agent token, so an outside agent holding `mcp:write`, which
// has no approval step, is never handed a write that needs one. The entries
// have the shape of `AGENT_WRITE_ROUTES` and are disjoint from it.
export const ASSISTANT_WRITE_ROUTES: readonly AgentWriteRoute[] = [];

// The writes the door admits to an agent token: the assistant's own list added to
// the shared one for the assistant grant, the shared one alone for any other.
export function agentWriteRoutes(
  agent: { readonly clientId: string; readonly assistant?: true },
  assistantRoutes: readonly AgentWriteRoute[] = ASSISTANT_WRITE_ROUTES,
): readonly AgentWriteRoute[] {
  return agent.assistant === true
    ? [...AGENT_WRITE_ROUTES, ...assistantRoutes]
    : AGENT_WRITE_ROUTES;
}

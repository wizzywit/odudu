import { useState } from 'react';
import type { AgentInstance } from '#/pages/agents/types/agent';
import { useAgentDetail } from '#/pages/agents/repository/useAgents';
import type { Read } from '#/shared/lib/services/read';

export interface AgentNode {
  open: boolean;
  toggle: () => void;
  // The run as the server holds it now, read once its details are opened.
  detail: Read<AgentInstance>;
}

export function useAgentNode(tenant: string, id: string): AgentNode {
  const [open, setOpen] = useState(false);
  return {
    open,
    toggle: () => {
      setOpen((was) => !was);
    },
    detail: useAgentDetail(tenant, id, open),
  };
}

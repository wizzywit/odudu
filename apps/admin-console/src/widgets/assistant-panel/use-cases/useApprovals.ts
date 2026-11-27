import { useState } from 'react';
import { loadedData } from '#/shared/lib/services/read';
import {
  useApprovalList,
  useDecideApproval,
} from '#/widgets/assistant-panel/repository/useApprovals';
import {
  NOTHING_HELD,
  afterDecision,
  anyWaiting,
  entriesOf,
  waitingLine,
  withDecision,
  type Held,
} from '#/widgets/assistant-panel/services/approvalEntries';
import type { Entry } from '#/widgets/assistant-panel/types/approvals';

export interface Approvals {
  entries: Entry[];
  // A change still waits on the person.
  waiting: boolean;
  // What the status line says while a change waits: the card's title once it
  // is known, and nothing before, so a screen reader hears it once.
  waitingText: string;
  // Sends the person's decision on one card.
  answer: (entry: Entry, approve: boolean) => void;
}

// The changes a conversation waits on, and the person's decision on each. A
// decision that was accepted carries the conversation on.
export function useApprovals(options: {
  tenant: string;
  conversationId: string | null;
  // A change waits, so the server's list is read.
  waiting: boolean;
  resume: () => void;
}): Approvals {
  const { tenant, conversationId, waiting, resume } = options;
  const list = useApprovalList(tenant, conversationId, waiting);
  const write = useDecideApproval(tenant, conversationId);
  const [held, setHeld] = useState<Held>(NOTHING_HELD);
  const entries = entriesOf(loadedData(list), held, conversationId);
  const answer = (entry: Entry, approve: boolean): void => {
    const base = { card: entry.card, offsetMs: entry.offsetMs };
    setHeld((previous) =>
      withDecision(previous, conversationId, {
        ...base,
        decision: { kind: 'deciding', approve },
      }),
    );
    write
      .run({ approvalId: entry.card.approval_id, approve })
      .then((result) => {
        const decision = afterDecision(result);
        setHeld((previous) => withDecision(previous, conversationId, { ...base, decision }));
        if (decision.kind === 'decided') resume();
      })
      .catch(() => undefined);
  };
  return {
    entries,
    waiting: anyWaiting(entries),
    waitingText: waitingLine(list.status, entries),
    answer,
  };
}

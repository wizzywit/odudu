import { useState } from 'react';
import { useNow } from '#/shared/lib/use-cases/useNow';
import { cardModel, secondsLeft } from '#/widgets/assistant-panel/services/approval';
import type { CardModel, Entry } from '#/widgets/assistant-panel/types/approvals';

const TICK_MS = 1_000;

export interface ApprovalCardState {
  model: CardModel;
  // The extra question a removal is asked before it is approved.
  confirming: boolean;
  approve: () => void;
  refuse: () => void;
  confirm: () => void;
  cancel: () => void;
}

// One card kept up to date by the server's clock. A change that removes
// something asks once more before the approval is sent.
export function useApprovalCard(
  entry: Entry,
  username: string,
  answer: (entry: Entry, approve: boolean) => void,
): ApprovalCardState {
  const now = useNow(TICK_MS);
  const [confirming, setConfirming] = useState(false);
  const model = cardModel({
    card: entry.card,
    username,
    decision: entry.decision,
    seconds: secondsLeft(entry.card.expires_at, now.getTime(), entry.offsetMs),
  });
  return {
    model,
    confirming,
    approve: () => {
      if (model.risky) setConfirming(true);
      else answer(entry, true);
    },
    refuse: () => {
      answer(entry, false);
    },
    confirm: () => {
      setConfirming(false);
      answer(entry, true);
    },
    cancel: () => {
      setConfirming(false);
    },
  };
}

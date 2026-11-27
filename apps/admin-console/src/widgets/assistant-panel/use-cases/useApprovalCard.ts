import { useState } from 'react';
import { useNow } from '#/shared/lib/use-cases/useNow';
import {
  approveRoute,
  cardModel,
  confirmArgs,
  confirmOpen,
  secondsLeft,
} from '#/widgets/assistant-panel/services/approval';
import type { StepState } from '#/widgets/assistant-panel/types/chat';
import type { CardModel, Entry } from '#/widgets/assistant-panel/types/approvals';

const TICK_MS = 1_000;

export interface ApprovalCardState {
  model: CardModel;
  // The extra question a change of tier B or C is asked before it is approved.
  confirming: boolean;
  approve: () => void;
  refuse: () => void;
  confirm: () => void;
  cancel: () => void;
}

// One card kept up to date by the server's clock. A change of tier B or C asks
// once more before the approval is sent, and C sends the name it was held for.
export function useApprovalCard(
  entry: Entry,
  username: string,
  actingIn: string | null,
  step: StepState,
  answer: (entry: Entry, approve: boolean, confirm?: string) => void,
): ApprovalCardState {
  const now = useNow(TICK_MS);
  const [confirming, setConfirming] = useState(false);
  const model = cardModel({
    card: entry.card,
    username,
    tenant: actingIn,
    decision: entry.decision,
    seconds: secondsLeft(entry.card.expires_at, now.getTime(), entry.offsetMs),
    step,
  });
  return {
    model,
    confirming: confirmOpen(confirming, model.status),
    approve: () => {
      if (approveRoute(model.risky) === 'confirm') setConfirming(true);
      else answer(entry, true);
    },
    refuse: () => {
      answer(entry, false);
    },
    confirm: () => {
      setConfirming(false);
      answer(entry, true, ...confirmArgs(model.dialog));
    },
    cancel: () => {
      setConfirming(false);
    },
  };
}

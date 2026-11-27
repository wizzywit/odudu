import { useState } from 'react';
import {
  feedSummary,
  linesWithCards,
  type FeedLine,
} from '#/widgets/assistant-panel/services/feed';
import type { Entry } from '#/widgets/assistant-panel/types/approvals';
import type { StepLine } from '#/widgets/assistant-panel/types/chat';

export interface Feed {
  open: boolean;
  toggle: () => void;
  summary: string;
  lines: FeedLine[];
}

// One answer's steps: open while the answer is written or waits for a
// decision, put away once it is finished, and the person's own choice from
// then on.
export function useFeed(
  steps: readonly StepLine[],
  live: boolean,
  entries: readonly Entry[],
): Feed {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? live;
  return {
    open,
    toggle: () => {
      setChosen(!open);
    },
    summary: feedSummary(steps),
    lines: linesWithCards(steps, open, entries),
  };
}

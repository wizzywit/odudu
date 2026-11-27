import { counted } from '#/shared/lib/services/format';
import type { Entry } from '#/widgets/assistant-panel/types/approvals';
import type { StepLine } from '#/widgets/assistant-panel/types/chat';

// The steps the feed lists. Open, all of them. Put away, only those that must
// stay in view: a step that failed or was refused, and a change that has a card.
export function visibleSteps(
  steps: readonly StepLine[],
  open: boolean,
  carded: ReadonlySet<string>,
): StepLine[] {
  if (open) return [...steps];
  return steps.filter(
    (step) => step.state === 'failed' || step.state === 'denied' || carded.has(step.id),
  );
}

// What the toggle says of the steps it holds: how many, and how many failed.
export function feedSummary(steps: readonly StepLine[]): string {
  const total = counted(steps.length, 'step', 'steps');
  const failed = steps.filter((step) => step.state === 'failed').length;
  return failed === 0 ? total : `${total}, ${String(failed)} failed`;
}

export interface FeedLine {
  step: StepLine;
  // The card of the change this step proposed, when the panel holds one.
  entry: Entry | undefined;
}

// The lines to draw, each with its card, put away or not.
export function linesWithCards(
  steps: readonly StepLine[],
  open: boolean,
  entries: readonly Entry[],
): FeedLine[] {
  const carded = new Set(entries.map((entry) => entry.card.tool_call_id));
  return visibleSteps(steps, open, carded).map((step) => ({
    step,
    entry: entries.find((entry) => entry.card.tool_call_id === step.id),
  }));
}

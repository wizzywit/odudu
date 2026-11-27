import type { Entry } from '#/widgets/assistant-panel/types/approvals';
import type { PanelMessage } from '#/widgets/assistant-panel/types/chat';

const FOLLOW_SLACK_PX = 24;

// Whether a log is scrolled to its end, near enough that the person has not
// chosen to read what is above.
export function nearBottom(metrics: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= FOLLOW_SLACK_PX;
}

// A number that changes whenever something is added to the log or a part of it
// grows, which is when a log that follows its end has to move.
export function contentSize(
  messages: readonly PanelMessage[],
  entries: readonly Entry[] = [],
): number {
  const cards = entries.reduce((sum, entry) => sum + 1 + (entry.decision?.kind.length ?? 0), 0);
  return (
    cards +
    messages.reduce(
      (total, message) =>
        total +
        1 +
        message.parts.reduce(
          (sum, part) => sum + (part.kind === 'text' ? part.text.length : 1 + part.state.length),
          0,
        ),
      0,
    )
  );
}

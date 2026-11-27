import { budgetName } from '#/widgets/assistant-panel/services/budget';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type { PanelState } from '#/widgets/assistant-panel/types/chat';

// The one line the polite live region holds: a short state, never a token of
// the answer, so a screen reader is told what changed and not made to read
// the text as it is written.
export function statusLine(
  state: PanelState,
  waiting: string = PANEL_WORDING.statusWaiting,
): string {
  switch (state.kind) {
    case 'empty':
      return '';
    case 'loading':
      return PANEL_WORDING.loadingHistory;
    case 'connecting':
      return PANEL_WORDING.statusConnecting;
    case 'thinking':
      return PANEL_WORDING.statusThinking;
    case 'tool':
      return state.step;
    case 'waiting':
      return waiting;
    case 'closed':
      return PANEL_WORDING.statusClosed;
    case 'stopped':
      return PANEL_WORDING.statusStopped;
    case 'step-limit':
      return PANEL_WORDING.statusStepLimit;
    case 'budget':
      return `Stopped: ${budgetName(state.level)} is used`;
    case 'failed':
      // The alert that carries the cause is what is announced.
      return '';
    case 'finished':
      return PANEL_WORDING.statusFinished;
  }
}

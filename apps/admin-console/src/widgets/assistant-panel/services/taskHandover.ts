import type { TaskRequest } from '#/entities/assistant';
import type { TaskCarry } from '#/widgets/assistant-panel/types/carry';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';

// A message the person had begun is theirs: the task's question goes into an
// empty field only.
export function startingDraft(task: TaskRequest | null, carried: TaskCarry | null): string {
  if (task === null) return '';
  return carried !== null && carried.draft.trim() !== '' ? carried.draft : task.draft;
}

// What the person is told of the panel the task replaced, or null when there
// is nothing to tell.
export function handoverNote(task: TaskRequest | null, carried: TaskCarry | null): string | null {
  if (task === null || carried === null) return null;
  const lines = [
    carried.stopped ? PANEL_WORDING.handoverStopped : null,
    carried.draft.trim() === '' ? null : PANEL_WORDING.handoverDraftKept,
  ].filter((line) => line !== null);
  return lines.length === 0 ? null : lines.join(' ');
}

import type { GatewayFailure } from '#/shared/lib/services/result';
import type { ExportFormat } from '#/widgets/assistant-panel/types/conversations';

export type ConversationAction = 'archive' | 'restore' | 'delete' | 'export';

const REPORTED = 'about:blank#conversation-reported';
const BUSY = 'about:blank#conversation-busy';

const GONE = 'This conversation is already gone.';
const COULD_NOT: Readonly<Record<ConversationAction, string>> = {
  archive: 'The conversation could not be archived. Try again.',
  restore: 'The conversation could not be restored. Try again.',
  delete: 'The conversation could not be deleted. Try again.',
  export: 'The conversation could not be exported. Try again.',
};

// What a refused action says: the two reasons a delete is held, in the
// person's words, and for anything else which action it was.
export function actionFailureText(action: ConversationAction, failure: GatewayFailure): string {
  if (failure.kind !== 'problem') return COULD_NOT[action];
  const { status, type } = failure.problem;
  if (status === 404) return GONE;
  if (action === 'delete' && type === REPORTED) {
    return 'This conversation was reported and is kept for review. You can archive it, but not delete it.';
  }
  if (action === 'delete' && type === BUSY) {
    return 'An answer is still running in this conversation. Stop it, then delete it.';
  }
  return COULD_NOT[action];
}

// A refusal that means the conversation is not there, so the list is stale.
export function isGone(failure: GatewayFailure): boolean {
  return failure.kind === 'problem' && failure.problem.status === 404;
}

const EXTENSIONS: Readonly<Record<ExportFormat, { extension: string; type: string }>> = {
  markdown: { extension: 'md', type: 'text/markdown' },
  json: { extension: 'json', type: 'application/json' },
};

export function exportFileName(id: string, format: ExportFormat): string {
  return `conversation-${id}.${EXTENSIONS[format].extension}`;
}

export function exportMediaType(format: ExportFormat, served: string | null): string {
  return served ?? EXTENSIONS[format].type;
}

export const EXPORTED = 'Exported. The file holds the text with secrets hidden.';
export const DELETED = 'Conversation deleted.';
export const RESTORED = 'Conversation restored.';

import { useState } from 'react';
import type { GatewayFailure, GatewayResult } from '#/shared/lib/services/result';
import { useToast } from '#/shared/lib/repository/useToasts';
import { useConversationWrites } from '#/widgets/assistant-panel/repository/useConversationWrites';
import {
  DELETED,
  EXPORTED,
  RESTORED,
  actionFailureText,
  isGone,
  type ConversationAction,
} from '#/widgets/assistant-panel/services/conversationActions';
import type { ConversationRow, ExportFormat } from '#/widgets/assistant-panel/types/conversations';

export interface ConversationActions {
  onArchive: (row: ConversationRow) => void;
  onRestore: (row: ConversationRow) => void;
  // Brings back the conversation the panel is showing, which was hidden.
  onRestoreCurrent: () => void;
  onExport: (row: ConversationRow, format: ExportFormat) => void;
  undo: ConversationRow | null;
  // The row just hidden, which fades while the list is read again.
  leaving: string | null;
  onUndo: () => void;
  deleting: ConversationRow | null;
  deleteBusy: boolean;
  deleteProblem: string | null;
  onAskDelete: (row: ConversationRow) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

// What the list's row actions do. Hiding takes effect at once and is offered
// back as one line, not asked about; deleting is the one that is asked about,
// since nothing brings the text back. Whatever the server refuses is said in
// words, and a conversation that is no longer there only refreshes the list.
export function useConversationActions(
  tenant: string,
  current: {
    id: string | null;
    markArchived: (id: string, archived: boolean) => void;
    startNew: () => void;
  },
): ConversationActions {
  const writes = useConversationWrites(tenant);
  const toast = useToast();
  const [undo, setUndo] = useState<ConversationRow | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ConversationRow | null>(null);
  const [deleteProblem, setDeleteProblem] = useState<string | null>(null);

  const setHidden = (id: string, archived: boolean, then: () => void): void => {
    const action: ConversationAction = archived ? 'archive' : 'restore';
    const refused = (failure: GatewayFailure): void => {
      setLeaving(null);
      toast.failed(actionFailureText(action, failure));
    };
    setLeaving(archived ? id : null);
    writes.archive
      .run({ id, archived })
      .then((result) => {
        if (!result.ok) {
          refused(result);
          return;
        }
        current.markArchived(id, archived);
        then();
      })
      .catch(() => {
        refused({ ok: false, kind: 'defect' });
      });
  };

  const removed = (result: GatewayResult<undefined>, row: ConversationRow): void => {
    if (result.ok || isGone(result)) {
      setDeleting(null);
      setDeleteProblem(null);
      if (row.id === current.id) current.startNew();
      toast.succeeded(DELETED);
      return;
    }
    setDeleteProblem(actionFailureText('delete', result));
  };

  return {
    onArchive: (row) => {
      setHidden(row.id, true, () => {
        setUndo(row);
      });
    },
    onRestore: (row) => {
      setHidden(row.id, false, () => {
        toast.succeeded(RESTORED);
      });
    },
    onRestoreCurrent: () => {
      if (current.id === null) return;
      setHidden(current.id, false, () => {
        toast.succeeded(RESTORED);
      });
    },
    onExport: (row, format) => {
      writes
        .save(row.id, format)
        .then((result) => {
          if (result.ok) toast.succeeded(EXPORTED);
          else toast.failed(actionFailureText('export', result));
        })
        .catch(() => {
          toast.failed(actionFailureText('export', { ok: false, kind: 'defect' }));
        });
    },
    undo,
    leaving,
    onUndo: () => {
      if (undo === null) return;
      setHidden(undo.id, false, () => {
        setUndo(null);
      });
    },
    deleting,
    deleteBusy: writes.remove.busy,
    deleteProblem,
    onAskDelete: (row) => {
      setDeleteProblem(null);
      setUndo(null);
      setDeleting(row);
    },
    onConfirmDelete: () => {
      if (deleting === null) return;
      const row = deleting;
      writes.remove
        .run(row.id)
        .then((result) => {
          removed(result, row);
        })
        .catch(() => {
          setDeleteProblem(actionFailureText('delete', { ok: false, kind: 'defect' }));
        });
    },
    onCancelDelete: () => {
      setDeleting(null);
      setDeleteProblem(null);
    },
  };
}

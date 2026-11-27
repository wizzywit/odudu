import { GridListItem } from 'react-aria-components';
import { ActionMenu, type MenuAction } from '#/shared/ui/ActionMenu';
import { StatusTag } from '#/shared/ui/StatusTag';
import { Timestamp } from '#/shared/ui/Timestamp';
import type { ConversationRow, ExportFormat } from '#/widgets/assistant-panel/types/conversations';
import type { PanelWords } from '#/widgets/assistant-panel/types/words';
import styles from '#/widgets/assistant-panel/ui/ConversationsView/ConversationsView.module.css';

export interface ConversationHandlers {
  onOpen: (row: ConversationRow) => void;
  onArchive: (row: ConversationRow) => void;
  onRestore: (row: ConversationRow) => void;
  onExport: (row: ConversationRow, format: ExportFormat) => void;
  onAskDelete: (row: ConversationRow) => void;
}

function actionsOf(
  row: ConversationRow,
  handlers: ConversationHandlers,
  words: PanelWords,
): MenuAction[] {
  return [
    {
      id: 'open',
      label: words.actionOpen,
      onAction: () => {
        handlers.onOpen(row);
      },
    },
    row.archived
      ? {
          id: 'restore',
          label: words.actionRestore,
          onAction: () => {
            handlers.onRestore(row);
          },
        }
      : {
          id: 'archive',
          label: words.actionArchive,
          onAction: () => {
            handlers.onArchive(row);
          },
        },
    {
      id: 'export-markdown',
      label: words.actionExportMarkdown,
      onAction: () => {
        handlers.onExport(row, 'markdown');
      },
    },
    {
      id: 'export-json',
      label: words.actionExportJson,
      onAction: () => {
        handlers.onExport(row, 'json');
      },
    },
    {
      id: 'delete',
      label: words.actionDelete,
      tone: 'danger',
      ...(row.reported ? { isDisabled: true, description: words.deleteHeld } : {}),
      onAction: () => {
        handlers.onAskDelete(row);
      },
    },
  ];
}

// One conversation: its title on one line, when it was last active and the
// tags below, and a menu of what can be done to it. Everything is on a line
// of fixed height, so a long title or a tag appearing moves nothing.
export function ConversationItem({
  row,
  current,
  leaving,
  now,
  handlers,
  words,
}: {
  row: ConversationRow;
  current: boolean;
  leaving: boolean;
  now: Date;
  handlers: ConversationHandlers;
  words: PanelWords;
}) {
  return (
    <GridListItem
      id={row.id}
      textValue={row.title}
      className={styles.item ?? ''}
      data-current={current || undefined}
      data-leaving={leaving || undefined}
      onAction={() => {
        handlers.onOpen(row);
      }}
    >
      <div className={styles.text}>
        <span className={styles.title}>{row.title}</span>
        <span className={styles.meta}>
          <span className={styles.when}>
            <Timestamp value={row.lastActiveAt} now={now} />
          </span>
          <StatusTag tone={row.mode === 'act' ? 'warning' : 'neutral'}>{row.modeLabel}</StatusTag>
          {row.tenant === null ? null : (
            <span className={styles.tenant} title={row.tenant}>
              {row.tenant}
            </span>
          )}
          {row.reported ? <StatusTag tone="warning">{words.reportedTag}</StatusTag> : null}
        </span>
      </div>
      <ActionMenu
        compact
        label={row.menuLabel}
        trigger={words.menuTrigger}
        actions={actionsOf(row, handlers, words)}
      />
    </GridListItem>
  );
}

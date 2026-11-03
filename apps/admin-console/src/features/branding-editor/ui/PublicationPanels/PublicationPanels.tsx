import type { VersionLine } from '#/features/branding-editor/services/versions';
import type { Revert } from '#/features/branding-editor/use-cases/useRevert';
import type { ThemeReset } from '#/features/branding-editor/use-cases/useThemeReset';
import type { Versions } from '#/features/branding-editor/use-cases/useVersions';
import { RevertConflict } from '#/features/branding-editor/ui/RevertConflict';
import { Button } from '#/shared/ui/Button';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { InlineFailed } from '#/shared/ui/InlineFailed';
import { Note } from '#/shared/ui/Note';
import { Panel } from '#/shared/ui/Panel';
import { recordTab } from '#/shared/ui/RecordTab';
import { FormSkeleton } from '#/shared/ui/Skeleton';
import { StatusTag } from '#/shared/ui/StatusTag';
import styles from '#/features/branding-editor/ui/PublicationPanels/PublicationPanels.module.css';

export function RevertPanel({ revert }: { revert: Revert }) {
  const { words } = revert;
  return (
    <Panel title={words.title}>
      <p className={recordTab.rule}>{words.lead}</p>
      {revert.hold === undefined ? null : <Note>{revert.hold}</Note>}
      <div className={recordTab.actions}>
        <Button isDisabled={revert.busy || revert.hold !== undefined} onPress={revert.revert}>
          {words.label}
        </Button>
      </div>
      <div role="status" className={styles.outcome}>
        {revert.problem === null ? null : <p className={styles.refused}>{revert.problem}</p>}
      </div>
      <RevertConflict revert={revert} />
    </Panel>
  );
}

function columns(versions: Versions): readonly Column<VersionLine>[] {
  const { words, restoring } = versions;
  return [
    {
      id: 'version',
      header: words.columns.version,
      isRowHeader: true,
      cell: (row) => row.name,
    },
    {
      id: 'state',
      header: words.columns.state,
      cell: (row) => <StatusTag tone={row.tone}>{row.state}</StatusTag>,
    },
    { id: 'when', header: words.columns.when, secondary: true, cell: (row) => row.when },
    {
      id: 'action',
      header: words.columns.action,
      cell: (row) =>
        row.restorable ? (
          <Button
            size="small"
            aria-label={row.restoreName}
            onPress={() => {
              restoring.ask(row);
            }}
          >
            {words.restoreLabel}
          </Button>
        ) : null,
    },
  ];
}

export function VersionsPanel({ versions }: { versions: Versions }) {
  const { read, restoring, words, dialog } = versions;
  return (
    <Panel title={words.title}>
      <p className={recordTab.rule}>{words.lead}</p>
      {read.status === 'loading' ? <FormSkeleton label={words.loading} fields={2} /> : null}
      {read.status === 'failed' ? <InlineFailed message={words.failed} retry={read.retry} /> : null}
      {read.status === 'ready' ? (
        <DataTable
          label={words.tableLabel}
          columns={columns(versions)}
          rows={versions.lines}
          rowKey={(row) => row.id}
          empty={<p className={recordTab.rule}>{words.empty}</p>}
        />
      ) : null}
      <ConfirmDialog
        isOpen={restoring.asking !== null}
        title={dialog.title}
        consequence={dialog.consequence}
        confirmLabel={dialog.confirmLabel}
        tone="primary"
        busy={restoring.busy}
        problem={restoring.problem}
        onConfirm={restoring.confirm}
        onCancel={restoring.cancel}
      />
    </Panel>
  );
}

export function ResetPanel({ reset }: { reset: ThemeReset }) {
  const { removal, words } = reset;
  return (
    <Panel title={words.title}>
      <p className={recordTab.rule}>{words.lead}</p>
      <div className={recordTab.actions}>
        <Button variant="danger" onPress={removal.ask}>
          {words.label}
        </Button>
      </div>
      <ConfirmDialog
        isOpen={removal.confirming}
        title={words.dialog.title}
        consequence={words.dialog.consequence}
        confirmLabel={words.dialog.confirmLabel}
        tone="danger"
        busy={removal.busy}
        problem={removal.problem}
        onConfirm={removal.confirm}
        onCancel={removal.cancel}
      />
    </Panel>
  );
}

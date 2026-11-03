import {
  RESET_LABEL,
  RESTORE_LABEL,
  restoreName,
  VERSIONS_COLUMNS,
  VERSIONS_TABLE_LABEL,
  NO_VERSIONS,
  RESET_CONFIRM,
  RESET_TITLE,
  resetBody,
  resetLead,
  restoreBody,
  restoreTitle,
  VERSIONS_FAILED,
  VERSIONS_TITLE,
  versionRows,
  versionsLead,
  type VersionRow,
} from '#/features/branding/services/versions';
import {
  REVERT_LABEL,
  REVERT_TITLE,
  REVERTING,
  revertLead,
} from '#/features/branding/services/revertDraft';
import type { ThemeScope } from '#/features/branding/services/themeScope';
import type { ScopedTab } from '#/features/branding/services/tabs';
import type { Revert } from '#/features/branding/use-cases/useRevert';
import type { Versions } from '#/features/branding/use-cases/useVersions';
import type { Removal } from '#/shared/use-cases/useConfirmedChange';
import { RevertConflict } from '#/features/branding/ui/RevertConflict';
import { Button } from '#/shared/ui/Button';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { InlineFailed } from '#/shared/ui/InlineFailed';
import { Note } from '#/shared/ui/Note';
import { Panel } from '#/shared/ui/Panel';
import { recordTab } from '#/shared/ui/RecordTab';
import { FormSkeleton } from '#/shared/ui/Skeleton';
import { StatusTag } from '#/shared/ui/StatusTag';
import styles from '#/features/branding/ui/PublicationPanels/PublicationPanels.module.css';

export function RevertPanel({
  scope,
  tab,
  revert,
}: {
  scope: ThemeScope;
  tab: ScopedTab;
  revert: Revert;
}) {
  return (
    <Panel title={REVERT_TITLE}>
      <p className={recordTab.rule}>{revertLead(scope, tab)}</p>
      {revert.hold === undefined ? null : <Note>{revert.hold}</Note>}
      <div className={recordTab.actions}>
        <Button isDisabled={revert.busy || revert.hold !== undefined} onPress={revert.revert}>
          {revert.busy ? REVERTING : REVERT_LABEL}
        </Button>
      </div>
      <div role="status" className={styles.outcome}>
        {revert.problem === null ? null : <p className={styles.refused}>{revert.problem}</p>}
      </div>
      <RevertConflict revert={revert} />
    </Panel>
  );
}

const COLUMNS = (ask: (row: VersionRow) => void): readonly Column<VersionRow>[] => [
  { id: 'version', header: VERSIONS_COLUMNS.version, isRowHeader: true, cell: (row) => row.name },
  {
    id: 'state',
    header: VERSIONS_COLUMNS.state,
    cell: (row) => <StatusTag tone={row.tone}>{row.state}</StatusTag>,
  },
  { id: 'when', header: VERSIONS_COLUMNS.when, secondary: true, cell: (row) => row.when },
  {
    id: 'action',
    header: VERSIONS_COLUMNS.action,
    cell: (row) =>
      row.restorable ? (
        <Button
          size="small"
          aria-label={restoreName(row.name)}
          onPress={() => {
            ask(row);
          }}
        >
          {RESTORE_LABEL}
        </Button>
      ) : null,
  },
];

export function VersionsPanel({ versions }: { versions: Versions }) {
  const { read, restoring } = versions;
  const asked = restoring.asking;
  return (
    <Panel title={VERSIONS_TITLE}>
      <p className={recordTab.rule}>{versionsLead()}</p>
      {read.status === 'loading' ? <FormSkeleton label="Loading the versions" fields={2} /> : null}
      {read.status === 'failed' ? (
        <InlineFailed message={VERSIONS_FAILED} retry={read.retry} />
      ) : null}
      {read.status === 'ready' ? (
        <DataTable
          label={VERSIONS_TABLE_LABEL}
          columns={COLUMNS(restoring.ask)}
          rows={versionRows(read.data.items)}
          rowKey={(row) => row.id}
          empty={<p className={recordTab.rule}>{NO_VERSIONS}</p>}
        />
      ) : null}
      <ConfirmDialog
        isOpen={asked !== null}
        title={asked === null ? '' : restoreTitle(asked)}
        consequence={asked === null ? '' : restoreBody(asked)}
        confirmLabel={RESTORE_LABEL}
        tone="primary"
        busy={restoring.busy}
        problem={restoring.problem}
        onConfirm={restoring.confirm}
        onCancel={restoring.cancel}
      />
    </Panel>
  );
}

export function ResetPanel({ scope, reset }: { scope: ThemeScope; reset: Removal }) {
  return (
    <Panel title={RESET_TITLE}>
      <p className={recordTab.rule}>{resetLead(scope)}</p>
      <div className={recordTab.actions}>
        <Button variant="danger" onPress={reset.ask}>
          {RESET_LABEL}
        </Button>
      </div>
      <ConfirmDialog
        isOpen={reset.confirming}
        title={`${RESET_TITLE}?`}
        consequence={resetBody(scope)}
        confirmLabel={RESET_CONFIRM}
        tone="danger"
        busy={reset.busy}
        problem={reset.problem}
        onConfirm={reset.confirm}
        onCancel={reset.cancel}
      />
    </Panel>
  );
}

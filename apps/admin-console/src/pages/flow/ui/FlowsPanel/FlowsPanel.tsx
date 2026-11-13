import type { FlowRow } from '#/pages/flow/services/flows';
import { useFlowsPanel, type FlowsPanel as Panel } from '#/pages/flow/use-cases/useFlowsPanel';
import { Button } from '#/shared/ui/Button';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { LastAction } from '#/shared/ui/LastAction';
import { Panel as Frame } from '#/shared/ui/Panel';
import { ReadGate } from '#/shared/ui/ReadGate';
import { StatusTag } from '#/shared/ui/StatusTag';
import { VisuallyHidden } from '#/shared/ui/VisuallyHidden';
import styles from '#/pages/flow/ui/FlowsPanel/FlowsPanel.module.css';

function columns(page: Panel): readonly Column<FlowRow>[] {
  const { columns: header, edit, delete: remove } = page.words;
  return [
    {
      id: 'name',
      header: header.name,
      isRowHeader: true,
      cell: ({ flow, isDefault }) => (
        <span>
          <code className={styles.name}>{flow.name}</code>{' '}
          {isDefault ? <StatusTag tone="active">{page.words.defaultTag}</StatusTag> : null}
        </span>
      ),
    },
    { id: 'steps', header: header.steps, cell: ({ summary }) => summary },
    {
      id: 'actions',
      header: header.actions,
      cell: (row) => (
        <div className={styles.actions}>
          <ButtonLink href={row.href} size="small" variant="quiet">
            {edit} <VisuallyHidden>{row.flow.name}</VisuallyHidden>
          </ButtonLink>
          {row.deletable ? (
            <Button
              size="small"
              variant="quiet"
              aria-label={row.deleteLabel}
              onPress={() => {
                page.action.ask(row.flow);
              }}
            >
              {remove}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];
}

function DeleteDialog({ page }: { page: Panel }) {
  const { action } = page;
  const dialog = action.dialog;
  return (
    <ConfirmDialog
      isOpen={dialog !== null}
      title={dialog?.title ?? ''}
      consequence={dialog?.consequence ?? ''}
      confirmLabel={dialog?.confirmLabel ?? ''}
      tone="danger"
      busy={action.busy}
      problem={action.problem}
      onConfirm={() => {
        action.confirm().catch(() => undefined);
      }}
      onCancel={action.cancel}
    />
  );
}

export function FlowsPanel({ tenant }: { tenant: string }) {
  const page = useFlowsPanel(tenant);
  const { words } = page;
  return (
    <Frame title={words.title}>
      <p className={styles.rule}>{words.rule}</p>
      <ReadGate read={page.record} label={words.loading} fields={2} failed={words.failed}>
        {() => (
          <DataTable
            label={words.label}
            columns={columns(page)}
            rows={page.rows}
            rowKey={({ flow }) => flow.id}
          />
        )}
      </ReadGate>
      <div className={styles.actions}>
        <ButtonLink href={page.newHref} variant="primary">
          {words.newFlow}
        </ButtonLink>
      </div>
      <LastAction label={words.lastAction} count={page.action.count}>
        {page.action.notice}
      </LastAction>
      <DeleteDialog page={page} />
    </Frame>
  );
}

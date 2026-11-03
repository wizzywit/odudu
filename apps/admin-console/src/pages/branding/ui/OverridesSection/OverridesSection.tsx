import { MessageKeyField } from '#/features/branding-editor';
import type { OverrideLine } from '#/pages/branding/services/overridesView';
import type { Settings } from '@odudu/contracts/admin';
import { useRef } from 'react';
import { useOverrideTable, type OverrideTable } from '#/pages/branding/use-cases/useOverrideTable';
import { Button } from '#/shared/ui/Button';
import { ConflictPanel } from '#/shared/ui/ConflictPanel';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { EmptyState } from '#/shared/ui/EmptyState';
import { SelectField, TextAreaField } from '#/shared/ui/Field';
import { FieldGrid, GridCell } from '#/shared/ui/FieldGrid';
import { LastAction } from '#/shared/ui/LastAction';
import { ListGate } from '#/shared/ui/ListGate';
import { LoadMore } from '#/shared/ui/LoadMore';
import { LiveMessage } from '#/shared/ui/Message';
import { Panel } from '#/shared/ui/Panel';
import { recordTab } from '#/shared/ui/RecordTab';
import { TableSkeleton } from '#/shared/ui/Skeleton';
import { Timestamp } from '#/shared/ui/Timestamp';
import styles from '#/pages/branding/ui/OverridesSection/OverridesSection.module.css';

function columns(
  page: OverrideTable,
  edit: (override: OverrideLine) => void,
): readonly Column<OverrideLine>[] {
  const { words } = page.table.view;
  return [
    {
      id: 'key',
      header: words.columns.key,
      isRowHeader: true,
      cell: (row) => <code className={styles.key}>{row.key}</code>,
    },
    {
      id: 'message',
      header: words.columns.text,
      cell: (row) => <span className={styles.text}>{row.message}</span>,
    },
    {
      id: 'updated_at',
      header: words.columns.changed,
      secondary: true,
      cell: (row) => <Timestamp value={row.updated_at} />,
    },
    {
      id: 'actions',
      header: words.columns.actions,
      cell: (row) => (
        <span className={styles.actions}>
          <Button
            size="small"
            variant="quiet"
            aria-label={row.editName}
            onPress={() => {
              edit(row);
            }}
          >
            {words.edit}
          </Button>
          <Button
            size="small"
            variant="quiet"
            aria-label={row.removeName}
            onPress={() => {
              page.removal.ask(row);
            }}
          >
            {words.remove}
          </Button>
        </span>
      ),
    },
  ];
}

function Form({ page }: { page: OverrideTable }) {
  const { form } = page;
  const { words } = form;
  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        form.save();
      }}
    >
      <FieldGrid>
        <GridCell span="wide">
          <MessageKeyField
            keys={form.keys}
            label={words.keyLabel}
            description={words.keyNote}
            mono
            custom
            value={form.values.key}
            error={form.errors.key}
            onChange={(next) => {
              form.edit('key', next);
            }}
          />
        </GridCell>
        <GridCell span="full">
          <TextAreaField
            label={words.messageLabel}
            description={words.messageNote}
            limit={words.messageLimit}
            value={form.values.message}
            error={form.errors.message}
            onChange={(next) => {
              form.edit('message', next);
            }}
          />
        </GridCell>
      </FieldGrid>
      <div className={styles.submit}>
        <Button type="submit" variant="primary" isDisabled={form.saving}>
          {words.save}
        </Button>
      </div>
      <LiveMessage label={words.lastLabel}>{form.message}</LiveMessage>
    </form>
  );
}

export function OverridesSection({ tenant, data }: { tenant: string; data: Settings }) {
  const page = useOverrideTable(tenant, data);
  const heading = useRef<HTMLHeadingElement>(null);
  const { locale, table, conflicts, removal } = page;
  const { list } = table;
  const { words } = table.view;
  return (
    <>
      <Panel title={page.words.title} headingRef={heading}>
        <p className={recordTab.rule}>{page.words.lead}</p>
        <SelectField
          label={locale.label}
          options={locale.options}
          value={locale.value}
          onChange={locale.pick}
        />
        <Form page={page} />
        <LastAction label={removal.words.lastLabel} count={removal.count}>
          {removal.notice}
        </LastAction>
        {conflicts.items.map((conflict) => (
          <ConflictPanel
            key={conflict.id}
            section={conflict.section}
            conflicts={conflict.fields}
            lead={conflict.lead}
            busy={conflicts.resolving}
            onKeepMine={() => {
              conflicts.keepMine(conflict.source);
            }}
            onTakeTheirs={() => {
              conflicts.takeTheirs(conflict.source);
            }}
          />
        ))}
        <ListGate
          list={list}
          loading={<TableSkeleton label={words.loading} columns={columns(page, () => undefined)} />}
          refused={words.refused}
          failed={words.failed}
        >
          {() =>
            table.view.lines.length === 0 ? (
              <EmptyState variant="nothing-yet" title={words.emptyTitle}>
                {words.empty}
              </EmptyState>
            ) : (
              <>
                <p className={recordTab.rule}>{table.view.cap}</p>
                <DataTable
                  label={words.label}
                  columns={columns(page, (row) => {
                    table.fill(row);
                    heading.current?.focus();
                  })}
                  rows={table.view.lines}
                  rowKey={(row) => row.key}
                />
                {list.next === null ? null : (
                  <LoadMore
                    noun={words.noun}
                    loading={list.loadingMore}
                    limited={list.loadLimited}
                    onPress={list.loadMore}
                  />
                )}
              </>
            )
          }
        </ListGate>
      </Panel>
      <ConfirmDialog
        isOpen={removal.removing !== null}
        title={removal.words.title}
        consequence={removal.consequence}
        confirmLabel={removal.words.confirmLabel}
        tone="danger"
        busy={removal.busy}
        problem={removal.problem}
        onConfirm={() => {
          removal.confirm().catch(() => undefined);
        }}
        onCancel={removal.cancel}
      />
    </>
  );
}

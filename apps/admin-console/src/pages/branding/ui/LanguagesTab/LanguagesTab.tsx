import { MessageKeyField } from '#/features/branding-editor';
import type { OverrideLine } from '#/pages/branding/services/overridesView';
import type { Settings } from '@odudu/contracts/admin';
import { useRef } from 'react';
import {
  useLanguagesSection,
  useOverrides,
  type Overrides,
} from '#/pages/branding/use-cases/useLanguages';
import { useLanguagesTab } from '#/pages/branding/use-cases/useLanguagesTab';
import { Button } from '#/shared/ui/Button';
import { ConflictPanel } from '#/shared/ui/ConflictPanel';
import { ChecklistField } from '#/shared/ui/ChecklistField';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { DataTable, type Column } from '#/shared/ui/DataTable';
import { EmptyState } from '#/shared/ui/EmptyState';
import { LocaleField, SelectField, TextAreaField } from '#/shared/ui/Field';
import { FieldGrid, GridCell } from '#/shared/ui/FieldGrid';
import { LastAction } from '#/shared/ui/LastAction';
import { ListGate } from '#/shared/ui/ListGate';
import { LoadMore } from '#/shared/ui/LoadMore';
import { LiveMessage } from '#/shared/ui/Message';
import { Panel } from '#/shared/ui/Panel';
import { recordTab } from '#/shared/ui/RecordTab';
import { ReadGate } from '#/shared/ui/ReadGate';
import { SaveSection } from '#/shared/ui/SaveSection';
import { TableSkeleton } from '#/shared/ui/Skeleton';
import { Timestamp } from '#/shared/ui/Timestamp';
import styles from '#/pages/branding/ui/LanguagesTab/LanguagesTab.module.css';

interface Props {
  tenant: string;
  data: Settings;
  etag: string;
  gone: boolean;
}

function LanguagesSection({ tenant, data, etag, gone }: Props) {
  const { save, hold, words, supported, add, fallback } = useLanguagesSection({
    tenant,
    data,
    etag,
    gone,
  });
  return (
    <SaveSection
      title={words.title}
      headingId={words.headingId}
      description={words.lead}
      save={save}
      blocked={hold}
    >
      <FieldGrid>
        <GridCell span="full">
          <ChecklistField
            label={supported.view.label}
            description={supported.view.description}
            error={supported.view.error}
            changed={supported.view.changed}
            options={supported.view.options}
            value={supported.view.value}
            onChange={supported.edit}
          />
        </GridCell>
        <GridCell span="wide">
          <div
            role="group"
            aria-label={add.words.label}
            onKeyDown={(event) => {
              const pointed =
                event.target instanceof HTMLElement
                  ? event.target.getAttribute('aria-activedescendant')
                  : null;
              const choosing =
                pointed !== null &&
                document.getElementById(pointed)?.getAttribute('aria-selected') !== 'true';
              if (!add.keyAdds(event.key, choosing)) return;
              event.preventDefault();
              add.press();
            }}
          >
            <LocaleField
              label={add.words.label}
              description={add.words.description}
              error={add.problem}
              value={add.value}
              onChange={add.type}
            />
            <Button variant="quiet" onPress={add.press}>
              {add.words.button}
            </Button>
          </div>
        </GridCell>
        <GridCell span="wide">
          <SelectField
            label={fallback.view.label}
            description={fallback.view.description}
            error={fallback.view.error}
            changed={fallback.view.changed}
            options={fallback.view.options}
            value={fallback.view.value}
            onChange={fallback.edit}
          />
        </GridCell>
      </FieldGrid>
    </SaveSection>
  );
}

function columns(
  page: Overrides,
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

function Form({ page }: { page: Overrides }) {
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

function OverridesSection({ tenant, data }: { tenant: string; data: Settings }) {
  const page = useOverrides(tenant, data);
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

export function LanguagesTab({ tenant }: { tenant: string }) {
  const { read, words } = useLanguagesTab(tenant);
  return (
    <ReadGate read={read} label={words.loading} fields={words.fields} failed={words.failed}>
      {(data, etag) => (
        <div className={styles.tab}>
          <LanguagesSection tenant={tenant} data={data} etag={etag} gone={read.gone} />
          <OverridesSection tenant={tenant} data={data} />
        </div>
      )}
    </ReadGate>
  );
}

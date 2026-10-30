import type { MessageOverride, Settings } from '@odudu/contracts/admin';
import { useRef } from 'react';
import {
  ADD_BUTTON,
  addsOnKey,
  ADD_LABEL,
  ADD_NOTE,
  capText,
  conflictFields,
  conflictSection,
  defaultChoices,
  DEFAULT_LABEL,
  DEFAULT_NOTE,
  EDIT_HINT,
  KEY_LABEL,
  KEY_NOTE,
  languageSettingsOf,
  LANGUAGES_DESCRIPTION,
  LANGUAGES_SECTION,
  LANGUAGES_TITLE,
  MESSAGE_LABEL,
  NOTHING_YET,
  NOUN,
  OVERRIDE_LENGTH,
  OVERRIDE_LOCALE_LABEL,
  OVERRIDE_MESSAGE_NOTE,
  OVERRIDES_DESCRIPTION,
  OVERRIDES_TITLE,
  overrideLocales,
  SAVE_OVERRIDE,
  SUPPORTED_LABEL,
  SUPPORTED_NOTE,
  supportedChoices,
} from '#/features/branding/service';
import {
  useLanguagesSection,
  useOverrides,
  type Overrides,
} from '#/features/branding/usecase/useLanguages';
import { useTenantSettingsRead } from '#/shared/usecase/useTenantSettingsRead';
import { MessageKeyField } from '#/features/branding/view/MessageKeyField';
import { Button } from '#/shared/view/Button';
import { ConflictPanel } from '#/shared/view/ConflictPanel';
import { ChecklistField } from '#/shared/view/ChecklistField';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog';
import { DataTable, type Column } from '#/shared/view/DataTable';
import { EmptyState } from '#/shared/view/EmptyState';
import { LocaleField, SelectField, TextAreaField } from '#/shared/view/Field';
import { FieldGrid, GridCell } from '#/shared/view/FieldGrid';
import { LastAction } from '#/shared/view/LastAction';
import { ListGate } from '#/shared/view/ListGate';
import { LoadMore } from '#/shared/view/LoadMore';
import { LiveMessage } from '#/shared/view/Message';
import { Panel } from '#/shared/view/Panel';
import { recordTab } from '#/shared/view/RecordTab';
import { ReadGate } from '#/shared/view/ReadGate';
import { SaveSection } from '#/shared/view/SaveSection';
import { TableSkeleton } from '#/shared/view/Skeleton';
import { Timestamp } from '#/shared/view/Timestamp';
import styles from '#/features/branding/view/LanguagesTab/LanguagesTab.module.css';

interface Props {
  tenant: string;
  data: Settings;
  etag: string;
  gone: boolean;
}

function LanguagesSection({ tenant, data, etag, gone }: Props) {
  const { save, hold, adding, addProblem, typeAdding, add } = useLanguagesSection({
    tenant,
    data,
    etag,
    gone,
  });
  const saved = languageSettingsOf(data);
  return (
    <SaveSection
      title={LANGUAGES_TITLE}
      headingId={`branding-${LANGUAGES_SECTION}`}
      description={LANGUAGES_DESCRIPTION}
      save={save}
      blocked={hold}
    >
      <FieldGrid>
        <GridCell span="full">
          <ChecklistField
            label={SUPPORTED_LABEL}
            description={SUPPORTED_NOTE}
            error={save.fieldErrors.supported_locales}
            changed={save.changed.includes('supported_locales')}
            options={supportedChoices(saved.supported_locales, save.values.supported_locales)}
            value={save.values.supported_locales}
            onChange={(next) => {
              save.edit('supported_locales', next);
            }}
          />
        </GridCell>
        <GridCell span="wide">
          <div
            role="group"
            aria-label={ADD_LABEL}
            onKeyDown={(event) => {
              const pointed =
                event.target instanceof HTMLElement
                  ? event.target.getAttribute('aria-activedescendant')
                  : null;
              const choosing =
                pointed !== null &&
                document.getElementById(pointed)?.getAttribute('aria-selected') !== 'true';
              if (!addsOnKey(event.key, choosing)) return;
              event.preventDefault();
              add();
            }}
          >
            <LocaleField
              label={ADD_LABEL}
              description={ADD_NOTE}
              error={addProblem}
              value={adding}
              onChange={typeAdding}
            />
            <Button variant="quiet" onPress={add}>
              {ADD_BUTTON}
            </Button>
          </div>
        </GridCell>
        <GridCell span="wide">
          <SelectField
            label={DEFAULT_LABEL}
            description={DEFAULT_NOTE}
            error={save.fieldErrors.default_locale}
            changed={save.changed.includes('default_locale')}
            options={defaultChoices(save.values.supported_locales)}
            value={save.values.default_locale}
            onChange={(next) => {
              save.edit('default_locale', next);
            }}
          />
        </GridCell>
      </FieldGrid>
    </SaveSection>
  );
}

function columns(
  page: Overrides,
  edit: (override: MessageOverride) => void,
): readonly Column<MessageOverride>[] {
  return [
    {
      id: 'key',
      header: 'Key',
      isRowHeader: true,
      cell: (row) => <code className={styles.key}>{row.key}</code>,
    },
    {
      id: 'message',
      header: 'Text',
      cell: (row) => <span className={styles.text}>{row.message}</span>,
    },
    {
      id: 'updated_at',
      header: 'Changed',
      secondary: true,
      cell: (row) => <Timestamp value={row.updated_at} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (row) => (
        <span className={styles.actions}>
          <Button
            size="small"
            variant="quiet"
            aria-label={`Edit ${row.key}`}
            onPress={() => {
              edit(row);
            }}
          >
            Edit
          </Button>
          <Button
            size="small"
            variant="quiet"
            aria-label={`Remove ${row.key}`}
            onPress={() => {
              page.ask(row);
            }}
          >
            Remove
          </Button>
        </span>
      ),
    },
  ];
}

function Form({ page }: { page: Overrides }) {
  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        page.save();
      }}
    >
      <FieldGrid>
        <GridCell span="wide">
          <MessageKeyField
            keys={page.keys}
            label={KEY_LABEL}
            description={KEY_NOTE}
            mono
            custom
            value={page.values.key}
            error={page.errors.key}
            onChange={(next) => {
              page.edit('key', next);
            }}
          />
        </GridCell>
        <GridCell span="full">
          <TextAreaField
            label={MESSAGE_LABEL}
            description={`${OVERRIDE_MESSAGE_NOTE} ${EDIT_HINT}`}
            limit={OVERRIDE_LENGTH}
            value={page.values.message}
            error={page.errors.message}
            onChange={(next) => {
              page.edit('message', next);
            }}
          />
        </GridCell>
      </FieldGrid>
      <div className={styles.submit}>
        <Button type="submit" variant="primary" isDisabled={page.saving}>
          {page.saving ? 'Saving…' : SAVE_OVERRIDE}
        </Button>
      </div>
      <LiveMessage label="Last override">{page.message}</LiveMessage>
    </form>
  );
}

function OverridesSection({ tenant, data }: { tenant: string; data: Settings }) {
  const page = useOverrides(tenant, data);
  const heading = useRef<HTMLHeadingElement>(null);
  const { list } = page;
  return (
    <>
      <Panel title={OVERRIDES_TITLE} headingRef={heading}>
        <p className={recordTab.rule}>{OVERRIDES_DESCRIPTION}</p>
        <SelectField
          label={OVERRIDE_LOCALE_LABEL}
          options={overrideLocales(languageSettingsOf(data).supported_locales)}
          value={page.locale}
          onChange={page.pick}
        />
        <Form page={page} />
        <LastAction label="Last removal" count={page.removed}>
          {page.notice}
        </LastAction>
        {page.conflicts.map((conflict) => (
          <ConflictPanel
            key={`${conflict.locale}/${conflict.key}`}
            section={conflictSection(conflict)}
            conflicts={conflictFields(conflict)}
            busy={page.resolving}
            onKeepMine={() => {
              page.keepMine(conflict);
            }}
            onTakeTheirs={() => {
              page.takeTheirs(conflict);
            }}
          />
        ))}
        <ListGate
          list={list}
          loading={
            <TableSkeleton label="Loading the overrides" columns={columns(page, () => undefined)} />
          }
          refused={{ capability: 'manage-tenant', noun: OVERRIDES_TITLE }}
          failed="The overrides could not be loaded"
        >
          {() =>
            list.rows.length === 0 ? (
              <EmptyState variant="nothing-yet" title="No overrides yet">
                {NOTHING_YET}
              </EmptyState>
            ) : (
              <>
                <p className={recordTab.rule}>{capText(list.rows.length, list.next !== null)}</p>
                <DataTable
                  label={OVERRIDES_TITLE}
                  columns={columns(page, (row) => {
                    page.fill(row);
                    heading.current?.focus();
                  })}
                  rows={list.rows}
                  rowKey={(row) => row.key}
                />
                {list.next === null ? null : (
                  <LoadMore
                    noun={NOUN.other}
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
        isOpen={page.removing !== null}
        title="Remove this override?"
        consequence={page.consequence}
        confirmLabel="Remove override"
        tone="danger"
        busy={page.removeBusy}
        problem={page.removeProblem}
        onConfirm={() => {
          page.confirm().catch(() => undefined);
        }}
        onCancel={page.cancel}
      />
    </>
  );
}

export function LanguagesTab({ tenant }: { tenant: string }) {
  const settings = useTenantSettingsRead(tenant);
  return (
    <ReadGate
      read={settings}
      label="Loading the languages"
      fields={3}
      failed="The languages could not be loaded"
    >
      {(data, etag) => (
        <div className={styles.tab}>
          <LanguagesSection tenant={tenant} data={data} etag={etag} gone={settings.gone} />
          <OverridesSection tenant={tenant} data={data} />
        </div>
      )}
    </ReadGate>
  );
}

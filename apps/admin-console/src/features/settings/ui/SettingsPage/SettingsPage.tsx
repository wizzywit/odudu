import type { Settings } from '@odudu/contracts/admin';
import { Fragment } from 'react';
import { AreaGate, areaAt } from '#/features/shell';
import { fieldDescription } from '#/features/settings/services/notes';
import {
  GENERAL_SECTION,
  LOCKOUT_SECTION,
  PASSWORD_SECTION,
  sectionHeadingId,
  SETTINGS_SECTIONS,
  type SettingField,
  type SettingsSection,
} from '#/features/settings/services/sections';
import { booleanOf, listOf, numberOf, textOf } from '#/features/settings/services/values';
import { usePasswordNote } from '#/features/settings/use-cases/usePasswordNote';
import {
  useGeneralSection,
  useSettingsSection,
  type SettingsSave,
} from '#/features/settings/use-cases/useSettingsSection';
import { numberKept } from '#/shared/services/numbers';
import { disableFixed } from '#/shared/services/tenantEnabled';
import { Button } from '#/shared/ui/Button';
import { ChecklistField } from '#/shared/ui/ChecklistField';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { NumberWithUnitField, SelectField, TextField, ToggleField } from '#/shared/ui/Field';
import { useTenantSettingsRead } from '#/shared/use-cases/useTenantSettingsRead';
import { FieldGrid, GridCell } from '#/shared/ui/FieldGrid';
import { PageHeader } from '#/shared/ui/PageHeader';
import { Note } from '#/shared/ui/Note';
import { ReadGate } from '#/shared/ui/ReadGate';
import { SaveSection } from '#/shared/ui/SaveSection';
import { ClearLockouts } from '#/features/settings/ui/ClearLockouts';
import styles from '#/features/settings/ui/SettingsPage/SettingsPage.module.css';

const TITLE = 'Settings';

function Control({
  field,
  save,
  description,
  isDisabled,
}: {
  field: SettingField;
  save: SettingsSave;
  description?: string | undefined;
  isDisabled?: boolean;
}) {
  const shared = {
    label: field.label,
    description: description ?? fieldDescription(field),
    error: save.fieldErrors[field.name],
    changed: save.changed.includes(field.name),
    ...(isDisabled === undefined ? {} : { isDisabled }),
  };
  const value = save.values[field.name];
  switch (field.control) {
    case 'toggle':
      return (
        <ToggleField
          {...shared}
          value={booleanOf(value)}
          onChange={(next) => {
            save.edit(field.name, next);
          }}
        />
      );
    case 'text':
      return (
        <TextField
          {...shared}
          value={textOf(value)}
          onChange={(next) => {
            save.edit(field.name, next);
          }}
        />
      );
    case 'seconds':
    case 'count':
      return (
        <NumberWithUnitField
          {...shared}
          unit={field.control === 'seconds' ? 'seconds' : (field.unit ?? '')}
          value={numberOf(value)}
          onChange={(next) => {
            save.edit(field.name, numberKept(next, numberOf(value)));
          }}
        />
      );
    case 'choice':
      return (
        <SelectField
          {...shared}
          options={field.options ?? []}
          value={textOf(value)}
          onChange={(next) => {
            save.edit(field.name, next);
          }}
        />
      );
    case 'set':
      return (
        <ChecklistField
          {...shared}
          options={(field.options ?? []).map((option) => ({
            id: option.id,
            label: option.label,
            ...(option.fixed === undefined ? {} : { unavailable: option.fixed }),
          }))}
          value={listOf(value)}
          onChange={(next) => {
            save.edit(field.name, next);
          }}
        />
      );
  }
}

function Fields({
  section,
  save,
  fixed,
}: {
  section: SettingsSection;
  save: SettingsSave;
  fixed?: Readonly<Record<string, string>>;
}) {
  return (
    <FieldGrid>
      {section.fields.map((field) => {
        const why = fixed?.[field.name];
        return (
          <GridCell
            key={field.name}
            {...(field.control === 'set'
              ? { span: 'full' as const }
              : field.control === 'text' || field.control === 'choice'
                ? { span: 'wide' as const }
                : {})}
          >
            <Control
              field={field}
              save={save}
              {...(why === undefined ? {} : { description: why, isDisabled: true })}
            />
          </GridCell>
        );
      })}
    </FieldGrid>
  );
}

interface Props {
  tenant: string;
  data: Settings;
  etag: string;
  gone: boolean;
}

function PasswordHint({ save, data }: { save: SettingsSave; data: Settings }) {
  const note = usePasswordNote(save, data);
  return note === null ? null : <Note tone={note.tone}>{note.text}</Note>;
}

function Plain({ tenant, data, etag, gone, section }: Props & { section: SettingsSection }) {
  const save = useSettingsSection({ tenant, section, data, etag, gone });
  return (
    <SaveSection
      title={section.title}
      headingId={sectionHeadingId(section.id)}
      description={section.description}
      save={save}
    >
      <Fields section={section} save={save} />
      {section.id === PASSWORD_SECTION ? <PasswordHint save={save} data={data} /> : null}
    </SaveSection>
  );
}

function General({ tenant, data, etag, gone, section }: Props & { section: SettingsSection }) {
  const general = useGeneralSection({ tenant, section, data, etag, gone });
  const s = general.save;
  const why = disableFixed(tenant);
  return (
    <>
      <SaveSection
        title={section.title}
        headingId={sectionHeadingId(section.id)}
        description={section.description}
        save={s}
        onSave={general.submit}
      >
        <Fields section={section} save={s} {...(why === null ? {} : { fixed: { enabled: why } })} />
      </SaveSection>
      <ConfirmDialog
        isOpen={general.confirming}
        title={`Disable ${tenant}?`}
        consequence={general.consequence}
        confirmLabel={`Disable ${tenant}`}
        tone="danger"
        typed={tenant}
        busy={s.saving}
        onConfirm={general.confirm}
        onCancel={general.cancel}
      />
    </>
  );
}

function Sections({ tenant }: { tenant: string }) {
  const settings = useTenantSettingsRead(tenant);
  return (
    <ReadGate
      read={settings}
      label="Loading the settings"
      fields={4}
      failed="The settings could not be loaded"
    >
      {(data, etag) => (
        <div className={styles.page}>
          <nav aria-label="On this page" className={styles.nav}>
            <ul className={styles.sections}>
              {SETTINGS_SECTIONS.map((section) => (
                <li key={section.id}>
                  <Button
                    size="small"
                    variant="quiet"
                    onPress={() => {
                      document.getElementById(sectionHeadingId(section.id))?.focus();
                    }}
                  >
                    {section.title}
                  </Button>
                </li>
              ))}
            </ul>
          </nav>
          {SETTINGS_SECTIONS.map((section) =>
            section.id === GENERAL_SECTION ? (
              <General
                key={section.id}
                tenant={tenant}
                data={data}
                etag={etag}
                gone={settings.gone}
                section={section}
              />
            ) : (
              <Fragment key={section.id}>
                <Plain
                  tenant={tenant}
                  data={data}
                  etag={etag}
                  gone={settings.gone}
                  section={section}
                />
                {section.id === LOCKOUT_SECTION ? <ClearLockouts tenant={tenant} /> : null}
              </Fragment>
            ),
          )}
        </div>
      )}
    </ReadGate>
  );
}

export function SettingsPage({ tenant }: { tenant: string }) {
  return (
    <AreaGate tenant={tenant} area={areaAt('settings')} title={TITLE}>
      <PageHeader
        kicker={tenant}
        title={TITLE}
        description="How this tenant signs people in, what it asks of their passwords, and how long it keeps what it records. Every section saves on its own."
      />
      <Sections tenant={tenant} />
    </AreaGate>
  );
}

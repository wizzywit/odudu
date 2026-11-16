import type { Settings } from '#/entities/tenant';
import { Fragment, useEffect } from 'react';
import { AreaGate } from '#/widgets/shell';
import type { ControlView } from '#/pages/settings/services/controls';
import type { SectionPlan } from '#/pages/settings/services/sectionPlan';
import type { SettingValue } from '#/pages/settings/services/values';
import { usePasswordNote } from '#/pages/settings/use-cases/usePasswordNote';
import { useCurrentSection } from '#/pages/settings/use-cases/useCurrentSection';
import { useSettingsFields } from '#/pages/settings/use-cases/useSettingsFields';
import { useSettingsPage } from '#/pages/settings/use-cases/useSettingsPage';
import { useSettingsSections } from '#/pages/settings/use-cases/useSettingsSections';
import {
  useGeneralSection,
  useSettingsSection,
  type SettingsSave,
} from '#/pages/settings/use-cases/useSettingsSection';
import { ChecklistField } from '#/shared/ui/ChecklistField';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import {
  NumberWithUnitField,
  SelectField,
  TextField,
  ToggleField,
  UrlField,
} from '#/shared/ui/Field';
import { FieldGrid, GridCell } from '#/shared/ui/FieldGrid';
import { PageHeader } from '#/shared/ui/PageHeader';
import { More } from '#/shared/ui/More';
import { Note } from '#/shared/ui/Note';
import { ReadGate } from '#/shared/ui/ReadGate';
import { SaveSection } from '#/shared/ui/SaveSection';
import { ClearLockouts } from '#/pages/settings/ui/ClearLockouts';
import { SectionNav } from '#/pages/settings/ui/SectionNav';
import styles from '#/pages/settings/ui/SettingsPage/SettingsPage.module.css';

function Control({
  view,
  change,
}: {
  view: ControlView;
  change: (name: string, next: SettingValue) => void;
}) {
  const shared = {
    label: view.label,
    description: view.description,
    error: view.error,
    changed: view.changed,
    isDisabled: view.isDisabled,
  };
  switch (view.control) {
    case 'toggle':
      return (
        <ToggleField
          {...shared}
          value={view.value}
          onChange={(next) => {
            change(view.name, next);
          }}
        />
      );
    case 'text':
      return (
        <TextField
          {...shared}
          value={view.value}
          onChange={(next) => {
            change(view.name, next);
          }}
        />
      );
    case 'url':
      return (
        <UrlField
          {...shared}
          value={view.value}
          onChange={(next) => {
            change(view.name, next);
          }}
        />
      );
    case 'number':
      return (
        <NumberWithUnitField
          {...shared}
          unit={view.unit}
          picker={view.picker}
          echo={false}
          {...(view.min === undefined ? {} : { minValue: view.min })}
          {...(view.max === undefined ? {} : { maxValue: view.max })}
          {...(view.rangeMessage === undefined ? {} : { rangeMessage: view.rangeMessage })}
          value={view.value}
          onChange={(next) => {
            change(view.name, next);
          }}
        />
      );
    case 'choice':
      return (
        <SelectField
          {...shared}
          options={view.options}
          value={view.value}
          onChange={(next) => {
            change(view.name, next);
          }}
        />
      );
    case 'set':
      return (
        <ChecklistField
          {...shared}
          options={view.options}
          value={view.value}
          onChange={(next) => {
            change(view.name, next);
          }}
        />
      );
  }
}

function Fields({
  plan,
  save,
  fixed,
}: {
  plan: SectionPlan;
  save: SettingsSave;
  fixed: Readonly<Record<string, string>>;
}) {
  const { groups, change } = useSettingsFields(plan.section, save, fixed);
  return (
    <>
      {groups.map((group) => {
        const grid = (
          <FieldGrid>
            {group.controls.map((view) => (
              <GridCell key={view.name} {...view.cell}>
                <Control view={view} change={change} />
                {view.more === undefined ? null : <More>{view.more}</More>}
              </GridCell>
            ))}
          </FieldGrid>
        );
        return group.title === undefined ? (
          <Fragment key="ungrouped">{grid}</Fragment>
        ) : (
          <fieldset key={group.title} className={styles.group}>
            <legend className={styles.legend}>{group.title}</legend>
            {grid}
          </fieldset>
        );
      })}
    </>
  );
}

interface Props {
  tenant: string;
  data: Settings;
  etag: string;
  gone: boolean;
  plan: SectionPlan;
}

function PasswordHint({ save, data }: { save: SettingsSave; data: Settings }) {
  const note = usePasswordNote(save, data);
  return note === null ? null : <Note tone={note.tone}>{note.text}</Note>;
}

function Plain({ tenant, data, etag, gone, plan }: Props) {
  const save = useSettingsSection({ tenant, section: plan.section, data, etag, gone });
  return (
    <SaveSection
      title={plan.title}
      headingId={plan.headingId}
      description={plan.description}
      save={save}
    >
      <Fields plan={plan} save={save} fixed={{}} />
      {plan.kind === 'password' ? <PasswordHint save={save} data={data} /> : null}
    </SaveSection>
  );
}

function General({ tenant, data, etag, gone, plan }: Props) {
  const general = useGeneralSection({ tenant, section: plan.section, data, etag, gone });
  const s = general.save;
  return (
    <>
      <SaveSection
        title={plan.title}
        headingId={plan.headingId}
        description={plan.description}
        save={s}
        onSave={general.submit}
      >
        <Fields plan={plan} save={s} fixed={general.fixed} />
      </SaveSection>
      <ConfirmDialog
        isOpen={general.confirming}
        title={general.dialog.title}
        consequence={general.dialog.consequence}
        confirmLabel={general.dialog.confirmLabel}
        tone="danger"
        typed={tenant}
        busy={s.saving}
        onConfirm={general.confirm}
        onCancel={general.cancel}
      />
    </>
  );
}

// A link to a section, opened in another tab or after a reload, lands on it.
function useHashTarget(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const hash = globalThis.location.hash.slice(1);
    document.getElementById(hash)?.focus();
  }, [ready]);
}

function sectionOf(headingId: string): Element | null {
  return document.getElementById(headingId)?.closest('section') ?? null;
}

function Sections({ tenant }: { tenant: string }) {
  const { read, plans, nav, words } = useSettingsSections(tenant);
  const current = useCurrentSection(nav, sectionOf);
  useHashTarget(read.data !== undefined);
  return (
    <ReadGate read={read} label={words.loading} fields={4} failed={words.failed}>
      {(data, etag) => (
        <div className={styles.frame}>
          <div className={styles.page}>
            <SectionNav label={words.navLabel} groups={nav} current={current} />
            <div className={styles.sections}>
              {plans.map((plan) =>
                plan.kind === 'general' ? (
                  <General
                    key={plan.section.id}
                    tenant={tenant}
                    data={data}
                    etag={etag}
                    gone={read.gone}
                    plan={plan}
                  />
                ) : (
                  <Fragment key={plan.section.id}>
                    <Plain tenant={tenant} data={data} etag={etag} gone={read.gone} plan={plan} />
                    {plan.kind === 'lockouts' ? <ClearLockouts tenant={tenant} /> : null}
                  </Fragment>
                ),
              )}
            </div>
          </div>
        </div>
      )}
    </ReadGate>
  );
}

export function SettingsPage({ tenant }: { tenant: string }) {
  const { area, title, words } = useSettingsPage();
  return (
    <AreaGate tenant={tenant} area={area} title={title}>
      <PageHeader kicker={tenant} title={title} description={words.description} />
      <Sections tenant={tenant} />
    </AreaGate>
  );
}

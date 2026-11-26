import type { Settings } from '#/entities/tenant';
import { Fragment } from 'react';
import { AreaGate } from '#/widgets/shell';
import type { SectionPlan } from '#/pages/settings/services/sectionPlan';
import { usePasswordNote } from '#/pages/settings/use-cases/usePasswordNote';
import { useHashFocus } from '#/pages/settings/use-cases/useHashFocus';
import { useCurrentSection } from '#/pages/settings/use-cases/useCurrentSection';
import { useSettingsPage } from '#/pages/settings/use-cases/useSettingsPage';
import { useSettingsSections } from '#/pages/settings/use-cases/useSettingsSections';
import {
  useGeneralSection,
  useSettingsSection,
  type SettingsSave,
} from '#/pages/settings/use-cases/useSettingsSection';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { PageHeader } from '#/shared/ui/PageHeader';
import { Note } from '#/shared/ui/Note';
import { ReadGate } from '#/shared/ui/ReadGate';
import { SaveSection } from '#/shared/ui/SaveSection';
import { ClearLockouts } from '#/pages/settings/ui/ClearLockouts';
import { AssistantSection } from '#/pages/settings/ui/AssistantSection';
import { SectionNav } from '#/pages/settings/ui/SectionNav';
import { SettingsFields } from '#/pages/settings/ui/SettingsFields';
import styles from '#/pages/settings/ui/SettingsPage/SettingsPage.module.css';

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
      <SettingsFields plan={plan} save={save} fixed={{}} />
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
        <SettingsFields plan={plan} save={s} fixed={general.fixed} />
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

function sectionOf(headingId: string): Element | null {
  return document.getElementById(headingId)?.closest('section') ?? null;
}

function focusHeading(headingId: string): void {
  document.getElementById(headingId)?.focus();
}

function Sections({ tenant }: { tenant: string }) {
  const { read, plans, nav, words, assistant } = useSettingsSections(tenant);
  const loaded = read.data !== undefined;
  const current = useCurrentSection(nav, sectionOf, loaded);
  useHashFocus(loaded, globalThis.location.hash.slice(1), focusHeading);
  return (
    <ReadGate read={read} label={words.loading} fields={4} failed={words.failed}>
      {(data, etag) => (
        <div className={styles.frame}>
          <div className={styles.page}>
            <SectionNav
              label={words.navLabel}
              unsavedLabel={words.unsaved}
              groups={nav}
              current={current}
            />
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
              <AssistantSection tenant={tenant} assistant={assistant} />
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

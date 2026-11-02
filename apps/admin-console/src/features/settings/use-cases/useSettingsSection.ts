import type { Settings } from '@odudu/contracts/admin';
import { usePrincipal, useRefusal } from '#/features/session';
import { settingsSave, type SectionValues } from '#/features/settings/repository/settingsSave';
import { disablesTenant } from '#/features/settings/services/general';
import { type SettingsSection } from '#/features/settings/services/sections';
import { settingEntries } from '#/features/settings/services/values';
import {
  useSectionSave,
  type SectionFields,
  type SectionSave,
} from '#/shared/repository/useSectionSave';
import { writeRefusal } from '#/shared/services/capabilities';
import { disableConsequence } from '#/shared/services/tenantEnabled';
import { TENANT_SETTINGS_RECORD } from '#/shared/services/tenantSettings';
import { useSaveConfirmation } from '#/shared/use-cases/useSaveConfirmation';
import { isOwnTenant } from '#/shared/services/principal';

export type SettingsSave = SectionSave<SectionValues>;

interface SectionInput {
  tenant: string;
  section: SettingsSection;
  data: Settings;
  etag: string;
  gone: boolean;
}

export function useSettingsSection({
  tenant,
  section,
  data,
  etag,
  gone,
}: SectionInput): SettingsSave {
  const refusal = useRefusal(tenant);
  const fields: SectionFields<SectionValues> = Object.fromEntries(
    settingEntries(section.fields, data).map((entry) => [
      entry.name,
      { value: entry.value, label: entry.label, kind: 'plain', describe: entry.describe },
    ]),
  );
  return useSectionSave({
    tenant,
    record: TENANT_SETTINGS_RECORD,
    section: section.id,
    label: section.title,
    etag,
    capability: 'manage-tenant',
    gone,
    refusal,
    explain: writeRefusal,
    fields,
    save: settingsSave(tenant),
  });
}

export interface GeneralSection {
  save: SettingsSave;
  // Switching the tenant off is asked about before it is saved.
  confirming: boolean;
  consequence: string;
  submit: () => boolean;
  confirm: () => void;
  cancel: () => void;
}

export function useGeneralSection(input: SectionInput): GeneralSection {
  const save = useSettingsSection(input);
  const principal = usePrincipal();
  const asking = useSaveConfirmation<true>(save);
  return {
    save,
    confirming: asking.confirming !== null,
    consequence: disableConsequence(input.tenant, isOwnTenant(principal, input.tenant)),
    submit: () => {
      if (disablesTenant(input.data.enabled, save.values.enabled)) {
        asking.ask(true);
        return false;
      }
      return save.submit();
    },
    confirm: asking.confirm,
    cancel: asking.cancel,
  };
}

import type { AssistantSettings } from '#/pages/settings/types/assistant';
import { useAuthority, useRefusal } from '#/entities/session';
import { useAssistantSave } from '#/pages/settings/repository/useAssistantSave';
import { useAssistantRead } from '#/pages/settings/repository/useAssistantRead';
import {
  ASSISTANT_HEADING_ID,
  ASSISTANT_PLAN,
  ASSISTANT_RECORD,
  ASSISTANT_SECTION,
  ASSISTANT_SECTION_ID,
  ASSISTANT_WORDS,
} from '#/pages/settings/services/assistantSection';
import {
  assistantPresence,
  mayChangeAssistant,
  mayReadAssistant,
  type AssistantPresence,
} from '#/pages/settings/services/assistantPresence';
import { settingEntries } from '#/pages/settings/services/values';
import type { SettingsSave } from '#/pages/settings/use-cases/useSettingsSection';
import { useSectionSave, type SectionFields } from '#/shared/lib/repository/useSectionSave';
import type { RecordState } from '#/shared/lib/repository/useRecord';
import { writeRefusal } from '#/shared/lib/services/capabilities';
import type { SectionValues } from '#/pages/settings/repository/settingsSave';

export interface AssistantAvailability {
  presence: AssistantPresence;
  read: RecordState<AssistantSettings>;
  // A reader who may not change: the fields show as text and there is no save.
  readOnly: boolean;
  words: typeof ASSISTANT_WORDS;
  headingId: string;
  plan: typeof ASSISTANT_PLAN;
}

// Whether the section is on the page at all, and what it reads.
export function useAssistantAvailability(tenant: string): AssistantAvailability {
  const authority = useAuthority(tenant);
  const mayRead = mayReadAssistant(authority);
  const read = useAssistantRead(tenant, mayRead);
  return {
    presence: assistantPresence({ mayRead, status: read.status, failure: read.failure }),
    read,
    readOnly: !mayChangeAssistant(authority),
    words: ASSISTANT_WORDS,
    headingId: ASSISTANT_HEADING_ID,
    plan: ASSISTANT_PLAN,
  };
}

export function useAssistantSection({
  tenant,
  data,
  etag,
  gone,
}: {
  tenant: string;
  data: AssistantSettings;
  etag: string;
  gone: boolean;
}): SettingsSave {
  const refusal = useRefusal(tenant);
  const fields: SectionFields<SectionValues> = Object.fromEntries(
    settingEntries(ASSISTANT_SECTION.fields, data).map((entry) => [
      entry.name,
      { value: entry.value, label: entry.label, kind: 'plain', describe: entry.describe },
    ]),
  );
  return useSectionSave({
    tenant,
    record: ASSISTANT_RECORD,
    section: ASSISTANT_SECTION_ID,
    label: ASSISTANT_SECTION.title,
    etag,
    capability: 'manage-assistant',
    gone,
    refusal,
    explain: writeRefusal,
    fields,
    save: useAssistantSave(tenant),
  });
}

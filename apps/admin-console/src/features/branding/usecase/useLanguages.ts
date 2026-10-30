import type { MessageOverride, Settings } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/features/session';
import { languagesSave } from '#/features/branding/repository/languagesSave';
import { useOverrideList, useOverrideWrites } from '#/features/branding/repository/useOverrides';
import { useMessageKeys } from '#/features/branding/usecase/useMessageKeys';
import {
  afterSave,
  askedRemoval,
  addLanguage,
  conflictsIn,
  editedOverride,
  EMPTY_OVERRIDE,
  filledOverride,
  formAfterSave,
  formAfterTakingTheirs,
  keepMine,
  staleOutcome,
  withConflict,
  withoutConflict,
  type OverrideConflict,
  type SentOverride,
  languageFields,
  languageSettingsOf,
  languagesOf,
  languagesHold,
  LANGUAGES_SECTION,
  LANGUAGES_TITLE,
  openingLocale,
  overrideAttempt,
  removeOutcome,
  shownLocale,
  type LanguageValues,
  type MessageEntry,
  type OverrideErrors,
  type OverrideField,
  type OverrideValues,
} from '#/features/branding/service';
import { withoutField } from '#/shared/service/fieldErrors';
import type { Read } from '#/shared/service/read';
import { useToast } from '#/shared/repository/useToasts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { writeRefusal } from '#/shared/service/capabilities';
import { TENANT_SETTINGS_RECORD } from '#/shared/service/tenantSettings';
import { useAnnouncedAction } from '#/shared/usecase/useAnnouncedAction';

export interface LanguagesInput {
  tenant: string;
  data: Settings;
  etag: string;
  gone: boolean;
}

export interface LanguagesSection {
  save: SectionSave<LanguageValues>;
  hold: string | undefined;
  // The language being typed or chosen to be added to the supported ones.
  adding: string;
  addProblem: string | undefined;
  typeAdding: (text: string) => void;
  add: () => void;
}

// The tenant's supported and default languages, saved as settings.
export function useLanguagesSection({
  tenant,
  data,
  etag,
  gone,
}: LanguagesInput): LanguagesSection {
  const refusal = useRefusal(tenant);
  const save = useSectionSave({
    tenant,
    record: TENANT_SETTINGS_RECORD,
    section: LANGUAGES_SECTION,
    label: LANGUAGES_TITLE,
    etag,
    capability: 'manage-tenant',
    gone,
    refusal,
    explain: writeRefusal,
    fields: languageFields(languagesOf(languageSettingsOf(data))),
    save: languagesSave(tenant),
  });
  const [adding, setAdding] = useState('');
  const [addProblem, setAddProblem] = useState<string | undefined>(undefined);
  return {
    save,
    hold: languagesHold(save.values),
    adding,
    addProblem,
    typeAdding: (text) => {
      setAdding(text);
      setAddProblem(undefined);
    },
    add: () => {
      addLanguage(save.values.supported_locales, adding, {
        problem: setAddProblem,
        accepted: (supported) => {
          save.edit('supported_locales', supported);
          setAdding('');
        },
      });
    },
  };
}

export type RemovedOverride = Pick<MessageOverride, 'locale' | 'key' | 'etag'>;

export interface Overrides {
  locale: string;
  pick: (locale: string) => void;
  list: ReturnType<typeof useOverrideList>;
  // Every message an override may be set under, for the key field.
  keys: Read<MessageEntry[]>;
  values: OverrideValues;
  errors: OverrideErrors;
  message: string | null;
  edit: (field: OverrideField, value: string) => void;
  fill: (override: Pick<MessageOverride, 'key' | 'message' | 'etag'>) => void;
  // Overrides of the language shown whose save met a newer version.
  conflicts: OverrideConflict[];
  resolving: boolean;
  keepMine: (conflict: OverrideConflict) => void;
  takeTheirs: (conflict: OverrideConflict) => void;
  saving: boolean;
  save: () => void;
  removing: RemovedOverride | null;
  consequence: string;
  removeBusy: boolean;
  removeProblem: string | null;
  notice: string | null;
  removed: number;
  ask: (override: RemovedOverride) => void;
  cancel: () => void;
  confirm: () => Promise<boolean>;
}

// The overrides of one language: the table, the form that sets one, and the
// removal of one.
export function useOverrides(tenant: string, data: Settings): Overrides {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const [picked, setPicked] = useState<string | null>(null);
  const languages = languageSettingsOf(data);
  const locale = shownLocale(picked, languages.supported_locales, openingLocale(languages));
  const list = useOverrideList(tenant, locale);
  const keys = useMessageKeys(tenant, null);
  const writes = useOverrideWrites(tenant);
  const [values, setValues] = useState(EMPTY_OVERRIDE);
  const [errors, setErrors] = useState<OverrideErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<OverrideConflict[]>([]);
  const action = useAnnouncedAction<RemovedOverride>({
    refusal,
    capability: 'manage-tenant',
    send: (asked) => writes.remove.run(asked),
    outcomeOf: (_asked, result) => removeOutcome(result),
  });
  const submit = (sent: SentOverride): void => {
    writes.put
      .run(sent)
      .then(async (result) => {
        const after = afterSave(result, sent, values);
        setErrors(after.errors);
        setMessage(after.message);
        setValues((was) => formAfterSave(was, sent, result.ok));
        if (after.toast !== null) toast.succeeded(after.toast);
        if (after.reported !== null) refusal.report(after.reported, 'manage-tenant');
        if (result.ok) setConflicts((held) => withoutConflict(held, sent));
        if (!after.stale) return;
        const stale = staleOutcome(sent, await writes.current(sent));
        setMessage(stale.message);
        if (stale.conflict !== null) {
          const { conflict } = stale;
          setConflicts((held) => withConflict(held, conflict));
        }
      })
      .catch(() => undefined);
  };
  return {
    locale,
    pick: setPicked,
    list,
    keys,
    values,
    errors,
    message,
    edit: (field, value) => {
      setValues((was) => editedOverride(was, field, value));
      setErrors((was) => withoutField(was, field));
    },
    fill: (override) => {
      setValues(filledOverride(override));
      setErrors({});
      setMessage(null);
    },
    saving: writes.put.busy,
    save: () => {
      const attempt = overrideAttempt(locale, values);
      setErrors(attempt.errors);
      setMessage(null);
      if (attempt.sent !== null) submit(attempt.sent);
    },
    conflicts: conflictsIn(conflicts, locale),
    resolving: writes.put.busy,
    keepMine: (conflict) => {
      submit(keepMine(conflict));
    },
    takeTheirs: (conflict) => {
      setConflicts((held) => withoutConflict(held, conflict));
      setValues((was) => formAfterTakingTheirs(was, conflict));
    },
    removing: action.asked,
    consequence: askedRemoval(action.asked),
    removeBusy: writes.remove.busy,
    removeProblem: action.problem,
    notice: action.notice,
    removed: action.done,
    ask: action.ask,
    cancel: action.cancel,
    confirm: action.confirm,
  };
}

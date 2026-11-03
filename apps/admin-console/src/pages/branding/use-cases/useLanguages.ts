import { type MessageKeys, useMessageKeys } from '#/features/branding-editor';
import type { MessageOverride } from '#/pages/branding/types/messageOverride';
import type { Settings } from '@odudu/contracts/admin';
import { useRef, useState } from 'react';
import { useRefusal } from '#/entities/session';
import { languagesSave } from '#/pages/branding/repository/languagesSave';
import { useOverrideList, useOverrideWrites } from '#/pages/branding/repository/useOverrides';
import { addLanguage, addsOnKey } from '#/pages/branding/services/addedLanguage';
import {
  ADD_WORDS,
  defaultView,
  LANGUAGES_WORDS,
  supportedView,
  type DefaultView,
  type SupportedView,
} from '#/pages/branding/services/languagesView';
import {
  conflictViews,
  formWords,
  localeView,
  OVERRIDES_WORDS,
  REMOVAL_WORDS,
  tableView,
  type ConflictView,
  type FormWords,
  type LocaleView,
  type TableView,
} from '#/pages/branding/services/overridesView';
import {
  languageFields,
  LANGUAGES_SECTION,
  LANGUAGES_TITLE,
} from '#/pages/branding/services/languagesSection';
import {
  languageSettingsOf,
  languagesOf,
  languagesHold,
  openingLocale,
  type LanguageValues,
} from '#/pages/branding/services/supportedLanguages';
import {
  conflictsAfterSave,
  conflictsIn,
  formAfterSave,
  formAfterTakingTheirs,
  keepMine,
  staleOutcome,
  conflictsOf,
  SAVE_INTERRUPTED,
  withConflict,
  withoutConflict,
  type OverrideConflict,
} from '#/pages/branding/services/overrideConflicts';
import {
  afterSave,
  settle,
  type SentOverride,
  overrideAttempt,
} from '#/pages/branding/services/overrideSaving';
import { askedRemoval, removeOutcome } from '#/pages/branding/services/overrideRemoval';
import {
  editedOverride,
  EMPTY_OVERRIDE,
  filledOverride,
  type OverrideErrors,
  type OverrideField,
  type OverrideValues,
} from '#/pages/branding/services/overrideForm';
import { shownLocale } from '#/pages/branding/services/overrideList';
import { withoutField } from '#/shared/services/fieldErrors';
import { useToast } from '#/shared/repository/useToasts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { writeRefusal } from '#/shared/services/capabilities';
import { offeredLocales, TENANT_SETTINGS_RECORD } from '#/entities/tenant';
import { useAnnouncedAction } from '#/shared/use-cases/useAnnouncedAction';

export interface LanguagesInput {
  tenant: string;
  data: Settings;
  etag: string;
  gone: boolean;
}

export interface LanguagesSection {
  save: SectionSave<LanguageValues>;
  hold: string | undefined;
  words: typeof LANGUAGES_WORDS;
  supported: { view: SupportedView; edit: (next: string[]) => void };
  // The language being typed or chosen to be added to the supported ones.
  add: {
    words: typeof ADD_WORDS;
    value: string;
    problem: string | undefined;
    type: (text: string) => void;
    press: () => void;
    // Whether a key press adds what was typed.
    keyAdds: (key: string, choosing: boolean) => boolean;
  };
  fallback: { view: DefaultView; edit: (next: string) => void };
}

// The tenant's supported and default languages, saved as settings.
export function useLanguagesSection({
  tenant,
  data,
  etag,
  gone,
}: LanguagesInput): LanguagesSection {
  const refusal = useRefusal(tenant);
  const saved = languageSettingsOf(data, offeredLocales(data));
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
    fields: languageFields(languagesOf(saved)),
    save: languagesSave(tenant),
  });
  const [adding, setAdding] = useState('');
  const [addProblem, setAddProblem] = useState<string | undefined>(undefined);
  const edit = {
    saved: saved.supported_locales,
    values: save.values,
    errors: {
      supported: save.fieldErrors.supported_locales,
      fallback: save.fieldErrors.default_locale,
    },
    changed: {
      supported: save.changed.includes('supported_locales'),
      fallback: save.changed.includes('default_locale'),
    },
  };
  return {
    save,
    hold: languagesHold(save.values),
    words: LANGUAGES_WORDS,
    supported: {
      view: supportedView(edit),
      edit: (next) => {
        save.edit('supported_locales', next);
      },
    },
    add: {
      words: ADD_WORDS,
      value: adding,
      problem: addProblem,
      type: (text) => {
        setAdding(text);
        setAddProblem(undefined);
      },
      press: () => {
        addLanguage(save.values.supported_locales, adding, {
          problem: setAddProblem,
          accepted: (supported) => {
            save.edit('supported_locales', supported);
            setAdding('');
          },
        });
      },
      keyAdds: addsOnKey,
    },
    fallback: {
      view: defaultView(edit),
      edit: (next) => {
        save.edit('default_locale', next);
      },
    },
  };
}

export type RemovedOverride = Pick<MessageOverride, 'locale' | 'key' | 'etag'>;

export interface Overrides {
  words: typeof OVERRIDES_WORDS;
  locale: LocaleView & { pick: (locale: string) => void };
  form: {
    words: FormWords;
    // Every message an override may be set under, for the key field.
    keys: MessageKeys;
    values: OverrideValues;
    errors: OverrideErrors;
    message: string | null;
    saving: boolean;
    edit: (field: OverrideField, value: string) => void;
    save: () => void;
  };
  table: {
    list: ReturnType<typeof useOverrideList>;
    view: TableView;
    fill: (override: Pick<MessageOverride, 'key' | 'message' | 'etag'>) => void;
  };
  // Overrides of the language shown whose save met a newer version.
  conflicts: {
    items: ConflictView[];
    resolving: boolean;
    keepMine: (conflict: OverrideConflict) => void;
    takeTheirs: (conflict: OverrideConflict) => void;
  };
  removal: {
    words: typeof REMOVAL_WORDS;
    removing: RemovedOverride | null;
    consequence: string;
    busy: boolean;
    problem: string | null;
    notice: string | null;
    count: number;
    ask: (override: RemovedOverride) => void;
    cancel: () => void;
    confirm: () => Promise<boolean>;
  };
}

// The overrides of one language: the table, the form that sets one, and the
// removal of one.
export function useOverrides(tenant: string, data: Settings): Overrides {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const [picked, setPicked] = useState<string | null>(null);
  const languages = languageSettingsOf(data, offeredLocales(data));
  const locale = shownLocale(picked, languages.supported_locales, openingLocale(languages));
  const list = useOverrideList(tenant, locale);
  const keys = useMessageKeys(tenant, null);
  const writes = useOverrideWrites(tenant);
  const [values, setValues] = useState(EMPTY_OVERRIDE);
  const [errors, setErrors] = useState<OverrideErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<readonly OverrideConflict[]>([]);
  // A save is under way from its first request to the end of the read that
  // follows a refusal, so a second press in between is not another save.
  const [submitting, setSubmitting] = useState(false);
  const action = useAnnouncedAction<RemovedOverride>({
    refusal,
    capability: 'manage-tenant',
    send: (asked) => writes.remove.run(asked),
    outcomeOf: (_asked, result) => removeOutcome(result),
  });
  // Set at once, where `submitting` is read only after a render, so a submit
  // that arrives before the next render (the form's Enter, a second press) is
  // still known to be a second one.
  const underway = useRef(false);
  const submit = (sent: SentOverride): void => {
    if (underway.current) return;
    underway.current = true;
    setSubmitting(true);
    writes.put
      .run(sent)
      .then(async (result) => {
        const after = afterSave(result, sent, values);
        setErrors(after.errors);
        setMessage(after.message);
        setValues((was) => formAfterSave(was, sent, result.ok));
        settle(after).forEach((step) => {
          if (step.kind === 'toast') toast.succeeded(step.text);
          else refusal.report(step.failure, 'manage-tenant');
        });
        setConflicts((held) => conflictsAfterSave(held, sent, result.ok));
        if (!after.stale) return;
        const stale = staleOutcome(sent, await writes.current(sent));
        setMessage(stale.message);
        conflictsOf(stale).forEach((conflict) => {
          setConflicts((held) => withConflict(held, conflict));
        });
      })
      .catch(() => {
        setMessage(SAVE_INTERRUPTED);
      })
      .finally(() => {
        underway.current = false;
        setSubmitting(false);
      });
  };
  const saving = writes.put.busy || submitting;
  return {
    words: OVERRIDES_WORDS,
    locale: { ...localeView(languages.supported_locales, locale), pick: setPicked },
    form: {
      words: formWords(saving),
      keys,
      values,
      errors,
      message,
      saving,
      edit: (field, value) => {
        setValues((was) => editedOverride(was, field, value));
        setErrors((was) => withoutField(was, field));
      },
      save: () => {
        const attempt = overrideAttempt(locale, values);
        setErrors(attempt.errors);
        setMessage(null);
        if (attempt.sent !== null) submit(attempt.sent);
      },
    },
    table: {
      list,
      view: tableView(list.rows, list.next !== null),
      fill: (override) => {
        setValues(filledOverride(override));
        setErrors({});
        setMessage(null);
      },
    },
    conflicts: {
      items: conflictViews(conflictsIn(conflicts, locale)),
      resolving: saving,
      keepMine: (conflict) => {
        submit(keepMine(conflict));
      },
      takeTheirs: (conflict) => {
        setConflicts((held) => withoutConflict(held, conflict));
        setValues((was) => formAfterTakingTheirs(was, conflict));
      },
    },
    removal: {
      words: REMOVAL_WORDS,
      removing: action.asked,
      consequence: askedRemoval(action.asked),
      busy: writes.remove.busy,
      problem: action.problem,
      notice: action.notice,
      count: action.done,
      ask: action.ask,
      cancel: action.cancel,
      confirm: action.confirm,
    },
  };
}

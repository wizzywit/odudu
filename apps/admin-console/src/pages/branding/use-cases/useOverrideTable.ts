import type { Settings } from '#/entities/tenant';
import { type MessageKeys, useMessageKeys } from '#/features/branding-editor';
import type { MessageOverride } from '#/pages/branding/types/messageOverride';
import { useRef, useState } from 'react';
import { useRefusal } from '#/entities/session';
import { useOverrideList, useOverrideWrites } from '#/pages/branding/repository/useOverrides';
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
import { languageSettingsOf, openingLocale } from '#/pages/branding/services/supportedLanguages';
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
import { withoutField } from '#/shared/lib/services/fieldErrors';
import { useToast } from '#/shared/lib/repository/useToasts';
import { offeredLocales } from '#/entities/tenant';
import { useAnnouncedAction } from '#/shared/lib/use-cases/useAnnouncedAction';

export type RemovedOverride = Pick<MessageOverride, 'locale' | 'key' | 'etag'>;

export interface OverrideTable {
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
export function useOverrideTable(tenant: string, data: Settings): OverrideTable {
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

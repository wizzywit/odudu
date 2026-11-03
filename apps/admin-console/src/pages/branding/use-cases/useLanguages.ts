import type { Settings } from '#/entities/tenant';
import { useState } from 'react';
import { useRefusal } from '#/entities/session';
import { languagesSave } from '#/pages/branding/repository/languagesSave';
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
  languageFields,
  LANGUAGES_SECTION,
  LANGUAGES_TITLE,
} from '#/pages/branding/services/languagesSection';
import {
  languageSettingsOf,
  languagesOf,
  languagesHold,
  type LanguageValues,
} from '#/pages/branding/services/supportedLanguages';
import { useSectionSave, type SectionSave } from '#/shared/lib/repository/useSectionSave';
import { writeRefusal } from '#/shared/lib/services/capabilities';
import { offeredLocales, TENANT_SETTINGS_RECORD } from '#/entities/tenant';

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

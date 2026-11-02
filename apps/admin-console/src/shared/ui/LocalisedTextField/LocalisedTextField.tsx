import type { ReactNode } from 'react';
import { languageLabel } from '#/shared/services/locales';
import {
  LANGUAGES_FAILED,
  languagesNote,
  NOT_OFFERED,
  offeredOf,
  offersTag,
  translatedSummary,
  translationTabs,
  withTranslation,
  type Translations,
} from '#/shared/services/localised';
import type { Read } from '#/shared/services/read';
import { InlineFailed } from '#/shared/ui/InlineFailed';
import { FieldGroup, TextAreaField, TextField } from '#/shared/ui/Field';
import { Note } from '#/shared/ui/Note';
import { recordTab } from '#/shared/ui/RecordTab';
import { Tabs } from '#/shared/ui/Tabs';

// A text written once in each language the tenant offers: a tab per language,
// and a language left blank is no entry, so it shows the text above it.
export function LocalisedTextField({
  label,
  description,
  languages,
  value,
  onChange,
  limit,
  multiline = false,
  error,
  changed,
}: {
  label: string;
  description?: ReactNode;
  languages: Read<string[]>;
  value: Translations;
  onChange: (next: Translations) => void;
  // Counted in a text area only; a single line has no counter.
  limit?: number;
  multiline?: boolean;
  error?: string | undefined;
  changed?: boolean;
}) {
  const note = languagesNote(languages);
  const tabs = translationTabs(offeredOf(languages), value).map((tag) => {
    // Not the group's label: a field named `Name in French` would answer a query for the base `Name` field.
    const named = `Translation into ${languageLabel(tag)}`;
    const edit = (text: string) => {
      onChange(withTranslation(value, tag, text));
    };
    return {
      id: tag,
      label: languageLabel(tag),
      panel: (
        <>
          {multiline ? (
            <TextAreaField
              label={named}
              value={value[tag] ?? ''}
              {...(limit === undefined ? {} : { limit })}
              onChange={edit}
            />
          ) : (
            <TextField label={named} value={value[tag] ?? ''} onChange={edit} />
          )}
          {offersTag(languages, tag) ? null : <Note>{NOT_OFFERED}</Note>}
        </>
      ),
    };
  });
  return (
    <FieldGroup
      label={label}
      {...(description === undefined ? {} : { description })}
      error={error}
      {...(changed === undefined ? {} : { changed })}
    >
      {languages.status === 'failed' && !languages.refused ? (
        <InlineFailed message={LANGUAGES_FAILED} retry={languages.retry} />
      ) : (
        <div role="status">{note === null ? null : <p className={recordTab.rule}>{note}</p>}</div>
      )}
      {tabs.length === 0 ? null : <Tabs label={`${label}, by language`} tabs={tabs} />}
      <p className={recordTab.rule}>{translatedSummary(value)}</p>
    </FieldGroup>
  );
}

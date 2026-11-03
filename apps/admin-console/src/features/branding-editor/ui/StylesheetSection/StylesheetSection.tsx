import type { Stylesheet } from '#/features/branding-editor/use-cases/useStylesheet';
import { InsertPicker } from '#/features/branding-editor/ui/OptionPicker';
import { CodeField } from '#/shared/ui/CodeField';
import { SaveSection } from '#/shared/ui/SaveSection';

export function StylesheetSection({ stylesheet }: { stylesheet: Stylesheet }) {
  const { save, problems, words, selectors, values } = stylesheet;
  return (
    <SaveSection
      title={words.title}
      description={words.lead}
      blocked={stylesheet.blocked}
      save={save}
    >
      <CodeField
        label={words.label}
        description={words.description}
        language="css"
        tools={
          <>
            <InsertPicker
              options={selectors.options}
              wording={selectors.wording}
              limit={selectors.limit}
              label={selectors.label}
              description={selectors.description}
            />
            <InsertPicker
              options={values.options}
              wording={values.wording}
              limit={values.limit}
              label={values.label}
              description={values.description}
            />
          </>
        }
        value={stylesheet.text}
        size={stylesheet.size}
        issues={problems.lines}
        error={problems.message}
        changed={stylesheet.changed}
        onChange={stylesheet.edit}
      />
    </SaveSection>
  );
}

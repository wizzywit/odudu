import type { ThemeView } from '#/features/branding/types/theme';
import {
  STYLESHEET_SECTION_TITLE,
  STYLESHEET_LABEL,
  STYLESHEET_LEAD,
} from '#/features/branding/services/stylesheet';
import type { ThemeScope } from '#/features/branding/services/themeScope';
import {
  SELECTORS_FAILED,
  SELECTORS_LABEL,
  SELECTORS_LOADING,
  SELECTORS_NOTE,
  VALUES_FAILED,
  VALUES_LABEL,
  VALUES_LOADING,
  VALUES_NOTE,
} from '#/features/branding/services/selectors';
import { LIST_LIMIT } from '#/features/branding/services/catalogue';
import { sourceReading } from '#/features/branding/services/sources';
import { useDesignValues, useSelectors } from '#/features/branding/use-cases/useSelectors';
import type { Stylesheet } from '#/features/branding/use-cases/useStylesheet';
import { InsertPicker } from '#/features/branding/ui/OptionPicker';
import { CodeField } from '#/shared/ui/CodeField';
import { SaveSection } from '#/shared/ui/SaveSection';

const WORDING = { loading: SELECTORS_LOADING, failed: SELECTORS_FAILED };
const VALUES_WORDING = { loading: VALUES_LOADING, failed: VALUES_FAILED };

export function StylesheetSection({
  tenant,
  scope,
  view,
  stylesheet,
}: {
  tenant: string;
  scope: ThemeScope;
  view: ThemeView;
  stylesheet: Stylesheet;
}) {
  const { save, problems } = stylesheet;
  const selectors = useSelectors(tenant);
  const values = useDesignValues(tenant);
  return (
    <SaveSection
      title={STYLESHEET_SECTION_TITLE}
      description={STYLESHEET_LEAD}
      blocked={stylesheet.blocked}
      save={save}
    >
      <CodeField
        label={STYLESHEET_LABEL}
        description={`${sourceReading(scope, view, 'stylesheet')}.`}
        language="css"
        tools={
          <>
            <InsertPicker
              options={selectors}
              wording={WORDING}
              limit={LIST_LIMIT}
              label={SELECTORS_LABEL}
              description={SELECTORS_NOTE}
            />
            <InsertPicker
              options={values}
              wording={VALUES_WORDING}
              limit={LIST_LIMIT}
              label={VALUES_LABEL}
              description={VALUES_NOTE}
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

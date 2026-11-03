import type { ThemeView } from '@odudu/contracts/admin';
import { STYLESHEET_SECTION_TITLE } from '#/features/branding/services/fields';
import { type ThemeScope } from '#/features/branding/services/themeScope';
import {
  SELECTOR_LIST_LIMIT,
  SELECTORS_FAILED,
  SELECTORS_LABEL,
  SELECTORS_LOADING,
  SELECTORS_NOTE,
  VALUES_FAILED,
  VALUES_LABEL,
  VALUES_LOADING,
  VALUES_NOTE,
} from '#/features/branding/services/selectors';
import { sourceReading } from '#/features/branding/services/sources';
import { STYLESHEET_LABEL, STYLESHEET_LEAD } from '#/features/branding/services/stylesheet';
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
              limit={SELECTOR_LIST_LIMIT}
              label={SELECTORS_LABEL}
              description={SELECTORS_NOTE}
            />
            <InsertPicker
              options={values}
              wording={VALUES_WORDING}
              limit={SELECTOR_LIST_LIMIT}
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

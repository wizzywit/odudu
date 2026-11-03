import type { Settings } from '@odudu/contracts/admin';
import { useLanguagesSection } from '#/pages/branding/use-cases/useLanguages';
import { OverridesSection } from '#/pages/branding/ui/OverridesSection';
import { useLanguagesTab } from '#/pages/branding/use-cases/useLanguagesTab';
import { Button } from '#/shared/ui/Button';
import { ChecklistField } from '#/shared/ui/ChecklistField';
import { LocaleField, SelectField } from '#/shared/ui/Field';
import { FieldGrid, GridCell } from '#/shared/ui/FieldGrid';
import { ReadGate } from '#/shared/ui/ReadGate';
import { SaveSection } from '#/shared/ui/SaveSection';
import styles from '#/pages/branding/ui/LanguagesTab/LanguagesTab.module.css';

interface Props {
  tenant: string;
  data: Settings;
  etag: string;
  gone: boolean;
}

function LanguagesSection({ tenant, data, etag, gone }: Props) {
  const { save, hold, words, supported, add, fallback } = useLanguagesSection({
    tenant,
    data,
    etag,
    gone,
  });
  return (
    <SaveSection
      title={words.title}
      headingId={words.headingId}
      description={words.lead}
      save={save}
      blocked={hold}
    >
      <FieldGrid>
        <GridCell span="full">
          <ChecklistField
            label={supported.view.label}
            description={supported.view.description}
            error={supported.view.error}
            changed={supported.view.changed}
            options={supported.view.options}
            value={supported.view.value}
            onChange={supported.edit}
          />
        </GridCell>
        <GridCell span="wide">
          <div
            role="group"
            aria-label={add.words.label}
            onKeyDown={(event) => {
              const pointed =
                event.target instanceof HTMLElement
                  ? event.target.getAttribute('aria-activedescendant')
                  : null;
              const choosing =
                pointed !== null &&
                document.getElementById(pointed)?.getAttribute('aria-selected') !== 'true';
              if (!add.keyAdds(event.key, choosing)) return;
              event.preventDefault();
              add.press();
            }}
          >
            <LocaleField
              label={add.words.label}
              description={add.words.description}
              error={add.problem}
              value={add.value}
              onChange={add.type}
            />
            <Button variant="quiet" onPress={add.press}>
              {add.words.button}
            </Button>
          </div>
        </GridCell>
        <GridCell span="wide">
          <SelectField
            label={fallback.view.label}
            description={fallback.view.description}
            error={fallback.view.error}
            changed={fallback.view.changed}
            options={fallback.view.options}
            value={fallback.view.value}
            onChange={fallback.edit}
          />
        </GridCell>
      </FieldGrid>
    </SaveSection>
  );
}

export function LanguagesTab({ tenant }: { tenant: string }) {
  const { read, words } = useLanguagesTab(tenant);
  return (
    <ReadGate read={read} label={words.loading} fields={words.fields} failed={words.failed}>
      {(data, etag) => (
        <div className={styles.tab}>
          <LanguagesSection tenant={tenant} data={data} etag={etag} gone={read.gone} />
          <OverridesSection tenant={tenant} data={data} />
        </div>
      )}
    </ReadGate>
  );
}

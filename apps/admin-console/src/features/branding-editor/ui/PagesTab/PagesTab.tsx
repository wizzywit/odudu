import type { ThemeView } from '#/features/branding-editor/types/theme';
import { useId } from 'react';
import {
  PAGE_PICKER_LABEL,
  PAGES_LEAD,
  MANIFESTS,
  PAGE_KIND_LABELS,
  PAGE_KIND_OPTIONS,
  slot,
  pageKindOf,
  type PageKind,
} from '#/features/branding-editor/services/pageKinds';
import type { PublishOutcome } from '#/features/branding-editor/services/publishOutcome';
import {
  TEMPLATES_SECTION_TITLE,
  formNote,
  MESSAGE_NOTE,
  OPTIONAL_NOTE,
  PARTS_TITLE,
  REQUIRED_NOTE,
  TEMPLATE_LABEL,
  TEMPLATE_RULES,
  TEMPLATES_INTRO,
  templateDescription,
} from '#/features/branding-editor/services/templateParts';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';
import { sourceReading } from '#/features/branding-editor/services/sources';
import { templateField } from '#/features/branding-editor/services/templateValues';
import { useMessageKeys } from '#/features/branding-editor/use-cases/useMessageKeys';
import { useRevert } from '#/features/branding-editor/use-cases/useRevert';
import { useTemplates } from '#/features/branding-editor/use-cases/useTemplates';
import { InsertMessage } from '#/features/branding-editor/ui/MessageKeyField';
import { RevertPanel } from '#/features/branding-editor/ui/PublicationPanels';
import { useFolds, type Folds } from '#/shared/use-cases/useFolds';
import { Button } from '#/shared/ui/Button';
import { CodeField } from '#/shared/ui/CodeField';
import { NativeSelectFields, SelectField } from '#/shared/ui/Field';
import { Panel } from '#/shared/ui/Panel';
import { recordTab } from '#/shared/ui/RecordTab';
import { SaveSection } from '#/shared/ui/SaveSection';
import styles from '#/features/branding-editor/ui/PagesTab/PagesTab.module.css';

function Parts({ kind, folds }: { kind: PageKind; folds: Folds }) {
  const manifest = MANIFESTS[kind];
  const inside = formNote(manifest);
  const body = useId();
  const open = folds.isOpen('parts');
  const toggle = (): void => {
    folds.toggle('parts');
  };
  return (
    <Panel title={PARTS_TITLE} headingClassName={styles.partsTitle ?? ''}>
      <div className={styles.fold}>
        <Button aria-expanded={open} aria-controls={body} onPress={toggle}>
          <span>{PARTS_TITLE}</span>
          <span aria-hidden="true">{open ? '▴' : '▾'}</span>
        </Button>
      </div>
      <div id={body} className={styles.partsBody} data-collapsed={!open || undefined}>
        <p className={recordTab.rule}>{TEMPLATES_INTRO}</p>
        <p className={recordTab.text}>{REQUIRED_NOTE}</p>
        <ul className={styles.parts}>
          {manifest.required.map((part) => (
            <li key={part}>
              <code>{slot(part)}</code>
            </li>
          ))}
        </ul>
        {manifest.optional.length === 0 ? null : (
          <>
            <p className={recordTab.text}>{OPTIONAL_NOTE}</p>
            <ul className={styles.parts}>
              {manifest.optional.map((part) => (
                <li key={part}>
                  <code>{slot(part)}</code>
                </li>
              ))}
            </ul>
          </>
        )}
        {inside === null ? null : <p className={recordTab.rule}>{inside}</p>}
        <p className={recordTab.rule}>{MESSAGE_NOTE}</p>
        <p className={recordTab.rule}>{TEMPLATE_RULES}</p>
      </div>
    </Panel>
  );
}

export function PagesTab({
  tenant,
  scope,
  view,
  tag,
  gone,
  kind,
  onKind,
  published,
}: {
  tenant: string;
  scope: ThemeScope;
  view: ThemeView;
  tag: string;
  gone: boolean;
  kind: PageKind;
  onKind: (kind: PageKind) => void;
  published: PublishOutcome;
}) {
  const templates = useTemplates({ tenant, scope, view, tag, gone, published });
  const { save } = templates;
  const revert = useRevert({ tenant, scope, view, tag, tab: 'pages' });
  const keys = useMessageKeys(tenant, kind);
  const folds = useFolds();
  const problems = templates.problems(kind);
  return (
    <div className={styles.tab}>
      <SaveSection
        title={TEMPLATES_SECTION_TITLE}
        description={PAGES_LEAD}
        save={save}
        blocked={templates.blocked}
      >
        {/* The browser's own select: a phone opens its picker, and a page of
            six or so has no need of a search. */}
        <NativeSelectFields>
          <SelectField
            label={PAGE_PICKER_LABEL}
            options={PAGE_KIND_OPTIONS}
            value={kind}
            onChange={(id) => {
              const next = pageKindOf(id);
              if (next !== undefined) onKind(next);
            }}
          />
        </NativeSelectFields>
        <CodeField
          key={kind}
          wrap={{
            on: folds.isOpen('wrap'),
            toggle: () => {
              folds.toggle('wrap');
            },
          }}
          label={`${PAGE_KIND_LABELS[kind]}: ${TEMPLATE_LABEL.toLowerCase()}`}
          description={`${sourceReading(scope, view, templateField(kind))}. ${templateDescription()}`}
          language="template"
          tools={<InsertMessage keys={keys} />}
          value={templates.text(kind)}
          size={templates.size(kind)}
          issues={problems.lines}
          error={problems.message}
          changed={templates.changed(kind)}
          onChange={(text) => {
            templates.edit(kind, text);
          }}
        />
      </SaveSection>
      <div className={styles.revert}>
        <RevertPanel scope={scope} tab="pages" revert={revert} />
      </div>
      <Parts kind={kind} folds={folds} />
    </div>
  );
}

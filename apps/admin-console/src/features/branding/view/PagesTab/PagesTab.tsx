import type { ThemeView } from '@odudu/contracts/admin';
import {
  formNote,
  MANIFESTS,
  MESSAGE_NOTE,
  OPTIONAL_NOTE,
  PAGE_KIND_LABELS,
  PAGE_KIND_OPTIONS,
  PAGE_PICKER_LABEL,
  PAGES_LEAD,
  PARTS_TITLE,
  REQUIRED_NOTE,
  slot,
  sourceReading,
  TEMPLATE_LABEL,
  TEMPLATE_RULES,
  TEMPLATES_INTRO,
  TEMPLATES_SECTION_TITLE,
  templateDescription,
  templateField,
  pageKindOf,
  type PageKind,
  type PublishOutcome,
  type ThemeScope,
} from '#/features/branding/service';
import { useMessageKeys } from '#/features/branding/usecase/useMessageKeys';
import { useRevert } from '#/features/branding/usecase/useRevert';
import { useTemplates } from '#/features/branding/usecase/useTemplates';
import { InsertMessage } from '#/features/branding/view/MessageKeyField';
import { RevertPanel } from '#/features/branding/view/PublicationPanels';
import { CodeField } from '#/shared/view/CodeField';
import { NativeSelectFields, SelectField } from '#/shared/view/Field';
import { Panel } from '#/shared/view/Panel';
import { recordTab } from '#/shared/view/RecordTab';
import { SaveSection } from '#/shared/view/SaveSection';
import styles from '#/features/branding/view/PagesTab/PagesTab.module.css';

function Parts({ kind }: { kind: PageKind }) {
  const manifest = MANIFESTS[kind];
  const inside = formNote(manifest);
  return (
    <Panel title={PARTS_TITLE}>
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
  const problems = templates.problems(kind);
  return (
    <div className={styles.tab}>
      <SaveSection title={TEMPLATES_SECTION_TITLE} description={PAGES_LEAD} save={save}>
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
      <Parts kind={kind} />
    </div>
  );
}

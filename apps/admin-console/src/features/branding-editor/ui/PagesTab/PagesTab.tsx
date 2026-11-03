import { useId } from 'react';
import type { PartsView } from '#/features/branding-editor/services/pagesTab';
import type { PageKind } from '#/features/branding-editor/services/pageKinds';
import type { PublishOutcome } from '#/features/branding-editor/services/publishOutcome';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';
import { usePagesTab } from '#/features/branding-editor/use-cases/usePagesTab';
import { InsertMessage } from '#/features/branding-editor/ui/MessageKeyField';
import { RevertPanel } from '#/features/branding-editor/ui/PublicationPanels';
import type { ThemeView } from '#/features/branding-editor/types/theme';
import { Button } from '#/shared/ui/Button';
import { CodeField } from '#/shared/ui/CodeField';
import { NativeSelectFields, SelectField } from '#/shared/ui/Field';
import { Panel } from '#/shared/ui/Panel';
import { recordTab } from '#/shared/ui/RecordTab';
import { SaveSection } from '#/shared/ui/SaveSection';
import styles from '#/features/branding-editor/ui/PagesTab/PagesTab.module.css';

function PartList({ parts }: { parts: string[] }) {
  return (
    <ul className={styles.parts}>
      {parts.map((part) => (
        <li key={part}>
          <code>{part}</code>
        </li>
      ))}
    </ul>
  );
}

function Parts({ parts, toggle }: { parts: PartsView; toggle: () => void }) {
  const body = useId();
  const { optional } = parts;
  return (
    <Panel title={parts.title} headingClassName={styles.partsTitle ?? ''}>
      <div className={styles.fold}>
        <Button aria-expanded={parts.open} aria-controls={body} onPress={toggle}>
          <span>{parts.title}</span>
          <span aria-hidden="true">{parts.open ? '▴' : '▾'}</span>
        </Button>
      </div>
      <div id={body} className={styles.partsBody} data-collapsed={!parts.open || undefined}>
        <p className={recordTab.rule}>{parts.intro}</p>
        <p className={recordTab.text}>{parts.required.note}</p>
        <PartList parts={parts.required.parts} />
        {optional === null ? null : (
          <>
            <p className={recordTab.text}>{optional.note}</p>
            <PartList parts={optional.parts} />
          </>
        )}
        {parts.inside === null ? null : <p className={recordTab.rule}>{parts.inside}</p>}
        {parts.notes.map((note) => (
          <p key={note} className={recordTab.rule}>
            {note}
          </p>
        ))}
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
  const tab = usePagesTab({ tenant, scope, view, tag, gone, kind, onKind, published });
  const { section, words, editor } = tab;
  return (
    <div className={styles.tab}>
      <SaveSection
        title={words.title}
        description={words.lead}
        save={section.save}
        blocked={section.blocked}
      >
        {/* The browser's own select: a phone opens its picker, and a page of
            six or so has no need of a search. */}
        <NativeSelectFields>
          <SelectField
            label={words.pickerLabel}
            options={words.pickerOptions}
            value={kind}
            onChange={tab.choose}
          />
        </NativeSelectFields>
        <CodeField
          key={kind}
          wrap={editor.wrap}
          label={editor.words.label}
          description={editor.words.description}
          language="template"
          tools={<InsertMessage keys={editor.keys} />}
          value={editor.text}
          size={editor.size}
          issues={editor.problems.lines}
          error={editor.problems.message}
          changed={editor.changed}
          onChange={editor.edit}
        />
      </SaveSection>
      <div className={styles.revert}>
        <RevertPanel revert={tab.revert} />
      </div>
      <Parts parts={tab.parts.view} toggle={tab.parts.toggle} />
    </div>
  );
}

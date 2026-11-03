import { useId } from 'react';
import type { ContrastPanelView } from '#/features/branding-editor/services/contrast';
import type { SchemeView } from '#/features/branding-editor/services/colourSection';
import type { Colours } from '#/features/branding-editor/use-cases/useColours';
import { ColourField } from '#/features/branding-editor/ui/ColourField';
import { Button } from '#/shared/ui/Button';
import { FieldCluster, SelectField, ToggleField } from '#/shared/ui/Field';
import { FieldGrid, GridCell } from '#/shared/ui/FieldGrid';
import { Panel } from '#/shared/ui/Panel';
import { VisuallyHidden } from '#/shared/ui/VisuallyHidden';
import { recordTab } from '#/shared/ui/RecordTab';
import { SaveSection } from '#/shared/ui/SaveSection';
import { StatusTag } from '#/shared/ui/StatusTag';
import styles from '#/features/branding-editor/ui/ColoursSection/ColoursSection.module.css';

function SchemeGroup({ group, colours }: { group: SchemeView; colours: Colours }) {
  const { scheme } = group;
  const body = useId();
  return (
    <div className={styles.scheme}>
      <div className={styles.fold}>
        <Button
          aria-expanded={group.open}
          aria-controls={body}
          onPress={() => {
            colours.toggle(scheme);
          }}
        >
          <span>{group.legend}</span>
          <span aria-hidden="true">{group.open ? '▴' : '▾'}</span>
        </Button>
      </div>
      <div id={body} className={styles.body} data-collapsed={!group.open || undefined}>
        <FieldCluster label={group.legend}>
          <ToggleField
            label={group.customLabel}
            description={group.description}
            value={group.custom}
            error={group.error}
            changed={group.changed}
            onChange={(custom) => {
              colours.customise(scheme, custom);
            }}
          />
          {group.custom ? (
            <div className={styles.colours}>
              <FieldGrid>
                {group.colours.map((colour) => (
                  <GridCell key={colour.key}>
                    <ColourField
                      label={colour.label}
                      value={colour.value}
                      error={colour.error}
                      changed={colour.changed}
                      pickLabel={colour.pickLabel}
                      swatch={colour.swatch}
                      onChange={(text) => {
                        colours.setColour(scheme, colour.key, text);
                      }}
                    />
                  </GridCell>
                ))}
              </FieldGrid>
            </div>
          ) : null}
        </FieldCluster>
      </div>
    </div>
  );
}

export function ColoursSection({ colours }: { colours: Colours }) {
  const { save, font } = colours;
  return (
    <SaveSection
      title={colours.words.title}
      description={colours.words.lead}
      blocked={colours.blocked}
      save={save}
    >
      <SelectField
        label={font.label}
        description={font.description}
        options={font.options}
        value={font.value}
        error={font.error}
        changed={font.changed}
        onChange={(id) => {
          colours.setFont(id);
        }}
      />
      {colours.schemes.map((group) => (
        <SchemeGroup key={group.scheme} group={group} colours={colours} />
      ))}
    </SaveSection>
  );
}

// Every pair the palettes being edited are held to, as they stand on screen.
export function ContrastPanel({ contrast }: { contrast: ContrastPanelView }) {
  return (
    <Panel title={contrast.title}>
      <p className={recordTab.rule}>{contrast.lead}</p>
      <p className={styles.summary} data-failing={contrast.failing || undefined}>
        {contrast.summary}
      </p>
      <VisuallyHidden role="status">{contrast.verdict}</VisuallyHidden>
      {contrast.rows.length === 0 ? null : (
        <ul className={styles.pairs}>
          {contrast.rows.map((row) => (
            <li key={row.id} className={styles.pair}>
              <StatusTag tone={row.passes ? 'active' : 'danger'}>{row.tag}</StatusTag>
              <span>{row.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

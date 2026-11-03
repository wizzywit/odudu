import type { ReactNode } from 'react';
import type { Choice } from '#/shared/lib/services/choice';
import { Button } from '#/shared/ui/Button';
import { InlineFields, SelectField } from '#/shared/ui/Field';
import { Panel } from '#/shared/ui/Panel';
import { recordTab } from '#/shared/ui/RecordTab';
import styles from '#/features/scope-assignment/ui/AssignmentControls/AssignmentControls.module.css';

// Assigning a scope to a client, from either side: the picker for the other
// side as `children`, how it is assigned, and the button that does it. The
// flow reports its own failure, so a rejected press is not raised again.
export function AssignPanel({
  title,
  assignment,
  choices,
  onAssignment,
  label,
  disabled,
  onAssign,
  children,
}: {
  title: string;
  assignment: string;
  choices: readonly Choice[];
  onAssignment: (value: string) => void;
  label: string;
  disabled: boolean;
  onAssign: () => Promise<unknown>;
  children: ReactNode;
}) {
  return (
    <Panel title={title}>
      {children}
      <SelectField
        label="Assign it as"
        options={choices}
        value={assignment}
        onChange={onAssignment}
      />
      <div className={recordTab.actions}>
        <Button
          variant="primary"
          isDisabled={disabled}
          onPress={() => {
            onAssign().catch(() => undefined);
          }}
        >
          {label}
        </Button>
      </div>
    </Panel>
  );
}

export function AssignedList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className={styles.list}>
      {children}
    </ul>
  );
}

// One assignment: who it is with, how it is assigned (a select to change it,
// or its words where it cannot be changed), and a button to take it away.
export function AssignedRow({
  name,
  assignment,
  choices,
  working,
  remove,
}: {
  name: ReactNode;
  // What an assignment can be changed to.
  choices: readonly Choice[];
  assignment:
    { label: string; value: string; onChange: (value: string) => Promise<unknown> } | string;
  // Another change is on its way, so none is offered meanwhile.
  working: boolean;
  remove: { verb: string; target: string; onRemove: () => Promise<unknown> } | null;
}) {
  return (
    <li className={styles.row}>
      {name}
      {typeof assignment === 'string' ? (
        <span>{assignment}</span>
      ) : (
        <InlineFields>
          <SelectField
            label={assignment.label}
            hideLabel
            options={choices}
            value={assignment.value}
            isDisabled={working}
            onChange={(value) => {
              assignment.onChange(value).catch(() => undefined);
            }}
          />
        </InlineFields>
      )}
      {remove === null ? null : (
        <Button
          size="small"
          variant="quiet"
          isDisabled={working}
          aria-label={`${remove.verb} ${remove.target}`}
          onPress={() => {
            remove.onRemove().catch(() => undefined);
          }}
        >
          {remove.verb}
        </Button>
      )}
    </li>
  );
}

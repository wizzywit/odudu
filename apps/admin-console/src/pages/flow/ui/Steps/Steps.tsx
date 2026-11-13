import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import type { FlowWords } from '#/pages/flow/services/flowWording';
import type { Direction } from '#/pages/flow/services/steps';
import type { StepEditing } from '#/pages/flow/use-cases/useStepEditing';
import { Button } from '#/shared/ui/Button';
import { InlineFields, SelectField } from '#/shared/ui/Field';
import { SaveSection } from '#/shared/ui/SaveSection';
import styles from '#/pages/flow/ui/Steps/Steps.module.css';

export type StepsSave = ComponentProps<typeof SaveSection>['save'] & {
  fieldErrors: Readonly<{ steps?: string | undefined }>;
};

function Add({ flow, words }: { flow: StepEditing; words: FlowWords['steps'] }) {
  if (flow.offered.length === 0) {
    return <p className={styles.rule}>{words.allAdded}</p>;
  }
  return (
    <div className={styles.add}>
      <SelectField
        label={words.addLabel}
        options={flow.offered}
        value={flow.adding}
        onChange={flow.chooseAddition}
      />
      <SelectField
        label={words.addRequirementLabel}
        options={words.requirements}
        value={flow.addingRequirement}
        onChange={flow.chooseAdditionRequirement}
      />
      <Button onPress={flow.add}>{words.addButton}</Button>
    </div>
  );
}

export function Steps({
  flow,
  words,
  lead,
}: {
  flow: StepEditing & { save: StepsSave };
  words: FlowWords['steps'];
  // Fields of the section that sit above the list of steps.
  lead?: ReactNode;
}) {
  const s = flow.save;
  const list = useRef<HTMLOListElement>(null);
  const moving = useRef<{ authenticator: string; direction: Direction } | null>(null);
  // A moved step keeps the focus, and when it cannot go further in that
  // direction the focus goes to the way back.
  useEffect(() => {
    const target = moving.current;
    moving.current = null;
    if (target === null) return;
    const row = flow.rows.find((each) => each.authenticator === target.authenticator);
    if (row === undefined) return;
    const press = (label: string): HTMLButtonElement | null =>
      list.current?.querySelector<HTMLButtonElement>(`button[aria-label="${CSS.escape(label)}"]`) ??
      null;
    const same = press(target.direction === 'up' ? row.up.label : row.down.label);
    const back = press(target.direction === 'up' ? row.down.label : row.up.label);
    (same?.disabled === false ? same : back)?.focus();
  });
  const move = (authenticator: string, direction: Direction): void => {
    moving.current = { authenticator, direction };
    flow.move(authenticator, direction);
  };
  return (
    <SaveSection
      title={words.title}
      description={words.rule}
      noticeTitle={words.noticeTitle}
      save={s}
    >
      {lead}
      <ol ref={list} aria-label={words.listLabel} className={styles.steps}>
        {flow.rows.map((row) => (
          <li
            key={row.authenticator}
            className={styles.step}
            {...(row.disabled ? { 'data-disabled': '' } : {})}
          >
            <span className={styles.position} aria-hidden="true">
              {row.position}
            </span>
            <div className={styles.name}>
              <code>{row.authenticator}</code>
              <span className={styles.what}>{row.what}</span>
              <span className={styles.what}>{row.requirementWhat}</span>
              {row.otpReading === null ? null : (
                <span className={styles.otp}>{row.otpReading}</span>
              )}
            </div>
            <InlineFields>
              <SelectField
                label={row.requirementLabel}
                hideLabel
                options={words.requirements}
                value={row.requirement}
                onChange={(value) => {
                  flow.setRequirement(row.authenticator, value);
                }}
              />
            </InlineFields>
            <div className={styles.moves}>
              <Button
                size="small"
                variant="quiet"
                aria-label={row.up.label}
                isDisabled={!row.up.enabled}
                onPress={() => {
                  move(row.authenticator, 'up');
                }}
              >
                {words.up}
              </Button>
              <Button
                size="small"
                variant="quiet"
                aria-label={row.down.label}
                isDisabled={!row.down.enabled}
                onPress={() => {
                  move(row.authenticator, 'down');
                }}
              >
                {words.down}
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <Add flow={flow} words={words} />
      {s.fieldErrors.steps === undefined ? null : (
        <p role="alert" className={styles.error}>
          {s.fieldErrors.steps}
        </p>
      )}
    </SaveSection>
  );
}

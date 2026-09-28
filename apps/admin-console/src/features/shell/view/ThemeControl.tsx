import { Label, RadioButton, RadioField, RadioGroup } from 'react-aria-components';
import type { ThemeChoice } from '#/shared/service/theme.ts';
import styles from '#/features/shell/view/ThemeControl.module.css';

const CHOICES: readonly { readonly id: ThemeChoice; readonly label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export function ThemeControl({
  choice,
  onChoose,
}: {
  readonly choice: ThemeChoice;
  readonly onChoose: (choice: ThemeChoice) => void;
}) {
  return (
    <RadioGroup
      value={choice}
      orientation="horizontal"
      onChange={(value) => {
        const chosen = CHOICES.find((c) => c.id === value);
        if (chosen !== undefined) onChoose(chosen.id);
      }}
      className={styles.group ?? ''}
    >
      <Label className={styles.label ?? ''}>Theme</Label>
      <div className={styles.options}>
        {CHOICES.map((c) => (
          <RadioField key={c.id} value={c.id} className={styles.field ?? ''}>
            <RadioButton className={styles.option ?? ''}>{c.label}</RadioButton>
          </RadioField>
        ))}
      </div>
    </RadioGroup>
  );
}

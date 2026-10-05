import { Label, RadioButton, RadioField, RadioGroup } from 'react-aria-components';
import { THEME_CHOICES, themeChoice } from '#/features/shell/service.ts';
import type { ThemeChoice } from '#/shared/service/theme.ts';
import styles from '#/features/shell/view/ThemeControl/ThemeControl.module.css';

export function ThemeControl({
  choice,
  onChoose,
}: {
  choice: ThemeChoice;
  onChoose: (choice: ThemeChoice) => void;
}) {
  return (
    <RadioGroup
      value={choice}
      orientation="horizontal"
      onChange={(value) => {
        const chosen = themeChoice(value);
        if (chosen !== undefined) onChoose(chosen);
      }}
      className={styles.group ?? ''}
    >
      <Label className={styles.label ?? ''}>Theme</Label>
      <div className={styles.options}>
        {THEME_CHOICES.map((c) => (
          <RadioField key={c.id} value={c.id} className={styles.field ?? ''}>
            <RadioButton className={styles.option ?? ''}>{c.label}</RadioButton>
          </RadioField>
        ))}
      </div>
    </RadioGroup>
  );
}

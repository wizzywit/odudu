import { Label, RadioButton, RadioField, RadioGroup } from 'react-aria-components';
import type { ThemeChoice } from '#/shared/lib/services/theme';
import { useThemeChoices } from '#/widgets/shell/use-cases/useThemeChoices';
import styles from '#/widgets/shell/ui/ThemeControl/ThemeControl.module.css';

export function ThemeControl({
  choice,
  onChoose,
}: {
  choice: ThemeChoice;
  onChoose: (choice: ThemeChoice) => void;
}) {
  const { choices, themeChoice } = useThemeChoices();
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
        {choices.map((c) => (
          <RadioField key={c.id} value={c.id} className={styles.field ?? ''}>
            <RadioButton className={styles.option ?? ''}>{c.label}</RadioButton>
          </RadioField>
        ))}
      </div>
    </RadioGroup>
  );
}

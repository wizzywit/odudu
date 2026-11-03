import { Label, RadioButton, RadioField, RadioGroup } from 'react-aria-components';
import type { ThemeSetting } from '#/widgets/shell/types/themeSetting';
import styles from '#/widgets/shell/ui/ThemeControl/ThemeControl.module.css';

export function ThemeControl({ theme }: { theme: ThemeSetting }) {
  return (
    <RadioGroup
      value={theme.choice}
      orientation="horizontal"
      onChange={(value) => {
        const chosen = theme.parse(value);
        if (chosen !== undefined) theme.choose(chosen);
      }}
      className={styles.group ?? ''}
    >
      <Label className={styles.label ?? ''}>Theme</Label>
      <div className={styles.options}>
        {theme.options.map((c) => (
          <RadioField key={c.id} value={c.id} className={styles.field ?? ''}>
            <RadioButton className={styles.option ?? ''}>{c.label}</RadioButton>
          </RadioField>
        ))}
      </div>
    </RadioGroup>
  );
}

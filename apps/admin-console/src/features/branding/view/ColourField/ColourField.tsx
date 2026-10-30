import { pickLabel, swatchOf } from '#/features/branding/service';
import { TextField } from '#/shared/view/Field';
import styles from '#/features/branding/view/ColourField/ColourField.module.css';

// A colour typed as #rrggbb, with the browser's own picker beside it.
export function ColourField({
  label,
  value,
  error,
  changed,
  onChange,
}: {
  label: string;
  value: string;
  error: string | undefined;
  changed: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.colour}>
      <TextField
        label={label}
        mono
        value={value}
        error={error}
        changed={changed}
        onChange={onChange}
      />
      <input
        type="color"
        className={styles.swatch}
        aria-label={pickLabel(label)}
        value={swatchOf(value)}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

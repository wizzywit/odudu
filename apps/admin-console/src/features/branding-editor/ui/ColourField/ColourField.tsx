import { TextField } from '#/shared/ui/Field';
import styles from '#/features/branding-editor/ui/ColourField/ColourField.module.css';

// A colour typed as #rrggbb, with the browser's own picker beside it.
export function ColourField({
  label,
  value,
  error,
  changed,
  pickLabel,
  swatch,
  onChange,
}: {
  label: string;
  value: string;
  error: string | undefined;
  changed: boolean;
  pickLabel: string;
  swatch: string;
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
        aria-label={pickLabel}
        value={swatch}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

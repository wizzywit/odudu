import { use, useId } from 'react';
import { CheckboxButton, CheckboxField } from 'react-aria-components';
import { FieldGroup, FieldsReadOnly, ReadOnlyValue, type Chrome } from '#/shared/view/Field';
import styles from '#/shared/view/ChecklistField/ChecklistField.module.css';

export interface ChecklistOption {
  id: string;
  label: string;
  description?: string;
  // A fact about the option as it stands, such as another path it is held by.
  note?: string | null;
  // Why it cannot be chosen here, or nothing when it can.
  unavailable?: string | null;
}

function Option({
  option,
  checked,
  disabled,
  onChange,
}: {
  option: ChecklistOption;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  const lines = [option.description, option.note, option.unavailable].filter(
    (line): line is string => line !== undefined && line !== null && line !== '',
  );
  return (
    <CheckboxField
      isSelected={checked}
      isDisabled={disabled || (option.unavailable ?? null) !== null}
      onChange={onChange}
      {...(lines.length === 0
        ? {}
        : { 'aria-describedby': lines.map((_, i) => `${id}-${String(i)}`).join(' ') })}
      className={styles.option ?? ''}
    >
      <CheckboxButton className={styles.checkbox ?? ''}>
        <span className={styles.box} aria-hidden="true" />
        <span className={styles.label}>{option.label}</span>
      </CheckboxButton>
      {lines.map((line, i) => (
        <span
          key={line}
          id={`${id}-${String(i)}`}
          className={line === option.unavailable ? styles.unavailable : styles.line}
        >
          {line}
        </span>
      ))}
    </CheckboxField>
  );
}

// A set chosen from a short fixed list, handed back in the order offered.
export function ChecklistField({
  options,
  value,
  onChange,
  ...chrome
}: Chrome & {
  options: readonly ChecklistOption[];
  value: readonly string[];
  onChange: (value: string[]) => void;
}) {
  if (use(FieldsReadOnly)) {
    const chosen = options.filter((option) => value.includes(option.id));
    return (
      <ReadOnlyValue
        label={chrome.label}
        value={chosen.length === 0 ? 'None' : chosen.map((option) => option.label).join(', ')}
        description={chrome.description}
        changed={chrome.changed}
      />
    );
  }
  return (
    <FieldGroup {...chrome}>
      <div className={styles.options}>
        {options.map((option) => (
          <Option
            key={option.id}
            option={option}
            checked={value.includes(option.id)}
            disabled={chrome.isDisabled === true}
            onChange={(checked) => {
              const next = new Set(value);
              if (checked) next.add(option.id);
              else next.delete(option.id);
              onChange(options.map((each) => each.id).filter((id) => next.has(id)));
            }}
          />
        ))}
      </div>
    </FieldGroup>
  );
}

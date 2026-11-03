import { use } from 'react';
import {
  FieldGroup,
  FieldsReadOnly,
  NumberWithUnitField,
  ReadOnlyValue,
  ToggleField,
} from '#/shared/ui/Field';
import { recordTab } from '#/shared/ui/RecordTab';

// A duration a client may leave to a default: off, it takes the default and
// says where from; on, it is a number of seconds with its reading.
export function OptionalSecondsField({
  label,
  offLabel,
  offText,
  readText,
  rule,
  value,
  start,
  min,
  max,
  error,
  changed,
  onChange,
}: {
  label: string;
  // The toggle's label, and what the default is, said while it is off.
  offLabel: string;
  offText: string;
  // The value as a read-only page says it.
  readText: string;
  rule: string;
  value: number | null;
  // What a duration starts from when it is first given.
  start: number;
  min: number;
  max: number | undefined;
  error: string | undefined;
  changed: boolean;
  onChange: (value: number | null) => void;
}) {
  if (use(FieldsReadOnly)) {
    return (
      <ReadOnlyValue
        label={label}
        value={readText}
        description={rule}
        changed={changed}
        mono={value !== null}
      />
    );
  }
  return (
    <FieldGroup label={label} description={rule} error={error} changed={changed}>
      <ToggleField
        label={offLabel}
        value={value === null}
        onChange={(on) => {
          onChange(on ? null : start);
        }}
      />
      {value === null ? (
        <p className={recordTab.rule}>{offText}</p>
      ) : (
        <NumberWithUnitField
          label={`${label}, in seconds`}
          unit="seconds"
          minValue={min}
          {...(max === undefined ? {} : { maxValue: max })}
          value={value}
          onChange={(entered) => {
            if (!Number.isNaN(entered)) onChange(entered);
          }}
        />
      )}
    </FieldGroup>
  );
}

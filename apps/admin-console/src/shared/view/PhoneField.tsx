import { use, useState } from 'react';
import { useLocale } from 'react-aria-components';
import { composePhone, phoneProblem, splitPhone } from '#/shared/service/phone.ts';
import { callingCodeOf, countryOptions } from '#/shared/service/regions.ts';
import { ComboBoxField, type ComboOption } from '#/shared/view/ComboBoxField.tsx';
import {
  FieldGroup,
  FieldsReadOnly,
  ReadOnlyValue,
  TextField,
  type Chrome,
} from '#/shared/view/Field.tsx';
import styles from '#/shared/view/Field.module.css';

interface Typed {
  readonly value: string;
  readonly region: string | null;
  readonly national: string;
  readonly extension: string | null;
}

function callingOptions(locale: string): readonly ComboOption[] {
  return countryOptions(locale).flatMap((region) => {
    const code = callingCodeOf(region.id);
    return code === null ? [] : [{ id: region.id, label: region.label, detail: `+${code}` }];
  });
}

// Stored as E.164. The number is kept as typed while it is typed, so a
// space or a leading 0 stays in the box even though it leaves the value.
export function PhoneField({
  label,
  description,
  error,
  changed,
  isDisabled = false,
  value,
  onChange,
}: Chrome & { value: string; onChange: (value: string) => void }) {
  const { locale } = useLocale();
  const readOnly = use(FieldsReadOnly);
  const [typed, setTyped] = useState<Typed>(() => ({ value, ...splitPhone(value) }));
  let current = typed;
  if (typed.value !== value) {
    current = { value, ...splitPhone(value, typed.region) };
    setTyped(current);
  }
  if (readOnly) return <ReadOnlyValue label={label} value={value} mono />;
  const change = (region: string | null, national: string): void => {
    const next = composePhone(region, national, current.extension);
    setTyped({ value: next, region, national, extension: current.extension });
    if (next !== value) onChange(next);
  };
  const problem = phoneProblem(current.region, current.national);
  const preview = problem === null && value !== '' ? `Stored as ${value}.` : null;
  return (
    <FieldGroup
      label={label}
      description={
        preview === null && description === undefined ? undefined : (
          <>
            {preview}
            {preview !== null && description !== undefined ? ' ' : null}
            {description}
          </>
        )
      }
      error={error ?? problem ?? undefined}
      {...(changed === undefined ? {} : { changed })}
    >
      <div className={styles.phone}>
        <ComboBoxField
          label="Country"
          options={callingOptions(locale)}
          value={current.region ?? ''}
          isDisabled={isDisabled}
          autoComplete="tel-country-code"
          onChange={(region) => {
            change(region === '' ? null : region, current.national);
          }}
        />
        <TextField
          label="Number"
          type="tel"
          value={current.national}
          isDisabled={isDisabled}
          autoComplete="tel-national"
          mono
          onChange={(national) => {
            change(current.region, national);
          }}
        />
      </div>
    </FieldGroup>
  );
}

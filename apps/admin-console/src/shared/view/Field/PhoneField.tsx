import { use, useMemo, useState } from 'react';
import { useLocale } from 'react-aria-components';
import {
  callingCodeOf,
  composePhone,
  formatPhone,
  phoneProblem,
  phoneProblemPart,
  readTypedNumber,
  splitPhone,
  typingInternational,
} from '#/shared/service/phone.ts';
import { countryOptions } from '#/shared/service/regions.ts';
import { ComboBoxField, type ComboOption } from '#/shared/view/Field/ComboBoxField.tsx';
import {
  FieldGroup,
  FieldsReadOnly,
  ReadOnlyValue,
  TextField,
  type Chrome,
} from '#/shared/view/Field/Field.tsx';
import styles from '#/shared/view/Field/Field.module.css';

interface Typed {
  value: string;
  region: string | null;
  national: string;
  extension: string | null;
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
  const options = useMemo(() => callingOptions(locale), [locale]);
  const [typed, setTyped] = useState<Typed>(() => ({ value, ...splitPhone(value) }));
  let current = typed;
  if (typed.value !== value) {
    current = { value, ...splitPhone(value, typed.region) };
    setTyped(current);
  }
  if (readOnly) {
    return <ReadOnlyValue label={label} value={formatPhone(value)} mono changed={changed} />;
  }
  const change = (
    region: string | null,
    national: string,
    typedExtension?: string | null,
  ): void => {
    const extension = typedExtension === undefined ? current.extension : typedExtension;
    const pasted = readTypedNumber(national);
    const parts = pasted ?? { region, national };
    const next = composePhone(parts.region, parts.national, extension);
    setTyped({ value: next, region: parts.region, national: parts.national, extension });
    if (next !== value) onChange(next);
  };
  const typing = typingInternational(current.national);
  const problem = typing ? null : phoneProblem(current.region, current.national);
  // The server's own error is about the number as a whole, so the number carries it.
  const part =
    error !== undefined
      ? 'number'
      : typing
        ? null
        : phoneProblemPart(current.region, current.national);
  const preview =
    problem === null && value !== '' && !typing
      ? `Stored as ${value}, which reads ${formatPhone(value)}.`
      : null;
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
          hideLabel
          placeholder="Country"
          options={options}
          value={current.region ?? ''}
          isDisabled={isDisabled}
          invalid={part === 'region'}
          onChange={(region) => {
            change(region === '' ? null : region, current.national);
          }}
        />
        <TextField
          label="Number"
          hideLabel
          placeholder="Number"
          type="tel"
          value={current.national}
          isDisabled={isDisabled}
          autoComplete="tel-national"
          invalid={part === 'number'}
          mono
          onChange={(national) => {
            change(current.region, national);
          }}
        />
        <TextField
          label="Extension"
          hideLabel
          placeholder="Extension"
          autoComplete="tel-extension"
          value={current.extension ?? ''}
          inputMode="numeric"
          isDisabled={isDisabled}
          mono
          onChange={(extension) => {
            const digits = extension.replace(/[^0-9]/gu, '');
            change(current.region, current.national, digits === '' ? null : digits);
          }}
        />
      </div>
    </FieldGroup>
  );
}

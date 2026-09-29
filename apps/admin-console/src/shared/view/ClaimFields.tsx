import { isValidZoneinfo } from '@odudu/contracts';
import { use, useMemo, useState } from 'react';
import { useLocale } from 'react-aria-components';
import { localeName, localeOptions, localeProblem } from '#/shared/service/locales.ts';
import {
  countryOptions,
  englishCountryName,
  regionOfCountryName,
} from '#/shared/service/regions.ts';
import { offsetOf, timeZoneOptions } from '#/shared/service/zones.ts';
import { ComboBoxField } from '#/shared/view/ComboBoxField.tsx';
import {
  FieldsReadOnly,
  ReadOnlyValue,
  SelectField,
  TextField,
  type Chrome,
} from '#/shared/view/Field.tsx';
import styles from '#/shared/view/Field.module.css';

type ClaimFieldProps = Chrome & { value: string; onChange: (value: string) => void };

// OIDC Core §5.1.1 names the country, so the English name is stored; the
// list reads in the reader's language, and a name it does not hold is kept.
export function CountryField({ value, onChange, ...chrome }: ClaimFieldProps) {
  const { locale } = useLocale();
  const options = useMemo(() => countryOptions(locale), [locale]);
  const region = regionOfCountryName(value);
  return (
    <ComboBoxField
      {...chrome}
      options={options}
      value={region ?? value}
      allowsCustomValue
      autoComplete="country-name"
      onChange={(chosen) => {
        onChange(options.some((o) => o.id === chosen) ? englishCountryName(chosen) : chosen);
      }}
    />
  );
}

export function TimeZoneField({ value, onChange, error, ...chrome }: ClaimFieldProps) {
  const options = useMemo(() => timeZoneOptions(new Date()), []);
  const problem =
    value === '' || isValidZoneinfo(value)
      ? undefined
      : 'Choose a zone from the list, such as Africa/Lagos.';
  const offset = value === '' || !isValidZoneinfo(value) ? null : safeOffset(value);
  return (
    <ComboBoxField
      {...chrome}
      error={error ?? problem}
      options={options}
      value={value}
      allowsCustomValue
      mono
      readOnlyText={offset === null ? value : `${value} · ${offset}`}
      onChange={onChange}
    />
  );
}

function safeOffset(zone: string): string | null {
  try {
    return offsetOf(zone, new Date());
  } catch {
    return null;
  }
}

export function LocaleField({ value, onChange, error, ...chrome }: ClaimFieldProps) {
  const { locale } = useLocale();
  const options = useMemo(() => localeOptions(locale, locale), [locale]);
  const problem = localeProblem(value) ?? undefined;
  return (
    <ComboBoxField
      {...chrome}
      error={error ?? problem}
      options={options}
      value={value}
      allowsCustomValue
      autoComplete="language"
      readOnlyText={
        value === '' || problem !== undefined ? value : `${localeName(value, locale)} · ${value}`
      }
      onChange={onChange}
    />
  );
}

const GENDERS = [
  { id: 'unset', label: 'Not given' },
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
  { id: 'own', label: 'In their own words' },
] as const;

type GenderChoice = (typeof GENDERS)[number]['id'];

function choiceOf(value: string, describing: boolean): GenderChoice {
  if (value === 'female' || value === 'male') return value;
  return value !== '' || describing ? 'own' : 'unset';
}

// OIDC names female and male, and lets any other value stand when neither
// applies; that one is typed in the subject's own words.
export function GenderField({
  label,
  description,
  error,
  changed,
  isDisabled = false,
  value,
  onChange,
}: ClaimFieldProps) {
  const readOnly = use(FieldsReadOnly);
  const [describing, setDescribing] = useState(false);
  const choice = choiceOf(value, describing);
  if (readOnly) {
    return (
      <ReadOnlyValue
        label={label}
        value={
          choice === 'own'
            ? value
            : choice === 'unset'
              ? ''
              : GENDERS.find((g) => g.id === choice)?.label
        }
      />
    );
  }
  return (
    <div className={styles.parts}>
      <SelectField
        label={label}
        {...(description === undefined ? {} : { description })}
        {...(changed === undefined ? {} : { changed })}
        error={choice === 'own' ? undefined : error}
        isDisabled={isDisabled}
        options={GENDERS}
        value={choice}
        autoComplete="sex"
        onChange={(next) => {
          setDescribing(next === 'own');
          if (next === 'female' || next === 'male') onChange(next);
          else if (next === 'unset' || choice !== 'own') onChange('');
        }}
      />
      {choice === 'own' ? (
        <TextField
          label="Their words"
          value={value}
          error={error}
          isDisabled={isDisabled}
          autoComplete="sex"
          onChange={onChange}
        />
      ) : null}
    </div>
  );
}

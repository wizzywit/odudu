import { use, useMemo, useState } from 'react';
import { useLocale } from 'react-aria-components';
import {
  localeName,
  localeOptions,
  localeProblem,
  typingLocale,
} from '#/shared/service/locales.ts';
import {
  countryOptions,
  englishCountryName,
  regionOfCountryName,
} from '#/shared/service/regions.ts';
import { offsetOf, timeZoneOptions, zoneProblem } from '#/shared/service/zones.ts';
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
      matchIds={false}
      autoComplete="country-name"
      onChange={(chosen) => {
        onChange(options.some((o) => o.id === chosen) ? englishCountryName(chosen) : chosen);
      }}
    />
  );
}

export function TimeZoneField({ value, onChange, error, ...chrome }: ClaimFieldProps) {
  const options = useMemo(() => timeZoneOptions(new Date()), []);
  const problem = zoneProblem(value) ?? undefined;
  const offset = value === '' || problem !== undefined ? null : safeOffset(value);
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
  const problem = typingLocale(value, options) ? undefined : (localeProblem(value) ?? undefined);
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
  if (describing) return 'own';
  if (value === 'female' || value === 'male') return value;
  return value !== '' ? 'own' : 'unset';
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
  const [words, setWords] = useState<{ value: string; text: string }>({ value, text: value });
  const choice = choiceOf(value, describing);
  let typed = words;
  if (words.value !== value) {
    typed = { value, text: value };
    setWords(typed);
  }
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
        changed={changed}
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
          value={typed.text}
          error={error}
          isDisabled={isDisabled}
          autoComplete="sex"
          onChange={(text) => {
            setWords({ value, text });
          }}
          onBlur={() => {
            if (typed.text === value) return;
            setWords({ value: typed.text, text: typed.text });
            onChange(typed.text);
          }}
        />
      ) : null}
    </div>
  );
}

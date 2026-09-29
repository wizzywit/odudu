import { CalendarDate, getLocalTimeZone, today } from '@internationalized/date';
import { use, useState } from 'react';
import {
  DateField,
  DateInput,
  DateSegment,
  Input,
  Label,
  NumberField,
  RadioButton,
  RadioField,
  RadioGroup,
  useLocale,
  type DateValue,
} from 'react-aria-components';
import {
  composeBirthdate,
  convertBirthdate,
  daysIn,
  formOf,
  readBirthdate,
  type Birthdate,
  type BirthdateForm,
} from '#/shared/service/birthdate.ts';
import {
  FieldGroup,
  FieldsReadOnly,
  ReadOnlyValue,
  SelectField,
  type Chrome,
} from '#/shared/view/Field.tsx';
import styles from '#/shared/view/Field.module.css';

const FORMS: readonly { readonly id: BirthdateForm; readonly label: string }[] = [
  { id: 'date', label: 'Full date' },
  { id: 'year', label: 'Year only' },
  { id: 'no-year', label: 'Day and month' },
];

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function spoken(birthdate: Birthdate, locale: string): string {
  switch (birthdate.kind) {
    case 'empty':
      return '';
    case 'other':
      return birthdate.raw;
    case 'year':
      return String(birthdate.year);
    case 'date':
      return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
        utc(birthdate.year, birthdate.month, birthdate.day),
      );
    case 'no-year':
      return `${new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(utc(2000, birthdate.month, birthdate.day))}, year withheld`;
  }
}

function monthOptions(locale: string) {
  const name = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, i) => ({
    id: String(i + 1),
    label: name.format(utc(2000, i + 1, 1)),
  }));
}

function dayOptions(month: number | null) {
  return Array.from({ length: daysIn(month ?? 1, null) }, (_, i) => ({
    id: String(i + 1),
    label: String(i + 1),
  }));
}

function FullDate({
  birthdate,
  onChange,
  isDisabled,
  invalid,
}: {
  birthdate: Birthdate;
  onChange: (next: Birthdate) => void;
  isDisabled: boolean;
  invalid: boolean;
}) {
  const value =
    birthdate.kind === 'date'
      ? new CalendarDate(birthdate.year, birthdate.month, birthdate.day)
      : null;
  return (
    <DateField
      value={value}
      onChange={(date: DateValue | null) => {
        onChange(
          date === null
            ? { kind: 'empty' }
            : { kind: 'date', year: date.year, month: date.month, day: date.day },
        );
      }}
      maxValue={today(getLocalTimeZone())}
      autoComplete="bday"
      validationBehavior="aria"
      isInvalid={invalid}
      isDisabled={isDisabled}
      className={styles.part ?? ''}
    >
      <Label className={styles.partLabel ?? ''}>Date</Label>
      <DateInput className={styles.dateInput ?? ''}>
        {(segment) => <DateSegment segment={segment} className={styles.segment ?? ''} />}
      </DateInput>
    </DateField>
  );
}

function YearOnly({
  birthdate,
  onChange,
  isDisabled,
}: {
  birthdate: Birthdate;
  onChange: (next: Birthdate) => void;
  isDisabled: boolean;
}) {
  return (
    <NumberField
      value={birthdate.kind === 'year' ? birthdate.year : Number.NaN}
      onChange={(year) => {
        onChange(Number.isNaN(year) ? { kind: 'empty' } : { kind: 'year', year });
      }}
      minValue={1}
      maxValue={new Date().getFullYear()}
      formatOptions={{ useGrouping: false, maximumFractionDigits: 0 }}
      validationBehavior="aria"
      isDisabled={isDisabled}
      className={styles.part ?? ''}
    >
      <Label className={styles.partLabel ?? ''}>Year</Label>
      <Input className={styles.input ?? ''} data-year autoComplete="bday-year" />
    </NumberField>
  );
}

function DayAndMonth({
  birthdate,
  onChange,
  isDisabled,
  locale,
}: {
  birthdate: Birthdate;
  onChange: (next: Birthdate) => void;
  isDisabled: boolean;
  locale: string;
}) {
  const [partial, setPartial] = useState<{ month: number | null; day: number | null }>({
    month: null,
    day: null,
  });
  const month = birthdate.kind === 'no-year' ? birthdate.month : partial.month;
  const day = birthdate.kind === 'no-year' ? birthdate.day : partial.day;
  const choose = (next: { month: number | null; day: number | null }): void => {
    const fits = next.day !== null && next.month !== null && next.day <= daysIn(next.month, null);
    const kept = { month: next.month, day: fits || next.month === null ? next.day : null };
    setPartial(kept);
    onChange(
      kept.month !== null && kept.day !== null
        ? { kind: 'no-year', month: kept.month, day: kept.day }
        : { kind: 'empty' },
    );
  };
  return (
    <div className={styles.parts}>
      <SelectField
        label="Month"
        options={monthOptions(locale)}
        value={month === null ? '' : String(month)}
        isDisabled={isDisabled}
        autoComplete="bday-month"
        onChange={(chosen) => {
          choose({ month: Number(chosen), day });
        }}
      />
      <SelectField
        label="Day"
        options={dayOptions(month)}
        value={day === null ? '' : String(day)}
        isDisabled={isDisabled}
        autoComplete="bday-day"
        onChange={(chosen) => {
          choose({ month, day: Number(chosen) });
        }}
      />
    </div>
  );
}

// OIDC Core §5.1 lets a birthdate be a full date, a year alone, or a day and
// month whose year is withheld (stored with the year 0000).
export function BirthdateField({
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
  const birthdate = readBirthdate(value);
  const [chosen, setChosen] = useState<BirthdateForm>(formOf(birthdate) ?? 'date');
  const form = formOf(birthdate) ?? chosen;
  if (readOnly) return <ReadOnlyValue label={label} value={spoken(birthdate, locale)} />;
  const set = (next: Birthdate): void => {
    onChange(composeBirthdate(next));
  };
  const stray =
    birthdate.kind === 'other'
      ? `Stored as ${birthdate.raw}, which names no day that exists.`
      : null;
  return (
    <FieldGroup
      label={label}
      description={
        stray === null && description === undefined ? undefined : (
          <>
            {stray}
            {stray !== null && description !== undefined ? ' ' : null}
            {description}
          </>
        )
      }
      error={error}
      {...(changed === undefined ? {} : { changed })}
    >
      <RadioGroup
        aria-label={`What is known of the ${label.toLowerCase()}`}
        orientation="horizontal"
        value={form}
        isDisabled={isDisabled}
        onChange={(next) => {
          const to = FORMS.find((f) => f.id === next)?.id ?? 'date';
          setChosen(to);
          set(convertBirthdate(birthdate, to));
        }}
        className={styles.forms ?? ''}
      >
        {FORMS.map((f) => (
          <RadioField key={f.id} value={f.id}>
            <RadioButton className={styles.form ?? ''}>{f.label}</RadioButton>
          </RadioField>
        ))}
      </RadioGroup>
      {form === 'date' ? (
        <FullDate
          birthdate={birthdate}
          onChange={set}
          isDisabled={isDisabled}
          invalid={error !== undefined}
        />
      ) : null}
      {form === 'year' ? (
        <YearOnly birthdate={birthdate} onChange={set} isDisabled={isDisabled} />
      ) : null}
      {form === 'no-year' ? (
        <DayAndMonth birthdate={birthdate} onChange={set} isDisabled={isDisabled} locale={locale} />
      ) : null}
    </FieldGroup>
  );
}

import { CalendarDate, getLocalTimeZone, today } from '@internationalized/date';
import { use, useState } from 'react';
import {
  DateField,
  DateInput,
  DateSegment,
  Label,
  useLocale,
  VisuallyHidden,
  type DateValue,
} from 'react-aria-components';
import {
  birthdateProblem,
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
  FieldGroupIds,
  FieldsReadOnly,
  OwnData,
  ownToken,
  partProps,
  ReadOnlyValue,
  SelectField,
  TextField,
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
  const group = use(FieldGroupIds);
  const own = use(OwnData);
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
      autoComplete={ownToken(own, 'bday')}
      validationBehavior="aria"
      {...partProps(group, invalid)}
      isDisabled={isDisabled}
      className={styles.part ?? ''}
    >
      <VisuallyHidden>
        <Label>Date</Label>
      </VisuallyHidden>
      <DateInput className={styles.dateInput ?? ''} data-control>
        {(segment) => <DateSegment segment={segment} className={styles.segment ?? ''} />}
      </DateInput>
    </DateField>
  );
}

// A text field rather than a NumberField, which commits only on blur or
// Enter: Enter would then submit the section before the year reached it.
function YearOnly({
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
  const year = birthdate.kind === 'year' ? birthdate.year : 0;
  const [typed, setText] = useState(year === 0 ? '' : String(year));
  // What was typed, while it still reads as the stored year; else the year.
  const text = Number(typed) === year ? typed : year === 0 ? '' : String(year);
  return (
    <div className={styles.part}>
      <TextField
        label="Year"
        hideLabel
        placeholder="YYYY"
        value={text}
        inputMode="numeric"
        isDisabled={isDisabled}
        invalid={invalid}
        autoComplete="bday-year"
        mono
        onChange={(typed) => {
          const digits = typed.replace(/[^0-9]/gu, '').slice(0, 4);
          setText(digits);
          const next = Number(digits);
          onChange(next === 0 ? { kind: 'empty' } : { kind: 'year', year: next });
        }}
      />
    </div>
  );
}

function DayAndMonth({
  birthdate,
  onChange,
  isDisabled,
  locale,
  invalid,
}: {
  birthdate: Birthdate;
  onChange: (next: Birthdate) => void;
  isDisabled: boolean;
  locale: string;
  invalid: boolean;
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
        hideLabel
        placeholder="Month"
        options={monthOptions(locale)}
        value={month === null ? '' : String(month)}
        isDisabled={isDisabled}
        invalid={invalid}
        autoComplete="bday-month"
        onChange={(chosen) => {
          choose({ month: Number(chosen), day });
        }}
      />
      <SelectField
        label="Day"
        hideLabel
        placeholder="Day"
        options={dayOptions(month)}
        value={day === null ? '' : String(day)}
        isDisabled={isDisabled}
        invalid={invalid}
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
  if (readOnly)
    return <ReadOnlyValue label={label} value={spoken(birthdate, locale)} changed={changed} />;
  const set = (next: Birthdate): void => {
    onChange(composeBirthdate(next));
  };
  const now = today(getLocalTimeZone());
  const problem = error ?? birthdateProblem(birthdate, now) ?? undefined;
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
      error={problem}
      {...(changed === undefined ? {} : { changed })}
    >
      <div className={styles.birthdate}>
        <SelectField
          label={`What is known of the ${label.toLowerCase()}`}
          hideLabel
          options={FORMS}
          value={form}
          isDisabled={isDisabled}
          onChange={(next) => {
            const to = FORMS.find((f) => f.id === next)?.id ?? 'date';
            setChosen(to);
            set(convertBirthdate(birthdate, to));
          }}
        />
        {form === 'date' ? (
          <FullDate
            birthdate={birthdate}
            onChange={set}
            isDisabled={isDisabled}
            invalid={problem !== undefined}
          />
        ) : null}
        {form === 'year' ? (
          <YearOnly
            birthdate={birthdate}
            onChange={set}
            isDisabled={isDisabled}
            invalid={problem !== undefined}
          />
        ) : null}
        {form === 'no-year' ? (
          <DayAndMonth
            birthdate={birthdate}
            onChange={set}
            isDisabled={isDisabled}
            locale={locale}
            invalid={problem !== undefined}
          />
        ) : null}
      </div>
    </FieldGroup>
  );
}

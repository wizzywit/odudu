import { use } from 'react';
import { Group, Input, NumberField as AriaNumberField, Text } from 'react-aria-components';
import { formatDuration } from '#/shared/service/format.ts';
import {
  FieldsReadOnly,
  Header,
  Message,
  ReadOnlyValue,
  VALIDATION,
  invalid,
  type Chrome,
} from '#/shared/view/Field/Field.tsx';
import styles from '#/shared/view/Field/Field.module.css';

const UNIT_SYMBOL: Readonly<Record<string, string>> = { seconds: 's' };

// Its own module, so react-aria's NumberField arrives with a page that
// edits a number rather than with every page that has a text field.
export function NumberWithUnitField({
  label,
  description,
  error,
  changed,
  isDisabled,
  value,
  onChange,
  unit,
  minValue,
  maxValue,
}: Chrome & {
  value: number;
  onChange: (value: number) => void;
  unit: string;
  minValue?: number;
  maxValue?: number;
}) {
  const reading = unit === 'seconds' ? formatDuration(value) : `${String(value)} ${unit}`;
  if (use(FieldsReadOnly)) {
    return <ReadOnlyValue label={label} value={reading} mono changed={changed} />;
  }
  return (
    <AriaNumberField
      {...VALIDATION}
      {...invalid(error)}
      isDisabled={isDisabled ?? false}
      value={value}
      onChange={onChange}
      formatOptions={{ useGrouping: false, maximumFractionDigits: 0 }}
      {...(minValue === undefined ? {} : { minValue })}
      {...(maxValue === undefined ? {} : { maxValue })}
      className={styles.field ?? ''}
      data-changed={changed === true || undefined}
    >
      <Header label={label} {...(changed === undefined ? {} : { changed })} />
      <Group className={styles.unitGroup ?? ''} data-control>
        <Input className={styles.input ?? ''} data-mono />
        <span className={styles.unit} data-unit aria-hidden="true">
          {UNIT_SYMBOL[unit] ?? unit}
        </span>
      </Group>
      <Text slot="description" className={styles.description ?? ''}>
        <span className={styles.reading}>{reading}</span>
        {description === undefined ? null : <span>{description}</span>}
      </Text>
      <Message error={error} />
    </AriaNumberField>
  );
}

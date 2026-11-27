import { use, useState } from 'react';
import {
  Button as AriaButton,
  Group,
  Input,
  ListBox,
  ListBoxItem,
  NumberField as AriaNumberField,
  Popover,
  Select,
  SelectValue,
  Text,
} from 'react-aria-components';
import {
  DURATION_UNITS,
  durationUnit,
  inUnit,
  holds,
  unitLabel,
  secondsOf,
  unitShown,
  type DurationUnit,
} from '#/shared/lib/services/durationUnits';
import { outsideRange } from '#/shared/lib/services/numbers';
import { formatDuration } from '#/shared/lib/services/format';
import {
  FieldsReadOnly,
  Header,
  Message,
  ReadOnlyValue,
  VALIDATION,
  invalid,
  type Chrome,
} from '#/shared/ui/Field/Field';
import styles from '#/shared/ui/Field/Field.module.css';

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
  picker = false,
  echo = true,
  rangeMessage,
}: Chrome & {
  value: number;
  onChange: (value: number) => void;
  unit: string;
  // The range in seconds, or in the unit given.
  minValue?: number;
  maxValue?: number;
  // Seconds entered in seconds, minutes, hours or days; the value stays seconds.
  picker?: boolean;
  // Whether the value is read back beneath the field.
  echo?: boolean;
  // Said under a picker field whose value is outside the range, before the server is asked.
  rangeMessage?: string;
}) {
  const [picked, setPicked] = useState<DurationUnit | null>(null);
  const reading =
    unit === 'seconds' || !Number.isFinite(value)
      ? formatDuration(value)
      : `${String(value)} ${unit}`;
  if (use(FieldsReadOnly)) {
    return <ReadOnlyValue label={label} value={reading} mono changed={changed} />;
  }
  const shown = unitShown(value, picked);
  const outside = picker && outsideRange(value, minValue, maxValue);
  const problem = error ?? (outside ? rangeMessage : undefined);
  return (
    <AriaNumberField
      {...VALIDATION}
      {...invalid(problem)}
      isDisabled={isDisabled ?? false}
      value={picker ? inUnit(value, shown) : value}
      onChange={(entered) => {
        // What is typed stays in the unit it was typed in, whatever it comes to.
        if (picker) setPicked(shown);
        onChange(picker ? secondsOf(entered, shown) : entered);
      }}
      formatOptions={{ useGrouping: false, maximumFractionDigits: 0 }}
      {...(minValue === undefined || picker ? {} : { minValue })}
      {...(maxValue === undefined || picker ? {} : { maxValue })}
      className={styles.field ?? ''}
      data-changed={changed === true || undefined}
    >
      <Header label={label} {...(changed === undefined ? {} : { changed })} />
      <Group className={styles.unitGroup ?? ''} data-control>
        <Input className={styles.input ?? ''} data-mono />
        {picker ? (
          <Select
            aria-label={unitLabel(label)}
            isDisabled={isDisabled ?? false}
            value={shown.id}
            onChange={(key) => {
              if (key !== null) setPicked(durationUnit(String(key)));
            }}
            disabledKeys={DURATION_UNITS.filter((each) => !holds(value, each)).map(
              (each) => each.id,
            )}
            className={styles.unitPicker ?? ''}
          >
            <AriaButton className={styles.unitSelect ?? ''} data-unit>
              <SelectValue />
              <span className={styles.chevron} aria-hidden="true">
                ▾
              </span>
            </AriaButton>
            <Popover className={styles.popover ?? ''} placement="bottom end">
              <ListBox className={styles.listbox ?? ''} items={DURATION_UNITS}>
                {(each) => (
                  <ListBoxItem id={each.id} textValue={each.id} className={styles.option ?? ''}>
                    {each.id}
                  </ListBoxItem>
                )}
              </ListBox>
            </Popover>
          </Select>
        ) : (
          <span className={styles.unit} data-unit aria-hidden="true">
            {UNIT_SYMBOL[unit] ?? unit}
          </span>
        )}
      </Group>
      {echo || description !== undefined ? (
        <Text slot="description" className={styles.description ?? ''}>
          {echo ? <span className={styles.reading}>{reading}</span> : null}
          {description === undefined ? null : <span>{description}</span>}
        </Text>
      ) : null}
      <Message error={problem} />
    </AriaNumberField>
  );
}

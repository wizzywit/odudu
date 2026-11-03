import { use, useState } from 'react';
import { Input, TextField as AriaTextField } from 'react-aria-components';
import { granularityOf, localText, readLocal } from '#/shared/lib/services/dateTime';
import { localZone, offsetOf } from '#/shared/lib/services/zones';
import {
  Description,
  FieldClusterIds,
  Header,
  invalid,
  Message,
  partProps,
  VALIDATION,
  type Chrome,
} from '#/shared/ui/Field/Field';
import styles from '#/shared/ui/Field/Field.module.css';

// A date and time in the reader's own zone, kept as the UTC instant the API
// takes: an ISO string, or empty for none. The browser's own input does the
// picking, so a day the month lacks cannot be completed, and what it cannot
// read is told apart from nothing: the field marks it invalid beside itself
// and keeps what was typed, never an empty value in its place. `edge` says
// which end of the minute an inclusive bound stands for.
export function DateTimeField({
  label,
  description,
  error,
  changed,
  isDisabled = false,
  value,
  onChange,
  edge,
  zone = localZone(),
  onProblem,
}: Chrome & {
  value: string;
  onChange: (value: string) => void;
  edge: 'start' | 'end';
  zone?: string;
  // Told why what is typed reads as no instant, or null once it does.
  onProblem?: (message: string | null) => void;
}) {
  const group = use(FieldClusterIds);
  const precision = value === '' ? 'minute' : granularityOf(value, edge);
  const [text, setText] = useState(() => (value === '' ? '' : localText(value, zone, precision)));
  const [badInput, setBadInput] = useState(false);
  const reading = readLocal(text, badInput, zone, edge, precision);
  const held = reading.kind === 'ok' ? reading.iso : '';
  // The address, back and forward change the instant under what is typed.
  if (value !== held && reading.kind !== 'problem') {
    setText(value === '' ? '' : localText(value, zone, precision));
  }
  const problem = reading.kind === 'problem' ? reading.message : null;
  const take = (input: HTMLInputElement): void => {
    const next = readLocal(input.value, input.validity.badInput, zone, edge, precision);
    setText(input.value);
    setBadInput(input.validity.badInput);
    onChange(next.kind === 'ok' ? next.iso : '');
    onProblem?.(next.kind === 'problem' ? next.message : null);
  };
  const shown = error ?? problem ?? undefined;
  return (
    <AriaTextField
      {...VALIDATION}
      {...invalid(shown)}
      {...partProps(group, undefined)}
      isDisabled={isDisabled}
      className={styles.field ?? ''}
      data-changed={changed === true || undefined}
    >
      <Header label={label} {...(changed === undefined ? {} : { changed })} />
      <Input
        type="datetime-local"
        step={precision === 'second' ? 1 : 60}
        className={styles.input ?? ''}
        data-control
        value={text}
        // Not onChange: a value that stays empty while a part is typed is no change to React.
        onInput={(event) => {
          take(event.currentTarget);
        }}
        // A browser says nothing while a first value is half typed, so what it
        // could not read is asked for once the field is left.
        onBlur={(event) => {
          take(event.currentTarget);
        }}
      />
      <Description>
        {description}
        {description === undefined ? null : ' '}
        {`In ${zone} (${offsetOf(zone, new Date())}).`}
      </Description>
      <Message error={shown} />
    </AriaTextField>
  );
}

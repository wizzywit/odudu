import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Button as AriaButton,
  FieldError,
  Group,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  NumberField as AriaNumberField,
  Popover,
  Select,
  SelectValue,
  SwitchButton,
  SwitchField,
  Text,
  TextField as AriaTextField,
  type Key,
} from 'react-aria-components';
import { formatDuration } from '#/shared/service/format.ts';
import { Button } from '#/shared/view/Button.tsx';
import styles from '#/shared/view/Field.module.css';

interface Chrome {
  readonly label: string;
  readonly description?: ReactNode;
  // What the problem detail said about this field; shown under it.
  readonly error?: string | undefined;
  readonly changed?: boolean;
  readonly isDisabled?: boolean;
}

// A server-reported error is shown as given; the browser's own constraint
// validation would otherwise block the form until the next response.
const VALIDATION = { validationBehavior: 'aria' } as const;

function invalid(error: string | undefined): { isInvalid: boolean } {
  return { isInvalid: error !== undefined };
}

function Header({ label, changed }: { readonly label: string; readonly changed?: boolean }) {
  return (
    <div className={styles.header}>
      <Label className={styles.label ?? ''}>{label}</Label>
      {changed === true ? <Changed /> : null}
    </div>
  );
}

function Changed() {
  return <span className={styles.changed}>Changed</span>;
}

function Message({ error }: { readonly error: string | undefined }) {
  return <FieldError className={styles.error ?? ''}>{error}</FieldError>;
}

function Description({ children }: { readonly children: ReactNode }) {
  if (children === undefined || children === null) return null;
  return (
    <Text slot="description" className={styles.description ?? ''}>
      {children}
    </Text>
  );
}

export function TextField({
  label,
  description,
  error,
  changed,
  isDisabled,
  value,
  onChange,
  type = 'text',
  mono = false,
  autoComplete = 'off',
  autoFocus = false,
}: Chrome & {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: 'text' | 'url' | 'email';
  readonly mono?: boolean;
  readonly autoComplete?: string;
  readonly autoFocus?: boolean;
}) {
  return (
    <AriaTextField
      {...VALIDATION}
      {...invalid(error)}
      isDisabled={isDisabled ?? false}
      value={value}
      onChange={onChange}
      type={type}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      className={styles.field ?? ''}
      data-changed={changed === true || undefined}
    >
      <Header label={label} {...(changed === undefined ? {} : { changed })} />
      <Input className={styles.input ?? ''} data-mono={mono || undefined} spellCheck={false} />
      <Description>{description}</Description>
      <Message error={error} />
    </AriaTextField>
  );
}

const UNIT_SYMBOL: Readonly<Record<string, string>> = { seconds: 's' };

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
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly unit: string;
  readonly minValue?: number;
  readonly maxValue?: number;
}) {
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
      <Group className={styles.unitGroup ?? ''}>
        <Input className={styles.input ?? ''} data-mono />
        <span className={styles.unit} data-unit aria-hidden="true">
          {UNIT_SYMBOL[unit] ?? unit}
        </span>
      </Group>
      <Text slot="description" className={styles.description ?? ''}>
        <span className={styles.reading}>
          {unit === 'seconds' ? formatDuration(value) : `${String(value)} ${unit}`}
        </span>
        {description === undefined ? null : <span>{description}</span>}
      </Text>
      <Message error={error} />
    </AriaNumberField>
  );
}

export interface SelectOption {
  readonly id: string;
  readonly label: string;
}

export function SelectField({
  label,
  description,
  error,
  changed,
  isDisabled,
  options,
  value,
  onChange,
}: Chrome & {
  readonly options: readonly SelectOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Select
      {...VALIDATION}
      {...invalid(error)}
      isDisabled={isDisabled ?? false}
      value={value}
      onChange={(key: Key | null) => {
        if (key !== null) onChange(String(key));
      }}
      className={styles.field ?? ''}
      data-changed={changed === true || undefined}
    >
      <Header label={label} {...(changed === undefined ? {} : { changed })} />
      <AriaButton className={styles.trigger ?? ''}>
        <SelectValue className={styles.selectValue ?? ''} />
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </AriaButton>
      <Description>{description}</Description>
      <Message error={error} />
      <Popover className={styles.popover ?? ''}>
        <ListBox className={styles.listbox ?? ''} items={options}>
          {(option) => (
            <ListBoxItem id={option.id} className={styles.option ?? ''}>
              {option.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}

export function ToggleField({
  label,
  description,
  error,
  changed,
  isDisabled,
  value,
  onChange,
}: Chrome & { readonly value: boolean; readonly onChange: (value: boolean) => void }) {
  return (
    <SwitchField
      {...VALIDATION}
      {...invalid(error)}
      isDisabled={isDisabled ?? false}
      isSelected={value}
      onChange={onChange}
      className={styles.field ?? ''}
      data-changed={changed === true || undefined}
    >
      <div className={styles.toggleRow}>
        <SwitchButton className={styles.switch ?? ''}>
          <span className={styles.track} aria-hidden="true">
            <span className={styles.thumb} />
          </span>
          <span className={styles.label}>{label}</span>
        </SwitchButton>
        <span className={styles.state} aria-hidden="true">
          {value ? 'On' : 'Off'}
        </span>
        {changed === true ? <Changed /> : null}
      </div>
      <Description>{description}</Description>
      <Message error={error} />
    </SwitchField>
  );
}

// After an add, focus goes into the new row; after a removal, to the add
// control, since the row that held it is gone.
function useRowFocus(count: number) {
  const root = useRef<HTMLDivElement>(null);
  const moved = useRef<'added' | 'removed' | null>(null);
  useEffect(() => {
    const change = moved.current;
    moved.current = null;
    if (change === 'added') {
      const rows = root.current?.querySelectorAll('[data-row]');
      rows?.[rows.length - 1]?.querySelector('input')?.focus();
    } else if (change === 'removed') {
      root.current?.querySelector<HTMLElement>('[data-add] button')?.focus();
    }
  }, [count]);
  return {
    root,
    added: () => {
      moved.current = 'added';
    },
    removed: () => {
      moved.current = 'removed';
    },
  };
}

interface RowIds {
  readonly ids: readonly string[];
  readonly next: number;
}

function numbered(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `row-${String(from + i)}`);
}

// Each row keeps its own id, so removing one never hands its input, focus or
// error to the row after it. A list changed from outside is renumbered.
function useRowIds(count: number) {
  const [rows, setRows] = useState<RowIds>(() => ({ ids: numbered(0, count), next: count }));
  let shown = rows;
  if (rows.ids.length !== count) {
    const kept = rows.ids.slice(0, count);
    const fresh = numbered(rows.next, count - kept.length);
    shown = { ids: [...kept, ...fresh], next: rows.next + fresh.length };
    setRows(shown);
  }
  return {
    ids: shown.ids,
    added: () => {
      setRows((r) => ({ ids: [...r.ids, ...numbered(r.next, 1)], next: r.next + 1 }));
    },
    removed: (index: number) => {
      setRows((r) => ({ ids: r.ids.filter((_, i) => i !== index), next: r.next }));
    },
  };
}

function removeName(noun: string, position: string, shows: string): string {
  return `Remove ${noun} ${position}, ${shows === '' ? 'empty' : shows}`;
}

function ListGroup({
  label,
  description,
  error,
  changed,
  children,
  addLabel,
  onAdd,
  isDisabled,
  rootRef,
}: Chrome & {
  readonly children: ReactNode;
  readonly addLabel: string;
  readonly onAdd: () => void;
  readonly rootRef: RefObject<HTMLDivElement | null>;
}) {
  const legend = useId();
  const descriptionId = useId();
  const errorId = useId();
  const describedBy = [
    description === undefined ? null : descriptionId,
    error === undefined ? null : errorId,
  ].filter((id) => id !== null);
  return (
    <div
      ref={rootRef}
      role="group"
      aria-labelledby={legend}
      {...(describedBy.length === 0 ? {} : { 'aria-describedby': describedBy.join(' ') })}
      className={styles.field}
      data-changed={changed === true || undefined}
    >
      <div className={styles.header}>
        <span id={legend} className={styles.label}>
          {label}
        </span>
        {changed === true ? <Changed /> : null}
      </div>
      <div className={styles.rows}>{children}</div>
      <div data-add>
        <Button size="small" onPress={onAdd} isDisabled={isDisabled ?? false}>
          {addLabel}
        </Button>
      </div>
      {description === undefined ? null : (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}

function RowInput({
  label,
  value,
  onChange,
  error,
  isDisabled,
  type = 'text',
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | undefined;
  readonly isDisabled: boolean;
  readonly type?: 'text' | 'url';
}) {
  return (
    <AriaTextField
      {...VALIDATION}
      {...invalid(error)}
      aria-label={label}
      value={value}
      onChange={onChange}
      type={type}
      isDisabled={isDisabled}
      className={styles.rowField ?? ''}
    >
      <Input className={styles.input ?? ''} data-mono spellCheck={false} autoComplete="off" />
      <Message error={error} />
    </AriaTextField>
  );
}

function replaceAt<T>(list: readonly T[], index: number, item: T): T[] {
  return list.map((existing, i) => (i === index ? item : existing));
}

function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

export function UrlListField({
  label,
  itemLabel,
  description,
  error,
  itemErrors = [],
  changed,
  isDisabled = false,
  value,
  onChange,
}: Chrome & {
  readonly itemLabel: string;
  readonly itemErrors?: readonly (string | undefined)[];
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
}) {
  const focus = useRowFocus(value.length);
  const rows = useRowIds(value.length);
  const noun = itemLabel.charAt(0).toLowerCase() + itemLabel.slice(1);
  return (
    <ListGroup
      label={label}
      description={description}
      error={error}
      {...(changed === undefined ? {} : { changed })}
      isDisabled={isDisabled}
      addLabel={`Add ${noun}`}
      onAdd={() => {
        focus.added();
        rows.added();
        onChange([...value, '']);
      }}
      rootRef={focus.root}
    >
      {value.map((url, i) => {
        const position = String(i + 1);
        return (
          <div key={rows.ids[i]} className={styles.row} data-row>
            <RowInput
              label={`${itemLabel} ${position}`}
              type="url"
              value={url}
              error={itemErrors[i]}
              isDisabled={isDisabled}
              onChange={(next) => {
                onChange(replaceAt(value, i, next));
              }}
            />
            <Button
              size="small"
              variant="quiet"
              isDisabled={isDisabled}
              aria-label={removeName(noun, position, url)}
              onPress={() => {
                focus.removed();
                rows.removed(i);
                onChange(removeAt(value, i));
              }}
            >
              Remove
            </Button>
          </div>
        );
      })}
    </ListGroup>
  );
}

export interface KeyValuePair {
  readonly key: string;
  readonly value: string;
}

export function KeyValueField({
  label,
  keyLabel,
  valueLabel,
  description,
  error,
  changed,
  isDisabled = false,
  value,
  onChange,
}: Chrome & {
  readonly keyLabel: string;
  readonly valueLabel: string;
  readonly value: readonly KeyValuePair[];
  readonly onChange: (value: readonly KeyValuePair[]) => void;
}) {
  const focus = useRowFocus(value.length);
  const rows = useRowIds(value.length);
  const noun = keyLabel.toLowerCase();
  return (
    <ListGroup
      label={label}
      description={description}
      error={error}
      {...(changed === undefined ? {} : { changed })}
      isDisabled={isDisabled}
      addLabel={`Add ${noun}`}
      onAdd={() => {
        focus.added();
        rows.added();
        onChange([...value, { key: '', value: '' }]);
      }}
      rootRef={focus.root}
    >
      {value.length === 0 ? null : (
        <div className={styles.pairHeader} aria-hidden="true">
          <span>{keyLabel}</span>
          <span>{valueLabel}</span>
        </div>
      )}
      {value.map((pair, i) => {
        const position = String(i + 1);
        return (
          <div key={rows.ids[i]} className={styles.row} data-row>
            <div className={styles.pair}>
              <RowInput
                label={`${keyLabel} ${position}`}
                value={pair.key}
                error={undefined}
                isDisabled={isDisabled}
                onChange={(key) => {
                  onChange(replaceAt(value, i, { ...pair, key }));
                }}
              />
              <RowInput
                label={`${valueLabel} ${position}`}
                value={pair.value}
                error={undefined}
                isDisabled={isDisabled}
                onChange={(next) => {
                  onChange(replaceAt(value, i, { ...pair, value: next }));
                }}
              />
            </div>
            <Button
              size="small"
              variant="quiet"
              isDisabled={isDisabled}
              aria-label={removeName(noun, position, pair.key)}
              onPress={() => {
                focus.removed();
                rows.removed(i);
                onChange(removeAt(value, i));
              }}
            >
              Remove
            </Button>
          </div>
        );
      })}
    </ListGroup>
  );
}

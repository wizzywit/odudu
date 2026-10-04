import {
  createContext,
  use,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
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
  VisuallyHidden,
  type Key,
} from 'react-aria-components';
import { formatDuration } from '#/shared/service/format.ts';
import { Button } from '#/shared/view/Button.tsx';
import styles from '#/shared/view/Field.module.css';

export interface Chrome {
  label: string;
  description?: ReactNode;
  // What the problem detail said about this field; shown under it.
  error?: string | undefined;
  changed?: boolean;
  isDisabled?: boolean;
}

// A server-reported error is shown as given; the browser's own constraint
// validation would otherwise block the form until the next response.
export const VALIDATION = { validationBehavior: 'aria' } as const;

export function invalid(error: string | undefined): { isInvalid: boolean } {
  return { isInvalid: error !== undefined };
}

// Inside a FieldGroup, the group's description and error ids: each control
// is described by the description, and the one a problem is about by the
// error as well, so a screen reader hears it on that control.
interface GroupIds {
  description: string | undefined;
  error: string | undefined;
}

export const FieldGroupIds = createContext<GroupIds | null>(null);

// A control inside a group that the group's error is about.
export interface GroupPart {
  invalid?: boolean;
}

export function partProps(
  group: GroupIds | null,
  part: boolean | undefined,
): { 'aria-describedby'?: string; isInvalid?: boolean } {
  if (group === null) return {};
  const ids = [group.description, part === true ? group.error : undefined].filter(
    (id) => id !== undefined,
  );
  return {
    ...(ids.length === 0 ? {} : { 'aria-describedby': ids.join(' ') }),
    ...(part === true ? { isInvalid: true } : {}),
  };
}

// A part of a group may hide its label from sight: the group's legend says
// what the whole is, and the label still names the part to a screen reader.
export interface PartLabel {
  hideLabel?: boolean;
  placeholder?: string;
}

export function Header({
  label,
  changed,
  hidden = false,
}: {
  label: string;
  changed?: boolean;
  hidden?: boolean | undefined;
}) {
  if (hidden) {
    return (
      <VisuallyHidden>
        <Label>{label}</Label>
      </VisuallyHidden>
    );
  }
  return (
    <div className={styles.header}>
      <Label className={styles.label ?? ''}>{label}</Label>
      {changed === true ? <Changed /> : null}
    </div>
  );
}

export function Changed() {
  return <span className={styles.changed}>Changed</span>;
}

export function Message({ error }: { error: string | undefined }) {
  return <FieldError className={styles.error ?? ''}>{error}</FieldError>;
}

export function Description({ children }: { children: ReactNode }) {
  if (children === undefined || children === null) return null;
  return (
    <Text slot="description" className={styles.description ?? ''}>
      {children}
    </Text>
  );
}

// A token names the operator's own data (WCAG 1.3.5), so a field carries it
// only where a page declares the data theirs; anywhere else it would offer
// the operator's own name, phone or address for somebody else's.
export const OwnData = createContext(false);

export function OwnDataFields({ children, when }: { children: ReactNode; when: boolean }) {
  return <OwnData value={when}>{children}</OwnData>;
}

export function ownToken(own: boolean, token: string): string {
  return own ? token : 'off';
}

// A page the caller may read but not change shows every field as text: no
// control is offered that the server would refuse.
export const FieldsReadOnly = createContext(false);

export function ReadOnlyFields({ children, when }: { children: ReactNode; when: boolean }) {
  return <FieldsReadOnly value={when}>{children}</FieldsReadOnly>;
}

// `changed` marks an edit held from before the page became read-only: it
// was never stored, so it is not shown as if it were.
export function ReadOnlyValue({
  label,
  value,
  description,
  mono = false,
  changed = false,
}: {
  label: string;
  value: ReactNode;
  description?: ReactNode;
  mono?: boolean;
  changed?: boolean | undefined;
}) {
  const empty = value === '' || value === null || value === undefined;
  return (
    <dl className={styles.readOnly}>
      <dt className={styles.label}>{label}</dt>
      <dd
        className={styles.readOnlyValue}
        data-mono={(mono && !empty) || undefined}
        data-unsaved={changed || undefined}
      >
        {empty ? <span className={styles.unset}>Not set</span> : value}
        {changed ? <span className={styles.unsaved}> · not saved</span> : null}
      </dd>
      {description === undefined || description === null ? null : (
        <dd className={styles.description}>{description}</dd>
      )}
    </dl>
  );
}

function ReadOnlyList({ items }: { items: readonly string[] }) {
  return (
    <ul className={styles.readOnlyList}>
      {items.map((item, i) => (
        <li key={`${String(i)}:${item}`}>{item}</li>
      ))}
    </ul>
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
  onBlur,
  invalid: part,
  inputMode,
  hideLabel,
  placeholder,
}: Chrome &
  GroupPart &
  PartLabel & {
    value: string;
    onChange: (value: string) => void;
    onBlur?: () => void;
    inputMode?: 'numeric' | 'tel';
    type?: 'text' | 'url' | 'email' | 'tel';
    mono?: boolean;
    autoComplete?: string;
    autoFocus?: boolean;
  }) {
  const group = use(FieldGroupIds);
  const own = use(OwnData);
  if (use(FieldsReadOnly))
    return <ReadOnlyValue label={label} value={value} mono={mono} changed={changed} />;
  return (
    <AriaTextField
      {...VALIDATION}
      {...invalid(error)}
      {...partProps(group, part)}
      isDisabled={isDisabled ?? false}
      value={value}
      onChange={onChange}
      type={type}
      autoComplete={ownToken(own, autoComplete)}
      autoFocus={autoFocus}
      {...(onBlur === undefined ? {} : { onBlur })}
      className={styles.field ?? ''}
      data-changed={changed === true || undefined}
    >
      <Header label={label} hidden={hideLabel} {...(changed === undefined ? {} : { changed })} />
      <Input
        className={styles.input ?? ''}
        data-control
        data-mono={mono || undefined}
        spellCheck={false}
        {...(inputMode === undefined ? {} : { inputMode })}
        {...(placeholder === undefined ? {} : { placeholder })}
      />
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

// Inside a filter bar a field's label sits beside its control, so every
// control in the bar keeps one height and one centre line.
const Inline = createContext(false);

export function InlineFields({ children }: { children: ReactNode }) {
  return <Inline value>{children}</Inline>;
}

export interface SelectOption {
  id: string;
  label: string;
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
  autoComplete,
  invalid: part,
  hideLabel,
  placeholder,
}: Chrome &
  GroupPart &
  PartLabel & {
    options: readonly SelectOption[];
    value: string;
    onChange: (value: string) => void;
    autoComplete?: string;
  }) {
  const inline = use(Inline);
  const readOnly = use(FieldsReadOnly);
  const group = use(FieldGroupIds);
  const own = use(OwnData);
  if (readOnly && !inline) {
    return (
      <ReadOnlyValue
        label={label}
        value={options.find((o) => o.id === value)?.label ?? value}
        changed={changed}
      />
    );
  }
  return (
    <Select
      {...VALIDATION}
      {...(autoComplete === undefined ? {} : { autoComplete: ownToken(own, autoComplete) })}
      {...invalid(error)}
      {...partProps(group, part)}
      isDisabled={isDisabled ?? false}
      value={value}
      onChange={(key: Key | null) => {
        if (key !== null) onChange(String(key));
      }}
      {...(placeholder === undefined ? {} : { placeholder })}
      className={styles.field ?? ''}
      data-changed={changed === true || undefined}
      data-inline={inline || undefined}
    >
      <Header label={label} hidden={hideLabel} {...(changed === undefined ? {} : { changed })} />
      <AriaButton className={styles.trigger ?? ''} data-control>
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
}: Chrome & { value: boolean; onChange: (value: boolean) => void }) {
  if (use(FieldsReadOnly)) {
    return (
      <ReadOnlyValue
        label={label}
        value={value ? 'On' : 'Off'}
        description={description}
        changed={changed}
      />
    );
  }
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
  ids: readonly string[];
  next: number;
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

// Several controls standing for one value: a fieldset whose legend reads as
// any field's label, carrying the description and the error for the whole.
export function FieldGroup({
  label,
  description,
  error,
  changed,
  children,
}: Chrome & { children: ReactNode }) {
  const descriptionId = useId();
  const errorId = useId();
  const describedBy = [
    description === undefined || description === null ? null : descriptionId,
    error === undefined ? null : errorId,
  ].filter((id) => id !== null);
  return (
    <fieldset
      {...(describedBy.length === 0 ? {} : { 'aria-describedby': describedBy.join(' ') })}
      className={styles.group}
      data-changed={changed === true || undefined}
      data-invalid={error === undefined ? undefined : true}
    >
      <legend className={styles.label}>{label}</legend>
      {changed === true ? <Changed /> : null}
      <FieldGroupIds
        value={{
          description:
            description === undefined || description === null ? undefined : descriptionId,
          error: error === undefined ? undefined : errorId,
        }}
      >
        {children}
      </FieldGroupIds>
      {description === undefined || description === null ? null : (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </fieldset>
  );
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
  children: ReactNode;
  addLabel: string;
  onAdd: () => void;
  rootRef: RefObject<HTMLDivElement | null>;
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
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  isDisabled: boolean;
  type?: 'text' | 'url';
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
  itemLabel: string;
  itemErrors?: readonly (string | undefined)[];
  value: readonly string[];
  onChange: (value: readonly string[]) => void;
}) {
  const focus = useRowFocus(value.length);
  const rows = useRowIds(value.length);
  const readOnly = use(FieldsReadOnly);
  const noun = itemLabel.charAt(0).toLowerCase() + itemLabel.slice(1);
  if (readOnly) {
    return (
      <ReadOnlyValue
        label={label}
        value={value.length === 0 ? '' : <ReadOnlyList items={value} />}
        changed={changed}
        mono
      />
    );
  }
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
  key: string;
  value: string;
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
  keyLabel: string;
  valueLabel: string;
  value: readonly KeyValuePair[];
  onChange: (value: readonly KeyValuePair[]) => void;
}) {
  const focus = useRowFocus(value.length);
  const rows = useRowIds(value.length);
  const readOnly = use(FieldsReadOnly);
  const noun = keyLabel.toLowerCase();
  if (readOnly) {
    return (
      <ReadOnlyValue
        label={label}
        value={
          value.length === 0 ? (
            ''
          ) : (
            <ReadOnlyList items={value.map((p) => `${p.key}: ${p.value}`)} />
          )
        }
        mono
      />
    );
  }
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

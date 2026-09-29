import { use, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Button as AriaButton,
  ComboBox,
  ComboBoxStateContext,
  Group,
  Input,
  ListBox,
  ListBoxItem,
  Popover,
  Text,
  type Key,
} from 'react-aria-components';
import {
  Description,
  FieldGroupIds,
  FieldsReadOnly,
  Header,
  invalid,
  Message,
  OwnData,
  ownToken,
  partProps,
  ReadOnlyValue,
  VALIDATION,
  type Chrome,
  type GroupPart,
} from '#/shared/view/Field.tsx';
import styles from '#/shared/view/Field.module.css';

export interface ComboOption {
  readonly id: string;
  readonly label: string;
  // Shown after the label and matched by typing, such as a zone's offset.
  readonly detail?: string;
}

// Closes the list each time `times` grows: React Aria leaves it open on a
// value that arrived whole, which would keep the page hidden around it.
function CloseList({ times }: { times: number }) {
  const current = use(ComboBoxStateContext);
  const state = useRef(current);
  useEffect(() => {
    state.current = current;
  });
  useEffect(() => {
    if (times === 0) return undefined;
    // After React Aria's own effects, which open the list on the same change.
    const timer = setTimeout(() => {
      state.current?.close();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [times]);
  return null;
}

interface Shown {
  readonly value: string;
  readonly text: string;
}

function matching(
  options: readonly ComboOption[],
  text: string,
  matchIds: boolean,
): ComboOption | undefined {
  const typed = text.trim().toLowerCase();
  return options.find(
    (o) => (matchIds && o.id.toLowerCase() === typed) || o.label.toLowerCase() === typed,
  );
}

// More than one character at once is a paste or an autofill, not typing.
function wholeValue(before: string, after: string): boolean {
  return Math.abs(after.length - before.length) > 1;
}

// Type to narrow the list, or open it with the button. With a custom value
// allowed, text that names no option is kept as typed.
export function ComboBoxField({
  label,
  description,
  error,
  changed,
  isDisabled,
  options,
  value,
  onChange,
  allowsCustomValue = false,
  autoComplete = 'off',
  readOnlyText,
  mono = false,
  matchIds = true,
  invalid: part,
}: Chrome &
  GroupPart & {
    readonly options: readonly ComboOption[];
    value: string;
    onChange: (value: string) => void;
    allowsCustomValue?: boolean;
    autoComplete?: string;
    // What a read-only page shows in place of the option's label.
    readOnlyText?: ReactNode;
    mono?: boolean;
    // Whether typing an option's id chooses it: yes for a zone or a locale tag,
    // no for a country, whose two-letter code is also the start of names.
    matchIds?: boolean;
  }) {
  const labelOf = (id: string): string => options.find((o) => o.id === id)?.label ?? id;
  const [shown, setShown] = useState<Shown>(() => ({ value, text: labelOf(value) }));
  const readOnly = use(FieldsReadOnly);
  const group = use(FieldGroupIds);
  const own = use(OwnData);
  const [closes, setCloses] = useState(0);
  let current = shown;
  if (shown.value !== value) {
    current = { value, text: labelOf(value) };
    setShown(current);
  }
  if (readOnly) {
    return <ReadOnlyValue label={label} value={readOnlyText ?? labelOf(value)} mono={mono} />;
  }
  const emit = (next: Shown): void => {
    setShown(next);
    if (next.value !== value) onChange(next.value);
  };
  return (
    <ComboBox
      {...VALIDATION}
      {...invalid(error)}
      {...partProps(group, part)}
      isDisabled={isDisabled ?? false}
      allowsCustomValue={allowsCustomValue}
      defaultItems={options}
      value={options.some((o) => o.id === value) ? value : null}
      inputValue={current.text}
      onInputChange={(text) => {
        const found = matching(options, text, matchIds);
        if (found !== undefined && wholeValue(current.text, text)) {
          emit({ value: found.id, text: found.label });
          setCloses((n) => n + 1);
          return;
        }
        if (!allowsCustomValue) {
          setShown({ value, text });
          return;
        }
        emit({ value: found?.id ?? text.trim(), text });
      }}
      onBlur={() => {
        const found = matching(options, current.text, matchIds);
        if (found !== undefined) emit({ value: found.id, text: found.label });
        else if (allowsCustomValue) emit({ value: current.text.trim(), text: current.text });
        else setShown({ value, text: labelOf(value) });
      }}
      onChange={(key: Key | null) => {
        if (key === null) {
          if (!allowsCustomValue && current.text === '') emit({ value: '', text: '' });
          return;
        }
        const id = String(key);
        emit({ value: id, text: labelOf(id) });
      }}
      className={styles.field ?? ''}
      data-changed={changed === true || undefined}
    >
      <CloseList times={closes} />
      <Header label={label} {...(changed === undefined ? {} : { changed })} />
      <Group className={styles.comboGroup ?? ''}>
        <Input
          className={styles.input ?? ''}
          data-mono={mono || undefined}
          spellCheck={false}
          autoComplete={ownToken(own, autoComplete)}
        />
        <AriaButton className={styles.comboButton ?? ''} aria-label={`Show ${label} options`}>
          <span aria-hidden="true">▾</span>
        </AriaButton>
      </Group>
      <Description>{description}</Description>
      <Message error={error} />
      <Popover className={styles.popover ?? ''}>
        <ListBox className={styles.listbox ?? ''}>
          {(option: ComboOption) => (
            <ListBoxItem
              id={option.id}
              textValue={
                option.detail === undefined ? option.label : `${option.label} ${option.detail}`
              }
              className={styles.option ?? ''}
            >
              <Text slot="label" className={styles.optionLabel ?? ''}>
                {option.label}
              </Text>
              {option.detail === undefined ? null : (
                <Text slot="description" className={styles.optionDetail ?? ''}>
                  {option.detail}
                </Text>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  );
}

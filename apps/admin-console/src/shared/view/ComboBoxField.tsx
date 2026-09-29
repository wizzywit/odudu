import { use, useState, type ReactNode } from 'react';
import {
  Button as AriaButton,
  ComboBox,
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
  FieldsReadOnly,
  Header,
  invalid,
  Message,
  ReadOnlyValue,
  VALIDATION,
  type Chrome,
} from '#/shared/view/Field.tsx';
import styles from '#/shared/view/Field.module.css';

export interface ComboOption {
  readonly id: string;
  readonly label: string;
  // Shown after the label and matched by typing, such as a zone's offset.
  readonly detail?: string;
}

interface Shown {
  readonly value: string;
  readonly text: string;
}

function matching(options: readonly ComboOption[], text: string): ComboOption | undefined {
  const typed = text.trim().toLowerCase();
  return options.find((o) => o.id.toLowerCase() === typed || o.label.toLowerCase() === typed);
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
}: Chrome & {
  readonly options: readonly ComboOption[];
  value: string;
  onChange: (value: string) => void;
  allowsCustomValue?: boolean;
  autoComplete?: string;
  // What a read-only page shows in place of the option's label.
  readOnlyText?: ReactNode;
  mono?: boolean;
}) {
  const labelOf = (id: string): string => options.find((o) => o.id === id)?.label ?? id;
  const [shown, setShown] = useState<Shown>(() => ({ value, text: labelOf(value) }));
  const readOnly = use(FieldsReadOnly);
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
      isDisabled={isDisabled ?? false}
      allowsCustomValue={allowsCustomValue}
      defaultItems={options}
      value={options.some((o) => o.id === value) ? value : null}
      inputValue={current.text}
      onInputChange={(text) => {
        if (!allowsCustomValue) {
          setShown({ value, text });
          return;
        }
        emit({ value: matching(options, text)?.id ?? text.trim(), text });
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
      <Header label={label} {...(changed === undefined ? {} : { changed })} />
      <Group className={styles.comboGroup ?? ''}>
        <Input
          className={styles.input ?? ''}
          data-mono={mono || undefined}
          spellCheck={false}
          autoComplete={autoComplete}
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

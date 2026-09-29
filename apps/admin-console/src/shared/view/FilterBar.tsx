import { useId, useState, type SubmitEvent, type ReactNode } from 'react';
import {
  Button as AriaButton,
  Input,
  ListBox,
  ListBoxItem,
  Popover,
  SearchField,
  Select,
  SelectValue,
  type Key,
} from 'react-aria-components';
import { Button } from '#/shared/view/Button.tsx';
import { InlineFields, type SelectOption } from '#/shared/view/Field.tsx';
import { KeyHint } from '#/shared/view/KeyHint.tsx';
import styles from '#/shared/view/FilterBar.module.css';

export interface Search {
  readonly field: string;
  readonly query: string;
}

// A search is a prefix on one named field, so the field is always shown as a
// chip rather than guessed; it applies on submit, never per keystroke.
export function FilterBar({
  label,
  fields,
  field,
  query,
  onSearch,
  onClear,
  active = false,
  count,
  children,
}: {
  label: string;
  readonly fields: readonly SelectOption[];
  field: string;
  query: string;
  onSearch: (search: Search) => void;
  onClear?: () => void;
  active?: boolean;
  // How many the filters leave, said at the end of the row.
  count?: ReactNode;
  children?: ReactNode;
}) {
  const shortcut = useId();
  const [applied, setApplied] = useState<Search>({ field, query });
  const [chosen, setChosen] = useState(field);
  const [text, setText] = useState(query);
  if (applied.field !== field || applied.query !== query) {
    setApplied({ field, query });
    setChosen(field);
    setText(query);
  }
  const fieldLabel = fields.find((f) => f.id === chosen)?.label ?? chosen;
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSearch({ field: chosen, query: text });
  };
  return (
    <form role="search" aria-label={label} noValidate onSubmit={submit} className={styles.bar}>
      <div className={styles.search}>
        {fields.length > 1 ? (
          <Select
            aria-label="Search field"
            value={chosen}
            onChange={(key: Key | null) => {
              if (key !== null) setChosen(String(key));
            }}
            className={styles.fieldSelect ?? ''}
          >
            <AriaButton className={styles.chip ?? ''}>
              <SelectValue />
              <span aria-hidden="true">▾</span>
            </AriaButton>
            <Popover className={styles.popover ?? ''}>
              <ListBox className={styles.listbox ?? ''} items={fields}>
                {(option) => (
                  <ListBoxItem id={option.id} className={styles.option ?? ''}>
                    {option.label}
                  </ListBoxItem>
                )}
              </ListBox>
            </Popover>
          </Select>
        ) : (
          <span className={styles.chip} data-fixed>
            {fieldLabel}
          </span>
        )}
        <SearchField
          aria-label={`Search by ${fieldLabel}`}
          value={text}
          onChange={setText}
          className={styles.field ?? ''}
        >
          <Input className={styles.input ?? ''} placeholder="Starts with…" />
          <AriaButton className={styles.clear ?? ''}>Clear</AriaButton>
        </SearchField>
        <Button type="submit" aria-describedby={shortcut}>
          Search
        </Button>
        <KeyHint id={shortcut} lead="or press" keys={['Enter']} />
      </div>
      {children === undefined ? null : (
        <div className={styles.filters}>
          <InlineFields>{children}</InlineFields>
        </div>
      )}
      {count === undefined || count === null ? null : <span className={styles.count}>{count}</span>}
      {active && onClear !== undefined ? (
        <Button variant="quiet" onPress={onClear}>
          Clear filters
        </Button>
      ) : null}
    </form>
  );
}

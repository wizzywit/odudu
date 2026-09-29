import { useId, useState } from 'react';
import {
  Input,
  ListBox,
  ListBoxItem,
  SearchField,
  Text,
  type Selection,
} from 'react-aria-components';
import type { PickerState } from '#/shared/service/picker.ts';
import { Button } from '#/shared/view/Button.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { Skeleton } from '#/shared/view/Skeleton.tsx';
import styles from '#/shared/view/Picker.module.css';

// Sits inside a section's form, so its search is a field and a button and
// never a form of its own. The selection is ids, including ones chosen
// from a page no longer loaded.
export function Picker<T>({
  label,
  noun,
  picker,
  idOf,
  nameOf,
  detailOf,
  accessibleNameOf,
  capability,
  selected,
  onChange,
  selectionMode = 'multiple',
}: {
  label: string;
  noun: { readonly one: string; readonly other: string };
  picker: PickerState<T>;
  idOf: (item: T) => string;
  nameOf: (item: T) => string;
  detailOf: (item: T) => string;
  // When the name alone could stand for two options, as a tenant role and
  // a client role of one name can.
  accessibleNameOf?: (item: T) => string;
  // Named when the list is refused.
  capability: string;
  readonly selected: readonly string[];
  onChange: (ids: string[]) => void;
  selectionMode?: 'single' | 'multiple';
}) {
  const heading = useId();
  const [text, setText] = useState(picker.query);
  const change = (keys: Selection): void => {
    if (keys === 'all') {
      onChange([...new Set([...selected, ...picker.options.map(idOf)])]);
      return;
    }
    onChange([...keys].map(String));
  };
  const search = (): void => {
    picker.search(text.trim());
  };
  return (
    <div role="group" aria-labelledby={heading} className={styles.picker}>
      <div className={styles.head}>
        <p id={heading} className={styles.label}>
          {label}
        </p>
        <span className={styles.count}>{`${String(selected.length)} selected`}</span>
      </div>
      {picker.status === 'refused' ? (
        <CapabilityNote capability={capability}>{`Choosing ${noun.other}`}</CapabilityNote>
      ) : (
        <>
          <div role="search" aria-label={`Search ${noun.other}`} className={styles.search}>
            <SearchField
              aria-label={`Search ${noun.other} by name`}
              value={text}
              onChange={setText}
              onSubmit={search}
              className={styles.field ?? ''}
            >
              <Input className={styles.input ?? ''} placeholder="Starts with…" />
            </SearchField>
            <Button size="small" onPress={search}>
              Search
            </Button>
          </div>
          <Options
            label={label}
            noun={noun}
            picker={picker}
            idOf={idOf}
            nameOf={nameOf}
            detailOf={detailOf}
            {...(accessibleNameOf === undefined ? {} : { accessibleNameOf })}
            selected={selected}
            selectionMode={selectionMode}
            onChange={change}
          />
        </>
      )}
    </div>
  );
}

function Options<T>({
  label,
  noun,
  picker,
  idOf,
  nameOf,
  detailOf,
  accessibleNameOf,
  selected,
  selectionMode,
  onChange,
}: {
  label: string;
  noun: { readonly one: string; readonly other: string };
  picker: PickerState<T>;
  idOf: (item: T) => string;
  nameOf: (item: T) => string;
  detailOf: (item: T) => string;
  accessibleNameOf?: (item: T) => string;
  readonly selected: readonly string[];
  selectionMode: 'single' | 'multiple';
  onChange: (keys: Selection) => void;
}) {
  switch (picker.status) {
    case 'loading':
      return <Skeleton label={`Loading ${noun.other}`} lines={3} />;
    case 'failed':
      return (
        <div role="alert" className={styles.empty}>
          <p>{`${label} could not be loaded.`}</p>
          <Button size="small" onPress={picker.retry}>
            Try again
          </Button>
        </div>
      );
    case 'refused':
    case 'ready':
      break;
  }
  if (picker.options.length === 0) {
    return (
      <p className={styles.empty}>
        {picker.query === ''
          ? `There are no ${noun.other} yet.`
          : `No ${noun.other} start with “${picker.query}”.`}
      </p>
    );
  }
  return (
    <>
      <ListBox
        aria-label={label}
        items={picker.options.map((item) => ({ id: idOf(item), item }))}
        selectionMode={selectionMode}
        selectedKeys={new Set(selected)}
        onSelectionChange={onChange}
        className={styles.list ?? ''}
      >
        {({ id, item }) => (
          <ListBoxItem
            id={id}
            textValue={nameOf(item)}
            className={styles.option ?? ''}
            {...(accessibleNameOf === undefined ? {} : { 'aria-label': accessibleNameOf(item) })}
          >
            <span className={styles.box} aria-hidden="true" />
            <span className={styles.text}>
              {accessibleNameOf === undefined ? (
                <Text slot="label" className={styles.name ?? ''}>
                  {nameOf(item)}
                </Text>
              ) : (
                <span className={styles.name}>{nameOf(item)}</span>
              )}
              <Text slot="description" className={styles.detail ?? ''}>
                {detailOf(item)}
              </Text>
            </span>
          </ListBoxItem>
        )}
      </ListBox>
      {picker.more ? (
        <Button
          size="small"
          variant="quiet"
          isDisabled={picker.loadingMore}
          onPress={picker.loadMore}
        >
          {picker.loadingMore ? `Loading more ${noun.other}…` : `Load more ${noun.other}`}
        </Button>
      ) : null}
    </>
  );
}

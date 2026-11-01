import { use } from 'react';
import type { Read } from '#/shared/service/read';
import { CodeInsert } from '#/shared/view/CodeField';
import { ComboBoxField, type ComboOption } from '#/shared/view/Field';
import { InlineFailed } from '#/shared/view/InlineFailed';

const NONE: ComboOption[] = [];

export interface PickerWording {
  // Said under the field's description while the list is being read.
  loading: string;
  // Said, with another try, when it could not be read.
  failed: string;
}

// An option chosen from a list the server owns, at most `limit` drawn at a
// time and narrowed by typing part of an option's name or of its detail. With
// a custom value allowed, text typed in full is kept as typed. While the list
// is unread or could not be read the field says so and, if custom values are
// allowed, stays usable as text.
export function OptionPicker({
  options,
  wording,
  limit,
  label,
  description,
  value,
  onChange,
  error,
  mono,
  custom,
}: {
  options: Read<ComboOption[]>;
  wording: PickerWording;
  limit: number;
  label: string;
  description: string;
  value: string;
  onChange: (id: string) => void;
  error?: string | undefined;
  mono?: boolean;
  // Whether text that names no listed option is kept: yes where the server
  // checks it, no for a picker that only inserts.
  custom?: boolean;
}) {
  const ready = options.status === 'ready';
  return (
    <>
      <ComboBoxField
        label={label}
        description={
          options.status === 'loading' ? `${description} ${wording.loading}` : description
        }
        options={options.status === 'ready' ? options.data : NONE}
        limit={limit}
        value={value}
        onChange={onChange}
        allowsCustomValue={custom ?? false}
        isDisabled={!ready && custom !== true}
        {...(error === undefined ? {} : { error })}
        {...(mono === undefined ? {} : { mono })}
      />
      {options.status === 'failed' ? (
        <InlineFailed message={wording.failed} retry={options.retry} />
      ) : null}
    </>
  );
}

// The picker above a code editor: chooses an option and types `text(id)`, or
// the option's id as it stands, at the caret, as one step of the editor's
// history.
export function InsertPicker({
  options,
  wording,
  limit,
  label,
  description,
  text,
}: {
  options: Read<ComboOption[]>;
  wording: PickerWording;
  limit: number;
  label: string;
  description: string;
  text?: (id: string) => string;
}) {
  const insert = use(CodeInsert);
  return (
    <OptionPicker
      options={options}
      wording={wording}
      limit={limit}
      label={label}
      description={description}
      value=""
      mono
      onChange={(id) => {
        if (id !== '') insert(text === undefined ? id : text(id));
      }}
    />
  );
}

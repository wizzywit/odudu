import { use, useId } from 'react';
import { Link } from 'react-aria-components';
import { previewable, typingScheme, urlProblem } from '#/shared/service/profileUrl.ts';
import {
  FieldGroupIds,
  FieldsReadOnly,
  ReadOnlyValue,
  TextField,
  type Chrome,
} from '#/shared/view/Field.tsx';
import styles from '#/shared/view/Field.module.css';

type UrlFieldProps = Chrome & {
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
};

export function UrlField({ value, error, autoComplete = 'url', ...rest }: UrlFieldProps) {
  const problem = typingScheme(value) ? null : urlProblem(value);
  return (
    <TextField
      {...rest}
      type="url"
      mono
      value={value}
      autoComplete={autoComplete}
      error={error ?? problem ?? undefined}
    />
  );
}

function noted(value: string): boolean {
  return (
    value !== '' && urlProblem(value) === null && !previewable(value, globalThis.location.origin)
  );
}

function Preview({ value, noteId }: { value: string; noteId: string }) {
  if (value === '' || urlProblem(value) !== null) return null;
  if (previewable(value, globalThis.location.origin)) {
    return <img className={styles.picture} src={value} alt="The picture at this address" />;
  }
  return (
    <p id={noteId} className={styles.pictureNote}>
      The console loads images from its own address only, so a picture on another site is not shown
      here.{' '}
      <Link href={value} target="_blank" rel="noopener noreferrer">
        Open the picture in a new tab
      </Link>
    </p>
  );
}

export function PictureField(props: UrlFieldProps) {
  const readOnly = use(FieldsReadOnly);
  const noteId = useId();
  if (readOnly)
    return <ReadOnlyValue label={props.label} value={props.value} mono changed={props.changed} />;
  return (
    <div className={styles.pictureField}>
      <FieldGroupIds
        value={{ description: noted(props.value) ? noteId : undefined, error: undefined }}
      >
        <UrlField autoComplete="photo" {...props} />
      </FieldGroupIds>
      <Preview value={props.value} noteId={noteId} />
    </div>
  );
}

import { use } from 'react';
import { Link } from 'react-aria-components';
import { previewable, typingScheme, urlProblem } from '#/shared/service/profileUrl.ts';
import { FieldsReadOnly, ReadOnlyValue, TextField, type Chrome } from '#/shared/view/Field.tsx';
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

function Preview({ value }: { value: string }) {
  if (value === '' || urlProblem(value) !== null) return null;
  if (previewable(value, globalThis.location.origin)) {
    return <img className={styles.picture} src={value} alt="The picture at this address" />;
  }
  return (
    <p className={styles.pictureNote}>
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
  if (readOnly) return <ReadOnlyValue label={props.label} value={props.value} mono />;
  return (
    <div className={styles.pictureField}>
      <UrlField autoComplete="photo" {...props} />
      <Preview value={props.value} />
    </div>
  );
}

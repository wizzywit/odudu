import { useId, type SubmitEvent, type ReactNode } from 'react';
import { SaveBar } from '#/shared/view/SaveBar.tsx';
import styles from '#/shared/view/Section.module.css';

// One section, one save, one request: the save bar belongs to this section
// alone, and a submit while one is in flight goes nowhere.
export function Section({
  title,
  description,
  dirty,
  saving,
  onSave,
  onDiscard,
  children,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
  readonly children: ReactNode;
}) {
  const heading = useId();
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (dirty && !saving) onSave();
  };
  return (
    <section aria-labelledby={heading} className={styles.section} data-dirty={dirty || undefined}>
      <header className={styles.header}>
        <h2 id={heading} className={styles.title}>
          {title}
        </h2>
        {description === undefined ? null : <p className={styles.description}>{description}</p>}
      </header>
      <form noValidate onSubmit={submit} className={styles.form} aria-busy={saving || undefined}>
        <div className={styles.fields}>{children}</div>
        {dirty ? (
          <div className={styles.saveBar}>
            <SaveBar section={title} saving={saving} onDiscard={onDiscard} />
          </div>
        ) : null}
      </form>
    </section>
  );
}

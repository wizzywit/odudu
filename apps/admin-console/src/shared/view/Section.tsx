import {
  use,
  useEffect,
  useId,
  useRef,
  type FocusEvent,
  type SubmitEvent,
  type ReactNode,
} from 'react';
import { FieldsReadOnly } from '#/shared/view/Field.tsx';
import { SaveBar } from '#/shared/view/SaveBar.tsx';
import { StatusTag } from '#/shared/view/StatusTag.tsx';
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
  restored = false,
  notice,
  blocked,
  children,
}: {
  title: string;
  description?: ReactNode;
  dirty: boolean;
  saving: boolean;
  // Answers false when it declined to start a save, which frees Save again.
  onSave: () => unknown;
  onDiscard: () => void;
  // Edits kept across a sign-in and put back, which nobody has looked at yet.
  restored?: boolean;
  // What the last save said that belongs to no single field: a conflict, a
  // guard's refusal. SectionNotice is the one to use.
  notice?: ReactNode;
  // Holds Save with this reason until it is resolved.
  blocked?: string | undefined;
  children: ReactNode;
}) {
  const heading = useId();
  // On a page the caller cannot change there is no save; an edit held from
  // before whoami said so stays, marked, until the page is left.
  const readOnly = use(FieldsReadOnly);
  // Holds between a submit and the render that shows it saving, which a
  // second quick submit would otherwise slip through.
  const submitted = useRef(false);
  useEffect(() => {
    if (!saving) submitted.current = false;
  }, [saving, dirty]);
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (readOnly || !dirty || saving || blocked !== undefined || submitted.current) return;
    submitted.current = true;
    if (onSave() === false) submitted.current = false;
  };
  // A save, a discard or a resolved conflict takes the control that held
  // focus away with it; focus then goes to the heading, not the page.
  const frame = useRef<HTMLElement>(null);
  const named = useRef<HTMLHeadingElement>(null);
  const held = useRef(false);
  useEffect(() => {
    if (held.current && document.activeElement === document.body) named.current?.focus();
  });
  const left = (event: FocusEvent<HTMLElement>): void => {
    const target = event.target;
    queueMicrotask(() => {
      const within = frame.current?.contains(document.activeElement) === true;
      if (target.isConnected && !within) held.current = false;
    });
  };
  return (
    <section
      ref={frame}
      aria-labelledby={heading}
      className={styles.section}
      data-dirty={dirty || undefined}
      onFocus={() => {
        held.current = true;
      }}
      onBlur={left}
    >
      <header className={styles.header}>
        <h2 id={heading} ref={named} tabIndex={-1} className={styles.title}>
          {title}
        </h2>
        {description === undefined ? null : <p className={styles.description}>{description}</p>}
        {restored ? (
          <p className={styles.restored}>
            <StatusTag tone="warning">Restored — review before saving</StatusTag>
          </p>
        ) : null}
      </header>
      <form noValidate onSubmit={submit} className={styles.form} aria-busy={saving || undefined}>
        <div className={styles.fields}>{children}</div>
        {notice === undefined || readOnly ? null : <div className={styles.notice}>{notice}</div>}
        {readOnly && dirty ? (
          <p role="status" className={styles.held}>
            Your change here was not saved and cannot be saved now. It stays until you leave the
            page.
          </p>
        ) : null}
        {dirty && !readOnly ? (
          <div className={styles.saveBar}>
            <SaveBar section={title} saving={saving} onDiscard={onDiscard} blocked={blocked} />
          </div>
        ) : null}
      </form>
    </section>
  );
}

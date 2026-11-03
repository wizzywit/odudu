import { useId, type ReactNode, type SubmitEvent } from 'react';
import { Button } from '#/shared/ui/Button';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import { TextAreaField, TextField } from '#/shared/ui/Field';
import { LiveMessage } from '#/shared/ui/Message';
import styles from '#/shared/ui/CreationForm/CreationForm.module.css';

// The form a record is made on: one submit, held back until the page says it
// may go.
export function CreationForm({ submit, children }: { submit: () => void; children: ReactNode }) {
  const send = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submit();
  };
  return (
    <form noValidate onSubmit={send} className={styles.form}>
      {children}
    </form>
  );
}

// A record made from a name and a description.
export function NameDescriptionFields({
  nameHelp,
  name,
  description,
}: {
  nameHelp: string;
  name: { value: string; error: string | undefined; onChange: (value: string) => void };
  description: {
    value: string;
    error: string | undefined;
    onChange: (value: string) => void;
    rule: string;
    limit?: number;
  };
}) {
  return (
    <>
      <TextField
        label="Name"
        description={nameHelp}
        value={name.value}
        error={name.error}
        onChange={name.onChange}
        mono
        autoFocus
      />
      <TextAreaField
        label="Description"
        description={description.rule}
        {...(description.limit === undefined ? {} : { limit: description.limit })}
        value={description.value}
        error={description.error}
        onChange={description.onChange}
      />
    </>
  );
}

// What the form ends in: create, or look for what a lost answer may have
// made, or open the partial copy; then the way back and the last word said.
export function CreationActions({
  noun,
  lookFor,
  busy,
  unconfirmed,
  onCheck,
  listHref,
  partial,
  held,
  message,
}: {
  // What is made: "role".
  noun: string;
  // What the look names, once the answer to a create was lost.
  lookFor: string;
  busy: boolean;
  unconfirmed: boolean;
  onCheck: () => void;
  listHref: string;
  // A copy that stopped part way, to open instead of creating again.
  partial?: { href: string; name: string; text: string } | null;
  // Why Create is held back, said beside it.
  held?: string | null;
  message: string | null;
}) {
  const heldId = useId();
  const holding = held !== undefined && held !== null;
  return (
    <>
      <div className={styles.actions}>
        {partial !== undefined && partial !== null ? (
          <ButtonLink href={partial.href} variant="primary">
            {`Open ${partial.name}`}
          </ButtonLink>
        ) : unconfirmed ? (
          <Button variant="primary" isDisabled={busy} onPress={onCheck}>
            {`Look for ${lookFor}`}
          </Button>
        ) : (
          <Button
            type="submit"
            variant="primary"
            isDisabled={busy || holding}
            {...(holding ? { 'aria-describedby': heldId } : {})}
          >
            {busy ? 'Creating…' : `Create ${noun}`}
          </Button>
        )}
        <ButtonLink href={listHref}>Cancel</ButtonLink>
      </div>
      {holding ? (
        <p id={heldId} className={styles.rule}>
          {held}
        </p>
      ) : null}
      <LiveMessage>{partial?.text ?? message}</LiveMessage>
    </>
  );
}

import { useId } from 'react';
import type { AuditFilterForm } from '#/features/audit/use-cases/useAuditPage';
import {
  choiceOf,
  EVENT_TYPE_OPTIONS,
  hasResourceType,
  OUTCOME_OPTIONS,
} from '#/features/audit/services/filters';
import { NOT_FILTERS } from '#/features/audit/services/page';
import { Button } from '#/shared/ui/Button';
import { DateTimeField, SelectField, TextField } from '#/shared/ui/Field';
import { FieldGrid, GridCell } from '#/shared/ui/FieldGrid';
import styles from '#/features/audit/ui/AuditFilters/AuditFilters.module.css';

// The form holds a draft: nothing is asked of the server until it is applied,
// and an applied filter lives in the address.
export function AuditFilters({ form }: { form: AuditFilterForm }) {
  const { draft, problems, set } = form;
  const hasType = hasResourceType(draft);
  const blockedId = useId();
  return (
    <form
      role="search"
      aria-label="Filter the audit trail"
      noValidate
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        // A browser says nothing of a half-typed first value until it is
        // left, so a submit with no blur in front of it asks the fields.
        const unread = [
          ...event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]'),
        ].filter((input) => input.validity.badInput);
        for (const input of unread)
          input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        if (unread.length === 0) form.submit();
      }}
    >
      <FieldGrid>
        <GridCell>
          <SelectField
            label="Event type"
            options={EVENT_TYPE_OPTIONS}
            value={choiceOf(draft, 'event_type')}
            onChange={(value) => {
              set('event_type', value);
            }}
          />
        </GridCell>
        <GridCell>
          <SelectField
            label="Outcome"
            options={OUTCOME_OPTIONS}
            value={choiceOf(draft, 'outcome')}
            onChange={(value) => {
              set('outcome', value);
            }}
          />
        </GridCell>
        <GridCell>
          <TextField
            label="Action"
            description="Exactly as logged, such as client.update."
            mono
            value={draft.action}
            error={problems.action}
            onChange={(value) => {
              set('action', value);
            }}
          />
        </GridCell>
        <GridCell>
          <TextField
            label="Resource type"
            description="Such as client, subject, role, group or scope."
            mono
            value={draft.resource_type}
            error={problems.resource_type}
            onChange={(value) => {
              set('resource_type', value);
            }}
          />
        </GridCell>
        <GridCell>
          <TextField
            label="Resource id"
            description={hasType ? undefined : 'Choose a resource type first.'}
            mono
            isDisabled={!hasType}
            value={draft.resource_id}
            error={problems.resource_id}
            onChange={(value) => {
              set('resource_id', value);
            }}
          />
        </GridCell>
        <GridCell>
          <TextField
            label="Actor (subject id)"
            description="The subject that acted, by its id."
            mono
            value={draft.actor_subject_id}
            error={problems.actor_subject_id}
            onChange={(value) => {
              set('actor_subject_id', value);
            }}
          />
        </GridCell>
        <GridCell>
          <DateTimeField
            label="From"
            description="Events at or after this minute."
            edge="start"
            value={draft.from}
            error={problems.from}
            onProblem={(message) => {
              form.report('from', message);
            }}
            onChange={(value) => {
              set('from', value);
            }}
          />
        </GridCell>
        <GridCell>
          <DateTimeField
            label="To"
            description="Events up to the end of this minute."
            edge="end"
            value={draft.to}
            error={problems.to}
            onProblem={(message) => {
              form.report('to', message);
            }}
            onChange={(value) => {
              set('to', value);
            }}
          />
        </GridCell>
      </FieldGrid>
      <p className={styles.hint}>{NOT_FILTERS}</p>
      <div className={styles.actions}>
        <Button
          type="submit"
          variant="primary"
          isDisabled={form.blocked !== null}
          {...(form.blocked === null ? {} : { 'aria-describedby': blockedId })}
        >
          Apply filters
        </Button>
        {form.blocked === null ? null : (
          <p id={blockedId} className={styles.blocked}>
            {form.blocked}
          </p>
        )}
        {form.filtered ? (
          <Button variant="quiet" onPress={form.clear}>
            Clear filters
          </Button>
        ) : null}
      </div>
    </form>
  );
}

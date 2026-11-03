import { useId } from 'react';
import type { AuditFilterForm } from '#/pages/audit/use-cases/useAuditPage';
import { Button } from '#/shared/ui/Button';
import { DateTimeField, SelectField, TextField } from '#/shared/ui/Field';
import { FieldGrid, GridCell } from '#/shared/ui/FieldGrid';
import styles from '#/pages/audit/ui/AuditFilters/AuditFilters.module.css';

// The form holds a draft: nothing is asked of the server until it is applied,
// and an applied filter lives in the address.
export function AuditFilters({ form }: { form: AuditFilterForm }) {
  const { draft, problems, set, words } = form;
  const blockedId = useId();
  return (
    <form
      role="search"
      aria-label={words.formLabel}
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
            label={words.eventType.label}
            options={words.eventType.options}
            value={form.choice('event_type')}
            onChange={(value) => {
              set('event_type', value);
            }}
          />
        </GridCell>
        <GridCell>
          <SelectField
            label={words.outcome.label}
            options={words.outcome.options}
            value={form.choice('outcome')}
            onChange={(value) => {
              set('outcome', value);
            }}
          />
        </GridCell>
        <GridCell>
          <TextField
            label={words.action.label}
            description={words.action.description}
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
            label={words.resourceType.label}
            description={words.resourceType.description}
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
            label={words.resourceId.label}
            description={form.hasType ? undefined : words.resourceId.needsType}
            mono
            isDisabled={!form.hasType}
            value={draft.resource_id}
            error={problems.resource_id}
            onChange={(value) => {
              set('resource_id', value);
            }}
          />
        </GridCell>
        <GridCell>
          <TextField
            label={words.actor.label}
            description={words.actor.description}
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
            label={words.from.label}
            description={words.from.description}
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
            label={words.to.label}
            description={words.to.description}
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
      <p className={styles.hint}>{words.notFilters}</p>
      <div className={styles.actions}>
        <Button
          type="submit"
          variant="primary"
          isDisabled={form.blocked !== null}
          {...(form.blocked === null ? {} : { 'aria-describedby': blockedId })}
        >
          {words.apply}
        </Button>
        {form.blocked === null ? null : (
          <p id={blockedId} className={styles.blocked}>
            {form.blocked}
          </p>
        )}
        {form.filtered ? (
          <Button variant="quiet" onPress={form.clear}>
            {words.clear}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

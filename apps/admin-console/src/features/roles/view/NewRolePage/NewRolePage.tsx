import type { SubmitEvent } from 'react';
import { AreaGate, areaAt } from '#/features/shell';
import { copyingText, rolesTrail } from '#/features/roles/service';
import { useNewRole, type Copying } from '#/features/roles/usecase/useNewRole.ts';
import { Button } from '#/shared/view/Button';
import { ButtonLink } from '#/shared/view/ButtonLink';
import { TextAreaField, TextField } from '#/shared/view/Field';
import { PageHeader } from '#/shared/view/PageHeader';
import styles from '#/features/roles/view/NewRolePage/NewRolePage.module.css';

function CopyNote({ copying }: { copying: Copying }) {
  switch (copying.status) {
    case 'none':
      return null;
    case 'loading':
      return <p className={styles.rule}>Reading the role to copy…</p>;
    case 'failed':
      return (
        <p className={styles.error}>
          The role to copy could not be read, so this makes a new role with nothing nested in it.
        </p>
      );
    case 'ready':
      return (
        <div className={styles.rule}>
          <span className={styles.place}>{copyingText(copying)}</span> Its description comes along.
          What it nests is added one role at a time after the copy is made, so a refusal of one
          leaves the rest in place.
          {copying.left.length === 0 ? null : (
            <>
              {' '}
              Not copied, since you could not nest it:
              <ul aria-label="Not copied" className={styles.left}>
                {copying.left.map((each) => (
                  <li key={each.name}>
                    <code>{each.name}</code> · {each.why}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      );
  }
}

function Form({ tenant }: { tenant: string }) {
  const page = useNewRole(tenant);
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    page.submit();
  };
  return (
    <form noValidate onSubmit={submit} className={styles.form}>
      <CopyNote copying={page.copying} />
      <TextField
        label="Name"
        description="Fixed once the role is made: tokens carry it. Unique among the tenant's own roles."
        value={page.name}
        error={page.errors.name}
        onChange={page.editName}
        mono
        autoFocus
      />
      <TextAreaField
        label="Description"
        description={page.descriptionRule}
        limit={page.descriptionLimit}
        value={page.description}
        error={page.errors.description}
        onChange={page.editDescription}
      />
      <div className={styles.actions}>
        {page.partial !== null ? (
          <ButtonLink href={page.partial.href} variant="primary">
            {`Open ${page.partial.name}`}
          </ButtonLink>
        ) : page.unconfirmed ? (
          <Button variant="primary" isDisabled={page.busy} onPress={page.check}>
            {`Look for ${page.name}`}
          </Button>
        ) : (
          <Button type="submit" variant="primary" isDisabled={page.busy}>
            {page.busy ? 'Creating…' : 'Create role'}
          </Button>
        )}
        <ButtonLink href={page.listHref}>Cancel</ButtonLink>
      </div>
      <p role="status" className={styles.message}>
        {page.partial?.text ?? page.message}
      </p>
    </form>
  );
}

export function NewRolePage({ tenant }: { tenant: string }) {
  const trail = rolesTrail(tenant, 'Create a role');
  return (
    <AreaGate tenant={tenant} area={areaAt('roles')} title="Create a role" breadcrumb={trail}>
      <PageHeader
        breadcrumb={trail}
        title="Create a role"
        description="A tenant role. A client's own roles are made from that client's page, since a token carries them under its name."
      />
      <Form tenant={tenant} />
    </AreaGate>
  );
}

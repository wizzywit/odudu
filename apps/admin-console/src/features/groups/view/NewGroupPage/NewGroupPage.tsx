import { useId, type SubmitEvent } from 'react';
import { AreaGate, areaAt } from '#/features/shell';
import { groupsTrail } from '#/features/groups/service.ts';
import { useNewGroup } from '#/features/groups/usecase/useNewGroup.ts';
import { Button } from '#/shared/view/Button';
import { ButtonLink } from '#/shared/view/ButtonLink';
import { TextAreaField, TextField } from '#/shared/view/Field';
import { GroupPicker } from '#/shared/view/GroupPicker';
import { PageHeader } from '#/shared/view/PageHeader';
import styles from '#/features/groups/view/NewGroupPage/NewGroupPage.module.css';

function Form({ tenant }: { tenant: string }) {
  const page = useNewGroup(tenant);
  const held = useId();
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    page.submit();
  };
  return (
    <form noValidate onSubmit={submit} className={styles.form}>
      <TextField
        label="Name"
        description="Fixed once the group is made: the groups claim carries its path. Unique among the groups beside it."
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
      <div className={styles.parent}>
        <GroupPicker
          label="Parent"
          picker={page.picker}
          selected={page.parentId === null ? [] : [page.parentId]}
          onChange={page.chooseParent}
          selectionMode="single"
          unavailableOf={page.unavailableOf}
        />
        <p className={styles.rule}>
          <span className={styles.place}>{page.place ?? 'Reading where it will sit…'}</span> Its
          members receive the roles of every group above it too. Choose the parent again to put it
          at the top level.
        </p>
        {page.errors.parent_id === undefined ? null : (
          <p className={styles.error}>{page.errors.parent_id}</p>
        )}
      </div>
      <div className={styles.actions}>
        {page.unconfirmed ? (
          <Button variant="primary" isDisabled={page.busy} onPress={page.check}>
            {`Look for ${page.name}`}
          </Button>
        ) : (
          <Button
            type="submit"
            variant="primary"
            isDisabled={page.busy || page.held !== null}
            {...(page.held === null ? {} : { 'aria-describedby': held })}
          >
            {page.busy ? 'Creating…' : 'Create group'}
          </Button>
        )}
        <ButtonLink href={page.listHref}>Cancel</ButtonLink>
      </div>
      {page.held === null ? null : (
        <p id={held} className={styles.rule}>
          {page.held}
        </p>
      )}
      <p role="status" className={styles.message}>
        {page.message}
      </p>
    </form>
  );
}

export function NewGroupPage({ tenant }: { tenant: string }) {
  const trail = groupsTrail(tenant, 'Create a group');
  return (
    <AreaGate tenant={tenant} area={areaAt('groups')} title="Create a group" breadcrumb={trail}>
      <PageHeader
        breadcrumb={trail}
        title="Create a group"
        description="A group starts with no members and no roles: give it roles from its Roles tab, and subjects join it from their own Groups tab."
      />
      <Form tenant={tenant} />
    </AreaGate>
  );
}

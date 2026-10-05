import type { SubmitEvent } from 'react';
import { AreaGate, areaAt } from '#/features/shell/index.ts';
import { groupsTrail } from '#/features/groups/service.ts';
import { useNewGroup } from '#/features/groups/usecase/useNewGroup.ts';
import { Button } from '#/shared/view/Button.tsx';
import { ButtonLink } from '#/shared/view/ButtonLink.tsx';
import { TextField } from '#/shared/view/Field.tsx';
import { GroupPicker } from '#/shared/view/GroupPicker.tsx';
import { PageHeader } from '#/shared/view/PageHeader.tsx';
import styles from '#/features/groups/view/Form.module.css';

function Form({ tenant }: { tenant: string }) {
  const page = useNewGroup(tenant);
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
      <TextField
        label="Description"
        description={page.descriptionRule}
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
          <Button type="submit" variant="primary" isDisabled={page.busy}>
            {page.busy ? 'Creating…' : 'Create group'}
          </Button>
        )}
        <ButtonLink href={page.listHref}>Cancel</ButtonLink>
      </div>
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

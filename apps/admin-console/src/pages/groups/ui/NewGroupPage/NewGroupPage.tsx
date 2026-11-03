import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { groupsTrail, GroupPicker } from '#/entities/group';
import { useNewGroup } from '#/pages/groups/use-cases/useNewGroup';
import {
  CreationActions,
  CreationForm,
  creationForm,
  NameDescriptionFields,
} from '#/shared/ui/CreationForm';
import { PageHeader } from '#/shared/ui/PageHeader';

function Form({ tenant }: { tenant: string }) {
  const page = useNewGroup(tenant);
  return (
    <CreationForm submit={page.submit}>
      <NameDescriptionFields
        nameHelp="Fixed once the group is made: the groups claim carries its path. Unique among the groups beside it."
        name={{ value: page.name, error: page.errors.name, onChange: page.editName }}
        description={{
          value: page.description,
          error: page.errors.description,
          onChange: page.editDescription,
          rule: page.descriptionRule,
          limit: page.descriptionLimit,
        }}
      />
      <div className={creationForm.parent}>
        <GroupPicker
          label="Parent"
          picker={page.picker}
          selected={page.parentId === null ? [] : [page.parentId]}
          onChange={page.chooseParent}
          selectionMode="single"
          unavailableOf={page.unavailableOf}
        />
        <p className={creationForm.rule}>
          <span className={creationForm.place}>{page.place ?? 'Reading where it will sit…'}</span>{' '}
          Its members receive the roles of every group above it too. Choose the parent again to put
          it at the top level.
        </p>
        {page.errors.parent_id === undefined ? null : (
          <p className={creationForm.error}>{page.errors.parent_id}</p>
        )}
      </div>
      <CreationActions
        noun="group"
        lookFor={page.name}
        busy={page.busy}
        unconfirmed={page.unconfirmed}
        onCheck={page.check}
        listHref={page.listHref}
        held={page.held}
        message={page.message}
      />
    </CreationForm>
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

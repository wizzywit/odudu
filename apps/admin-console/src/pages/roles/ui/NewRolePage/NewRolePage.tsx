import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { rolesTrail } from '#/entities/role';
import { useNewRole, type Copying } from '#/pages/roles/use-cases/useNewRole';
import {
  CreationActions,
  CreationForm,
  creationForm,
  NameDescriptionFields,
} from '#/shared/ui/CreationForm';
import { PageHeader } from '#/shared/ui/PageHeader';

function CopyNote({ copying, line }: { copying: Copying; line: string | null }) {
  switch (copying.status) {
    case 'none':
      return null;
    case 'loading':
      return <p className={creationForm.rule}>Reading the role to copy…</p>;
    case 'failed':
      return (
        <p className={creationForm.error}>
          The role to copy could not be read, so this makes a new role with nothing nested in it.
        </p>
      );
    case 'ready':
      return (
        <div className={creationForm.rule}>
          <span className={creationForm.place}>{line}</span> Its description comes along. What it
          nests is added one role at a time after the copy is made, so a refusal of one leaves the
          rest in place.
          {copying.left.length === 0 ? null : (
            <>
              {' '}
              Not copied, since you could not nest it:
              <ul aria-label="Not copied" className={creationForm.left}>
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
  return (
    <CreationForm submit={page.submit}>
      <CopyNote copying={page.copying} line={page.copyingLine} />
      <NameDescriptionFields
        nameHelp="Fixed once the role is made: tokens carry it. Unique among the tenant's own roles."
        name={{ value: page.name, error: page.errors.name, onChange: page.editName }}
        description={{
          value: page.description,
          error: page.errors.description,
          onChange: page.editDescription,
          rule: page.descriptionRule,
          limit: page.descriptionLimit,
        }}
      />
      <CreationActions
        noun="role"
        lookFor={page.name}
        busy={page.busy}
        unconfirmed={page.unconfirmed}
        onCheck={page.check}
        listHref={page.listHref}
        partial={page.partial}
        message={page.message}
      />
    </CreationForm>
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

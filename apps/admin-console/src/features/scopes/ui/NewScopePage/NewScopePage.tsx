import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { scopesTrail } from '#/features/scopes/services/address';
import { copyingText } from '#/features/scopes/services/scopeCopy';
import { useNewScope, type Copying } from '#/features/scopes/use-cases/useNewScope';
import {
  CreationActions,
  CreationForm,
  creationForm,
  NameDescriptionFields,
} from '#/shared/ui/CreationForm';
import { PageHeader } from '#/shared/ui/PageHeader';

function CopyNote({ copying }: { copying: Copying }) {
  switch (copying.status) {
    case 'none':
      return null;
    case 'loading':
      return <p className={creationForm.rule}>Reading the scope to copy…</p>;
    case 'failed':
      return (
        <p className={creationForm.error}>
          The scope to copy could not be read, so this makes a new scope with nothing mapped or
          bound.
        </p>
      );
    case 'ready':
      return (
        <div className={creationForm.rule}>
          <span className={creationForm.place}>{copyingText(copying)}</span> Its token flags,
          consent text and default assignment come along. Roles and mappers are added after the copy
          is made, so a refusal of one leaves the rest in place. The clients that carry it are not
          copied.
          {copying.left.length === 0 ? null : (
            <>
              {' '}
              Not copied, since you could not give it:
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
  const page = useNewScope(tenant);
  return (
    <CreationForm submit={page.submit}>
      <CopyNote copying={page.copying} />
      <NameDescriptionFields
        nameHelp="Fixed once the scope is made: a client asks for it by this name and a token carries it. Unique in the tenant."
        name={{ value: page.name, error: page.errors.name, onChange: page.editName }}
        description={{
          value: page.description,
          error: page.errors.description,
          onChange: page.editDescription,
          rule: page.descriptionRule,
        }}
      />
      <CreationActions
        noun="scope"
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

export function NewScopePage({ tenant }: { tenant: string }) {
  const trail = scopesTrail(tenant, 'Create a scope');
  return (
    <AreaGate tenant={tenant} area={areaAt('scopes')} title="Create a scope" breadcrumb={trail}>
      <PageHeader
        breadcrumb={trail}
        title="Create a scope"
        description="Its token flags, consent text and roles are set on its page once it is made."
      />
      <Form tenant={tenant} />
    </AreaGate>
  );
}

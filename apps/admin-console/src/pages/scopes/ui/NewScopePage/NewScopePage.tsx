import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { useScopeFrame } from '#/pages/scopes/use-cases/useScopeFrame';
import { useNewScope, type Copying } from '#/pages/scopes/use-cases/useNewScope';
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
          <span className={creationForm.place}>{line}</span> Its token flags, consent text and
          default assignment come along. Roles and mappers are added after the copy is made, so a
          refusal of one leaves the rest in place. The clients that carry it are not copied.
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
      <CopyNote copying={page.copying} line={page.copyingLine} />
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
  const { creation } = useScopeFrame(tenant);
  return (
    <AreaGate
      tenant={tenant}
      area={areaAt('scopes')}
      title={creation.title}
      breadcrumb={creation.breadcrumb}
    >
      <PageHeader
        breadcrumb={creation.breadcrumb}
        title={creation.title}
        description="Its token flags, consent text and roles are set on its page once it is made."
      />
      <Form tenant={tenant} />
    </AreaGate>
  );
}

import { AreaGate } from '#/widgets/shell';
import { useNewFlow, useNewFlowArea } from '#/pages/flow/use-cases/useNewFlow';
import { CreationActions, CreationForm } from '#/shared/ui/CreationForm';
import { TextField } from '#/shared/ui/Field';
import { PageHeader } from '#/shared/ui/PageHeader';

function Form({ tenant }: { tenant: string }) {
  const page = useNewFlow(tenant);
  const { words } = page;
  return (
    <CreationForm submit={page.submit}>
      <TextField
        label={words.nameLabel}
        description={words.nameHelp}
        value={page.name}
        error={page.error}
        onChange={page.editName}
        mono
        autoFocus
      />
      <CreationActions
        noun={words.noun}
        lookFor={page.name}
        busy={page.busy}
        unconfirmed={page.unconfirmed}
        onCheck={page.check}
        listHref={page.listHref}
        message={page.message}
      />
    </CreationForm>
  );
}

export function NewFlowPage({ tenant }: { tenant: string }) {
  const { area, title, description, trail } = useNewFlowArea(tenant);
  return (
    <AreaGate tenant={tenant} area={area} title={title} breadcrumb={trail}>
      <PageHeader breadcrumb={trail} title={title} description={description} />
      <Form tenant={tenant} />
    </AreaGate>
  );
}

import { AreaGate } from '#/widgets/shell';
import { areaAt } from '#/entities/area';
import { useClientFrame } from '#/pages/clients/use-cases/useClientFrame';
import { useNewClient } from '#/pages/clients/use-cases/useNewClient';
import { CreationActions, CreationForm } from '#/shared/ui/CreationForm';
import { SelectField, TextAreaField, TextField, UrlListField } from '#/shared/ui/Field';
import { PageHeader } from '#/shared/ui/PageHeader';
import { SecretDialog } from '#/shared/ui/SecretDialog';

function Form({ tenant }: { tenant: string }) {
  const page = useNewClient(tenant);
  return (
    <>
      <CreationForm submit={page.submit}>
        <TextField
          label="Client ID"
          description="What the application is configured with. Fixed once the client is made."
          value={page.clientId}
          error={page.errors.client_id}
          onChange={page.editClientId}
          mono
          autoFocus
        />
        <TextField
          label="Name"
          description="Shown to people on the consent screen. Leave it empty to use the client ID."
          value={page.name}
          error={page.errors.name}
          onChange={page.editName}
        />
        <TextAreaField
          label="Description"
          description={page.descriptionRule}
          limit={page.descriptionLimit}
          value={page.description}
          error={page.errors.description}
          onChange={page.editDescription}
        />
        <SelectField
          label="Kind"
          description={page.kindDescription}
          options={page.kindOptions}
          value={page.kind}
          onChange={page.editKind}
        />
        {page.asksRedirects ? (
          <UrlListField
            label="Redirect URIs"
            itemLabel="Redirect URI"
            description={page.redirectsDescription}
            error={page.errors.redirect_uris}
            value={page.redirectUris}
            onChange={page.editRedirectUris}
          />
        ) : null}
        <CreationActions
          noun="client"
          lookFor={page.clientId}
          busy={page.busy}
          unconfirmed={page.unconfirmed}
          onCheck={page.check}
          listHref={page.listHref}
          message={page.message}
        />
      </CreationForm>
      <SecretDialog
        secret={page.secret}
        title={page.secretTitle}
        label={page.secretLabel}
        onClose={page.closeSecret}
      >
        {page.secretNote}
      </SecretDialog>
    </>
  );
}

export function NewClientPage({ tenant }: { tenant: string }) {
  const { creation } = useClientFrame(tenant);
  return (
    <AreaGate
      tenant={tenant}
      area={areaAt('clients')}
      title={creation.title}
      breadcrumb={creation.breadcrumb}
    >
      <PageHeader
        breadcrumb={creation.breadcrumb}
        title={creation.title}
        description="A client starts with the default scopes and no roles. Everything else about it is set from its own page."
      />
      <Form tenant={tenant} />
    </AreaGate>
  );
}

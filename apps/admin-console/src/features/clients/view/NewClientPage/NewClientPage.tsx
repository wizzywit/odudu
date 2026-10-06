import { type SubmitEvent } from 'react';
import { AreaGate, areaAt } from '#/features/shell';
import {
  clientsTrail,
  SECRET_LABEL,
  TYPE_CHOICES,
  REDIRECTS_RULE,
} from '#/features/clients/service';
import { useNewClient } from '#/features/clients/usecase/useNewClient.ts';
import { Button } from '#/shared/view/Button';
import { ButtonLink } from '#/shared/view/ButtonLink';
import { SelectField, TextAreaField, TextField, UrlListField } from '#/shared/view/Field';
import { PageHeader } from '#/shared/view/PageHeader';
import { SecretDialog } from '#/shared/view/SecretDialog';
import styles from '#/features/clients/view/NewClientPage/NewClientPage.module.css';

function Form({ tenant }: { tenant: string }) {
  const page = useNewClient(tenant);
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    page.submit();
  };
  const chosen = TYPE_CHOICES.find((choice) => choice.id === page.type);
  return (
    <>
      <form noValidate onSubmit={submit} className={styles.form}>
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
          label="Type"
          description={chosen?.description}
          options={TYPE_CHOICES.map((choice) => ({ id: choice.id, label: choice.label }))}
          value={page.type}
          onChange={page.editType}
        />
        <UrlListField
          label="Redirect URIs"
          itemLabel="Redirect URI"
          description={`${REDIRECTS_RULE} ${page.redirectCount}`}
          error={page.errors.redirect_uris}
          value={page.redirectUris}
          onChange={page.editRedirectUris}
        />
        <div className={styles.actions}>
          {page.unconfirmed ? (
            <Button variant="primary" isDisabled={page.busy} onPress={page.check}>
              {`Look for ${page.clientId}`}
            </Button>
          ) : (
            <Button type="submit" variant="primary" isDisabled={page.busy}>
              {page.busy ? 'Creating…' : 'Create client'}
            </Button>
          )}
          <ButtonLink href={page.listHref}>Cancel</ButtonLink>
        </div>
        <p role="status" className={styles.message}>
          {page.message}
        </p>
      </form>
      <SecretDialog
        secret={page.secret}
        title={page.secretTitle}
        label={SECRET_LABEL}
        onClose={page.closeSecret}
      >
        {page.secretNote}
      </SecretDialog>
    </>
  );
}

export function NewClientPage({ tenant }: { tenant: string }) {
  const trail = clientsTrail(tenant, 'Create a client');
  return (
    <AreaGate tenant={tenant} area={areaAt('clients')} title="Create a client" breadcrumb={trail}>
      <PageHeader
        breadcrumb={trail}
        title="Create a client"
        description="A client starts with the default scopes and no roles. Everything else about it is set from its own page."
      />
      <Form tenant={tenant} />
    </AreaGate>
  );
}

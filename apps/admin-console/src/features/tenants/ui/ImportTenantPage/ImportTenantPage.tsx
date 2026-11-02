import { TENANT_DOCUMENT_MEDIA_TYPE } from '@odudu/contracts/admin';
import { useId } from 'react';
import { FileTrigger } from 'react-aria-components';
import { tenantsTrail } from '#/features/tenants/services/address';
import {
  useImportTenantPage,
  type ImportTenantPage as ImportState,
} from '#/features/tenants/use-cases/useImportTenantPage';
import { counted } from '#/shared/services/format';
import { SystemGate } from '#/features/tenants/ui/SystemGate';
import { Button } from '#/shared/ui/Button';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import { TextField } from '#/shared/ui/Field';
import { CreationForm } from '#/shared/ui/CreationForm';
import { PageHeader } from '#/shared/ui/PageHeader';
import { SecretDialog } from '#/shared/ui/SecretDialog';
import styles from '#/features/tenants/ui/ImportTenantPage/ImportTenantPage.module.css';

const ACCEPTED = ['application/json', TENANT_DOCUMENT_MEDIA_TYPE, '.json'];

function DocumentField({ state }: { state: ImportState }) {
  const label = useId();
  const described = useId();
  const error = useId();
  return (
    <div role="group" aria-labelledby={label} className={styles.file}>
      <span id={label} className={styles.label}>
        Tenant document
      </span>
      <div className={styles.fileRow}>
        <FileTrigger
          acceptedFileTypes={ACCEPTED}
          onSelect={(files) => {
            state.choose(files?.item(0) ?? null);
          }}
        >
          <Button
            aria-describedby={state.fileError === undefined ? described : `${described} ${error}`}
          >
            Choose a file…
          </Button>
        </FileTrigger>
        <span id={described} className={styles.chosen}>
          {state.file === null
            ? 'No file chosen. An export from any Odudu tenant, up to 16 MiB.'
            : `${state.file.name}, ${state.file.size}`}
        </span>
      </div>
      {state.fileError === undefined ? null : (
        <p id={error} className={styles.error}>
          {state.fileError}
        </p>
      )}
    </div>
  );
}

function Problems({ state }: { state: ImportState }) {
  const heading = useId();
  if (state.errors.length === 0) return null;
  return (
    <section aria-labelledby={heading} className={styles.problems}>
      <h2 id={heading} className={styles.problemsHeading}>
        {`${counted(state.errors.length, 'problem', 'problems')} in the document`}
      </h2>
      <p className={styles.lead}>
        Nothing was created. Each is listed at its place in the request.
      </p>
      <ul className={styles.problemList}>
        {state.errors.map((problem, index) => (
          <li key={`${problem.path}-${String(index)}`}>
            <code className={styles.path}>{problem.path}</code> {problem.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Imported({ state }: { state: ImportState }) {
  if (state.imported === null) return null;
  const { tenant, recordHref } = state.imported;
  return (
    <div className={styles.done}>
      <p className={styles.lead}>
        <code>{tenant}</code> was imported with fresh signing keys and fresh client secrets. An
        import creates no administrator, so nobody can sign in to its console until one is added.
      </p>
      <div className={styles.actions}>
        <Button variant="primary" onPress={state.begin.start}>
          Create the first administrator
        </Button>
        <ButtonLink href={recordHref}>{`Open ${tenant}`}</ButtonLink>
      </div>
    </div>
  );
}

function Import() {
  const state = useImportTenantPage();
  return (
    <>
      <PageHeader
        breadcrumb={tenantsTrail('Import a tenant')}
        title="Import a tenant"
        description="An import always creates a new tenant from an exported document. The whole document is checked before anything is written."
      />
      {state.imported === null ? (
        <CreationForm submit={state.submit}>
          <TextField
            label="Name"
            description={state.rule}
            value={state.name}
            error={state.nameError}
            onChange={state.editName}
            mono
            autoFocus
          />
          <TextField
            label="Display name"
            description="Optional."
            value={state.displayName}
            onChange={state.editDisplayName}
          />
          <DocumentField state={state} />
          <p role="status" className={styles.message}>
            {state.message}
          </p>
          <div className={styles.actions}>
            {state.unconfirmed ? (
              <Button variant="primary" onPress={state.check}>
                {`Check whether ${state.name} exists`}
              </Button>
            ) : (
              <Button type="submit" variant="primary" isDisabled={state.busy}>
                {state.busy ? 'Importing…' : 'Import'}
              </Button>
            )}
          </div>
        </CreationForm>
      ) : null}
      <Problems state={state} />
      <Imported state={state} />
      <SecretDialog
        secret={state.secret?.secret ?? null}
        title={`Client secret for ${state.secret?.clientId ?? ''}, ${state.secretPlace}`}
        label="client secret"
        onClose={state.closeSecret}
      >
        {`The import gave ${state.secret?.clientId ?? 'this client'} a fresh secret; the one it had where it was exported is not carried over.`}
      </SecretDialog>
    </>
  );
}

export function ImportTenantPage({ tenant }: { tenant: string }) {
  return (
    <SystemGate
      tenant={tenant}
      title="Import a tenant"
      breadcrumb={tenantsTrail('Import a tenant')}
    >
      <Import />
    </SystemGate>
  );
}

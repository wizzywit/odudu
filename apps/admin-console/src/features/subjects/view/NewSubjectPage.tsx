import type { SubmitEvent } from 'react';
import { subjectsTrail } from '#/features/subjects/service.ts';
import { useNewSubject } from '#/features/subjects/usecase/useNewSubject.ts';
import { SubjectsGate } from '#/features/subjects/view/SubjectsGate.tsx';
import { Button } from '#/shared/view/Button.tsx';
import { ButtonLink } from '#/shared/view/ButtonLink.tsx';
import { CapabilityNote } from '#/shared/view/CapabilityNote.tsx';
import { OwnDataFields, TextField } from '#/shared/view/Field.tsx';
import { PageHeader } from '#/shared/view/PageHeader.tsx';
import styles from '#/features/subjects/view/NewSubjectPage.module.css';

function Form({ tenant }: { tenant: string }) {
  const page = useNewSubject(tenant);
  if (page.refused !== null) {
    return <CapabilityNote capability={page.refused}>Creating a subject</CapabilityNote>;
  }
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    page.submit();
  };
  return (
    // A new subject is never the operator: their own details must not be offered.
    <OwnDataFields when={false}>
      <form noValidate onSubmit={submit} className={styles.form}>
        <TextField
          label="Username"
          description={page.rule}
          value={page.username}
          error={page.usernameError}
          onChange={page.editUsername}
          autoComplete="username"
          mono
          autoFocus
        />
        <TextField
          label="Email"
          description="Optional. Unverified until the subject proves it or you mark it verified on the Profile tab."
          type="email"
          value={page.email}
          error={page.emailError}
          autoComplete="email"
          onChange={page.editEmail}
        />
        <div className={styles.actions}>
          {page.unconfirmed ? (
            <Button variant="primary" isDisabled={page.busy} onPress={page.check}>
              {`Look for ${page.username}`}
            </Button>
          ) : (
            <Button type="submit" variant="primary" isDisabled={page.busy}>
              {page.busy ? 'Creating…' : 'Create subject'}
            </Button>
          )}
          <ButtonLink href={page.listHref}>Cancel</ButtonLink>
        </div>
        <p role="status" className={styles.message}>
          {page.message}
        </p>
      </form>
    </OwnDataFields>
  );
}

export function NewSubjectPage({ tenant }: { tenant: string }) {
  return (
    <SubjectsGate
      tenant={tenant}
      title="Create a subject"
      breadcrumb={subjectsTrail(tenant, 'Create a subject')}
    >
      <PageHeader
        breadcrumb={subjectsTrail(tenant, 'Create a subject')}
        title="Create a subject"
        description="A subject created here has no password: it owes a password change, and you issue it a one-time password from its Credentials tab."
      />
      <Form tenant={tenant} />
    </SubjectsGate>
  );
}

import { VisuallyHidden } from 'react-aria-components';
import { useNewTenant } from '#/features/tenants/use-cases/useNewTenant';
import { useAdministratorStep } from '#/features/tenants/use-cases/useAdministratorStep';
import { type StepFeedback } from '#/features/tenants/use-cases/useStepFeedback';
import { useTenantStep } from '#/features/tenants/use-cases/useTenantStep';
import {
  systemAdminsTrail,
  tenantAdministratorTrail,
  tenantsTrail,
} from '#/features/tenants/services/systemTrail';
import { type Creation, type CreationFlow } from '#/features/tenants/services/creation';
import { flowOf } from '#/features/tenants/services/creationDraft';
import { doneStepOf, type DoneStep } from '#/features/tenants/services/done';
import {
  ADD_SYSTEM_ADMIN_TITLE,
  CREATE_TENANT_TITLE,
  creationHeading,
  pageOf,
} from '#/features/tenants/services/creationPosition';
import {
  firstAdministratorNote,
  originText,
} from '#/features/tenants/services/administratorOrigin';
import { useAdministratorTitle } from '#/features/tenants/use-cases/useAdministratorTitle';
import { ReplaceUnfinished } from '#/features/tenants/ui/ReplaceUnfinished';
import { SystemGate } from '#/features/tenants/ui/SystemGate';
import { Button } from '#/shared/ui/Button';
import { ButtonLink } from '#/shared/ui/ButtonLink';
import { ChecklistField } from '#/shared/ui/ChecklistField';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { TextField } from '#/shared/ui/Field';
import { CreationForm, creationForm } from '#/shared/ui/CreationForm';
import { PageHeader } from '#/shared/ui/PageHeader';
import { SecretDialog } from '#/shared/ui/SecretDialog';
import { recordTab } from '#/shared/ui/RecordTab';
import styles from '#/features/tenants/ui/NewTenantPage/NewTenantPage.module.css';

const STEPS = ['The tenant', 'Its first administrator', 'Done'] as const;

function Steps({ at }: { at: number }) {
  return (
    <ol aria-label="Steps" className={styles.steps}>
      {STEPS.map((label, index) => (
        <li
          key={label}
          className={styles.step}
          data-state={index < at ? 'done' : index === at ? 'current' : 'next'}
          {...(index === at ? { 'aria-current': 'step' } : {})}
        >
          <span className={styles.number} aria-hidden="true">
            {index + 1}
          </span>
          {label}
          {index < at ? <VisuallyHidden elementType="span">, done</VisuallyHidden> : null}
        </li>
      ))}
    </ol>
  );
}

function Message({ text }: { text: string | null }) {
  return (
    <p role="status" className={styles.message}>
      {text}
    </p>
  );
}

interface StepProps<S extends Creation['step']> {
  creation: Extract<Creation, { step: S }>;
  feedback: StepFeedback;
  update: (creation: Creation) => void;
  systemIssuer: string | undefined;
}

function Tenant({ creation, feedback, update, systemIssuer }: StepProps<'tenant'>) {
  const step = useTenantStep(creation, feedback, update, systemIssuer);
  return (
    <CreationForm submit={step.submit}>
      <TextField
        label="Name"
        description={step.rule}
        value={step.name}
        error={step.nameError}
        onChange={step.editName}
        mono
        autoFocus
      />
      <div className={styles.preview}>
        <span className={styles.previewLabel}>Issuer</span>
        <code className={styles.previewValue}>
          {step.issuer ?? 'Shown once the name follows the rule.'}
        </code>
      </div>
      <TextField
        label="Display name"
        description="Optional. What the console and the tenant's pages call it."
        value={step.displayName}
        error={step.displayNameError}
        onChange={step.editDisplayName}
      />
      <Message text={step.message} />
      <div className={styles.actions}>
        {step.unconfirmed ? (
          <Button variant="primary" isDisabled={step.busy} onPress={step.check}>
            {`Check whether ${step.name} was created`}
          </Button>
        ) : (
          <Button type="submit" variant="primary" isDisabled={step.busy}>
            {step.busy ? 'Creating…' : 'Create tenant'}
          </Button>
        )}
      </div>
    </CreationForm>
  );
}

function Administrator({ creation, feedback, update, systemIssuer }: StepProps<'administrator'>) {
  const step = useAdministratorStep(creation, feedback, update, systemIssuer);
  const note = firstAdministratorNote(step.origin, step.tenant);
  return (
    <>
      <p className={styles.lead}>
        {step.systemAdminsHref === null ? (
          <>
            <code>{step.tenant}</code> {originText(step.origin)}
          </>
        ) : (
          <>
            A system administrator holds tenant-admin in <code>system</code>, which carries every
            capability and reaches every tenant.
          </>
        )}{' '}
        The administrator is created with a one-time password, shown once, and is asked to change it
        at their first sign-in.
      </p>
      <CreationForm submit={step.submit}>
        {step.created ? (
          <dl className={recordTab.fixed}>
            <dt>Username</dt>
            <dd>
              <code>{step.username}</code>, created. What is left is what they hold and the one-time
              password.
            </dd>
          </dl>
        ) : (
          <>
            <TextField
              label="Username"
              value={step.username}
              error={step.usernameError}
              onChange={step.editUsername}
              mono
              autoFocus
            />
            <TextField
              label="Email"
              description="Optional."
              type="email"
              value={step.email}
              error={step.emailError}
              onChange={step.editEmail}
            />
          </>
        )}
        {note === null ? null : <p className={styles.lead}>{note}</p>}
        {step.choosing ? (
          <ChecklistField
            label="What they hold"
            description="Full is every capability. A part of it is any set of capabilities, each changeable later from the tenant's Administrators tab. You can give only what you hold."
            options={step.holdingOptions}
            value={step.holdings}
            error={step.holdingsError}
            onChange={step.chooseHoldings}
          />
        ) : null}
        {step.needs.map((capability) => (
          <CapabilityNote key={capability} capability={capability}>
            Creating the administrator
          </CapabilityNote>
        ))}
        <Message text={step.message} />
        <div className={styles.actions}>
          {step.unconfirmed ? (
            <Button variant="primary" isDisabled={step.busy} onPress={step.check}>
              {`Check whether ${step.username} was created`}
            </Button>
          ) : (
            <Button type="submit" variant="primary" isDisabled={step.busy || step.needs.length > 0}>
              {step.busy ? 'Working…' : step.created ? 'Continue' : 'Create administrator'}
            </Button>
          )}
        </div>
      </CreationForm>
      <SecretDialog
        secret={step.secret}
        title={`${step.username}'s one-time password`}
        label="one-time password"
        onClose={step.closeSecret}
      >
        {`${step.username} signs in to ${step.tenant} with it once${step.issuer === null ? '' : `, at ${step.issuer}`}, and then chooses a password of their own.`}
      </SecretDialog>
    </>
  );
}

function Done({ step, onStartOver }: { step: DoneStep; onStartOver: () => void }) {
  if (step.systemAdminsHref !== null) {
    return (
      <div className={creationForm.form}>
        <p className={styles.lead}>
          <code>{step.username}</code> {step.systemHolds} <code>system</code>, and changes the
          one-time password at their first sign-in.
        </p>
        <div className={styles.actions}>
          <ButtonLink href={step.systemAdminsHref} variant="primary">
            Back to System administrators
          </ButtonLink>
        </div>
      </div>
    );
  }
  return (
    <div className={creationForm.form}>
      <p className={styles.lead}>
        <code>{step.tenant}</code> has an administrator, <code>{step.username}</code>, who holds{' '}
        {step.holds} and changes the one-time password at their first sign-in.
      </p>
      <div className={styles.actions}>
        <ButtonLink href={step.recordHref} variant="primary">
          {`Open ${step.tenant}`}
        </ButtonLink>
        <ButtonLink href={step.enterHref}>{`Enter ${step.tenant}`}</ButtonLink>
        <Button variant="quiet" onPress={onStartOver}>
          {step.again === 'tenant' ? 'Create another tenant' : 'Add another administrator'}
        </Button>
      </div>
    </div>
  );
}

function Creation({ flow }: { flow: CreationFlow }) {
  const { creation, update, feedback, systemIssuer, startOver, replacing, replace, keep } =
    useNewTenant(flow);
  const { at, title, breadcrumb } = creationHeading(flow, pageOf(creation));
  return (
    <>
      <PageHeader
        breadcrumb={breadcrumb}
        title={title}
        description="Where it has got to is kept in this tab, so a reload carries on from the last request that landed."
        {...(creation.step === 'administrator'
          ? {
              actions: (
                <Button variant="quiet" onPress={startOver}>
                  Start over
                </Button>
              ),
            }
          : {})}
      />
      {flow === 'tenant' ? <Steps at={at} /> : null}
      {creation.step === 'tenant' ? (
        <Tenant
          creation={creation}
          feedback={feedback}
          update={update}
          systemIssuer={systemIssuer}
        />
      ) : null}
      {creation.step === 'administrator' ? (
        <Administrator
          creation={creation}
          feedback={feedback}
          update={update}
          systemIssuer={systemIssuer}
        />
      ) : null}
      {creation.step === 'done' ? (
        <Done step={doneStepOf(creation, flow)} onStartOver={startOver} />
      ) : null}
      <ReplaceUnfinished unfinished={replacing} onReplace={replace} onKeep={keep} />
    </>
  );
}

export function NewTenantPage({ tenant }: { tenant: string }) {
  return (
    <SystemGate
      tenant={tenant}
      title={CREATE_TENANT_TITLE}
      breadcrumb={tenantsTrail(CREATE_TENANT_TITLE)}
    >
      <Creation flow="tenant" />
    </SystemGate>
  );
}

// system's own administrators are added under System administrators, so the
// page keeps that area's name and trail while access is checked.
export function NewSystemAdministratorPage({ tenant }: { tenant: string }) {
  return (
    <SystemGate
      tenant={tenant}
      title={ADD_SYSTEM_ADMIN_TITLE}
      breadcrumb={systemAdminsTrail(ADD_SYSTEM_ADMIN_TITLE)}
    >
      <Creation flow="system-administrator" />
    </SystemGate>
  );
}

export function NewAdministratorPage({ tenant, name }: { tenant: string; name: string }) {
  const title = useAdministratorTitle(name);
  return (
    <SystemGate tenant={tenant} title={title} breadcrumb={tenantAdministratorTrail(name)}>
      <Creation flow={flowOf(name)} />
    </SystemGate>
  );
}

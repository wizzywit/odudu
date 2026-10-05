import type { SubmitEvent } from 'react';
import { VisuallyHidden } from 'react-aria-components';
import {
  useNewTenant,
  type AdministratorStep,
  type DoneStep,
  type TenantStep,
} from '#/features/tenants/usecase/useNewTenant.ts';
import {
  administratorTitle,
  flowOf,
  systemAdminsTrail,
  tenantAdministratorTrail,
  tenantsTrail,
  type CreationFlow,
} from '#/features/tenants/service.ts';
import { useAdministratorTitle } from '#/features/tenants/usecase/useAdministratorTitle.ts';
import { ReplaceUnfinished } from '#/features/tenants/view/ReplaceUnfinished';
import { SystemGate } from '#/features/tenants/view/SystemGate';
import { Button } from '#/shared/view/Button';
import { ButtonLink } from '#/shared/view/ButtonLink';
import { ChecklistField } from '#/shared/view/ChecklistField';
import { CapabilityNote } from '#/shared/view/CapabilityNote';
import { TextField } from '#/shared/view/Field';
import { PageHeader } from '#/shared/view/PageHeader';
import { SecretDialog } from '#/shared/view/SecretDialog';
import styles from '#/features/tenants/view/NewTenantPage/NewTenantPage.module.css';

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

function submitted(run: () => void) {
  return (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    run();
  };
}

function Message({ text }: { text: string | null }) {
  return (
    <p role="status" className={styles.message}>
      {text}
    </p>
  );
}

function Tenant({ step }: { step: TenantStep }) {
  return (
    <form noValidate onSubmit={submitted(step.submit)} className={styles.form}>
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
    </form>
  );
}

const ORIGIN: Readonly<Record<AdministratorStep['origin'], string>> = {
  created: 'was created. It has no administrator yet, so nobody can sign in to its console.',
  imported:
    'was imported. An import creates no administrator, so nobody can sign in to its console yet.',
  existing: 'gets another administrator.',
};

function Administrator({ step }: { step: AdministratorStep }) {
  return (
    <>
      <p className={styles.lead}>
        {step.systemAdminsHref === null ? (
          <>
            <code>{step.tenant}</code> {ORIGIN[step.origin]}
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
      <form noValidate onSubmit={submitted(step.submit)} className={styles.form}>
        {step.created ? (
          <dl className={styles.fixed}>
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
        {step.origin === 'existing' ? null : (
          <p className={styles.lead}>
            {`The first administrator holds Full, so somebody in ${step.tenant} can give every capability; narrow it afterwards under Administrators.`}
          </p>
        )}
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
      </form>
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
      <div className={styles.form}>
        <p className={styles.lead}>
          <code>{step.username}</code>{' '}
          {step.holds === 'tenant-admin'
            ? 'is a system administrator, holding tenant-admin in'
            : `holds ${step.holds} in`}{' '}
          <code>system</code>, and changes the one-time password at their first sign-in.
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
    <div className={styles.form}>
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
  const { current, startOver, replacing, replace, keep } = useNewTenant(flow);
  const at = current.step === 'tenant' ? 0 : current.step === 'administrator' ? 1 : 2;
  const systemAdmins = current.step === 'tenant' ? null : current.systemAdminsHref;
  const title =
    current.step === 'tenant'
      ? 'Create a tenant'
      : systemAdmins !== null
        ? 'Add a system administrator'
        : administratorTitle(
            current.tenant,
            flow === 'tenant' ? 'created' : current.step === 'done' ? 'existing' : current.origin,
          );
  const breadcrumb =
    systemAdmins !== null
      ? systemAdminsTrail(title)
      : flow === 'tenant' || current.step === 'tenant'
        ? tenantsTrail(title)
        : tenantAdministratorTrail(current.tenant);
  return (
    <>
      <PageHeader
        breadcrumb={breadcrumb}
        title={title}
        description="Where it has got to is kept in this tab, so a reload carries on from the last request that landed."
        {...(current.step === 'administrator'
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
      {current.step === 'tenant' ? <Tenant step={current} /> : null}
      {current.step === 'administrator' ? <Administrator step={current} /> : null}
      {current.step === 'done' ? <Done step={current} onStartOver={startOver} /> : null}
      <ReplaceUnfinished unfinished={replacing} onReplace={replace} onKeep={keep} />
    </>
  );
}

export function NewTenantPage({ tenant }: { tenant: string }) {
  return (
    <SystemGate
      tenant={tenant}
      title="Create a tenant"
      breadcrumb={tenantsTrail('Create a tenant')}
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
      title="Add a system administrator"
      breadcrumb={systemAdminsTrail('Add a system administrator')}
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

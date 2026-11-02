import type { ListExecutionsResponse, Settings } from '@odudu/contracts/admin';
import { useEffect, useRef } from 'react';
import { AreaGate, areaAt } from '#/features/shell';
import {
  authenticatorText,
  FLOW_RULE,
  FLOW_TITLE,
  hasOtpStep,
  NO_OTP_STEP,
  OTP,
  OTP_LABEL,
  OTP_RULE,
  OTP_TITLE,
  OTP_UNREAD,
  otpReading,
  otpRequired,
  REQUIREMENT_OPTIONS,
  requirementText,
  type Direction,
} from '#/features/flow/services';
import { useFlowSteps, type FlowSteps } from '#/features/flow/use-cases/useFlowSteps';
import { useOtpRequirement, type OtpRequirement } from '#/features/flow/use-cases/useOtpRequirement';
import { useFlowRead } from '#/features/flow/use-cases/useFlowPage';
import { useTenantSettingsRead } from '#/shared/use-cases/useTenantSettingsRead';
import { Button } from '#/shared/ui/Button';
import { InlineFields, SelectField, ToggleField } from '#/shared/ui/Field';
import { PageHeader } from '#/shared/ui/PageHeader';
import { ReadGate } from '#/shared/ui/ReadGate';
import { SaveSection } from '#/shared/ui/SaveSection';
import styles from '#/features/flow/ui/FlowPage/FlowPage.module.css';

function Add({ flow }: { flow: FlowSteps }) {
  if (flow.offered.length === 0) {
    return <p className={styles.rule}>Every authenticator the server has is already a step.</p>;
  }
  return (
    <div className={styles.add}>
      <SelectField
        label="Add a step"
        options={flow.offered.map((name) => ({ id: name, label: name }))}
        value={flow.adding}
        onChange={flow.chooseAddition}
      />
      <SelectField
        label="Requirement of the new step"
        options={REQUIREMENT_OPTIONS}
        value={flow.addingRequirement}
        onChange={flow.chooseAdditionRequirement}
      />
      <Button onPress={flow.add}>Add step</Button>
    </div>
  );
}

function Steps({ flow, reading }: { flow: FlowSteps; reading: string | null }) {
  const s = flow.save;
  const list = useRef<HTMLOListElement>(null);
  const moving = useRef<{ authenticator: string; direction: Direction } | null>(null);
  // A moved step keeps the focus, and when it cannot go further in that
  // direction the focus goes to the way back.
  useEffect(() => {
    const target = moving.current;
    moving.current = null;
    if (target === null) return;
    const press = (direction: Direction): HTMLButtonElement | null =>
      list.current?.querySelector<HTMLButtonElement>(
        `button[aria-label="Move ${CSS.escape(target.authenticator)} ${direction}"]`,
      ) ?? null;
    const same = press(target.direction);
    const back = press(target.direction === 'up' ? 'down' : 'up');
    (same?.disabled === false ? same : back)?.focus();
  });
  const move = (authenticator: string, direction: Direction): void => {
    moving.current = { authenticator, direction };
    flow.move(authenticator, direction);
  };
  return (
    <SaveSection title="Steps" description={FLOW_RULE} noticeTitle={FLOW_TITLE} save={s}>
      <ol ref={list} aria-label="Sign-in steps" className={styles.steps}>
        {flow.steps.map((step, at) => (
          <li
            key={step.authenticator}
            className={styles.step}
            {...(step.requirement === 'disabled' ? { 'data-disabled': '' } : {})}
          >
            <span className={styles.position} aria-hidden="true">
              {at + 1}
            </span>
            <div className={styles.name}>
              <code>{step.authenticator}</code>
              <span className={styles.what}>{authenticatorText(step.authenticator)}</span>
              <span className={styles.what}>{requirementText(step.requirement)}</span>
              {step.authenticator === OTP && reading !== null ? (
                <span className={styles.otp}>{reading}</span>
              ) : null}
            </div>
            <InlineFields>
              <SelectField
                label={`Requirement for ${step.authenticator}`}
                hideLabel
                options={REQUIREMENT_OPTIONS}
                value={step.requirement}
                onChange={(value) => {
                  flow.setRequirement(step.authenticator, value);
                }}
              />
            </InlineFields>
            <div className={styles.moves}>
              <Button
                size="small"
                variant="quiet"
                aria-label={`Move ${step.authenticator} up`}
                isDisabled={!flow.canMove(step.authenticator, 'up')}
                onPress={() => {
                  move(step.authenticator, 'up');
                }}
              >
                Up
              </Button>
              <Button
                size="small"
                variant="quiet"
                aria-label={`Move ${step.authenticator} down`}
                isDisabled={!flow.canMove(step.authenticator, 'down')}
                onPress={() => {
                  move(step.authenticator, 'down');
                }}
              >
                Down
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <Add flow={flow} />
      {s.fieldErrors.steps === undefined ? null : (
        <p role="alert" className={styles.error}>
          {s.fieldErrors.steps}
        </p>
      )}
    </SaveSection>
  );
}

function Otp({ otp, hasStep }: { otp: OtpRequirement; hasStep: boolean }) {
  const s = otp.save;
  return (
    <SaveSection title={OTP_TITLE} description={OTP_RULE} save={s}>
      <ToggleField
        label={OTP_LABEL}
        value={s.values.otp_required}
        error={s.fieldErrors.otp_required}
        changed={s.changed.includes('otp_required')}
        onChange={(value) => {
          s.edit('otp_required', value);
        }}
      />
      {hasStep ? null : <p className={styles.rule}>{NO_OTP_STEP}</p>}
    </SaveSection>
  );
}

function StepsReady({
  tenant,
  data,
  etag,
  gone,
  reading,
}: {
  tenant: string;
  data: ListExecutionsResponse;
  etag: string;
  gone: boolean;
  reading: string | null;
}) {
  const flow = useFlowSteps({ tenant, data, etag, gone });
  return <Steps flow={flow} reading={reading} />;
}

function OtpReady({
  tenant,
  data,
  etag,
  gone,
  hasStep,
}: {
  tenant: string;
  data: Settings;
  etag: string;
  gone: boolean;
  hasStep: boolean;
}) {
  const otp = useOtpRequirement({ tenant, data, etag, gone });
  return <Otp otp={otp} hasStep={hasStep} />;
}

function Flow({ tenant }: { tenant: string }) {
  const flow = useFlowRead(tenant);
  const settings = useTenantSettingsRead(tenant);
  return (
    <ReadGate
      read={flow}
      label="Loading the flow"
      fields={3}
      failed="The sign-in flow could not be loaded"
    >
      {(data, etag) => (
        <div className={styles.page}>
          <StepsReady
            tenant={tenant}
            data={data}
            etag={etag}
            gone={flow.gone}
            reading={settings.data === undefined ? null : otpReading(otpRequired(settings.data))}
          />
          {settings.status === 'failed' ? <p className={styles.rule}>{OTP_UNREAD}</p> : null}
          {settings.data === undefined || settings.etag === null ? null : (
            <OtpReady
              tenant={tenant}
              data={settings.data}
              etag={settings.etag}
              gone={settings.gone}
              hasStep={hasOtpStep(data.items)}
            />
          )}
        </div>
      )}
    </ReadGate>
  );
}

export function FlowPage({ tenant }: { tenant: string }) {
  return (
    <AreaGate tenant={tenant} area={areaAt('flow')} title={FLOW_TITLE}>
      <PageHeader
        kicker={tenant}
        title={FLOW_TITLE}
        description="What a subject is asked, in what order, to sign in to this tenant."
      />
      <Flow tenant={tenant} />
    </AreaGate>
  );
}

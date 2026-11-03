import type { ListExecutionsResponse, Settings } from '@odudu/contracts/admin';
import { useEffect, useRef } from 'react';
import { AreaGate } from '#/widgets/shell';
import type { FlowWords } from '#/pages/flow/services/flowWording';
import type { Direction } from '#/pages/flow/services/steps';
import { useFlowPage } from '#/pages/flow/use-cases/useFlowPage';
import { useFlowSections } from '#/pages/flow/use-cases/useFlowSections';
import { useFlowSteps, type FlowSteps } from '#/pages/flow/use-cases/useFlowSteps';
import { useOtpRequirement, type OtpRequirement } from '#/pages/flow/use-cases/useOtpRequirement';
import { Button } from '#/shared/ui/Button';
import { InlineFields, SelectField, ToggleField } from '#/shared/ui/Field';
import { PageHeader } from '#/shared/ui/PageHeader';
import { ReadGate } from '#/shared/ui/ReadGate';
import { SaveSection } from '#/shared/ui/SaveSection';
import styles from '#/pages/flow/ui/FlowPage/FlowPage.module.css';

function Add({ flow, words }: { flow: FlowSteps; words: FlowWords['steps'] }) {
  if (flow.offered.length === 0) {
    return <p className={styles.rule}>{words.allAdded}</p>;
  }
  return (
    <div className={styles.add}>
      <SelectField
        label={words.addLabel}
        options={flow.offered}
        value={flow.adding}
        onChange={flow.chooseAddition}
      />
      <SelectField
        label={words.addRequirementLabel}
        options={words.requirements}
        value={flow.addingRequirement}
        onChange={flow.chooseAdditionRequirement}
      />
      <Button onPress={flow.add}>{words.addButton}</Button>
    </div>
  );
}

function Steps({ flow, words }: { flow: FlowSteps; words: FlowWords['steps'] }) {
  const s = flow.save;
  const list = useRef<HTMLOListElement>(null);
  const moving = useRef<{ authenticator: string; direction: Direction } | null>(null);
  // A moved step keeps the focus, and when it cannot go further in that
  // direction the focus goes to the way back.
  useEffect(() => {
    const target = moving.current;
    moving.current = null;
    if (target === null) return;
    const row = flow.rows.find((each) => each.authenticator === target.authenticator);
    if (row === undefined) return;
    const press = (label: string): HTMLButtonElement | null =>
      list.current?.querySelector<HTMLButtonElement>(`button[aria-label="${CSS.escape(label)}"]`) ??
      null;
    const same = press(target.direction === 'up' ? row.up.label : row.down.label);
    const back = press(target.direction === 'up' ? row.down.label : row.up.label);
    (same?.disabled === false ? same : back)?.focus();
  });
  const move = (authenticator: string, direction: Direction): void => {
    moving.current = { authenticator, direction };
    flow.move(authenticator, direction);
  };
  return (
    <SaveSection
      title={words.title}
      description={words.rule}
      noticeTitle={words.noticeTitle}
      save={s}
    >
      <ol ref={list} aria-label={words.listLabel} className={styles.steps}>
        {flow.rows.map((row) => (
          <li
            key={row.authenticator}
            className={styles.step}
            {...(row.disabled ? { 'data-disabled': '' } : {})}
          >
            <span className={styles.position} aria-hidden="true">
              {row.position}
            </span>
            <div className={styles.name}>
              <code>{row.authenticator}</code>
              <span className={styles.what}>{row.what}</span>
              <span className={styles.what}>{row.requirementWhat}</span>
              {row.otpReading === null ? null : (
                <span className={styles.otp}>{row.otpReading}</span>
              )}
            </div>
            <InlineFields>
              <SelectField
                label={row.requirementLabel}
                hideLabel
                options={words.requirements}
                value={row.requirement}
                onChange={(value) => {
                  flow.setRequirement(row.authenticator, value);
                }}
              />
            </InlineFields>
            <div className={styles.moves}>
              <Button
                size="small"
                variant="quiet"
                aria-label={row.up.label}
                isDisabled={!row.up.enabled}
                onPress={() => {
                  move(row.authenticator, 'up');
                }}
              >
                {words.up}
              </Button>
              <Button
                size="small"
                variant="quiet"
                aria-label={row.down.label}
                isDisabled={!row.down.enabled}
                onPress={() => {
                  move(row.authenticator, 'down');
                }}
              >
                {words.down}
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <Add flow={flow} words={words} />
      {s.fieldErrors.steps === undefined ? null : (
        <p role="alert" className={styles.error}>
          {s.fieldErrors.steps}
        </p>
      )}
    </SaveSection>
  );
}

function Otp({ otp, words }: { otp: OtpRequirement; words: FlowWords['otp'] }) {
  const s = otp.save;
  return (
    <SaveSection title={words.title} description={words.rule} save={s}>
      <ToggleField
        label={words.label}
        value={s.values.otp_required}
        error={s.fieldErrors.otp_required}
        changed={s.changed.includes('otp_required')}
        onChange={(value) => {
          s.edit('otp_required', value);
        }}
      />
      {otp.hasStep ? null : <p className={styles.rule}>{words.noStep}</p>}
    </SaveSection>
  );
}

function StepsReady({
  tenant,
  data,
  etag,
  gone,
  reading,
  words,
}: {
  tenant: string;
  data: ListExecutionsResponse;
  etag: string;
  gone: boolean;
  reading: string | null;
  words: FlowWords['steps'];
}) {
  const flow = useFlowSteps({ tenant, data, etag, gone, reading });
  return <Steps flow={flow} words={words} />;
}

function OtpReady({
  tenant,
  data,
  etag,
  gone,
  steps,
  words,
}: {
  tenant: string;
  data: Settings;
  etag: string;
  gone: boolean;
  steps: ListExecutionsResponse['items'];
  words: FlowWords['otp'];
}) {
  const otp = useOtpRequirement({ tenant, data, etag, gone, steps });
  return <Otp otp={otp} words={words} />;
}

function Flow({ tenant }: { tenant: string }) {
  const { flow, words, reading, unread, otp } = useFlowSections(tenant);
  return (
    <ReadGate read={flow} label={words.loading} fields={3} failed={words.failed}>
      {(data, etag) => (
        <div className={styles.page}>
          <StepsReady
            tenant={tenant}
            data={data}
            etag={etag}
            gone={flow.gone}
            reading={reading}
            words={words.steps}
          />
          {unread ? <p className={styles.rule}>{words.unread}</p> : null}
          {otp === null ? null : (
            <OtpReady
              tenant={tenant}
              data={otp.data}
              etag={otp.etag}
              gone={otp.gone}
              steps={data.items}
              words={words.otp}
            />
          )}
        </div>
      )}
    </ReadGate>
  );
}

export function FlowPage({ tenant }: { tenant: string }) {
  const { area, title, words } = useFlowPage();
  return (
    <AreaGate tenant={tenant} area={area} title={title}>
      <PageHeader kicker={tenant} title={title} description={words.description} />
      <Flow tenant={tenant} />
    </AreaGate>
  );
}

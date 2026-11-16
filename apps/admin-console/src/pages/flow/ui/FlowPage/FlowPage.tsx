import type { Settings } from '#/entities/tenant';
import type { ListExecutionsResponse } from '#/pages/flow/types/executions';
import { AreaGate } from '#/widgets/shell';
import type { FlowWords } from '#/pages/flow/services/flowWording';
import { useFlowPage } from '#/pages/flow/use-cases/useFlowPage';
import { useFlowSections } from '#/pages/flow/use-cases/useFlowSections';
import { useFlowSteps } from '#/pages/flow/use-cases/useFlowSteps';
import { useOtpRequirement, type OtpRequirement } from '#/pages/flow/use-cases/useOtpRequirement';
import { ToggleField } from '#/shared/ui/Field';
import { PageHeader } from '#/shared/ui/PageHeader';
import { ReadGate } from '#/shared/ui/ReadGate';
import { SaveSection } from '#/shared/ui/SaveSection';
import { FlowsPanel } from '#/pages/flow/ui/FlowsPanel';
import { Steps } from '#/pages/flow/ui/Steps';
import styles from '#/pages/flow/ui/FlowPage/FlowPage.module.css';

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
  tenantSettings,
  words,
}: {
  tenant: string;
  data: ListExecutionsResponse;
  etag: string;
  gone: boolean;
  reading: string | null;
  tenantSettings: Settings | undefined;
  words: FlowWords['steps'];
}) {
  const flow = useFlowSteps({ tenant, data, etag, gone, reading, tenantSettings });
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
  const { flow, words, reading, tenantSettings, unread, otp } = useFlowSections(tenant);
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
            tenantSettings={tenantSettings}
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
          <FlowsPanel tenant={tenant} />
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

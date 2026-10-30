import type { SmtpConfig } from '@odudu/contracts/admin';
import { AreaGate, areaAt } from '#/features/shell';
import { useEmailPage } from '#/features/email/usecase/useEmailPage';
import {
  effectiveLabel,
  effectiveReading,
  effectiveTone,
  PORT_RULE,
  RELAY_LABELS,
  removeConsequence,
  TEST_AS_LABEL,
  TEST_AS_RULE,
  TEST_TENANT_OWN,
} from '#/features/email/service';
import {
  RELAY_TITLE,
  useRelaySection,
  type RelaySection,
} from '#/features/email/usecase/useRelaySection';
import { useRelayRemoval } from '#/features/email/usecase/useRelayRemoval';
import { useTestSend } from '#/features/email/usecase/useTestSend';
import { Button } from '#/shared/view/Button';
import { CapabilityNote } from '#/shared/view/CapabilityNote';
import { ClientPicker } from '#/shared/view/ClientPicker';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog';
import { TextField, ToggleField } from '#/shared/view/Field';
import { FieldGrid, GridCell } from '#/shared/view/FieldGrid';
import { PageHeader } from '#/shared/view/PageHeader';
import { Panel } from '#/shared/view/Panel';
import { ReadGate } from '#/shared/view/ReadGate';
import { SaveSection } from '#/shared/view/SaveSection';
import { StatusTag } from '#/shared/view/StatusTag';
import { recordTab } from '#/shared/view/RecordTab';
import { MailDelivery } from '#/features/email/view/MailDelivery';
import styles from '#/features/email/view/EmailPage/EmailPage.module.css';

const TITLE = 'Email';

function RelayForm({ relay, config }: { relay: RelaySection; config: SmtpConfig }) {
  const s = relay.save;
  const field = (name: 'host' | 'port' | 'from_address' | 'username') => ({
    value: s.values[name],
    error: s.fieldErrors[name],
    changed: s.changed.includes(name),
    onChange: (value: string) => {
      s.edit(name, value);
    },
  });
  return (
    <SaveSection
      title={RELAY_TITLE}
      description="The server this tenant's verification and reset mail is sent through. Saving replaces the whole relay."
      blocked={relay.blocked}
      save={s}
    >
      <FieldGrid>
        <GridCell span="wide">
          <TextField label={RELAY_LABELS.host} mono {...field('host')} />
        </GridCell>
        <GridCell>
          <TextField
            label={RELAY_LABELS.port}
            mono
            inputMode="numeric"
            description={PORT_RULE}
            {...field('port')}
          />
        </GridCell>
        <GridCell span="wide">
          <TextField
            label={RELAY_LABELS.from_address}
            description="What the From line of each message says."
            {...field('from_address')}
          />
        </GridCell>
        <GridCell>
          <TextField
            label={RELAY_LABELS.username}
            description="Leave it empty if the relay needs no login."
            {...field('username')}
          />
        </GridCell>
        <GridCell span="wide">
          <TextField
            label={RELAY_LABELS.password}
            type="password"
            description={relay.passwordNote}
            isDisabled={s.values.remove_password}
            value={s.values.password}
            error={s.fieldErrors.password}
            changed={s.changed.includes('password')}
            onChange={(value) => {
              s.edit('password', value);
            }}
          />
        </GridCell>
        {config.password_set ? (
          <GridCell>
            <ToggleField
              label={RELAY_LABELS.remove_password}
              value={s.values.remove_password}
              changed={s.changed.includes('remove_password')}
              onChange={relay.removePassword}
            />
          </GridCell>
        ) : null}
        <GridCell span="wide">
          <ToggleField
            label={RELAY_LABELS.starttls}
            description="Required while a username or password is set, so they are not sent in the clear."
            value={s.values.starttls}
            error={s.fieldErrors.starttls}
            changed={s.changed.includes('starttls')}
            onChange={(value) => {
              s.edit('starttls', value);
            }}
          />
        </GridCell>
      </FieldGrid>
    </SaveSection>
  );
}

function TestMessage({
  tenant,
  configured,
  unsaved,
}: {
  tenant: string;
  configured: boolean;
  unsaved: boolean;
}) {
  const test = useTestSend(tenant, configured);
  return (
    <Panel title="Test message">
      <p className={recordTab.rule}>
        Sends one message through the saved relay and tells what the server answered.
        {unsaved ? ' The test uses the saved relay, not the changes above.' : ''}
      </p>
      <form
        className={styles.test}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          test.send();
        }}
      >
        <TextField label="Send to" type="email" value={test.to} onChange={test.setTo} />
        <Button type="submit" isDisabled={test.busy || test.blocked !== undefined}>
          {test.busy ? 'Sending…' : 'Send test message'}
        </Button>
      </form>
      <div className={styles.client}>
        {test.clientsClosed ? (
          <CapabilityNote capability="manage-clients">Choosing clients</CapabilityNote>
        ) : (
          <ClientPicker
            label={TEST_AS_LABEL}
            picker={test.picker}
            selected={test.selected}
            selectionMode="single"
            onChange={test.choose}
          />
        )}
        <p className={recordTab.rule}>{TEST_AS_RULE}</p>
        <p className={recordTab.rule}>{test.summary}</p>
        {test.selected.length === 0 ? null : (
          <Button size="small" onPress={test.useTenantOwn}>
            {TEST_TENANT_OWN}
          </Button>
        )}
      </div>
      {test.blocked === undefined ? null : <p className={recordTab.rule}>{test.blocked}</p>}
      <p role="status" className={styles.outcome} data-tone={test.outcome?.tone}>
        {test.outcome?.text}
      </p>
    </Panel>
  );
}

function Removal({ tenant, reread }: { tenant: string; reread: () => void }) {
  const removal = useRelayRemoval(tenant, reread);
  return (
    <Panel title="Remove the relay">
      <p className={recordTab.rule}>Goes back to the deployment’s sender, if it has one.</p>
      <div className={recordTab.actions}>
        <Button variant="danger" onPress={removal.ask}>
          Remove the relay
        </Button>
      </div>
      <p role="status" className={styles.outcome}>
        {removal.message}
      </p>
      <ConfirmDialog
        isOpen={removal.confirming}
        title="Remove this tenant’s relay?"
        consequence={removeConsequence()}
        confirmLabel="Remove the relay"
        tone="danger"
        busy={removal.busy}
        onConfirm={removal.confirm}
        onCancel={removal.cancel}
      />
    </Panel>
  );
}

// The test panel sits with the form because it says when edits are not yet used.
function RelayAndTest({
  tenant,
  config,
  etag,
  gone,
}: {
  tenant: string;
  config: SmtpConfig;
  etag: string;
  gone: boolean;
}) {
  const relay = useRelaySection({ tenant, config, etag, gone });
  return (
    <>
      <RelayForm relay={relay} config={config} />
      <TestMessage tenant={tenant} configured={config.configured} unsaved={relay.save.dirty} />
    </>
  );
}

function Email({ tenant }: { tenant: string }) {
  const record = useEmailPage(tenant);
  return (
    <ReadGate
      read={record}
      label="Loading the mail relay"
      fields={4}
      failed="The mail relay could not be loaded"
    >
      {(config, etag) => (
        <div className={styles.page}>
          <p className={styles.effective}>
            <StatusTag tone={effectiveTone(config.effective)}>
              {effectiveLabel(config.effective)}
            </StatusTag>{' '}
            {effectiveReading(config.effective)}
          </p>
          <RelayAndTest tenant={tenant} config={config} etag={etag} gone={record.gone} />
          {config.configured ? <Removal tenant={tenant} reread={record.retry} /> : null}
        </div>
      )}
    </ReadGate>
  );
}

export function EmailPage({ tenant }: { tenant: string }) {
  return (
    <AreaGate tenant={tenant} area={areaAt('email')} title={TITLE}>
      <PageHeader
        kicker={tenant}
        title={TITLE}
        description="The relay this tenant's verification and reset mail goes through."
      />
      <div className={styles.page}>
        <Email tenant={tenant} />
        <MailDelivery tenant={tenant} />
      </div>
    </AreaGate>
  );
}

import type { SmtpConfig } from '@odudu/contracts/admin';
import { AreaGate } from '#/widgets/shell';
import { useEffectiveReading } from '#/pages/email/use-cases/useEffectiveReading';
import { useEmailArea, useEmailPage } from '#/pages/email/use-cases/useEmailPage';
import { useRelaySection, type RelaySection } from '#/pages/email/use-cases/useRelaySection';
import { useRelayRemoval } from '#/pages/email/use-cases/useRelayRemoval';
import { useTestSend } from '#/pages/email/use-cases/useTestSend';
import { Button } from '#/shared/ui/Button';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { ClientPicker } from '#/entities/client';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import { TextField, ToggleField } from '#/shared/ui/Field';
import { FieldGrid, GridCell } from '#/shared/ui/FieldGrid';
import { PageHeader } from '#/shared/ui/PageHeader';
import { Panel } from '#/shared/ui/Panel';
import { ReadGate } from '#/shared/ui/ReadGate';
import { SaveSection } from '#/shared/ui/SaveSection';
import { StatusTag } from '#/shared/ui/StatusTag';
import { recordTab } from '#/shared/ui/RecordTab';
import { MailDelivery } from '#/pages/email/ui/MailDelivery';
import styles from '#/pages/email/ui/EmailPage/EmailPage.module.css';

function RelayForm({ relay, config }: { relay: RelaySection; config: SmtpConfig }) {
  const s = relay.save;
  const { labels, portRule } = relay.words;
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
      title={relay.words.title}
      description={relay.words.description}
      blocked={relay.blocked}
      save={s}
    >
      <FieldGrid>
        <GridCell span="wide">
          <TextField label={labels.host} mono {...field('host')} />
        </GridCell>
        <GridCell>
          <TextField
            label={labels.port}
            mono
            inputMode="numeric"
            description={portRule}
            {...field('port')}
          />
        </GridCell>
        <GridCell span="wide">
          <TextField
            label={labels.from_address}
            description={relay.words.fromNote}
            {...field('from_address')}
          />
        </GridCell>
        <GridCell>
          <TextField
            label={labels.username}
            description={relay.words.usernameNote}
            {...field('username')}
          />
        </GridCell>
        <GridCell span="wide">
          <TextField
            label={labels.password}
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
              label={labels.remove_password}
              value={s.values.remove_password}
              changed={s.changed.includes('remove_password')}
              onChange={relay.removePassword}
            />
          </GridCell>
        ) : null}
        <GridCell span="wide">
          <ToggleField
            label={labels.starttls}
            description={relay.words.starttlsNote}
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
  const test = useTestSend(tenant, configured, unsaved);
  return (
    <Panel title={test.words.title}>
      <p className={recordTab.rule}>{test.rule}</p>
      <form
        className={styles.test}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          test.form.send();
        }}
      >
        <TextField
          label={test.words.to}
          type="email"
          value={test.form.to}
          onChange={test.form.setTo}
        />
        <Button type="submit" isDisabled={test.form.busy || test.form.blocked !== undefined}>
          {test.form.busy ? test.words.sending : test.words.submit}
        </Button>
      </form>
      <div className={styles.client}>
        {test.client.closed ? (
          <CapabilityNote capability="manage-clients">{test.words.clientsNeeded}</CapabilityNote>
        ) : (
          <ClientPicker
            label={test.words.clientLabel}
            picker={test.client.picker}
            selected={test.client.selected}
            selectionMode="single"
            onChange={test.client.choose}
          />
        )}
        <p className={recordTab.rule}>{test.words.clientRule}</p>
        <p className={recordTab.rule}>{test.client.summary}</p>
        {test.client.selected.length === 0 ? null : (
          <Button size="small" onPress={test.client.useTenantOwn}>
            {test.words.tenantOwn}
          </Button>
        )}
      </div>
      {test.form.blocked === undefined ? null : (
        <p className={recordTab.rule}>{test.form.blocked}</p>
      )}
      <p role="status" className={styles.outcome} data-tone={test.outcome?.tone}>
        {test.outcome?.text}
      </p>
    </Panel>
  );
}

function Removal({ tenant, reread }: { tenant: string; reread: () => void }) {
  const removal = useRelayRemoval(tenant, reread);
  return (
    <Panel title={removal.words.title}>
      <p className={recordTab.rule}>{removal.words.rule}</p>
      <div className={recordTab.actions}>
        <Button variant="danger" onPress={removal.ask}>
          {removal.words.action}
        </Button>
      </div>
      <p role="status" className={styles.outcome}>
        {removal.message}
      </p>
      <ConfirmDialog
        isOpen={removal.confirming}
        title={removal.words.dialogTitle}
        consequence={removal.words.consequence}
        confirmLabel={removal.words.action}
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

function Effective({ effective }: { effective: SmtpConfig['effective'] }) {
  const reading = useEffectiveReading(effective);
  return (
    <p className={styles.effective}>
      <StatusTag tone={reading.tone}>{reading.label}</StatusTag> {reading.text}
    </p>
  );
}

function Email({ tenant }: { tenant: string }) {
  const { record, words } = useEmailPage(tenant);
  return (
    <ReadGate read={record} label={words.loading} fields={4} failed={words.failed}>
      {(config, etag) => (
        <div className={styles.page}>
          <Effective effective={config.effective} />
          <RelayAndTest tenant={tenant} config={config} etag={etag} gone={record.gone} />
          {config.configured ? <Removal tenant={tenant} reread={record.retry} /> : null}
        </div>
      )}
    </ReadGate>
  );
}

export function EmailPage({ tenant }: { tenant: string }) {
  const { area, title, description } = useEmailArea();
  return (
    <AreaGate tenant={tenant} area={area} title={title}>
      <PageHeader kicker={tenant} title={title} description={description} />
      <div className={styles.page}>
        <Email tenant={tenant} />
        <MailDelivery tenant={tenant} />
      </div>
    </AreaGate>
  );
}

import type { Client } from '@odudu/contracts/admin';
import { useId } from 'react';
import {
  CLIENT_ID_FIXED,
  PAGES_RULE,
  registeredText,
  TYPE_FIXED,
  TYPE_TEXT,
} from '#/features/clients/service';
import {
  useClientGeneral,
  type ClientGeneral,
  type Deletion,
} from '#/features/clients/usecase/useClientGeneral.ts';
import { SectionNoticeOf } from '#/shared/view/SectionNoticeOf';
import { Button } from '#/shared/view/Button';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog';
import { CopyValue } from '#/shared/view/CopyValue';
import { TextAreaField, TextField, ToggleField, UrlField } from '#/shared/view/Field';
import { FieldGrid, GridCell } from '#/shared/view/FieldGrid';
import { Section } from '#/shared/view/Section';
import { Timestamp } from '#/shared/view/Timestamp';
import styles from '#/features/clients/view/GeneralTab/GeneralTab.module.css';

function Fixed({ client }: { client: Client }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} className={styles.heading}>
        Identity
      </h2>
      <dl className={styles.fixed}>
        <div>
          <dt>Client ID</dt>
          <dd>
            <CopyValue label="client ID" value={client.client_id} />
          </dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{TYPE_TEXT[client.type] ?? client.type}</dd>
        </div>
        <div>
          <dt>Registered</dt>
          <dd>{registeredText(client.registration_origin)}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            <Timestamp value={client.created_at} />
          </dd>
        </div>
      </dl>
      <p className={styles.rule}>{`${CLIENT_ID_FIXED} ${TYPE_FIXED}`}</p>
    </section>
  );
}

function Details({ general }: { general: ClientGeneral }) {
  const s = general.details;
  return (
    <Section
      title="Details"
      description="How the client is named wherever a person meets it."
      dirty={s.dirty}
      saving={s.saving}
      onSave={s.submit}
      onDiscard={s.discard}
      restored={s.restored}
      blocked={s.blocked}
      notice={<SectionNoticeOf title="Details" save={s} />}
    >
      <TextField
        label="Name"
        description="Shown on the consent screen."
        value={s.values.name}
        error={s.fieldErrors.name}
        changed={s.changed.includes('name')}
        onChange={(value) => {
          s.edit('name', value);
        }}
      />
      <TextAreaField
        label="Description"
        description={general.descriptionRule}
        limit={general.descriptionLimit}
        value={s.values.description}
        error={s.fieldErrors.description}
        changed={s.changed.includes('description')}
        onChange={(value) => {
          s.edit('description', value);
        }}
      />
    </Section>
  );
}

function Pages({ general }: { general: ClientGeneral }) {
  const s = general.pages;
  return (
    <Section
      title="Consent screen links"
      description={PAGES_RULE}
      dirty={s.dirty}
      saving={s.saving}
      onSave={s.submit}
      onDiscard={s.discard}
      restored={s.restored}
      blocked={s.blocked}
      notice={<SectionNoticeOf title="Consent screen links" save={s} />}
    >
      <FieldGrid>
        <GridCell span="full">
          <UrlField
            label="Home page"
            autoComplete="off"
            value={s.values.client_uri}
            error={s.fieldErrors.client_uri}
            changed={s.changed.includes('client_uri')}
            onChange={(value) => {
              s.edit('client_uri', value);
            }}
          />
        </GridCell>
        <GridCell span="full">
          <UrlField
            label="Privacy policy"
            autoComplete="off"
            value={s.values.policy_uri}
            error={s.fieldErrors.policy_uri}
            changed={s.changed.includes('policy_uri')}
            onChange={(value) => {
              s.edit('policy_uri', value);
            }}
          />
        </GridCell>
        <GridCell span="full">
          <UrlField
            label="Terms of service"
            autoComplete="off"
            value={s.values.tos_uri}
            error={s.fieldErrors.tos_uri}
            changed={s.changed.includes('tos_uri')}
            onChange={(value) => {
              s.edit('tos_uri', value);
            }}
          />
        </GridCell>
      </FieldGrid>
    </Section>
  );
}

function Availability({ general }: { general: ClientGeneral }) {
  const s = general.availability;
  return (
    <Section
      title="Availability"
      dirty={s.dirty}
      saving={s.saving}
      onSave={s.submit}
      onDiscard={s.discard}
      restored={s.restored}
      blocked={s.blocked}
      notice={<SectionNoticeOf title="Availability" save={s} />}
    >
      {general.enabledFixed === null ? (
        <ToggleField
          label="Enabled"
          description="A disabled client signs nobody in and issues no token; its configuration is kept."
          value={s.values.enabled}
          changed={s.changed.includes('enabled')}
          onChange={(value) => {
            s.edit('enabled', value);
          }}
        />
      ) : (
        <p className={styles.rule}>{general.enabledFixed}</p>
      )}
    </Section>
  );
}

function Consent({ general }: { general: ClientGeneral }) {
  const s = general.consent;
  return (
    <Section
      title="Consent"
      dirty={s.dirty}
      saving={s.saving}
      onSave={s.submit}
      onDiscard={s.discard}
      restored={s.restored}
      blocked={s.blocked}
      notice={<SectionNoticeOf title="Consent" save={s} />}
    >
      <ToggleField
        label="Consent required"
        description="Each person is asked to approve what the client receives before it is given, once, and the approval is kept."
        value={s.values.consent_required}
        changed={s.changed.includes('consent_required')}
        onChange={(value) => {
          s.edit('consent_required', value);
        }}
      />
    </Section>
  );
}

function Danger({
  name,
  clientId,
  fixed,
  deletion,
}: {
  name: string;
  clientId: string;
  fixed: string | null;
  deletion: Deletion;
}) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} className={styles.heading}>
        Delete
      </h2>
      {fixed === null ? (
        <>
          <p className={styles.text}>
            A deleted client is gone with the roles scoped to it, and no application can sign in
            through it again. Its ID is typed to confirm, since two clients may share a name.
          </p>
          <div className={styles.actions}>
            <Button variant="danger" onPress={deletion.ask}>
              {`Delete ${name}`}
            </Button>
          </div>
        </>
      ) : (
        <p className={styles.rule}>{fixed}</p>
      )}
      <ConfirmDialog
        isOpen={deletion.confirming}
        title={`Delete ${name}?`}
        consequence={deletion.consequence}
        confirmLabel={`Delete ${name}`}
        tone="danger"
        typed={clientId}
        busy={deletion.busy}
        problem={deletion.problem}
        onConfirm={deletion.confirm}
        onCancel={deletion.cancel}
      />
    </section>
  );
}

// `writable` is whether the page offers any change: left out where it does
// not, since the page's one line says why.
export function GeneralTab({
  tenant,
  client,
  etag,
  gone,
  writable,
}: {
  tenant: string;
  client: Client;
  etag: string;
  gone: boolean;
  writable: boolean;
}) {
  const general = useClientGeneral({ tenant, client, etag, gone });
  return (
    <div className={styles.tab}>
      <Fixed client={client} />
      <Details general={general} />
      <Pages general={general} />
      <Availability general={general} />
      <Consent general={general} />
      {writable ? (
        <Danger
          name={client.name}
          clientId={client.client_id}
          fixed={general.deleteFixed}
          deletion={general.deletion}
        />
      ) : null}
    </div>
  );
}

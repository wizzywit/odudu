import type { Client } from '@odudu/contracts/admin';
import { useId } from 'react';
import {
  AUDIENCES_RULE,
  authNote,
  EXCHANGE_LABEL,
  EXCHANGE_RULE,
  FIXED_BY_DESIGN,
  GRACE_LABEL,
  GRACE_MAX,
  GRACE_RULE,
  JWKS_URI_RULE,
  KEY_SOURCES,
  KEYS_BLOCKED,
  KEYS_RULE,
  PUBLIC_AUTH_FIXED,
  PUBLIC_SECRET_FIXED,
  SECRET_RULE,
  SECTIONS_ADVANCED,
  SUBJECT_DN_RULE,
  USERINFO_RULE,
} from '#/features/clients/service';
import { useClientAdvanced } from '#/features/clients/usecase/useClientAdvanced.ts';
import { useClientSecret, type ClientSecret } from '#/features/clients/usecase/useClientSecret.ts';
import { Installation } from '#/features/clients/view/ClientRecordPage/Installation.tsx';
import { SaveSection } from '#/features/clients/view/ClientRecordPage/SaveSection.tsx';
import { Button } from '#/shared/view/Button';
import { ConfirmDialog } from '#/shared/view/ConfirmDialog';
import {
  NumberWithUnitField,
  ReadOnlyFields,
  SelectField,
  TextAreaField,
  TextField,
  TextListField,
  ToggleField,
  UrlField,
} from '#/shared/view/Field';
import { SecretDialog } from '#/shared/view/SecretDialog';
import { Timestamp } from '#/shared/view/Timestamp';
import styles from '#/features/clients/view/ClientRecordPage/Tab.module.css';

function Rotation({ client, secret }: { client: Client; secret: ClientSecret }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} className={styles.heading}>
        {SECTIONS_ADVANCED.secret}
      </h2>
      <p className={styles.rule}>{SECRET_RULE}</p>
      {client.previous_secret_expires_at === null ? null : (
        <p className={styles.text}>
          The previous secret authenticates until{' '}
          <Timestamp value={client.previous_secret_expires_at} />.
        </p>
      )}
      <NumberWithUnitField
        label={GRACE_LABEL}
        description={GRACE_RULE}
        unit="seconds"
        minValue={0}
        maxValue={GRACE_MAX}
        value={secret.grace}
        onChange={secret.setGrace}
      />
      {secret.problem === null ? null : (
        <p role="alert" className={styles.message}>
          {secret.problem}
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="danger" isDisabled={secret.busy} onPress={secret.ask}>
          {`Rotate the secret of ${client.name}`}
        </Button>
      </div>
      <ConfirmDialog
        isOpen={secret.confirming}
        title={`Rotate the secret of ${client.name}?`}
        consequence={secret.consequence}
        confirmLabel="Rotate secret"
        tone="danger"
        busy={secret.busy}
        problem={null}
        onConfirm={secret.confirm}
        onCancel={secret.cancel}
      />
      <SecretDialog
        secret={secret.secret}
        title={secret.secretTitle}
        label="client secret"
        onClose={secret.closeSecret}
      >
        {secret.secretNote}
      </SecretDialog>
    </section>
  );
}

function Fixed() {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className={styles.panel}>
      <h2 id={heading} className={styles.heading}>
        {SECTIONS_ADVANCED.fixed}
      </h2>
      <dl className={styles.fixed}>
        {FIXED_BY_DESIGN.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>
              <code>{item.value}</code>
              <span className={styles.rule}>{` · ${item.why}`}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function AdvancedTab({
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
  const page = useClientAdvanced({ tenant, client, etag, gone });
  const secret = useClientSecret(tenant, client);
  const { auth, keys, userinfo, audiences, exchange } = page;
  const method = auth.values.token_endpoint_auth_method;
  const source = keys.values.key_source;
  return (
    <div className={styles.tab}>
      <Installation tenant={tenant} clientDbId={client.id} />
      <ReadOnlyFields when={!writable}>
        <SaveSection title={SECTIONS_ADVANCED.auth} save={auth}>
          {client.type === 'public' ? (
            <p className={styles.rule}>{PUBLIC_AUTH_FIXED}</p>
          ) : (
            <>
              <SelectField
                label="Authentication method"
                description={authNote(method)}
                options={page.authMethods}
                value={method}
                error={auth.fieldErrors.token_endpoint_auth_method}
                changed={auth.changed.includes('token_endpoint_auth_method')}
                onChange={(value) => {
                  auth.edit('token_endpoint_auth_method', value);
                }}
              />
              {page.asksSubject ? (
                <TextField
                  label="Certificate subject"
                  description={SUBJECT_DN_RULE}
                  mono
                  value={auth.values.tls_client_auth_subject_dn}
                  error={auth.fieldErrors.tls_client_auth_subject_dn}
                  changed={auth.changed.includes('tls_client_auth_subject_dn')}
                  onChange={(value) => {
                    auth.edit('tls_client_auth_subject_dn', value);
                  }}
                />
              ) : null}
            </>
          )}
        </SaveSection>
        <SaveSection
          title={SECTIONS_ADVANCED.keys}
          description={KEYS_RULE}
          save={keys}
          blocked={page.keysProblem === undefined ? undefined : KEYS_BLOCKED}
        >
          <SelectField
            label="Key source"
            options={KEY_SOURCES}
            value={source}
            changed={keys.changed.includes('key_source')}
            onChange={(value) => {
              keys.edit('key_source', value);
            }}
          />
          {source === 'uri' ? (
            <UrlField
              label="JWKS URI"
              description={JWKS_URI_RULE}
              autoComplete="off"
              value={keys.values.jwks_uri}
              error={
                keys.fieldErrors.jwks_uri ??
                (page.keysProblem?.field === 'jwks_uri' ? page.keysProblem.message : undefined)
              }
              changed={keys.changed.includes('jwks_uri')}
              onChange={(value) => {
                keys.edit('jwks_uri', value);
              }}
            />
          ) : null}
          {source === 'inline' ? (
            <TextAreaField
              label="Key set"
              description="A JSON Web Key Set: an object with a keys array of public keys."
              mono
              value={keys.values.jwks}
              error={
                keys.fieldErrors.jwks ??
                (page.keysProblem?.field === 'jwks' ? page.keysProblem.message : undefined)
              }
              changed={keys.changed.includes('jwks')}
              onChange={(value) => {
                keys.edit('jwks', value);
              }}
            />
          ) : null}
        </SaveSection>
        <SaveSection title={SECTIONS_ADVANCED.userinfo} description={USERINFO_RULE} save={userinfo}>
          <SelectField
            label="Signing algorithm"
            options={page.signingOptions}
            value={userinfo.values.userinfo_signed_response_alg}
            error={userinfo.fieldErrors.userinfo_signed_response_alg}
            changed={userinfo.changed.includes('userinfo_signed_response_alg')}
            onChange={(value) => {
              userinfo.edit('userinfo_signed_response_alg', value);
            }}
          />
          <SelectField
            label="Encryption algorithm"
            options={page.encryptionOptions}
            value={userinfo.values.userinfo_encrypted_response_alg}
            error={userinfo.fieldErrors.userinfo_encrypted_response_alg}
            changed={userinfo.changed.includes('userinfo_encrypted_response_alg')}
            onChange={(value) => {
              userinfo.edit('userinfo_encrypted_response_alg', value);
            }}
          />
          {page.encrypted ? (
            <SelectField
              label="Content encryption"
              options={page.contentOptions}
              value={userinfo.values.userinfo_encrypted_response_enc}
              error={userinfo.fieldErrors.userinfo_encrypted_response_enc}
              changed={userinfo.changed.includes('userinfo_encrypted_response_enc')}
              onChange={(value) => {
                userinfo.edit('userinfo_encrypted_response_enc', value);
              }}
            />
          ) : null}
        </SaveSection>
        <SaveSection title={SECTIONS_ADVANCED.audiences} save={audiences}>
          <TextListField
            label="Audiences"
            itemLabel="Audience"
            description={`${AUDIENCES_RULE} ${page.audienceCount}`}
            error={audiences.fieldErrors.audiences}
            changed={audiences.changed.includes('audiences')}
            value={audiences.values.audiences}
            onChange={(value) => {
              audiences.edit('audiences', value);
            }}
          />
        </SaveSection>
        <SaveSection title={SECTIONS_ADVANCED.exchange} save={exchange}>
          <ToggleField
            label={EXCHANGE_LABEL}
            description={EXCHANGE_RULE}
            value={exchange.values.token_exchange_impersonation_allowed}
            error={exchange.fieldErrors.token_exchange_impersonation_allowed}
            changed={exchange.changed.includes('token_exchange_impersonation_allowed')}
            onChange={(value) => {
              exchange.edit('token_exchange_impersonation_allowed', value);
            }}
          />
        </SaveSection>
      </ReadOnlyFields>
      {client.type === 'public' ? (
        <p className={styles.rule}>{PUBLIC_SECRET_FIXED}</p>
      ) : writable ? (
        <Rotation client={client} secret={secret} />
      ) : null}
      <Fixed />
    </div>
  );
}

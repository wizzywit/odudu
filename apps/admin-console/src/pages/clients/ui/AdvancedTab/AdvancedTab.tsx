import type { Client } from '#/entities/client';
import {
  useClientAdvanced,
  type ClientAdvanced,
} from '#/pages/clients/use-cases/useClientAdvanced';
import { useClientSecret, type ClientSecret } from '#/pages/clients/use-cases/useClientSecret';
import { Installation } from '#/pages/clients/ui/Installation';
import type { ClientTabProps } from '#/pages/clients/ui/ClientTabProps';
import { SaveSection } from '#/shared/ui/SaveSection';
import { Button } from '#/shared/ui/Button';
import { ConfirmDialog } from '#/shared/ui/ConfirmDialog';
import {
  NumberWithUnitField,
  ReadOnlyFields,
  SelectField,
  TextAreaField,
  TextField,
  TextListField,
  ToggleField,
  UrlField,
} from '#/shared/ui/Field';
import { Problem } from '#/shared/ui/Message';
import { Panel } from '#/shared/ui/Panel';
import { SecretDialog } from '#/shared/ui/SecretDialog';
import { Timestamp } from '#/shared/ui/Timestamp';
import { recordTab } from '#/shared/ui/RecordTab';

function Rotation({ client, secret }: { client: Client; secret: ClientSecret }) {
  return (
    <Panel title={secret.title}>
      <p className={recordTab.rule}>{secret.rule}</p>
      {secret.previous === null ? null : (
        <p className={recordTab.text}>
          {secret.previous.lead} <Timestamp value={secret.previous.at} />.
        </p>
      )}
      <NumberWithUnitField
        label={secret.graceLabel}
        description={secret.graceRule}
        unit="seconds"
        minValue={0}
        maxValue={secret.graceMax}
        value={secret.grace}
        onChange={secret.setGrace}
      />
      <Problem>{secret.problem}</Problem>
      <div className={recordTab.actions}>
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
    </Panel>
  );
}

function Fixed({ title, items }: { title: string; items: ClientAdvanced['fixedByDesign'] }) {
  return (
    <Panel title={title}>
      <dl className={recordTab.fixed}>
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>
              <code>{item.value}</code>
              <span className={recordTab.rule}>{` · ${item.why}`}</span>
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

export function AdvancedTab({ tenant, client, etag, gone, writable }: ClientTabProps) {
  const page = useClientAdvanced({ tenant, client, etag, gone });
  const secret = useClientSecret(tenant, client);
  const { auth, keys, userinfo, audiences, exchange } = page;
  const method = auth.values.token_endpoint_auth_method;
  const source = keys.values.key_source;
  return (
    <div className={recordTab.tab}>
      <Installation tenant={tenant} clientDbId={client.id} />
      <ReadOnlyFields when={!writable}>
        <SaveSection title={page.sections.auth} save={auth}>
          {client.type === 'public' ? (
            <p className={recordTab.rule}>{page.publicAuthFixed}</p>
          ) : (
            <>
              <SelectField
                label="Authentication method"
                description={page.authNote}
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
                  description={page.subjectDnRule}
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
          title={page.sections.keys}
          description={page.keysRule}
          save={keys}
          blocked={page.keysBlocked}
        >
          <SelectField
            label="Key source"
            options={page.keySources}
            value={source}
            changed={keys.changed.includes('key_source')}
            onChange={(value) => {
              keys.edit('key_source', value);
            }}
          />
          {source === 'uri' ? (
            <UrlField
              label="JWKS URI"
              description={page.jwksUriRule}
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
        <SaveSection title={page.sections.userinfo} description={page.userinfoRule} save={userinfo}>
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
        <SaveSection title={page.sections.audiences} save={audiences}>
          <TextListField
            label="Audiences"
            itemLabel="Audience"
            description={page.audiencesDescription}
            error={audiences.fieldErrors.audiences}
            changed={audiences.changed.includes('audiences')}
            value={audiences.values.audiences}
            onChange={(value) => {
              audiences.edit('audiences', value);
            }}
          />
        </SaveSection>
        <SaveSection title={page.sections.exchange} save={exchange}>
          <ToggleField
            label={page.exchangeLabel}
            description={page.exchangeRule}
            value={exchange.values.token_exchange_impersonation_allowed}
            error={exchange.fieldErrors.token_exchange_impersonation_allowed}
            changed={exchange.changed.includes('token_exchange_impersonation_allowed')}
            onChange={(value) => {
              exchange.edit('token_exchange_impersonation_allowed', value);
            }}
          />
        </SaveSection>
      </ReadOnlyFields>
      {secret.fixed !== null ? (
        <p className={recordTab.rule}>{secret.fixed}</p>
      ) : writable ? (
        <Rotation client={client} secret={secret} />
      ) : null}
      <Fixed title={page.sections.fixed} items={page.fixedByDesign} />
    </div>
  );
}

import type { Client } from '@odudu/contracts/admin';
import {
  AUTH_TIME_LABEL,
  AUTH_TIME_RULE,
  CREDENTIALS_RULE,
  FULL_SCOPE_RULE,
  GRANTS_RULE,
  ID_TOKEN_ALG_LABEL,
  ID_TOKEN_ALG_RULE,
  LIFETIMES,
  lifetimeBounds,
  lifetimeRule,
  MAX_AGE_LABEL,
  MAX_AGE_MAX,
  MAX_AGE_OFF,
  MAX_AGE_RULE,
  MAX_AGE_START,
  REQUIRE_AUTH_TIME_NOTE,
  SECTIONS_TOKENS,
  tenantLifetimeLabel,
} from '#/features/clients/service';
import { useClientTokens } from '#/features/clients/usecase/useClientTokens.ts';
import { OptionalSecondsField } from '#/features/clients/view/OptionalSecondsField';
import { SaveSection } from '#/features/clients/view/SaveSection';
import { ChecklistField } from '#/shared/view/ChecklistField';
import { ReadOnlyFields, SelectField, TextListField, ToggleField } from '#/shared/view/Field';
import styles from '#/features/clients/view/TokensTab/TokensTab.module.css';

export function TokensTab({
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
  const page = useClientTokens({ tenant, client, etag, gone });
  const { lifetimes, grants, credentials, fullScope, idToken } = page;
  return (
    <div className={styles.tab}>
      <ReadOnlyFields when={!writable}>
        <SaveSection
          title={SECTIONS_TOKENS.lifetimes}
          description="How long each token lasts. A client with none of its own takes the tenant's."
          save={lifetimes}
        >
          {LIFETIMES.map((each) => {
            const { min, max } = lifetimeBounds(each.field);
            return (
              <OptionalSecondsField
                key={each.field}
                label={each.label}
                offLabel={tenantLifetimeLabel(each.label)}
                offText={each.inherits}
                rule={lifetimeRule(each.field)}
                value={lifetimes.values[each.field]}
                start={each.start}
                min={min}
                max={max}
                error={lifetimes.fieldErrors[each.field]}
                changed={lifetimes.changed.includes(each.field)}
                onChange={(value) => {
                  lifetimes.edit(each.field, value);
                }}
              />
            );
          })}
        </SaveSection>
        <SaveSection
          title={SECTIONS_TOKENS.grants}
          description={GRANTS_RULE}
          save={grants}
          blocked={page.grantsBlocked}
        >
          <ChecklistField
            label="Grant types"
            options={page.grantOptions}
            value={grants.values.grant_types}
            error={grants.fieldErrors.grant_types}
            changed={grants.changed.includes('grant_types')}
            onChange={(value) => {
              grants.edit('grant_types', value);
            }}
          />
        </SaveSection>
        <SaveSection title={SECTIONS_TOKENS.credentials} save={credentials}>
          <TextListField
            label="Client credentials scopes"
            itemLabel="Scope name"
            description={`${CREDENTIALS_RULE} ${page.credentialCount}`}
            error={credentials.fieldErrors.client_credentials_scopes}
            changed={credentials.changed.includes('client_credentials_scopes')}
            value={credentials.values.client_credentials_scopes}
            onChange={(value) => {
              credentials.edit('client_credentials_scopes', value);
            }}
          />
        </SaveSection>
        <SaveSection title={SECTIONS_TOKENS.fullScope} save={fullScope}>
          <ToggleField
            label="Carry every role the subject holds"
            description={FULL_SCOPE_RULE}
            value={fullScope.values.full_scope_allowed}
            error={fullScope.fieldErrors.full_scope_allowed}
            changed={fullScope.changed.includes('full_scope_allowed')}
            onChange={(value) => {
              fullScope.edit('full_scope_allowed', value);
            }}
          />
        </SaveSection>
        <SaveSection title={SECTIONS_TOKENS.idToken} save={idToken}>
          <SelectField
            label={ID_TOKEN_ALG_LABEL}
            description={ID_TOKEN_ALG_RULE}
            options={page.idTokenAlgs}
            value={idToken.values.id_token_signed_response_alg}
            error={idToken.fieldErrors.id_token_signed_response_alg}
            changed={idToken.changed.includes('id_token_signed_response_alg')}
            onChange={(value) => {
              idToken.edit('id_token_signed_response_alg', value);
            }}
          />
          <OptionalSecondsField
            label={MAX_AGE_LABEL}
            offLabel="No default"
            offText={MAX_AGE_OFF}
            rule={MAX_AGE_RULE}
            value={idToken.values.default_max_age}
            start={MAX_AGE_START}
            min={0}
            max={MAX_AGE_MAX}
            error={idToken.fieldErrors.default_max_age}
            changed={idToken.changed.includes('default_max_age')}
            onChange={(value) => {
              idToken.edit('default_max_age', value);
            }}
          />
          <ToggleField
            label={AUTH_TIME_LABEL}
            description={`${AUTH_TIME_RULE} ${REQUIRE_AUTH_TIME_NOTE}`}
            value={idToken.values.require_auth_time}
            error={idToken.fieldErrors.require_auth_time}
            changed={idToken.changed.includes('require_auth_time')}
            onChange={(value) => {
              idToken.edit('require_auth_time', value);
            }}
          />
        </SaveSection>
      </ReadOnlyFields>
    </div>
  );
}

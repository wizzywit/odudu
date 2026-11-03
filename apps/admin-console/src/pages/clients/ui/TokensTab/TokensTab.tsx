import { useClientTokens } from '#/pages/clients/use-cases/useClientTokens';
import { OptionalSecondsField } from '#/pages/clients/ui/OptionalSecondsField';
import type { ClientTabProps } from '#/pages/clients/ui/ClientTabProps';
import { SaveSection } from '#/shared/ui/SaveSection';
import { ChecklistField } from '#/shared/ui/ChecklistField';
import { ReadOnlyFields, SelectField, TextListField, ToggleField } from '#/shared/ui/Field';
import { recordTab } from '#/shared/ui/RecordTab';

export function TokensTab({ tenant, client, etag, gone, writable }: ClientTabProps) {
  const page = useClientTokens({ tenant, client, etag, gone });
  const { lifetimes, grants, credentials, fullScope, idToken } = page;
  return (
    <div className={recordTab.tab}>
      <ReadOnlyFields when={!writable}>
        <SaveSection
          title={page.sections.lifetimes}
          description="How long each token lasts. A client with none of its own takes the tenant's."
          save={lifetimes}
        >
          {page.lifetimeFields.map((each) => (
            <OptionalSecondsField
              key={each.field}
              label={each.label}
              offLabel={each.offLabel}
              offText={each.offText}
              readText={each.readText}
              rule={each.rule}
              value={lifetimes.values[each.field]}
              start={each.start}
              min={each.min}
              max={each.max}
              error={lifetimes.fieldErrors[each.field]}
              changed={lifetimes.changed.includes(each.field)}
              onChange={(value) => {
                page.setLifetime(each.field, value);
              }}
            />
          ))}
        </SaveSection>
        <SaveSection
          title={page.sections.grants}
          description={page.grantsRule}
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
        <SaveSection title={page.sections.credentials} save={credentials}>
          <TextListField
            label="Client credentials scopes"
            itemLabel="Scope name"
            description={page.credentialsDescription}
            error={credentials.fieldErrors.client_credentials_scopes}
            changed={credentials.changed.includes('client_credentials_scopes')}
            value={credentials.values.client_credentials_scopes}
            onChange={(value) => {
              credentials.edit('client_credentials_scopes', value);
            }}
          />
        </SaveSection>
        <SaveSection title={page.sections.fullScope} save={fullScope}>
          <ToggleField
            label={page.fullScopeLabel}
            description={page.fullScopeRule}
            value={fullScope.values.full_scope_allowed}
            error={fullScope.fieldErrors.full_scope_allowed}
            changed={fullScope.changed.includes('full_scope_allowed')}
            onChange={(value) => {
              fullScope.edit('full_scope_allowed', value);
            }}
          />
        </SaveSection>
        <SaveSection title={page.sections.idToken} save={idToken}>
          <SelectField
            label={page.idTokenAlgLabel}
            description={page.idTokenAlgRule}
            options={page.idTokenAlgs}
            value={idToken.values.id_token_signed_response_alg}
            error={idToken.fieldErrors.id_token_signed_response_alg}
            changed={idToken.changed.includes('id_token_signed_response_alg')}
            onChange={(value) => {
              idToken.edit('id_token_signed_response_alg', value);
            }}
          />
          <OptionalSecondsField
            label={page.maxAge.label}
            offLabel={page.maxAge.offLabel}
            offText={page.maxAge.offText}
            readText={page.maxAge.readText}
            rule={page.maxAge.rule}
            value={idToken.values.default_max_age}
            start={page.maxAge.start}
            min={page.maxAge.min}
            max={page.maxAge.max}
            error={idToken.fieldErrors.default_max_age}
            changed={idToken.changed.includes('default_max_age')}
            onChange={(value) => {
              page.setMaxAge(value);
            }}
          />
          <ToggleField
            label={page.authTimeLabel}
            description={page.authTimeDescription}
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

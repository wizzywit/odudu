import { useAmendClient } from '#/features/clients/repository/useClientRecord.ts';
import { authPayload, keysPayload, sentOf, userinfoPayload } from '#/features/clients/service';
import type { SaveInput } from '#/shared/repository/useSectionSave.ts';
import type { Gateway } from '#/shared/transport/gateway.ts';

type Values = Readonly<Record<string, unknown>>;

export interface LifetimeValues extends Values {
  access_token_ttl_seconds: number | null;
  id_token_ttl_seconds: number | null;
  refresh_token_ttl_seconds: number | null;
}

export interface GrantValues extends Values {
  grant_types: readonly string[];
}

export interface CredentialValues extends Values {
  client_credentials_scopes: readonly string[];
}

export interface FullScopeValues extends Values {
  full_scope_allowed: boolean;
}

export interface IdTokenValues extends Values {
  id_token_signed_response_alg: string;
  default_max_age: number | null;
  require_auth_time: boolean;
}

export interface PostLogoutValues extends Values {
  post_logout_redirect_uris: readonly string[];
}

export interface BackchannelValues extends Values {
  backchannel_logout_uri: string;
  backchannel_logout_session_required: boolean;
}

export interface FrontchannelValues extends Values {
  frontchannel_logout_uri: string;
  frontchannel_logout_session_required: boolean;
}

export interface AuthValues extends Values {
  token_endpoint_auth_method: string;
  tls_client_auth_subject_dn: string;
}

export interface KeyValues extends Values {
  key_source: string;
  jwks_uri: string;
  jwks: string;
}

export interface UserinfoValues extends Values {
  userinfo_signed_response_alg: string;
  userinfo_encrypted_response_alg: string;
  userinfo_encrypted_response_enc: string;
}

export interface AudienceValues extends Values {
  audiences: readonly string[];
}

export interface ExchangeValues extends Values {
  token_exchange_impersonation_allowed: boolean;
}

// The sections of Tokens, Logout and Advanced, each a PATCH of its own fields.
export function useClientConfigSaves(tenant: string, id: string) {
  const amend = useAmendClient(tenant, id);
  return {
    lifetimes: (gateway: Gateway, { values, ifMatch }: SaveInput<LifetimeValues>) =>
      amend(
        gateway,
        {
          access_token_ttl_seconds: values.access_token_ttl_seconds,
          id_token_ttl_seconds: values.id_token_ttl_seconds,
          refresh_token_ttl_seconds: values.refresh_token_ttl_seconds,
        },
        ifMatch,
      ),
    grants: (gateway: Gateway, { values, ifMatch }: SaveInput<GrantValues>) =>
      amend(gateway, { grant_types: values.grant_types }, ifMatch),
    credentials: (gateway: Gateway, { values, ifMatch }: SaveInput<CredentialValues>) =>
      amend(gateway, { client_credentials_scopes: values.client_credentials_scopes }, ifMatch),
    fullScope: (gateway: Gateway, { values, ifMatch }: SaveInput<FullScopeValues>) =>
      amend(gateway, { full_scope_allowed: values.full_scope_allowed }, ifMatch),
    idToken: (gateway: Gateway, { values, ifMatch }: SaveInput<IdTokenValues>) =>
      amend(
        gateway,
        {
          id_token_signed_response_alg: sentOf(values.id_token_signed_response_alg),
          default_max_age: values.default_max_age,
          require_auth_time: values.require_auth_time,
        },
        ifMatch,
      ),
    postLogout: (gateway: Gateway, { values, ifMatch }: SaveInput<PostLogoutValues>) =>
      amend(gateway, { post_logout_redirect_uris: values.post_logout_redirect_uris }, ifMatch),
    backchannel: (gateway: Gateway, { values, ifMatch }: SaveInput<BackchannelValues>) =>
      amend(
        gateway,
        {
          backchannel_logout_uri: values.backchannel_logout_uri,
          backchannel_logout_session_required: values.backchannel_logout_session_required,
        },
        ifMatch,
      ),
    frontchannel: (gateway: Gateway, { values, ifMatch }: SaveInput<FrontchannelValues>) =>
      amend(
        gateway,
        {
          frontchannel_logout_uri: values.frontchannel_logout_uri,
          frontchannel_logout_session_required: values.frontchannel_logout_session_required,
        },
        ifMatch,
      ),
    auth: (gateway: Gateway, { values, ifMatch }: SaveInput<AuthValues>) =>
      amend(gateway, authPayload(values), ifMatch),
    keys: (gateway: Gateway, { values, ifMatch }: SaveInput<KeyValues>) =>
      amend(gateway, keysPayload(values), ifMatch),
    userinfo: (gateway: Gateway, { values, ifMatch }: SaveInput<UserinfoValues>) =>
      amend(gateway, userinfoPayload(values), ifMatch),
    audiences: (gateway: Gateway, { values, ifMatch }: SaveInput<AudienceValues>) =>
      amend(gateway, { audiences: values.audiences }, ifMatch),
    exchange: (gateway: Gateway, { values, ifMatch }: SaveInput<ExchangeValues>) =>
      amend(
        gateway,
        { token_exchange_impersonation_allowed: values.token_exchange_impersonation_allowed },
        ifMatch,
      ),
  };
}

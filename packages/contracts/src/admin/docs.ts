import { z } from 'zod';

// The prose of the admin API reference, held apart from the schemas so that the
// admin console, which imports the schemas to validate against them, does not
// carry text only the generated documentation reads. An object schema is found
// by the names of its fields, so every place a shape appears gets the same words.

type JsonSchema = z.core.JSONSchema.BaseSchema;
type Fields = Readonly<Record<string, string>>;

interface RootNotes {
  readonly description?: string;
  readonly examples?: readonly unknown[];
}

import {
  auditEventSchema,
  countAuditQuerySchema,
  listAuditQuerySchema,
  listAuditResponseSchema,
} from '#/admin/audit';
import {
  clientFieldsSchema,
  clientInstallationSchema,
  countClientsQuerySchema,
  createClientRequestSchema,
  createClientResponseSchema,
  evaluateClaimsResponseSchema,
  listClientsQuerySchema,
  logoutDeliverySchema,
  rotateClientSecretResponseSchema,
  clientRecordSchema,
} from '#/admin/clients';
import { consentSchema } from '#/admin/consents';
import { countResponseSchema } from '#/admin/counts';
import {
  executionStepSchema,
  listExecutionsResponseSchema,
  replaceExecutionsRequestSchema,
} from '#/admin/flow';
import {
  countGroupsQuerySchema,
  setGroupDefaultRequestSchema,
  groupFieldsSchema,
  groupRecordSchema,
  groupSchema,
  listGroupsQuerySchema,
} from '#/admin/groups';
import { createKeyRequestSchema, listKeysQuerySchema, signingKeySchema } from '#/admin/keys';
import { mailMessageSchema } from '#/admin/mail';
import { amendProfileRequestSchema, profileSchema } from '#/admin/profile';
import {
  mintRegistrationTokenRequestSchema,
  mintRegistrationTokenResponseSchema,
  registrationTokenSchema,
} from '#/admin/registration-tokens';
import {
  addRoleCompositeRequestSchema,
  countRolesQuerySchema,
  createRoleRequestSchema,
  listRolesQuerySchema,
  roleFieldsSchema,
  roleSchema,
} from '#/admin/roles';
import { scopeMappersSchema, setScopeMappersRequestSchema } from '#/admin/scope-mappers';
import {
  assignScopeToClientRequestSchema,
  assignScopeToClientResponseSchema,
  builtinScopeSchema,
  clientScopeAssignmentViewSchema,
  clientScopeSchema,
  createScopeRequestSchema,
  listBuiltinScopesResponseSchema,
  restoreBuiltinScopesResponseSchema,
  scopeClientSchema,
  scopeImpactSchema,
  scopeRoleSchema,
} from '#/admin/scopes';
import {
  countSessionsQuerySchema,
  endSessionsResponseSchema,
  endTenantSessionsResponseSchema,
  grantSchema,
  listTenantSessionsQuerySchema,
  revokeClientGrantsResponseSchema,
  revokeGrantsResponseSchema,
  sessionSchema,
  tenantSessionSchema,
} from '#/admin/sessions';
import { amendSettingsRequestSchema, settingsSchema } from '#/admin/settings';
import {
  putSmtpRequestSchema,
  smtpConfigSchema,
  testSmtpRequestSchema,
  testSmtpResponseSchema,
} from '#/admin/smtp';
import {
  adminCapabilitiesResponseSchema,
  amendSubjectRequestSchema,
  bulkSubjectResultSchema,
  bulkSubjectsRequestSchema,
  clearLockoutsResponseSchema,
  countSubjectsQuerySchema,
  createSubjectRequestSchema,
  credentialSchema,
  effectiveRoleSchema,
  heldAdminCapabilitySchema,
  listSubjectsQuerySchema,
  listedSubjectSchema,
  roleAssignmentSchema,
  sendActionsEmailRequestSchema,
  setRequiredActionsRequestSchema,
  setRequiredActionsResponseSchema,
  setRolesRequestSchema,
  subjectSchema,
  usernamePolicySchema,
} from '#/admin/subjects';
import {
  exportedClientSchema,
  exportedFlowStepSchema,
  exportedGroupSchema,
  exportedRoleSchema,
  exportedScopeSchema,
  exportedSmtpSchema,
  exportedSubjectSchema,
  importTenantRequestSchema,
  importTenantResponseSchema,
  importedClientSecretSchema,
  registrationPolicySchema,
  tenantDocumentSchema,
  tenantSettingsDocumentSchema,
} from '#/admin/tenant-document';
import {
  exportedMessageOverrideSchema,
  listMessageOverridesQuerySchema,
  listMessageOverridesResponseSchema,
  messageCatalogueEntrySchema,
  messageCatalogueResponseSchema,
  messageCatalogueSectionSchema,
  messageOverrideSchema,
  putMessageOverrideRequestSchema,
} from '#/admin/message-overrides';
import {
  countTenantsQuerySchema,
  createTenantRequestSchema,
  listTenantsQuerySchema,
  tenantSchema,
} from '#/admin/tenants';
import {
  listThemeVersionsResponseSchema,
  publishedThemeSchema,
  themeAssetSchema,
  previewThemeQuerySchema,
  themePreviewFaultSchema,
  themePreviewInfoSchema,
  stylesheetHooksResponseSchema,
  themePreviewRefusedSchema,
  uploadThemeAssetQuerySchema,
  themeVersionSchema,
  themeViewSchema,
  themeWarningSchema,
  publishThemeResponseSchema,
} from '#/admin/theme';
import {
  mailBrandingViewSchema,
  mailColoursSchema,
  mailLogoSchema,
  mailSchemeSchema,
  previewMailQuerySchema,
} from '#/admin/mail-preview';
import { whoamiResponseSchema } from '#/admin/whoami';
import {
  paletteSchema,
  themeAssetsSchema,
  themeBodyRequestSchema,
  themeImageSchema,
  themeLogoSchema,
  themeTokensSchema,
} from '#/theme-body';

function fingerprint(names: readonly string[]): string {
  return [...names].sort().join(',');
}

const FIELDS = new Map<string, { readonly names: ReadonlySet<string>; readonly fields: Fields }>();

// The names in `fields` that the schema has no field for: words for a field
// that is not there describe nothing and read as dead code.
export function fieldsMissingFrom(
  schema: { readonly shape: Readonly<Record<string, unknown>> },
  fields: Fields,
): string[] {
  return Object.keys(fields).filter((name) => !(name in schema.shape));
}

// The words of a shared set that belong to this schema's own fields.
function wordsOf(
  schema: { readonly shape: Readonly<Record<string, unknown>> },
  words: Fields,
): Fields {
  return Object.fromEntries(Object.entries(words).filter(([name]) => name in schema.shape));
}

function describeFields(
  schema: { readonly shape: Readonly<Record<string, unknown>> },
  fields: Fields,
): void {
  const missing = fieldsMissingFrom(schema, fields);
  if (missing.length > 0) {
    throw new Error(`describeFields names ${missing.join(', ')}, which the schema lacks`);
  }
  const names = Object.keys(schema.shape);
  const key = fingerprint(names);
  FIELDS.set(key, { names: new Set(names), fields: { ...FIELDS.get(key)?.fields, ...fields } });
}

// An object is described by every registered shape that makes up most of it (all its
// fields are held, and they are at least four fifths of the object's own), the largest
// last, so a shape extended by a field or two (`clientSchema` over its stored fields)
// keeps the words of the shape it extends, and a short shape does not describe a long one.
function describing(names: readonly string[]): readonly Fields[] {
  const held = new Set(names);
  return [...FIELDS.values()]
    .filter(
      (entry) =>
        entry.names.size >= 1 &&
        entry.names.size >= 0.8 * held.size &&
        [...entry.names].every((name) => held.has(name)),
    )
    .sort((a, b) => a.names.size - b.names.size)
    .map((entry) => entry.fields);
}

describeFields(auditEventSchema, {
  id: 'The event’s identifier.',
  occurred_at: 'When it happened.',
  event_type:
    'The kind of event: `admin_mutation`, `admin_access`, `authentication`, `session`, `token` or `credential`.',
  action: 'What happened, such as `client.create` or `login.password`.',
  outcome: '`allowed`, `refused` or `failed`.',
  actor_tenant_id: 'The tenant of whoever did it, or null.',
  actor_subject_id: 'The subject who did it, or null.',
  actor_client_id: 'The client it was done through, or null.',
  actor_name: 'The actor’s username, or null.',
  actor_origin:
    'Where the actor comes from: this `tenant`, the `system` tenant, or `other-tenant`.',
  resource_type: 'The kind of thing acted on, or null.',
  resource_id: 'The thing acted on, or null.',
  request_id: 'The `x-request-id` of the request, to correlate with logs.',
  ip: 'The address the server saw the request come from.',
  detail: 'Extra facts about the event. Never a secret, a token or a password.',
});
describeFields(listAuditQuerySchema, {
  event_type: 'Only events of this type.',
  actor_subject_id: 'Only events done by this subject.',
  resource_type: 'Only events on this kind of resource, such as `client`.',
  resource_id: 'Only events on this resource; needs `resource_type`.',
  action: 'Only events with this action, such as `client.create`.',
  outcome: 'Only events with this outcome.',
  from: 'Only events at or after this instant.',
  to: 'Only events before this instant.',
});
describeFields(countAuditQuerySchema, {
  event_type: 'Only events of this type.',
  actor_subject_id: 'Only events done by this subject.',
  resource_type: 'Only events on this kind of resource, such as `client`.',
  resource_id: 'Only events on this resource; needs `resource_type`.',
  action: 'Only events with this action, such as `client.create`.',
  outcome: 'Only events with this outcome.',
  from: 'Only events at or after this instant.',
  to: 'Only events before this instant.',
});
describeFields(clientFieldsSchema, {
  id: "The client's internal identifier, a UUID. It names the client in admin API paths such as `/clients/{id}`; it is not the OAuth `client_id`.",
  client_id:
    'The `client_id` the application sends to the authorization and token endpoints. Chosen when the client is created and unique within the tenant.',
  name: 'A display name for people, shown for example on the consent screen.',
  description: 'Free text for administrators, or null when none was set.',
  name_i18n:
    'The name in other languages, by language tag, such as `fr` or `pt-BR`: at most 32, each of the tenant’s `supported_locales`, each at most 256 characters. A language with no entry shows `name`. A PATCH replaces the whole map.',
  description_i18n:
    'The description in other languages, by language tag, under the same rules as `name_i18n`, each at most 1000 characters.',
  type: '`public` for an application that cannot keep a secret (a single-page or native app), which must use PKCE; `confidential` for one that authenticates at the token endpoint.',
  enabled:
    'A disabled client cannot start a sign-in or obtain tokens, and tokens already issued to it stop being accepted.',
  full_scope_allowed:
    "When true the client's tokens carry every role the user holds. When false, a role reaches a token only through a scope the client is assigned.",
  skip_logout_confirmation:
    "When true, `/logout` signs a user out of this client without the confirmation page, but only for a request carrying an ID token this client was issued, for the session that is current, even an expired one. Anyone holding such a token can then sign that user out by opening a link. Off for every client but the console's own, and never settable through dynamic registration.",
  registration_origin:
    'How the client came to exist: `seeded` by `odudu seed` or `odudu init`, `anonymous` or `token` through dynamic registration, or `operator` through the admin API.',
  created_at: 'When the client was created, as an ISO 8601 date and time.',
  redirect_uris:
    'The addresses the authorization server may send the user back to after sign-in. A request naming any other address is refused.',
  grant_types:
    'The grants the client may use at the token endpoint, such as `authorization_code`, `refresh_token`, `client_credentials`.',
  token_endpoint_auth_method:
    'How a confidential client authenticates at the token endpoint, for example `client_secret_basic`, `client_secret_post` or `private_key_jwt`.',
  audiences:
    'The audiences (`aud`) added to the access tokens issued to this client, besides the issuer.',
  access_token_ttl_seconds:
    "How long this client's access tokens live, in seconds. Null uses the tenant's setting of the same name.",
  id_token_ttl_seconds:
    "How long this client's ID tokens live, in seconds. Null uses the tenant's setting of the same name.",
  refresh_token_ttl_seconds:
    "How long this client's refresh tokens live, in seconds. Null uses the tenant's setting of the same name.",
  client_credentials_scopes:
    'The scopes the client may request with the `client_credentials` grant, where it acts as itself.',
  web_origins:
    'The browser origins allowed to call the token and UserInfo endpoints from JavaScript (CORS).',
  post_logout_redirect_uris:
    'The addresses the user may be sent to after a logout the client started.',
  jwks: 'The public keys the client authenticates with when its method is `private_key_jwt`, as a JWK Set. Null when it uses `jwks_uri` or a secret.',
  jwks_uri:
    'The address the server fetches the client public keys from, instead of holding them in `jwks`.',
  frontchannel_logout_uri:
    'The client page the user agent loads to tell the client the user signed out (front-channel logout).',
  backchannel_logout_uri:
    'The client endpoint the server posts a logout token to when a session ends (back-channel logout).',
  frontchannel_logout_session_required:
    'Whether the front-channel logout request carries the session id (`sid`) and issuer.',
  backchannel_logout_session_required:
    'Whether the back-channel logout token carries the session id (`sid`).',
  consent_required:
    'Whether the user must approve what the client asks for on a consent screen before tokens are issued.',
  token_exchange_impersonation_allowed:
    'Whether the client may use token exchange (RFC 8693) to act as a user rather than on behalf of one.',
  userinfo_signed_response_alg:
    'The algorithm that signs this client’s UserInfo responses. Null returns plain JSON.',
  userinfo_encrypted_response_alg:
    'The key-management algorithm that encrypts this client’s UserInfo responses, or null.',
  userinfo_encrypted_response_enc:
    'The content-encryption algorithm for encrypted UserInfo responses, or null.',
  tls_client_auth_subject_dn:
    'The certificate subject a client using `tls_client_auth` must present, or null.',
  client_uri: 'A web page about the client application, shown to users.',
  policy_uri: 'The client privacy policy page, shown to users.',
  tos_uri: 'The client terms of service page, shown to users.',
  id_token_signed_response_alg:
    'The algorithm that signs this client’s ID tokens. Null uses the tenant’s default.',
  default_max_age:
    'The longest age in seconds a sign-in may have before the user must sign in again, when the request does not say. Null sets none.',
  require_auth_time: 'Whether ID tokens always carry the `auth_time` claim.',
  previous_secret_expires_at:
    'When the secret that a rotation replaced stops authenticating, or null when no rotation kept one. The secret itself is never shown.',
  builtin_admin:
    'True for the tenant’s built-in admin console client, which cannot be deleted and is limited in what can be amended.',
  service_subject_id:
    'The service account a confidential client authenticates as, or null when it has none.',
  scopes:
    'The scopes assigned to the client and whether each is `default` (always requested) or `optional` (only when asked for).',
});
describeFields(listClientsQuerySchema, {
  client_id: 'Only clients whose `client_id` starts with this.',
  client_id_exact: 'The one client with exactly this `client_id`.',
  name: 'Only clients whose name starts with this.',
  type: 'Only clients of this type.',
  enabled: '`true` for enabled clients only.',
});
describeFields(countClientsQuerySchema, {
  client_id: 'Only clients whose `client_id` starts with this.',
  client_id_exact: 'The one client with exactly this `client_id`.',
  name: 'Only clients whose name starts with this.',
  type: 'Only clients of this type.',
  enabled: '`true` for enabled clients only.',
});
describeFields(clientInstallationSchema, {
  issuer: 'The issuer identifier the application must trust.',
  discovery_url: 'The discovery document address; most client libraries need only this.',
  client_id: 'The `client_id` to configure in the application.',
  client_type: '`public` or `confidential`.',
  token_endpoint_auth_method: 'How the application authenticates at the token endpoint.',
  redirect_uris: 'The redirect addresses registered for the client.',
  post_logout_redirect_uris: 'The post-logout addresses registered for the client.',
  grant_types: 'The grants the client may use.',
  default_scope: 'The scopes requested when the application asks for none, space-separated.',
});
describeFields(createClientResponseSchema, {
  client_secret:
    'The generated secret of a confidential client. Shown only in this response; store it now, as only its hash is kept.',
});
describeFields(evaluateClaimsResponseSchema, {
  scope: 'The scopes the evaluation used, space-separated.',
  id_token: 'The claims the ID token would carry, or null when the scope has no `openid`.',
  access_token: 'The claims the access token would carry.',
  userinfo: 'The claims the UserInfo endpoint would return.',
});
describeFields(logoutDeliverySchema, {
  id: 'The delivery’s identifier.',
  session_id: 'The session whose end the token reports.',
  endpoint: 'The client address the token is posted to.',
  status:
    '`pending` until delivered, `delivered` once the client answered, `failed` after the attempts ran out.',
  attempts: 'How many times delivery was tried.',
  last_error: 'Why the last attempt failed, or null.',
  created_at: 'When the delivery was queued.',
  next_attempt_at: 'When the next attempt is due.',
  delivered_at: 'When the client accepted it, or null.',
});
describeFields(rotateClientSecretResponseSchema, {
  client_secret: 'The new secret. Shown only in this response.',
});
describeFields(consentSchema, {
  client_id: 'The client’s internal identifier.',
  client_key: 'The client’s `client_id`.',
  scope_names: 'The scopes the user agreed to.',
  granted_at: 'When the user agreed.',
});
describeFields(countResponseSchema, {
  count: 'How many items match, up to a cap.',
  capped: 'True when more match than `count` says, because counting stops at the cap.',
});
describeFields(executionStepSchema, {
  index: 'The step’s position, counted from 0.',
  authenticator: 'The sign-in step this entry runs, one of `available`.',
  requirement:
    '`required` always runs, `alternative` is one of several of which one suffices, `conditional` runs only when it applies to the user, `disabled` is skipped.',
});
describeFields(listExecutionsResponseSchema, {
  items: 'The tenant’s sign-in flow, in the order the steps run.',
  available: 'Every authenticator a step may name.',
});
describeFields(replaceExecutionsRequestSchema.element, {
  authenticator: 'The sign-in step to run, one of `available` in the list answer.',
  requirement:
    '`required` always runs, `alternative` is one of several of which one suffices, `conditional` runs only when it applies, `disabled` is skipped.',
});
describeFields(createKeyRequestSchema, {
  alg: 'The algorithm of the new key. It is created `rotating`; promote it to make it the one that signs.',
});
describeFields(listKeysQuerySchema, {
  status: 'Only keys with this status.',
  alg: 'Only keys with this algorithm.',
});
describeFields(signingKeySchema, {
  id: 'The key’s identifier in the admin API.',
  status:
    '`active` signs new tokens, `rotating` still verifies and is published but is not used to sign, `retired` is kept only until deleted.',
  kid: 'The key id placed in the header of tokens it signs and published in the JWKS.',
  alg: 'The signature algorithm, `RS256` or `ES256`.',
  created_at: 'When the key was created.',
  not_after: 'When the key stops being published for verification, or null.',
});
describeFields(amendProfileRequestSchema, {
  name: 'The user’s full name, as they would write it.',
  given_name: 'The first name.',
  family_name: 'The last name.',
  middle_name: 'The middle name.',
  nickname: 'A casual name.',
  preferred_username:
    'The name the user prefers to be addressed by; separate from the sign-in username.',
  profile: 'The address of the user’s profile page.',
  picture: 'The address of the user’s picture.',
  website: 'The address of the user’s web page.',
  gender: 'The user’s gender, in the user’s own words.',
  birthdate: 'The birth date as `YYYY-MM-DD`, or `YYYY` alone.',
  zoneinfo: 'The time zone as an IANA name, such as `Europe/Berlin`.',
  locale: 'The preferred language as a BCP 47 tag, such as `en-GB`.',
  phone_number: 'The telephone number, ideally in E.164 form.',
  phone_number_verified: 'Whether the phone number was verified.',
  email_verified: 'Whether the email address was verified.',
  address_formatted: 'The whole postal address as one multi-line string.',
  address_street: 'The street address.',
  address_locality: 'The city or locality.',
  address_region: 'The state, province or region.',
  address_postal_code: 'The postal code.',
  address_country: 'The country.',
  email: 'Refused here: change the email address with the subject’s own `email`.',
  username: 'Refused here: change the username with the subject’s own `username`.',
});
describeFields(profileSchema, {
  name: 'The user’s full name, as they would write it.',
  given_name: 'The first name.',
  family_name: 'The last name.',
  middle_name: 'The middle name.',
  nickname: 'A casual name.',
  preferred_username:
    'The name the user prefers to be addressed by; separate from the sign-in username.',
  profile: 'The address of the user’s profile page.',
  picture: 'The address of the user’s picture.',
  website: 'The address of the user’s web page.',
  gender: 'The user’s gender, in the user’s own words.',
  birthdate: 'The birth date as `YYYY-MM-DD`, or `YYYY` alone.',
  zoneinfo: 'The time zone as an IANA name, such as `Europe/Berlin`.',
  locale: 'The preferred language as a BCP 47 tag, such as `en-GB`.',
  phone_number: 'The telephone number, ideally in E.164 form.',
  phone_number_verified: 'Whether the phone number was verified.',
  email_verified: 'Whether the email address was verified.',
  address_formatted: 'The whole postal address as one multi-line string.',
  address_street: 'The street address.',
  address_locality: 'The city or locality.',
  address_region: 'The state, province or region.',
  address_postal_code: 'The postal code.',
  address_country: 'The country.',
  profile_updated_at: 'When the profile last changed, or null.',
});
describeFields(mintRegistrationTokenRequestSchema, {
  uses: 'How many client registrations the token allows before it is spent.',
  ttl_seconds: 'How long the token stays valid, from 60 seconds to a year.',
});
describeFields(mintRegistrationTokenResponseSchema, {
  id: 'The token’s identifier, for revoking it.',
  token:
    'The initial access token. Shown only in this response; give it to the registering client as a bearer token.',
  remaining_uses: 'How many registrations it allows.',
  expires_at: 'When it stops working.',
});
describeFields(registrationTokenSchema, {
  id: 'The token’s identifier, for revoking it. The token itself is never shown again.',
  remaining_uses: 'How many more registrations the token allows.',
  created_at: 'When the token was minted.',
  expires_at: 'When the token stops working.',
});
describeFields(scopeMappersSchema, {
  available: 'Every claim mapper the server has.',
  bound: 'The mappers the scope uses now.',
  declared: 'The mapper names stored for the scope, including any the server no longer has.',
});
describeFields(setScopeMappersRequestSchema, {
  mapper_names: 'The mappers the scope should use. Replaces the current set.',
});
describeFields(assignScopeToClientRequestSchema, {
  assignment: '`default` or `optional`.',
});
describeFields(assignScopeToClientResponseSchema, {
  client_id: 'The client’s internal identifier.',
  scopes: 'The client’s scopes after the change.',
});
describeFields(clientScopeAssignmentViewSchema, {
  id: 'The scope’s identifier.',
  name: 'The scope name.',
  assignment:
    '`default` is requested for the client without being asked for, `optional` only when the request names it.',
});
describeFields(scopeImpactSchema, {
  builtin: 'True for a scope every tenant has, which is deleted only when `confirm` names it.',
  client_assignments: 'How many clients carry the scope, each of which loses it on deletion.',
  role_mappings: 'How many roles are mapped to the scope, each unmapped on deletion.',
});
describeFields(listBuiltinScopesResponseSchema, {
  items: 'Every built-in scope, in the order a new tenant is given them.',
});
describeFields(builtinScopeSchema, {
  name: 'The scope’s name.',
  present: 'False when the tenant has no scope of that name, so a restore would create it.',
});
describeFields(restoreBuiltinScopesResponseSchema, {
  created: 'The built-in scopes the call created, in order; empty when none was missing.',
});
describeFields(clientScopeSchema, {
  id: 'The scope’s identifier.',
  name: 'The scope name clients request, such as `profile`.',
  description: 'Free text for administrators, or null.',
  include_in_id_token: 'Whether the claims this scope adds appear in the ID token.',
  include_in_access_token: 'Whether the claims this scope adds appear in the access token.',
  default_client_assignment:
    'How every new client gets this scope: `default`, `optional`, or null for neither.',
  consent_text: 'The sentence the consent screen shows for this scope, or null to use its name.',
  description_i18n:
    'The description in other languages, by language tag: at most 32, each of the tenant’s `supported_locales`, each at most 1000 characters. A language with no entry shows `description`. A PATCH replaces the whole map.',
  consent_text_i18n:
    'The consent sentence in other languages, by language tag, under the same rules, each at most 500 characters. The consent screen takes the page’s language by RFC 4647 lookup (`fr-CA` finds `fr`), then `consent_text`, then the scope’s name.',
  display_order: 'Where the scope sorts on the consent screen; lowest first.',
  created_at: 'When the scope was created.',
});
describeFields(createScopeRequestSchema, {
  name: 'The scope name clients will request. Unique in the tenant.',
  description: 'Free text for administrators.',
  include_in_id_token: 'Whether its claims appear in the ID token.',
  include_in_access_token: 'Whether its claims appear in the access token.',
  default_client_assignment: 'Assign it to every new client as `default` or `optional`.',
  consent_text: 'The sentence the consent screen shows for it.',
  description_i18n:
    'The description in other languages, by language tag: at most 32, each of the tenant’s `supported_locales`, each at most 1000 characters. A language with no entry shows `description`. A PATCH replaces the whole map.',
  consent_text_i18n:
    'The consent sentence in other languages, by language tag, under the same rules, each at most 500 characters. The consent screen takes the page’s language by RFC 4647 lookup (`fr-CA` finds `fr`), then `consent_text`, then the scope’s name.',
  display_order: 'Where it sorts on the consent screen; lowest first.',
});
describeFields(scopeClientSchema, {
  id: 'The client’s internal identifier.',
  client_id: 'The client’s `client_id`.',
  name: 'The client’s display name.',
  assignment: 'How the scope is assigned to it.',
});
describeFields(scopeRoleSchema, {
  id: 'The role’s identifier.',
  name: 'The role name.',
  client_id:
    'For a role scoped to a client, that client’s internal id; null for a tenant-wide role.',
  client_key: 'For a client role, the client’s `client_id`.',
});
describeFields(endSessionsResponseSchema, {
  ended: 'How many sessions were ended.',
});
describeFields(endTenantSessionsResponseSchema, {
  ended: 'How many sessions this call ended.',
  remaining: 'How many are left; repeat the call until it is 0.',
  beyond_ceiling:
    'How many belong to users holding an admin capability the caller does not, which are left alone.',
});
describeFields(grantSchema, {
  id: 'The grant’s identifier.',
  client_id: 'The client the grant was issued to, by its internal id.',
  client_key: 'That client’s `client_id`.',
  scope: 'The scopes the grant covers, space-separated.',
  created_at: 'When the user authorized it.',
  session_id: 'The session it is tied to, or null for an offline grant.',
  offline: 'True when the grant outlives the user’s session (the `offline_access` scope).',
  refresh_expires_at: 'When its refresh token expires, or null.',
});
describeFields(revokeClientGrantsResponseSchema, {
  beyond_ceiling:
    'How many belong to users holding an admin capability the caller does not, which are left alone.',
  remaining: 'How many are left; repeat the call until it is 0.',
});
describeFields(revokeGrantsResponseSchema, {
  revoked: 'How many grants were revoked.',
});
describeFields(listTenantSessionsQuerySchema, {
  client: 'Only sessions that signed the user in to this client, by its internal id.',
});
describeFields(countSessionsQuerySchema, {
  client: 'Only sessions that signed the user in to this client, by its internal id.',
});
describeFields(sessionSchema, {
  id: 'The session’s identifier.',
  created_at: 'When the user signed in.',
  last_active_at: 'When the session last did anything.',
  remembered:
    'Whether the user chose to stay signed in, which gives the session the longer remember-me lifetimes.',
  client_ids: 'The clients the session has signed the user in to.',
});
describeFields(tenantSessionSchema, {
  id: 'The session’s identifier.',
  created_at: 'When the user signed in.',
  last_active_at: 'When the session last did anything.',
  remembered:
    'Whether the user chose to stay signed in, which gives the session the longer remember-me lifetimes.',
  client_ids: 'The clients the session has signed the user in to.',
  subject_id: 'The user the session belongs to.',
  username: 'That user’s username, or null.',
});
describeFields(adminCapabilitiesResponseSchema, {
  items: 'The roles that carry admin capabilities, with how the subject holds each.',
  complete: 'False when the list was cut at its bound.',
});
describeFields(amendSubjectRequestSchema, {
  username: 'A new sign-in name, when the tenant allows renaming.',
  email: 'A new email address, or null to remove it.',
  enabled: 'Whether the subject may sign in.',
});
describeFields(bulkSubjectResultSchema, {
  id: 'The subject.',
  status: 'The HTTP status this subject’s part of the call would have had alone.',
  type: 'The problem type when it was refused.',
  detail: 'Why it was refused.',
  ended: 'For `end-sessions`, how many sessions were ended.',
});
describeFields(bulkSubjectsRequestSchema, {
  action: 'What to do to every listed subject: `disable`, `enable`, `delete` or `end-sessions`.',
  ids: 'The subjects to act on, at most 100.',
});
describeFields(clearLockoutsResponseSchema, {
  cleared: 'How many subjects’ failed sign-ins were cleared.',
  beyond_ceiling: 'How many hold an admin capability the caller does not, and were left locked.',
  remaining: 'How many more are left; repeat the call until it is 0.',
});
describeFields(createSubjectRequestSchema, {
  username: 'The sign-in name. Unique in the tenant, case counts.',
  email: 'The email address, if any.',
});
describeFields(credentialSchema, {
  id: 'The credential’s identifier, for deleting it. Absent for a password.',
  type: '`password`, `totp` (an authenticator app), `webauthn` (a passkey) or `recovery-code`.',
  created_at: 'When the credential was set up.',
  expired: 'For a password, whether the tenant’s maximum password age has passed.',
  recovery_code_count: 'For recovery codes, how many unused codes remain.',
});
describeFields(effectiveRoleSchema, {
  id: 'The role’s identifier.',
  name: 'The role name.',
  client_id:
    'For a role scoped to a client, that client’s internal id; null for a tenant-wide role.',
  client_key: 'For a client role, the client’s `client_id`.',
  via: 'How the subject holds the role: directly, through a group, or through a composite role.',
});
describeFields(heldAdminCapabilitySchema, {
  name: 'The admin capability, or `tenant-admin`, which holds them all.',
  direct:
    'True when it is assigned to the subject itself, false when it comes through a group or a role.',
});
describeFields(listedSubjectSchema, {
  admin_capabilities:
    'Present when the list was filtered by `capability`: every admin capability the subject holds.',
});
describeFields(roleAssignmentSchema, {
  id: 'The role’s identifier.',
  name: 'The role name.',
  client_id:
    'For a role scoped to a client, that client’s internal id; null for a tenant-wide role.',
  client_key: 'For a client role, the client’s `client_id`.',
});
describeFields(sendActionsEmailRequestSchema, {
  actions: 'The actions the mailed link asks the user to complete; at least one.',
});
describeFields(setRequiredActionsRequestSchema, {
  actions:
    'The steps the user must complete at their next sign-in: `update-password`, `configure-totp`, `configure-passkey` or `generate-recovery-codes`. Replaces the current list.',
});
describeFields(setRequiredActionsResponseSchema, {
  actions: 'The required actions after the change.',
});
describeFields(setRolesRequestSchema, {
  role_ids: 'The identifiers of every role the subject should hold. Replaces the current set.',
});
describeFields(listSubjectsQuerySchema, {
  username: 'Only subjects whose username starts with this, ignoring case.',
  email: 'Only subjects whose email starts with this, ignoring case.',
  name: 'Only subjects whose full name starts with this, ignoring case.',
  given_name: 'Only subjects whose first name starts with this, ignoring case.',
  family_name: 'Only subjects whose last name starts with this, ignoring case.',
  enabled: '`true` for enabled subjects only, `false` for disabled ones only.',
  role: 'Only subjects holding this role, by role id.',
  group: 'Only members of this group, by group id.',
  capability:
    'Only holders of this admin capability, `tenant-admin`, or `any` admin capability; held effectively.',
  type: 'Only subjects of this type.',
  locked: '`true` for subjects locked out by failed sign-ins only.',
});
describeFields(countSubjectsQuerySchema, {
  username: 'Only subjects whose username starts with this, ignoring case.',
  email: 'Only subjects whose email starts with this, ignoring case.',
  name: 'Only subjects whose full name starts with this, ignoring case.',
  given_name: 'Only subjects whose first name starts with this, ignoring case.',
  family_name: 'Only subjects whose last name starts with this, ignoring case.',
  enabled: '`true` for enabled subjects only, `false` for disabled ones only.',
  role: 'Only subjects holding this role, by role id.',
  group: 'Only members of this group, by group id.',
  capability:
    'Only holders of this admin capability, `tenant-admin`, or `any` admin capability; held effectively.',
  type: 'Only subjects of this type.',
  locked: '`true` for subjects locked out by failed sign-ins only.',
});
describeFields(subjectSchema, {
  id: 'The subject’s identifier, a UUID.',
  type: '`user` is a person, `service` is the account of a confidential client, `agent_instance` is an automated agent.',
  username: 'The name the subject signs in with, or null for a subject that does not.',
  email: 'The subject’s email address, or null.',
  enabled: 'A disabled subject cannot sign in or get tokens.',
  created_at: 'When the subject was created.',
});
describeFields(usernamePolicySchema, {
  username_editable: 'Whether the tenant lets a username be changed.',
});
describeFields(clientRecordSchema, {
  supported_locales:
    'The languages the tenant offers (its `supported_locales` setting), at most 32: the languages `name_i18n` and `description_i18n` may be written in. Only the client’s own read and amendment carry it, so a caller who may manage clients can see them without reading the tenant’s settings.',
});
describeFields(exportedClientSchema, {
  client_id:
    'The `client_id` the application sends to the authorization and token endpoints. Chosen when the client is created and unique within the tenant.',
  name: 'A display name for people, shown for example on the consent screen.',
  description: 'Free text for administrators, or null when none was set.',
  name_i18n:
    'The name in other languages, by language tag, such as `fr` or `pt-BR`: at most 32, each of the tenant’s `supported_locales`, each at most 256 characters. A language with no entry shows `name`. A PATCH replaces the whole map.',
  description_i18n:
    'The description in other languages, by language tag, under the same rules as `name_i18n`, each at most 1000 characters.',
  type: '`public` for an application that cannot keep a secret (a single-page or native app), which must use PKCE; `confidential` for one that authenticates at the token endpoint.',
  enabled:
    'A disabled client cannot start a sign-in or obtain tokens, and tokens already issued to it stop being accepted.',
  full_scope_allowed:
    "When true the client's tokens carry every role the user holds. When false, a role reaches a token only through a scope the client is assigned.",
  skip_logout_confirmation:
    'When true, `/logout` signs a user out of this client without the confirmation page, for a request carrying an ID token this client was issued for the session that is current, even an expired one. Absent in a document exported before the setting existed, which imports with it off.',
  registration_origin:
    'How the client came to exist: `seeded` by `odudu seed` or `odudu init`, `anonymous` or `token` through dynamic registration, or `operator` through the admin API.',
  redirect_uris:
    'The addresses the authorization server may send the user back to after sign-in. A request naming any other address is refused.',
  grant_types:
    'The grants the client may use at the token endpoint, such as `authorization_code`, `refresh_token`, `client_credentials`.',
  token_endpoint_auth_method:
    'How a confidential client authenticates at the token endpoint, for example `client_secret_basic`, `client_secret_post` or `private_key_jwt`.',
  audiences:
    'The audiences (`aud`) added to the access tokens issued to this client, besides the issuer.',
  access_token_ttl_seconds:
    "How long this client's access tokens live, in seconds. Null uses the tenant's setting of the same name.",
  id_token_ttl_seconds:
    "How long this client's ID tokens live, in seconds. Null uses the tenant's setting of the same name.",
  refresh_token_ttl_seconds:
    "How long this client's refresh tokens live, in seconds. Null uses the tenant's setting of the same name.",
  client_credentials_scopes:
    'The scopes the client may request with the `client_credentials` grant, where it acts as itself.',
  web_origins:
    'The browser origins allowed to call the token and UserInfo endpoints from JavaScript (CORS).',
  post_logout_redirect_uris:
    'The addresses the user may be sent to after a logout the client started.',
  jwks: 'The public keys the client authenticates with when its method is `private_key_jwt`, as a JWK Set. Null when it uses `jwks_uri` or a secret.',
  jwks_uri:
    'The address the server fetches the client public keys from, instead of holding them in `jwks`.',
  frontchannel_logout_uri:
    'The client page the user agent loads to tell the client the user signed out (front-channel logout).',
  backchannel_logout_uri:
    'The client endpoint the server posts a logout token to when a session ends (back-channel logout).',
  frontchannel_logout_session_required:
    'Whether the front-channel logout request carries the session id (`sid`) and issuer.',
  backchannel_logout_session_required:
    'Whether the back-channel logout token carries the session id (`sid`).',
  consent_required:
    'Whether the user must approve what the client asks for on a consent screen before tokens are issued.',
  token_exchange_impersonation_allowed:
    'Whether the client may use token exchange (RFC 8693) to act as a user rather than on behalf of one.',
  userinfo_signed_response_alg:
    'The algorithm that signs this client’s UserInfo responses. Null returns plain JSON.',
  userinfo_encrypted_response_alg:
    'The key-management algorithm that encrypts this client’s UserInfo responses, or null.',
  userinfo_encrypted_response_enc:
    'The content-encryption algorithm for encrypted UserInfo responses, or null.',
  tls_client_auth_subject_dn:
    'The certificate subject a client using `tls_client_auth` must present, or null.',
  client_uri: 'A web page about the client application, shown to users.',
  policy_uri: 'The client privacy policy page, shown to users.',
  tos_uri: 'The client terms of service page, shown to users.',
  id_token_signed_response_alg:
    'The algorithm that signs this client’s ID tokens. Null uses the tenant’s default.',
  default_max_age:
    'The longest age in seconds a sign-in may have before the user must sign in again, when the request does not say. Null sets none.',
  require_auth_time: 'Whether ID tokens always carry the `auth_time` claim.',
});
describeFields(exportedFlowStepSchema, {
  authenticator: 'The sign-in step to run.',
  requirement: '`required`, `alternative`, `conditional` or `disabled`.',
});
describeFields(exportedGroupSchema, {
  path: 'The group’s place in the hierarchy, such as `/staff/eu`.',
  description: 'Free text for administrators, or null.',
  default_for_new_subjects: 'Whether new users join the group.',
  roles: 'The roles every member of the group is given.',
});
describeFields(exportedRoleSchema, {
  name: 'The role name.',
  client: 'The `client_id` the role belongs to, or null for a tenant-wide role.',
  description: 'Free text for administrators, or null.',
  default_for_new_subjects: 'Whether new users are given the role.',
  builtin: 'True for a role every tenant has, such as the admin roles.',
  composites: 'The roles this role contains.',
});
describeFields(exportedScopeSchema, {
  name: 'The scope name clients request.',
  description: 'Free text for administrators, or null.',
  include_in_id_token: 'Whether its claims appear in the ID token.',
  include_in_access_token: 'Whether its claims appear in the access token.',
  default_client_assignment: 'How every new client gets the scope, or null for neither.',
  consent_text: 'The sentence the consent screen shows for it, or null.',
  description_i18n:
    'The description in other languages, by language tag: at most 32, each of the tenant’s `supported_locales`, each at most 1000 characters. A language with no entry shows `description`. A PATCH replaces the whole map.',
  consent_text_i18n:
    'The consent sentence in other languages, by language tag, under the same rules, each at most 500 characters. The consent screen takes the page’s language by RFC 4647 lookup (`fr-CA` finds `fr`), then `consent_text`, then the scope’s name.',
  display_order: 'Where it sorts on the consent screen; lowest first.',
  builtin: 'True for a scope every tenant has.',
  roles: 'The roles the scope carries into tokens.',
  mappers: 'The claim mappers the scope uses.',
  clients: 'The clients the scope is assigned to, by `client_id`.',
});
describeFields(exportedSmtpSchema, {
  host: 'The SMTP relay’s host.',
  port: 'The relay’s port.',
  from_address: 'The address mail is sent from.',
  username: 'The user name for the relay, or null. The password is never exported.',
  starttls: 'Whether STARTTLS is required.',
});
describeFields(exportedSubjectSchema, {
  username: 'The sign-in name.',
  email: 'The email address, or null.',
  enabled: 'Whether the subject may sign in.',
  profile: 'The standard profile claims.',
  roles: 'The roles the subject holds directly.',
  groups: 'The groups the subject belongs to, by path.',
  required_actions: 'The actions the subject must complete at next sign-in.',
});
describeFields(importTenantRequestSchema, {
  name: 'The name of the tenant to create.',
  display_name: 'A friendly name for the new tenant.',
});
describeFields(importTenantResponseSchema, {
  tenant: 'The tenant that was created.',
  client_secrets: 'The secrets generated for the imported confidential clients.',
});
describeFields(importedClientSecretSchema, {
  client_id: 'The imported client.',
  secret: 'Its newly generated secret. Shown only in this response.',
});
describeFields(registrationPolicySchema, {
  registration_allowed: 'Whether people may register themselves.',
  verify_email: 'Whether a registered address must be verified before sign-in.',
  client_registration_policy:
    'Who may register clients dynamically: nobody (`disabled`), anybody (`open`) or the holder of an initial access token (`token`).',
});
describeFields(tenantDocumentSchema, {
  version: 'The document format version; always 1.',
  settings: 'The tenant’s settings.',
  flow: 'The sign-in flow, in order.',
  clients: 'The tenant’s clients. Secrets are never exported.',
  roles: 'The tenant’s roles.',
  groups: 'The tenant’s groups.',
  scopes: 'The tenant’s client scopes.',
  registration_policy: 'Who may register themselves and register clients.',
  smtp: 'The tenant’s mail relay, or null when it has none.',
  message_overrides:
    'The tenant’s own wording for page messages, at most 500, in locale and key order. Absent from a document exported before overrides existed, which imports with none.',
  subjects: 'The tenant’s users, only when requested with `include=subjects`.',
  omitted: 'What the document leaves out on purpose, such as secrets and credentials.',
});
describeFields(tenantSettingsDocumentSchema, {
  display_name: 'The name shown to people on sign-in pages.',
  enabled: 'Whether the tenant accepts sign-ins and token requests.',
  reset_password_allowed: 'Whether users may ask for a password reset link by mail.',
  sso_session_idle_seconds: 'How long a browser session may sit idle before it ends.',
  sso_session_max_seconds: 'The longest a browser session lasts, however active.',
  password_min_length: 'The fewest characters a password may have.',
  password_require_digit: 'Whether a password must contain a digit.',
  password_require_uppercase: 'Whether a password must contain an upper-case letter.',
  password_require_lowercase: 'Whether a password must contain a lower-case letter.',
  password_require_special:
    'Whether a password must contain a character that is not a letter or digit.',
  password_not_username: 'Whether a password may not equal the username.',
  password_not_email: 'Whether a password may not equal the email address.',
  password_history_depth: 'How many previous passwords a user may not reuse. 0 keeps none.',
  password_max_age_days: 'Days before a password must be changed. 0 means it never expires.',
  otp_required: 'Whether every user must set up a one-time-code authenticator.',
  brute_force_max_failures: 'Failed sign-ins in a row before the account is locked out.',
  brute_force_lockout_seconds: 'How long a lockout lasts.',
  brute_force_max_lockout_seconds: 'The longest a lockout can grow to when it is tripped again.',
  brute_force_failure_reset_seconds:
    'How long without a failed sign-in before the count starts again.',
  max_clients: 'The most clients the tenant may hold.',
  max_sessions_per_browser: 'The most sessions one browser may hold at once.',
  remember_me_allowed: 'Whether the sign-in form offers to stay signed in.',
  remember_me_idle_seconds: 'How long a remembered session may sit idle.',
  remember_me_max_seconds: 'The longest a remembered session lasts.',
  audit_retention_days: 'How many days audit events are kept before `odudu reap` deletes them.',
  username_editable: 'Whether a username may be changed after it is set.',
  access_token_ttl_seconds: 'How long an access token lives unless the client says otherwise.',
  id_token_ttl_seconds: 'How long an ID token lives unless the client says otherwise.',
  refresh_token_ttl_seconds: 'How long a refresh token lives unless the client says otherwise.',
  authorization_code_ttl_seconds: 'How long an authorization code can be redeemed.',
  login_ttl_seconds: 'How long a started sign-in may take to finish.',
  verify_email_ttl_seconds: 'How long a mailed email-verification link works.',
  reset_password_ttl_seconds: 'How long a mailed password-reset link works.',
  login_with_email: 'Whether a user may sign in with the email address instead of the username.',
  audit_event_types: 'The audit event types the tenant stores.',
  supported_locales:
    'The language tags the tenant’s pages are offered in, 1 to 32, each such as `fr` or `zh-Hant-TW`; discovery advertises them as `ui_locales_supported`.',
  default_locale:
    'The language a page is shown in ahead of the browser’s preference, when the request names none; one of `supported_locales`. Null when the browser decides; send an empty string to clear it.',
});
describeFields(createTenantRequestSchema, {
  name: 'The tenant name, used in every address of the tenant (`/tenants/{name}/...`). 1 to 63 lowercase letters, digits or hyphens, not starting or ending with a hyphen.',
  display_name: 'A friendly name for people. Null when none was given.',
});
describeFields(listTenantsQuerySchema, {
  name: 'Only tenants whose name starts with this.',
  display_name: 'Only tenants whose display name starts with this.',
  enabled: '`true` for enabled tenants only, `false` for disabled ones.',
});
describeFields(countTenantsQuerySchema, {
  name: 'Only tenants whose name starts with this.',
  display_name: 'Only tenants whose display name starts with this.',
  enabled: '`true` for enabled tenants only, `false` for disabled ones.',
});
describeFields(tenantSchema, {
  id: 'The tenant’s internal identifier, a UUID.',
  name: 'The name in the tenant’s addresses and issuer.',
  display_name: 'The name shown to people on sign-in pages, or null.',
  enabled: 'A disabled tenant refuses every sign-in and token request.',
  created_at: 'When the tenant was created.',
});

const GROUP_WORDS: Fields = {
  id: 'The group’s identifier, a UUID.',
  name: 'The group’s own name, unique among the groups beside it. Fixed once the group is made.',
  description: 'What the group is for, or null.',
  parent_id: 'The group this one sits under, or null for a group at the top level.',
  default_for_new_subjects:
    'Whether every subject created from now on joins the group, by the admin API, registration and seeding alike. Subjects that already exist are not changed.',
  path: 'The names from the top of the tree down to this group, such as `/eng/platform`. The `groups` claim carries it, and it is recomputed when the group is moved.',
  created_at: 'When the group was created.',
  admin_reach:
    'The admin capabilities membership of the group hands out, however deep roles nest them: its own roles and those of every group above it.',
  subtree_admin_reach:
    'The admin capabilities handed out by this group and every group beneath it, which is what deleting it would take away.',
  holds_default_group:
    'Whether this group, or one beneath it, is given to every new subject. Such a group cannot be moved under a parent that hands out an admin capability.',
};
for (const schema of [groupFieldsSchema, groupSchema, groupRecordSchema]) {
  describeFields(schema, wordsOf(schema, GROUP_WORDS));
}
for (const query of [listGroupsQuerySchema, countGroupsQuerySchema]) {
  describeFields(query, {
    name: 'Only groups whose own name starts with this, at any level.',
    parent:
      'Only the groups directly under the group with this id, or `root` for the groups with no parent.',
  });
}

const ROLE_WORDS: Fields = {
  id: 'The role’s identifier, a UUID.',
  name: 'The role’s name, which a token carries. Fixed once the role is made.',
  description: 'What the role is for, or null.',
  client_id:
    'The internal identifier of the client the role is scoped to, or null for a tenant role.',
  client_key:
    'The `client_id` of that client, the name it is told apart by, or null for a tenant role. A token carries a client role as this, a colon and the role’s name.',
  default_for_new_subjects:
    'Whether every subject created from now on is given the role. Subjects that already exist are not changed.',
  created_at: 'When the role was created.',
  admin_reach:
    'The admin capabilities the role hands out, however deep it nests them, as the capability ceiling judges them.',
};
for (const schema of [roleFieldsSchema, roleSchema]) {
  describeFields(schema, wordsOf(schema, ROLE_WORDS));
}
for (const query of [listRolesQuerySchema, countRolesQuerySchema]) {
  describeFields(query, {
    name: 'Only roles whose name starts with this.',
    client:
      'Only the roles of one owner: `tenant` for the tenant’s own roles, or a client’s internal id for the roles scoped to it.',
  });
}
describeFields(createRoleRequestSchema, {
  name: 'The role’s name, which a token carries. It cannot be changed afterwards.',
  description: 'What the role is for.',
  client_id:
    'The internal identifier of the client to scope the role to; omit it for a tenant role.',
  default_for_new_subjects: 'Give the role to every subject created from now on.',
});

describeFields(mailMessageSchema, {
  id: 'The message’s identifier, a UUID.',
  to: 'The recipient’s address. Masked, with `to_masked` true, unless the caller may read subjects.',
  to_masked: 'True when `to` is masked because the caller may not read subjects.',
  subject:
    'The message’s subject line. Its body is never returned, because it carries a link that signs somebody in.',
  last_error: 'What the last failed attempt answered, or null if none has failed.',
  created_at: 'When the message was queued.',
  next_attempt_at: 'When the sender will try it next.',
  sent_at: 'When it was delivered, or null if it has not been.',
});

describeFields(smtpConfigSchema, {
  configured: 'Whether the tenant has a relay of its own saved.',
  host: 'The relay’s host, or null when the tenant has none.',
  port: 'The relay’s port, or null when the tenant has none.',
  from_address: 'What the From line of each message says, or null when the tenant has no relay.',
  username: 'The login the relay asks for, or null when it asks for none.',
  password_set:
    'Whether a password is stored. The password itself is never returned, whether the relay was just written or read in an earlier session.',
  starttls:
    'Whether the connection must upgrade to TLS (STARTTLS), or null when the tenant has no relay.',
});
describeFields(putSmtpRequestSchema, {
  host: 'The relay’s host.',
  port: 'The relay’s port, a whole number from 1 to 65535.',
  from_address: 'What the From line of each message says.',
  username: 'The login the relay asks for. Omit it or send null when it asks for none.',
  password:
    'The password to store. Omitted, the stored one is kept while the host, port and username are unchanged; null clears it.',
  starttls:
    'Whether the connection must upgrade to TLS (STARTTLS). Required while a username or password is set.',
});

// Bodies of a single field, described by that field alone: a shape of one
// field describes only an object of exactly that one field.
// One shape for the group and the role body alike: a fingerprint holds one set of words.
describeFields(setGroupDefaultRequestSchema, {
  default:
    'True to give every subject created from now on this group or role, false to stop. Subjects that already exist are not changed.',
});
describeFields(addRoleCompositeRequestSchema, {
  child_role_id: 'The role to nest in this one. Whoever holds this role then holds it too.',
});
describeFields(testSmtpRequestSchema, { to: 'The address to send the test message to.' });
describeFields(testSmtpResponseSchema, {
  sent: 'True when the relay accepted the message. A relay that refuses it answers 502 instead.',
});

describeFields(whoamiResponseSchema, {
  subjectId: 'The subject the access token was issued to.',
  issuerTenantId: 'The tenant that issued the token, which is the caller’s own tenant.',
  capabilities:
    'The admin capabilities the caller holds in its own tenant, directly, through a group or nested in a role. A composite such as `tenant-admin` is reported as the capabilities it carries.',
  crossTenant:
    'True when the caller’s tenant is not the tenant in the path, which only a holder of `manage-tenants` may be.',
});

describeFields(themeBodyRequestSchema, {
  tokens:
    'The colours and font, as groups that each replace the layer below whole: `light`, `dark` and `font`.',
  stylesheet:
    'One stylesheet of at most 128 KiB, checked against an allowlist of properties, values and the page class hooks, or null for none.',
  templates:
    'A template per page kind, by kind name, each at most 64 KiB: HTML with the server’s own slots such as `{{form.open}}` and `{{t "login.title"}}`. A kind left out uses the layer below.',
  assets:
    'The images: `logo` and `darkLogo` with alt text, `favicon` and `background`, each naming an uploaded image of this tenant by its id.',
});
describeFields(themeTokensSchema, {
  light: 'The colours of the light scheme, all eleven or none.',
  dark: 'The colours of the dark scheme, all eleven or none.',
  font: 'The font family, one of the two Instrument serves itself.',
});
describeFields(paletteSchema, {
  surfacePage: 'The page background, as `#rrggbb`.',
  surfacePanel: 'The card or panel background.',
  surfaceSunken: 'The background of an input or a recessed area.',
  inkPrimary: 'The body text colour.',
  inkMuted: 'The secondary text colour.',
  signalActive: 'The primary button background.',
  signalActiveInk: 'The text on the primary button, and on the page and panel.',
  signalDanger: 'The destructive button background.',
  signalDangerInk: 'The text on the destructive button, and the error text.',
  borderStrong: 'The border of an input and a panel.',
  focusRing: 'The focus outline.',
});
describeFields(themeAssetsSchema, {
  logo: 'The logo and its alt text, which is required.',
  darkLogo: 'The logo shown under the dark scheme, with its own alt text.',
  favicon: 'The icon the browser tab shows.',
  background: 'The page background image.',
});
describeFields(themeLogoSchema, {
  assetId: 'The image, as the id an upload answered. It must belong to this tenant.',
  alt: 'The text a screen reader says for the logo, at most 200 characters and not blank.',
});
describeFields(themeImageSchema, {
  assetId: 'The image, as the id an upload answered. It must belong to this tenant.',
});
describeFields(themeViewSchema, {
  scope: '`tenant` for the tenant’s own theme, `client` for one client’s.',
  draft:
    'The saved draft, or null when there is none. Users never see a draft. Its `ETag` is the response’s, and the next write must send it as `If-Match`.',
  published:
    'The version users see, or null when the scope has none and its pieces come from below.',
  sources:
    'For each piece of the published theme, the layer that supplies it: `client`, `tenant` or `default` (Instrument). A client with no theme of its own shows `tenant` for every piece the tenant sets.',
  draft_sources:
    'The same for the draft as it would be if published, or null when there is no draft.',
  tenant_sources:
    'On a client’s theme, the layer that supplies each piece of the tenant’s own published theme: `tenant` where the tenant sets it, `default` where it does not, so a piece the client sets can say which of the tenant’s it hides. Null on the tenant’s own theme. It needs no capability beyond the client’s own theme read.',
});
describeFields(publishedThemeSchema, {
  id: 'The version’s identifier, which `restore` names.',
  version: 'The version number, which grows with each publish or restore.',
  published_at: 'When it was published.',
  body: 'The theme as it was published.',
});
describeFields(publishThemeResponseSchema, {
  warnings:
    'What publishing cannot prove: a stylesheet or a template may break the contrast or the layout the checked pieces guarantee. A warning does not block.',
});
describeFields(themeWarningSchema, {
  piece: 'The piece the warning is about: `stylesheet` or `templates.<kind>`.',
  code: '`stylesheet-unverified` or `template-unverified`.',
  message: 'What cannot be checked and who is responsible for it.',
});
describeFields(themeVersionSchema, {
  id: 'The version’s identifier, which `restore` names.',
  version: 'The version number.',
  state: '`published` for the one users see, `archived` for an earlier one.',
  created_at: 'When the version was first saved as a draft.',
  published_at: 'When it was published.',
});
describeFields(previewThemeQuerySchema, {
  kind: 'The page to render, one of the kinds a theme has a template for; `sign-in` when left out.',
  scheme:
    'Render in the `light` or the `dark` palette; the viewer\u2019s own colour scheme when left out.',
});
describeFields(themePreviewInfoSchema, {
  kind: 'The page kind the preview shows.',
  from: 'Where the scope\u2019s own layer comes from: its `draft`, its `published` version when it has no draft, or `none` when it has neither.',
  shown:
    'The most specific layer the page is drawn from: the `client`\u2019s, the `tenant`\u2019s, or the `default` look when no layer could be used.',
  faults:
    'Layers, or a layer\u2019s stylesheet, that were not used, each with the reason; empty when everything was used.',
  refused:
    'Templates of this page kind that failed the checks, by layer; the page then uses the template of the layer below or the default one.',
  unfilled:
    'True when a template passed the checks but could not be filled, so the default page is shown.',
});
describeFields(stylesheetHooksResponseSchema, {
  version:
    'The version of the lists. It is raised when a class is renamed or removed, never when one is added.',
  classes:
    'The classes the server pages render, which a rule may name with a dot, such as `.logo`.',
  page_kind_classes:
    'One class per page kind, `page-` and the kind, which a rule may name to style that page alone.',
  elements: 'The element types a rule may name, such as `main` and `button`.',
  pseudo_classes:
    'The states a rule may name after a colon, such as `:hover`. A rule may chain them onto a class or an element.',
  pseudo_elements:
    'The parts of an element a rule may name after two colons, such as `::before`. Nothing may follow one in a selector.',
  tokens:
    'The design values a declaration may read with `var()`, such as `var(--ink-primary)`. A stylesheet cannot define a custom property of its own.',
});
describeFields(themePreviewFaultSchema, {
  layer: 'The layer that was not fully used.',
  code: '`invalid_body`: the stored theme could not be read; `image_gone`: it names an image that no longer exists; `stylesheet_refused`: its stylesheet fails today\u2019s checks and was left out.',
});
describeFields(themePreviewRefusedSchema, {
  layer: 'The layer whose template was refused.',
  codes: 'The codes of the checks it failed.',
});
describeFields(previewMailQuerySchema, {
  kind: 'The mail to render; `verify-email`, the address-verification mail, when left out.',
  scheme:
    'Render in the `light` or the `dark` palette and logo. A mail client chooses by its own setting, so the preview fixes one; `light` when left out.',
  locale:
    'The language of the mail, one of the languages a mail catalogue exists for; the tenant\u2019s `default_locale`, then English, when left out.',
});
describeFields(mailBrandingViewSchema, {
  light:
    'The nine colours a mail is drawn in under a light scheme, and whether the tenant\u2019s published theme or Odudu\u2019s own supplies them.',
  dark: 'The same under a dark scheme.',
  logo: 'The logo in the mail\u2019s header, or null when the mail carries Odudu\u2019s own mark.',
  dark_logo:
    'The logo a dark scheme swaps in, or null when the light one is shown in both schemes.',
});
describeFields(mailSchemeSchema, {
  source: '`tenant` when the published theme sets this scheme\u2019s palette, else `default`.',
  colours: 'The colours as `#rrggbb`, which is how a mail client takes them.',
});
describeFields(mailColoursSchema, {
  page: 'The background around the message.',
  panel: 'The background of the message itself.',
  sunken: 'The background of a code or an address shown inside it.',
  border: 'The outline of the message and of what is shown inside it.',
  ink: 'The text.',
  muted: 'The quieter text of the footer and the notes.',
  link: 'A link.',
  button: 'The background of the button.',
  button_ink: 'The text on the button.',
});
describeFields(mailLogoSchema, {
  src: 'The absolute address a mail client fetches the image from, on this server\u2019s public origin.',
  alt: 'The text a mail client shows where it does not load the image.',
  width: 'The width in pixels the mail draws it at.',
  height: 'The height in pixels the mail draws it at.',
});
describeFields(uploadThemeAssetQuerySchema, {
  kind: 'The slot the image is for, which sets its limits: `logo`, `darkLogo` and `favicon` at most 256 KiB and 1024 pixels on the longer side, `background` at most 1 MiB and 2560 pixels.',
});
describeFields(themeAssetSchema, {
  id: 'The image\u2019s identifier, which a theme names as `assetId`.',
  sha256: 'The SHA-256 of the stored image, the hash its public address carries.',
  mime: 'The stored type: `image/png`, `image/jpeg` or `image/webp`, as the bytes are and never as the request declared.',
  width: 'The width in pixels.',
  height: 'The height in pixels.',
  bytes:
    'The stored size in bytes, after the image was re-encoded; this is what counts against the tenant\u2019s 8 MiB.',
  kind: 'The slot this upload was checked as, echoing the request; the same image may be uploaded as another kind, so it is not a stored fact.',
});
describeFields(listThemeVersionsResponseSchema, {
  items: 'At most 20 versions, newest first, without their bodies.',
});

describeFields(messageOverrideSchema, {
  locale: 'The language tag the text is for, spelled `fr`, `fr-CA` or `zh-Hant-TW`.',
  key: 'The key of the page message it replaces, such as `login.title`.',
  message:
    'The text shown in place of the catalogue’s. Placeholders such as `{name}` and plural arms are kept; markup is shown as text, never rendered.',
  updated_at: 'When the override was last written.',
});
describeFields(exportedMessageOverrideSchema, {
  locale: 'The language tag the text is for.',
  key: 'The key of the page message it replaces.',
  message: 'The text shown in place of the catalogue’s.',
});
describeFields(putMessageOverrideRequestSchema, {
  message:
    'The replacement text, 1 to 2,000 characters. It may use the placeholders the catalogue message uses; a placeholder a page does not supply makes the page show the catalogue’s text instead.',
});
describeFields(listMessageOverridesQuerySchema, {
  locale: 'The language tag whose overrides to list.',
});
describeFields(listMessageOverridesResponseSchema, {
  items: 'The overrides of the locale in key order.',
});
describeFields(messageCatalogueResponseSchema, {
  sections:
    'One section per package that fills pages, each with the page kinds it fills. The list is the same for every tenant and holds a few hundred messages in all.',
});
describeFields(messageCatalogueSectionSchema, {
  kinds:
    'The page kinds filled from this section. A template of one of them may name, in `{{t "key"}}`, only a key of its own section.',
  messages:
    'Every message of the section in key order. A message override may name the key of any section.',
});
describeFields(messageCatalogueEntrySchema, {
  key: 'The key a template names in `{{t "key"}}` and an override is set under.',
  en: 'The English text of the message, as the catalogue holds it, placeholders included.',
});

// Words for a field of this name wherever it appears and nothing says otherwise.
const COMMON: Fields = {
  next: 'An opaque cursor for the next page; absent on the last page.',
  cursor: 'The `next` value of the previous page, to continue after it.',
  limit: 'How many items to return. A value over 200 is treated as 200; the default is 50.',
  items: 'The entries of this answer.',
  end_sessions:
    '`true` also ends every live session of the subject in the same transaction as the removal, queueing their back-channel logouts as `DELETE …/sessions` does; the default `false` leaves them signed in.',
  require_new_set:
    '`true` (the default) owes the subject a new set of recovery codes at their next sign-in when a second factor remains; `false` leaves them with none until one is asked of them.',
  count: 'How many items match, up to a cap.',
  capped: 'True when more match than `count` says, because counting stops at the cap.',
};

const ROOT = new Map<z.ZodType, RootNotes>([
  [createTenantRequestSchema, { examples: [{ name: 'acme', display_name: 'Acme Corporation' }] }],
  [createSubjectRequestSchema, { examples: [{ username: 'ada', email: 'ada@example.com' }] }],
  [
    setRequiredActionsRequestSchema,
    { examples: [{ actions: ['update-password', 'configure-totp'] }] },
  ],
  [
    createClientRequestSchema,
    {
      examples: [
        {
          client_id: 'web-app',
          name: 'Web app',
          redirect_uris: ['https://app.example.com/callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          token_endpoint_auth_method: 'none',
        },
      ],
    },
  ],
  [
    listAuditResponseSchema,
    {
      examples: [
        {
          items: [
            {
              id: '0192f5c4-1d4e-7a3b-9c11-5a2f0e6b7c01',
              occurred_at: '2026-10-19T09:30:00.000Z',
              event_type: 'admin_mutation',
              action: 'client.create',
              outcome: 'allowed',
              actor_tenant_id: '0192f5c4-0000-7000-8000-000000000001',
              actor_subject_id: '0192f5c4-0000-7000-8000-000000000002',
              actor_client_id: '0192f5c4-0000-7000-8000-000000000003',
              actor_name: 'ada',
              actor_origin: 'tenant',
              resource_type: 'client',
              resource_id: '0192f5c4-0000-7000-8000-000000000004',
              request_id: '0192f5c4-0000-7000-8000-000000000005',
              ip: '203.0.113.7',
              detail: {},
            },
          ],
        },
      ],
    },
  ],
  [
    amendSettingsRequestSchema,
    {
      description:
        'The settings to change, by name, each with its new value. A name the tenant does not have, or a value outside its range, is refused naming it.',
      examples: [{ password_min_length: 12, registration_allowed: true }],
    },
  ],
  [
    settingsSchema,
    {
      description:
        'Every tenant setting by name with its current value: lifetimes, password and lockout rules, which sign-in features are on, retention.',
    },
  ],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function annotate(node: unknown): void {
  if (Array.isArray(node)) {
    for (const child of node) annotate(child);
    return;
  }
  if (!isRecord(node)) return;
  const properties = node.properties;
  if (isRecord(properties)) {
    const shapes = describing(Object.keys(properties));
    for (const [name, property] of Object.entries(properties)) {
      const words =
        shapes.map((fields) => fields[name]).findLast((text) => text !== undefined) ?? COMMON[name];
      if (isRecord(property) && words !== undefined && property.description === undefined) {
        property.description = words;
      }
    }
  }
  for (const value of Object.values(node)) annotate(value);
}

// The JSON Schema of a contract schema with the reference's descriptions and
// examples added: what the OpenAPI document carries.
export function documentedJsonSchema(schema: z.ZodType): JsonSchema {
  const json: JsonSchema = z.toJSONSchema(schema, { unrepresentable: 'any' });
  annotate(json);
  const notes = ROOT.get(schema);
  if (notes?.description !== undefined) json.description = notes.description;
  if (notes?.examples !== undefined) json.examples = [...notes.examples];
  return json;
}

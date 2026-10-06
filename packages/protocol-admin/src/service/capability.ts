import {
  addRoleCompositeRequestSchema,
  listRoleCompositesResponseSchema,
  setRoleDefaultRequestSchema,
  sendActionsEmailRequestSchema,
  setGroupDefaultRequestSchema,
  amendClientRequestSchema,
  listAuditQuerySchema,
  listAuditResponseSchema,
  countAuditQuerySchema,
  exportAuditQuerySchema,
  auditEventSchema,
  AUDIT_EXPORT_MEDIA_TYPE,
  amendGroupRequestSchema,
  amendRoleRequestSchema,
  amendScopeRequestSchema,
  amendSettingsRequestSchema,
  amendProfileRequestSchema,
  amendSubjectRequestSchema,
  assignScopeToClientRequestSchema,
  assignScopeToClientResponseSchema,
  clientSchema,
  createClientRequestSchema,
  createClientResponseSchema,
  createGroupRequestSchema,
  createRoleRequestSchema,
  createScopeRequestSchema,
  createSubjectRequestSchema,
  createTenantRequestSchema,
  amendTenantRequestSchema,
  cursorQuerySchema,
  createKeyRequestSchema,
  groupSchema,
  listExecutionsResponseSchema,
  replaceExecutionsRequestSchema,
  listClientsQuerySchema,
  countClientsQuerySchema,
  listGroupsQuerySchema,
  countGroupsQuerySchema,
  listKeysQuerySchema,
  listRolesQuerySchema,
  countRolesQuerySchema,
  listScopesQuerySchema,
  countScopesQuerySchema,
  listClientsResponseSchema,
  listLogoutDeliveriesResponseSchema,
  listLogoutDeliveriesQuerySchema,
  clientInstallationSchema,
  evaluateClaimsResponseSchema,
  evaluateClaimsQuerySchema,
  listMailResponseSchema,
  listMailQuerySchema,
  listConsentsQuerySchema,
  listConsentsResponseSchema,
  listCredentialsResponseSchema,
  listGroupsResponseSchema,
  listRegistrationTokensQuerySchema,
  listRegistrationTokensResponseSchema,
  mintRegistrationTokenRequestSchema,
  mintRegistrationTokenResponseSchema,
  listKeysResponseSchema,
  listRolesResponseSchema,
  listScopesResponseSchema,
  listScopeClientsQuerySchema,
  listScopeClientsResponseSchema,
  listSessionsResponseSchema,
  endSessionsResponseSchema,
  listGrantsResponseSchema,
  revokeGrantsResponseSchema,
  revokeClientGrantsResponseSchema,
  listTenantSessionsResponseSchema,
  listTenantSessionsQuerySchema,
  countSessionsQuerySchema,
  endTenantSessionsResponseSchema,
  issuePasswordResponseSchema,
  lockoutSchema,
  listSubjectsQuerySchema,
  countSubjectsQuerySchema,
  listSubjectsResponseSchema,
  bulkSubjectsRequestSchema,
  bulkSubjectsResponseSchema,
  clearLockoutsResponseSchema,
  listEffectiveRolesQuerySchema,
  adminCapabilitiesResponseSchema,
  listEffectiveRolesResponseSchema,
  listTenantsQuerySchema,
  countTenantsQuerySchema,
  listTenantsResponseSchema,
  deleteTenantQuerySchema,
  roleSchema,
  rotateClientSecretQuerySchema,
  rotateClientSecretResponseSchema,
  scopeMappersSchema,
  setGroupRolesRequestSchema,
  setGroupRolesResponseSchema,
  setRequiredActionsRequestSchema,
  setRequiredActionsResponseSchema,
  setRolesRequestSchema,
  setRolesResponseSchema,
  setSubjectGroupsRequestSchema,
  setSubjectGroupsResponseSchema,
  setScopeMappersRequestSchema,
  setScopeRolesRequestSchema,
  setScopeRolesResponseSchema,
  settingsSchema,
  clientScopeSchema,
  smtpConfigSchema,
  putSmtpRequestSchema,
  testSmtpRequestSchema,
  testSmtpResponseSchema,
  signingKeySchema,
  profileSchema,
  subjectSchema,
  usernamePolicySchema,
  tenantSchema,
  whoamiResponseSchema,
  countResponseSchema,
  exportTenantQuerySchema,
  TENANT_DOCUMENT_MEDIA_TYPE,
  tenantDocumentSchema,
  importTenantRequestSchema,
  importTenantResponseSchema,
  TENANT_IMPORT_BODY_LIMIT,
} from '@odudu/contracts/admin';
import { MANAGE_TENANTS, type TenantCapability } from '@odudu/domain-tenant';
import { z } from 'zod';

// `manage-tenants` reaches every tenant and is provisioned only in the
// system tenant (@odudu/domain-tenant's admin-capabilities.ts), so it is
// deliberately not one of the seven in `TenantCapability` — a route can
// require it without a tenant-local admin ever being able to hold it.
export type AdminCapability = TenantCapability | typeof MANAGE_TENANTS;

export interface AdminRoute {
  readonly method: string;
  readonly pattern: string;
  readonly capability: AdminCapability | null;
  // Further capabilities that admit this route besides `capability`, each
  // with whatever composes it. Only a read carries any: a list another
  // capability's writes pick from.
  readonly alsoAdmits?: readonly AdminCapability[];
  // The shape of a successful response, published at /admin/openapi.json.
  // Required, not optional: a route with no schema is a type error, not a
  // gap the document silently leaves out.
  readonly responseSchema: z.ZodType;
  // The status a successful response carries — omitted, it is 200. Only a
  // route whose success is something else (a create's 201) sets it.
  readonly successStatus?: number;
  // The media type of a successful response — omitted, it is
  // application/json. Only a route answering a document of its own kind
  // sets it.
  readonly successMediaType?: string;
  // Fastify's ajv compiler (installAdminValidator) validates and coerces
  // against these when present, so a handler reads an already-shaped
  // request rather than parsing the wire format itself — the one authority
  // for what a querystring or body may contain, instead of a second one a
  // handler could quietly disagree with.
  readonly querystringSchema?: z.ZodType;
  readonly bodySchema?: z.ZodType;
  // Fastify's per-route body limit, in bytes — omitted, the server's own.
  readonly bodyLimit?: number;
  // Extra prose `/admin/openapi.json` carries beside the generated
  // capability summary — for a caveat a generated client's user needs
  // without reading this repository's own docs.
  readonly description?: string;
}

// Appended to the description of every route that mutates one subject.
const TARGET_CEILING =
  ' Refused with `403` when the subject holds an admin capability the caller does not ' +
  '(the target ceiling).';

// For every route that can take an admin capability away from whoever holds
// it through a group, a role, a scope or a client's roles.
const REMOVAL_CEILING =
  'Refused with `403` when what it removes reaches an admin capability the caller does not hold.';

// For a wholesale replacement of a role list, judged by its delta.
const DELTA_CEILING =
  ' Refused with `403` when a role it adds or leaves out reaches an admin capability the ' +
  'caller does not hold; a role it keeps is not counted.';

// For every route that can take the last enabled administrator away.
const LAST_ADMINISTRATOR =
  ' Refused with `409` (`about:blank#last-administrator`) when it would leave no enabled ' +
  'subject holding `tenant-admin` \u2014 `manage-tenants` in the system tenant.';

// What a client answers beside its stored fields.
const CLIENT_REACH =
  '`service_account_admin_reach` is what the client\u2019s service account holds of the admin ' +
  'capabilities, which every write on the client is judged against; derived on every read ' +
  'and outside the `ETag`, empty for a client with no service account.';

// A client's lists are bounded, whichever write names one.
const CLIENT_LIST_BOUND =
  'A list on the client (`redirect_uris`, `web_origins`, `post_logout_redirect_uris`, ' +
  '`audiences`, `client_credentials_scopes`) holds at most 200 entries, refused with `400` ' +
  'naming the field, how many it held and how many it may. A write refuses only a list it ' +
  'changes: a client stored over the limit is amended in its other fields as it is.';

// The target ceiling, for every route that mutates one client: a confidential
// client authenticates as its service account.
const SERVICE_ACCOUNT_CEILING =
  'Refused with `403` when the client\u2019s service account holds an admin capability ' +
  'the caller does not (the target ceiling).';

// The single list the router registers from (view/routes/router.ts): a
// route with no entry here fails at startup rather than shipping
// reachable and unguarded. `capability: null` means authentication
// alone — `whoami` is the only one. `/admin/tenants` and its `/count`
// carry no `:tenant` segment — they administer the tenant collection
// itself, which only a system-tenant admin reaches (router.ts resolves
// its target explicitly); deleting one tenant needs the same capability.
export const ADMIN_ROUTES: readonly AdminRoute[] = [
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/whoami',
    capability: null,
    responseSchema: whoamiResponseSchema,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects',
    capability: 'view-users',
    responseSchema: listSubjectsResponseSchema,
    querystringSchema: listSubjectsQuerySchema,
    description:
      'The subjects of a tenant, paged. `capability` narrows to the holders of one admin ' +
      'capability, of `tenant-admin`, or of `any`, held effectively; with it, each item carries ' +
      '`admin_capabilities`, every name it holds and whether one is assigned to it directly.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/count',
    capability: 'view-users',
    responseSchema: countResponseSchema,
    querystringSchema: countSubjectsQuerySchema,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/username-policy',
    capability: 'view-users',
    responseSchema: usernamePolicySchema,
    description:
      'Whether this tenant accepts a rename: its `username_editable` setting, readable by ' +
      'whoever can read subjects, where `GET /admin/tenants/{tenant}/settings` needs ' +
      '`manage-tenant`. No `ETag`: nothing is written against it.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/subjects',
    capability: 'manage-users',
    responseSchema: subjectSchema,
    successStatus: 201,
    bodySchema: createSubjectRequestSchema,
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/subjects/bulk',
    capability: 'manage-users',
    responseSchema: bulkSubjectsResponseSchema,
    bodySchema: bulkSubjectsRequestSchema,
    description:
      'Applies one action to at most 100 subjects, each exactly as its single-subject door ' +
      'would — `PATCH …/subjects/{id}` for `disable` and `enable`, `DELETE …/subjects/{id}`, ' +
      'and `DELETE …/subjects/{id}/sessions` for `end-sessions`, which additionally requires ' +
      '`manage-sessions` — each in its own transaction with its own audit row. Answers `200` ' +
      'with the status each id would have had, and a refusal\u2019s problem `type` and `detail`.' +
      TARGET_CEILING +
      LAST_ADMINISTRATOR,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/:id',
    capability: 'view-users',
    responseSchema: subjectSchema,
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/subjects/:id',
    capability: 'manage-users',
    responseSchema: subjectSchema,
    bodySchema: amendSubjectRequestSchema,
    description: TARGET_CEILING.trimStart() + LAST_ADMINISTRATOR,
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/subjects/:id',
    capability: 'manage-users',
    responseSchema: z.void(),
    successStatus: 204,
    description: TARGET_CEILING.trimStart() + LAST_ADMINISTRATOR,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/:id/profile',
    capability: 'view-users',
    responseSchema: profileSchema,
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/subjects/:id/profile',
    capability: 'manage-users',
    responseSchema: profileSchema,
    bodySchema: amendProfileRequestSchema,
    description:
      'Amends the OIDC claim columns a subject carries — every `profileSchema` member ' +
      'except `profile_updated_at`, which the write stamps itself. `email` and `username` ' +
      'are refused here, naming `PATCH /admin/tenants/{tenant}/subjects/{id}`, which owns ' +
      'each. Submitting a different `phone_number` without also setting ' +
      '`phone_number_verified` in the same request resets it to `false` — a different number ' +
      'is not a verified one, the way amending `email` through the subjects route resets ' +
      '`email_verified`; resubmitting the same number leaves it untouched. `If-Match` is ' +
      'optional: honoured when present, never required.' +
      TARGET_CEILING,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/:id/credentials',
    capability: 'view-users',
    responseSchema: listCredentialsResponseSchema,
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/subjects/:id/credentials/:credentialId',
    capability: 'manage-users',
    responseSchema: z.void(),
    successStatus: 204,
    description: TARGET_CEILING.trimStart(),
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/:id/consents',
    capability: 'view-users',
    responseSchema: listConsentsResponseSchema,
    querystringSchema: listConsentsQuerySchema,
    description:
      'The subject\u2019s consents, paged by keyset on the client\u2019s own `client_id`: `limit` up to 200, and `next` (also the `link` header) names the following page; a response with no `next` is the last.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/subjects/:id/consents/:clientId',
    capability: 'manage-users',
    responseSchema: z.void(),
    successStatus: 204,
    description:
      'Withdraws the grant so the next `/authorize` for this client asks again, and revokes ' +
      'every token issued under it — a subject who revokes access is not still impersonated ' +
      'by a refresh token that outlives the consent it was granted under.' +
      TARGET_CEILING,
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/subjects/:id/password',
    capability: 'manage-users',
    responseSchema: issuePasswordResponseSchema,
    successStatus: 201,
    description:
      'Replaces the subject\u2019s password with a server-generated one-time password, ' +
      'answered once in this body and never again, and owes `update-password` so the ' +
      'subject changes it at the next sign-in. Ends no session and revokes no grant, as a ' +
      'password reset does not; `DELETE /admin/tenants/{tenant}/subjects/{id}/sessions` is ' +
      'that door. A subject with no `users` row answers `404`.' +
      TARGET_CEILING,
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/subjects/:id/password-reset',
    capability: 'manage-users',
    responseSchema: z.void(),
    successStatus: 202,
    description:
      'Queues the reset-password link a self-service request sends, to the subject\u2019s own ' +
      'address. The link is never in this response or the audit trail. `409` with its own ' +
      'problem type when the subject has no email (`no-email`), when the tenant\u2019s ' +
      '`reset_password_allowed` is off so the link would be refused (`reset-password-off`), or ' +
      'when its mail would only be logged, `GET …/smtp`\u2019s `none` (`no-mail-relay`). ' +
      'Rate-limited per origin, as the self-service request is.' +
      TARGET_CEILING,
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/subjects/:id/verification',
    capability: 'manage-users',
    responseSchema: z.void(),
    successStatus: 202,
    description:
      'Queues a fresh email-verification link to the subject\u2019s own address. The link is ' +
      'never in this response or the audit trail. `409` `no-email` or `no-mail-relay` as ' +
      '`POST …/password-reset` answers them. Rate-limited per origin.' +
      TARGET_CEILING,
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/subjects/:id/actions-email',
    capability: 'manage-users',
    responseSchema: z.void(),
    successStatus: 202,
    bodySchema: sendActionsEmailRequestSchema,
    description:
      'Queues a link to the subject\u2019s own address that takes them through `actions`, ' +
      'a non-empty subset of the required actions `PUT …/required-actions` takes. Following ' +
      'it sets a new password where `update-password` is named, and owes the rest, so the ' +
      'next sign-in asks for each; the link alone never enrols a factor. The ' +
      'link is never in this response or the audit trail. ' +
      'The same `409`s as `POST …/password-reset`, `reset-password-off` only when ' +
      '`update-password` is named. Rate-limited per origin.' +
      TARGET_CEILING,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/:id/lockout',
    capability: 'view-users',
    responseSchema: lockoutSchema,
    description:
      'The subject\u2019s run of failed sign-ins: how many, the last one, and whether the ' +
      'account is locked now, judged by the server\u2019s clock. A subject that has never ' +
      'failed answers a zero count. `404` for a subject with no `users` row.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/subjects/:id/lockout',
    capability: 'manage-users',
    responseSchema: z.void(),
    successStatus: 204,
    description:
      'Clears the subject\u2019s brute-force failure count, and with it any lockout, so ' +
      'the next correct password signs in. `204` whether or not anything was recorded; `404` ' +
      'for a subject with no `users` row, which has no sign-in to be locked out of.' +
      TARGET_CEILING,
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/subjects/:id/recovery-codes',
    capability: 'manage-users',
    responseSchema: z.void(),
    successStatus: 204,
    description:
      'Revokes every recovery code the subject holds, spent or not, so none signs in again. ' +
      'Recovery codes carry no id of their own, so this is the only way to remove them. ' +
      '`204` whether or not any were held; `404` for a subject with no `users` row. ' +
      'Owes nothing: `PUT .../required-actions` with `generate-recovery-codes` asks for a ' +
      'fresh set at the next sign-in.' +
      TARGET_CEILING,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/:id/required-actions',
    capability: 'view-users',
    responseSchema: setRequiredActionsResponseSchema,
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/subjects/:id/required-actions',
    capability: 'manage-users',
    responseSchema: setRequiredActionsResponseSchema,
    bodySchema: setRequiredActionsRequestSchema,
    description:
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.' +
      TARGET_CEILING,
  },
  // The capability ceiling this route enforces — a caller may never assign
  // authority it does not itself hold — is checked in the usecase
  // (`setRoles`, #/usecase/subjects.ts), not here: ADMIN_ROUTES only gates
  // whether a caller may reach the route at all, never what it may do with
  // a specific body.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/:id/roles',
    capability: 'view-users',
    responseSchema: setRolesResponseSchema,
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/subjects/:id/roles',
    capability: 'manage-users',
    responseSchema: setRolesResponseSchema,
    bodySchema: setRolesRequestSchema,
    description:
      'More than 200 entries is refused with `400`. ' +
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.' +
      TARGET_CEILING +
      LAST_ADMINISTRATOR,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/:id/effective-roles',
    capability: 'view-users',
    responseSchema: listEffectiveRolesResponseSchema,
    querystringSchema: listEffectiveRolesQuerySchema,
    description:
      'A page holds at most `limit` roles (up to 200); follow `next` (or the `link` header) until it is absent for the whole set. ' +
      'The roles the subject holds, the set token issuance and authorization read, in id ' +
      'order, each with every path it is held by: assigned directly, mapped to a group the ' +
      'subject belongs to or to one of its ancestors, or nested under another role it holds. ' +
      'Paged, and carrying no `ETag`: `GET …/roles` is the list `PUT …/roles` replaces.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/:id/admin-capabilities',
    capability: 'view-users',
    responseSchema: adminCapabilitiesResponseSchema,
    description:
      'The admin capabilities the subject holds, each as an effective role with every path it ' +
      'is held by, and the roles that carry them (one nesting a capability, held directly or ' +
      'through a group), found among the roles that reach a capability whatever else the ' +
      'subject holds. Never a page: at most 200 carriers, and `complete` is false when more ' +
      'exist, in which case nothing may be judged from it. What a console judges the ' +
      'subject\u2019s reach, and what losing a role would take, by.',
  },
  // Joining a group grants its roles and its ancestors', so this route's
  // capability ceiling (`setSubjectGroups`, #/usecase/subjects.ts) is the
  // same one `PUT .../roles` enforces, checked in the usecase for the same
  // reason.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/:id/groups',
    capability: 'view-users',
    responseSchema: setSubjectGroupsResponseSchema,
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/subjects/:id/groups',
    capability: 'manage-users',
    responseSchema: setSubjectGroupsResponseSchema,
    bodySchema: setSubjectGroupsRequestSchema,
    description:
      'More than 200 entries is refused with `400`. ' +
      'Replaces the subject\u2019s direct memberships. `If-Match` is mandatory (`428` absent, `412` stale). Refused with `403` when the groups, their ancestors or the composites their roles nest reach an admin capability the caller does not hold.' +
      TARGET_CEILING +
      LAST_ADMINISTRATOR,
  },
  // No `view-sessions`: reached only by an operator who can also end one,
  // the same reasoning that leaves clients with no `view-clients`.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/:id/sessions',
    capability: 'manage-sessions',
    responseSchema: listSessionsResponseSchema,
    querystringSchema: cursorQuerySchema,
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/subjects/:id/sessions',
    capability: 'manage-sessions',
    responseSchema: endSessionsResponseSchema,
    description:
      'Ends every live session the subject holds, each exactly as ' +
      '`DELETE /admin/tenants/{tenant}/subjects/{id}/sessions/{sid}` ends one: its grants ' +
      'revoked and a Back-Channel Logout Token delivered to every registered client that ' +
      'used it. Answers how many were ended. A grant bound to no session — `offline_access` — ' +
      'is left alone, as it is by ending one.' +
      TARGET_CEILING,
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/subjects/:id/sessions/:sid',
    capability: 'manage-sessions',
    responseSchema: z.void(),
    successStatus: 204,
    description:
      'Ends the session and delivers a Back-Channel Logout Token to every registered ' +
      'client that used it. No Front-Channel Logout is attempted: there is no browser ' +
      'here to render its iframes in.' +
      TARGET_CEILING,
  },
  // A grant is what a token is presented under, so it is a session's
  // concern: `manage-sessions`, as ending a session is.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/:id/grants',
    capability: 'manage-sessions',
    responseSchema: listGrantsResponseSchema,
    querystringSchema: cursorQuerySchema,
    description:
      'Every grant the subject holds that nothing has revoked, session-bound or not: ' +
      '`offline` is true for a grant whose scope carries `offline_access`, which ending ' +
      'sessions leaves alone; a `client_credentials` grant has no session and is not offline. ' +
      'Never a token.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/subjects/:id/grants/:clientId',
    capability: 'manage-sessions',
    responseSchema: revokeGrantsResponseSchema,
    description:
      'Revokes every grant the subject holds through the client, offline ones included, so ' +
      'no refresh token issued under them is honoured again. Withdraws no consent and ends ' +
      'no session. Answers how many were revoked.' +
      TARGET_CEILING,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/sessions',
    capability: 'manage-sessions',
    responseSchema: listTenantSessionsResponseSchema,
    querystringSchema: listTenantSessionsQuerySchema,
    description:
      'Every live session in the tenant, whoever holds it, in id order; `?client=` narrows ' +
      'it to the sessions holding a grant through that client (its row id).',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/sessions/count',
    capability: 'manage-sessions',
    responseSchema: countResponseSchema,
    querystringSchema: countSessionsQuerySchema,
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/sessions',
    capability: 'manage-sessions',
    responseSchema: endTenantSessionsResponseSchema,
    description:
      'Ends the tenant\u2019s live sessions, each as `DELETE …/subjects/{id}/sessions/{sid}` ' +
      'ends one, at most 500 a call in id order; `remaining` says how many are still live ' +
      'within reach, so a caller repeats the call until it is 0. A session whose subject holds ' +
      'an admin capability the caller does not is left alone and counted under ' +
      '`beyond_ceiling` (the target ceiling, run over the tenant).',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants',
    capability: MANAGE_TENANTS,
    responseSchema: listTenantsResponseSchema,
    querystringSchema: listTenantsQuerySchema,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/count',
    capability: MANAGE_TENANTS,
    responseSchema: countResponseSchema,
    querystringSchema: countTenantsQuerySchema,
  },
  {
    method: 'POST',
    pattern: '/admin/tenants',
    capability: MANAGE_TENANTS,
    responseSchema: tenantSchema,
    successStatus: 201,
    bodySchema: createTenantRequestSchema,
  },
  {
    method: 'POST',
    pattern: '/admin/tenant-imports',
    capability: MANAGE_TENANTS,
    responseSchema: importTenantResponseSchema,
    successStatus: 201,
    bodySchema: importTenantRequestSchema,
    bodyLimit: TENANT_IMPORT_BODY_LIMIT,
    description:
      'A set over 200 entries, more than 1,000 scopes or more than 200 default roles or groups is refused in the same `400`, naming the limit and the count. ' +
      'Creates a new tenant from a document `GET /admin/tenants/{tenant}/export` answered, with ' +
      'its own signing key and a fresh secret for each confidential client, answered once here. ' +
      'Every problem with the request is refused together in one `400` whose `errors` lists each ' +
      'by its JSON path; a name already in use is refused with `409`.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant',
    capability: 'manage-tenant',
    responseSchema: tenantSchema,
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant',
    capability: 'manage-tenant',
    responseSchema: tenantSchema,
    bodySchema: amendTenantRequestSchema,
    description:
      'Amends display_name and enabled. `name` is refused with 400: it is already in the ' +
      'issuer URL of every token this tenant has minted. Disabling the system tenant is ' +
      'refused with 409, since every cross-tenant administrator authenticates against it. ' +
      'Once a disable of any other has committed, every live session in it is ended in ' +
      'batches of 500, each its own transaction, queuing a Back-Channel Logout Token for ' +
      'each relying party that used one; the answer comes when all have ended. A batch that ' +
      'fails is answered with `500` `sessions-not-ended`: the disable stands, and sending ' +
      '`enabled: false` again ends the rest. Its discovery document and key set stay served.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant',
    capability: MANAGE_TENANTS,
    responseSchema: z.void(),
    successStatus: 204,
    querystringSchema: deleteTenantQuerySchema,
    description:
      'Deletes the tenant and every row it holds, in one transaction, recorded in the ' +
      '`system` tenant\u2019s trail as `tenant.delete`. `confirm` must be the tenant\u2019s ' +
      'own name, refused with `400` naming it otherwise. Refused with `409` for `system`; ' +
      'with `409` `tenant-enabled` until the tenant is disabled, which ends its sessions and ' +
      'queues their Logout Tokens; with `409` `sessions-live` while any session is still ' +
      'live; and with `409` `logout-deliveries-pending` until each of those tokens is ' +
      'delivered or has spent every attempt. The tenant\u2019s keys go with it. Refused ' +
      'with `403` when the tenant\u2019s subjects hold an admin capability the caller does ' +
      'not (the target ceiling, over every subject at once).',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/export',
    capability: 'manage-tenant',
    responseSchema: tenantDocumentSchema,
    successMediaType: TENANT_DOCUMENT_MEDIA_TYPE,
    querystringSchema: exportTenantQuerySchema,
    description:
      'A tenant too large for one document is refused with `413`: more than 20,000 clients, roles or groups, 200,000 rows of a link table, or one role, group, scope or subject holding more than 200 of a set, which an import would refuse. ' +
      'The tenant\u2019s configuration, every reference by name, with no secret in it: each ' +
      'secret a reader would expect is named under `omitted` by its JSON path. Additionally ' +
      'requires `manage-clients`, the capability every other client read requires, refused ' +
      'with `403` otherwise. `?include=subjects` adds subjects and additionally requires ' +
      '`view-users`, refused with `403` otherwise and with `413` above 10,000 subjects.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/settings',
    capability: 'manage-tenant',
    responseSchema: settingsSchema,
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/settings',
    capability: 'manage-tenant',
    responseSchema: settingsSchema,
    bodySchema: amendSettingsRequestSchema,
    description:
      '`enabled: false` ends every live session in the tenant, after the change has ' +
      'committed and in batches, as `PATCH /admin/tenants/{tenant}` does.',
  },
  // No `view-clients`: client metadata is configuration rather than a
  // population to browse, so every route below requires `manage-clients`.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/clients',
    capability: 'manage-clients',
    responseSchema: listClientsResponseSchema,
    querystringSchema: listClientsQuerySchema,
    description:
      `${CLIENT_REACH} \`client_id_exact\` finds the one client whose \`client_id\` is exactly ` +
      'that, through the unique index.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/clients/count',
    capability: 'manage-clients',
    responseSchema: countResponseSchema,
    querystringSchema: countClientsQuerySchema,
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/clients',
    capability: 'manage-clients',
    responseSchema: createClientResponseSchema,
    successStatus: 201,
    bodySchema: createClientRequestSchema,
    description: CLIENT_LIST_BOUND,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/clients/:id',
    capability: 'manage-clients',
    responseSchema: clientSchema,
    description: CLIENT_REACH,
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/clients/:id',
    capability: 'manage-clients',
    responseSchema: clientSchema,
    bodySchema: amendClientRequestSchema,
    description: `${SERVICE_ACCOUNT_CEILING} ${CLIENT_LIST_BOUND}`,
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/clients/:id',
    capability: 'manage-clients',
    responseSchema: z.void(),
    successStatus: 204,
    description:
      `${SERVICE_ACCOUNT_CEILING} Deletes every role scoped to the client with it, and is ` +
      'refused with `403` too when what those roles reach includes an admin capability the ' +
      `caller does not hold.${LAST_ADMINISTRATOR}`,
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/clients/:id/secret',
    capability: 'manage-clients',
    responseSchema: rotateClientSecretResponseSchema,
    querystringSchema: rotateClientSecretQuerySchema,
    description:
      'Answers the new secret once. `grace_seconds` (0 to 604800, default 0) keeps the ' +
      'secret it replaces authenticating that long beside it, and the response states ' +
      `when it stops in \`previous_secret_expires_at\`. ${SERVICE_ACCOUNT_CEILING}`,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/clients/:id/logout-deliveries',
    capability: 'manage-clients',
    responseSchema: listLogoutDeliveriesResponseSchema,
    querystringSchema: listLogoutDeliveriesQuerySchema,
    description:
      'The Back-Channel Logout Tokens queued for the client, most recent first: `pending`, ' +
      '`delivered`, or `failed` once every attempt is spent, with the last error. Never the ' +
      'token itself.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/clients/:id/evaluate',
    capability: 'manage-clients',
    responseSchema: evaluateClaimsResponseSchema,
    querystringSchema: evaluateClaimsQuerySchema,
    description:
      'The claims an authorization-code exchange for this client and `subject` would put in ' +
      'the ID token, the access token and the UserInfo response, computed by the functions ' +
      'issuance calls, with none of the envelope a signer adds. `scope` is resolved against ' +
      'the client\u2019s assignments, as issuance resolves it; absent, the client\u2019s ' +
      'default scopes. It assumes consent is granted: for a `consent_required` client a real ' +
      'code carries only the scopes consented to. Signs nothing. Additionally requires ' +
      '`view-users`, refused with `403` ' +
      'otherwise, since the claims are the subject\u2019s. Audited as `client.evaluate`.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/clients/:id/installation',
    capability: 'manage-clients',
    responseSchema: clientInstallationSchema,
    description:
      'What a relying party is configured with: the issuer and its discovery URL, as this ' +
      'request\u2019s host names them, and the client\u2019s own identifier, type, ' +
      'authentication method, URIs, grant types and default scopes. Never the secret.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/clients/:id/sessions',
    capability: 'manage-sessions',
    responseSchema: listTenantSessionsResponseSchema,
    querystringSchema: cursorQuerySchema,
    description:
      'The live sessions holding a grant through the client: `GET …/sessions?client={id}`, ' +
      'answering `404` for a client that does not exist.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/clients/:id/grants',
    capability: 'manage-sessions',
    responseSchema: revokeClientGrantsResponseSchema,
    description:
      'Revokes up to 10,000 of the grants issued through the client that nothing has revoked, ' +
      'whoever holds them, so no refresh token the client holds is honoured again; `remaining` ' +
      'says how many more are left (counted to 10,000), so a caller repeats the call until it ' +
      'is 0 — one call is not every grant. Ends no session. A grant whose subject holds an ' +
      'admin capability the caller does not is left alone and counted under `beyond_ceiling`.',
  },
  // RFC 7591 §3 initial access tokens, gated the same way clients above are —
  // `manage-clients`, since a token that mints a client is configuration for
  // dynamic registration rather than a population of its own.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/registration-tokens',
    capability: 'manage-clients',
    responseSchema: listRegistrationTokensResponseSchema,
    querystringSchema: listRegistrationTokensQuerySchema,
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/registration-tokens',
    capability: 'manage-clients',
    responseSchema: mintRegistrationTokenResponseSchema,
    successStatus: 201,
    bodySchema: mintRegistrationTokenRequestSchema,
    description:
      'Answers `token` exactly once. Nothing else this API serves ever repeats it: not a ' +
      'later `GET`, not an audit detail.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/registration-tokens/:id',
    capability: 'manage-clients',
    responseSchema: z.void(),
    successStatus: 204,
  },
  // Roles, groups and client scopes: manage-tenant for all three, the same
  // shape (cursor pagination, ETag/If-Match, one audit call per mutation)
  // as every other resource group above.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/roles',
    capability: 'manage-tenant',
    alsoAdmits: ['view-users'],
    responseSchema: listRolesResponseSchema,
    querystringSchema: listRolesQuerySchema,
    description:
      'Also readable with `view-users`, and so with `manage-users`, whose holder assigns roles ' +
      'and picks them from this list. Nothing else under `/roles` is.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/roles/count',
    capability: 'manage-tenant',
    responseSchema: countResponseSchema,
    querystringSchema: countRolesQuerySchema,
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/roles',
    capability: 'manage-tenant',
    responseSchema: roleSchema,
    successStatus: 201,
    bodySchema: createRoleRequestSchema,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/roles/:id',
    capability: 'manage-tenant',
    responseSchema: roleSchema,
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/roles/:id',
    capability: 'manage-tenant',
    responseSchema: roleSchema,
    bodySchema: amendRoleRequestSchema,
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/roles/:id',
    capability: 'manage-tenant',
    responseSchema: z.void(),
    successStatus: 204,
    description: REMOVAL_CEILING + LAST_ADMINISTRATOR,
  },
  // The capability ceiling this route enforces is checked in the usecase
  // (`addRoleComposite`, #/usecase/roles.ts), not here — the same split
  // `PUT .../subjects/:id/roles` uses.
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/roles/:id/composites',
    capability: 'manage-tenant',
    responseSchema: z.void(),
    successStatus: 204,
    bodySchema: addRoleCompositeRequestSchema,
    description:
      'A role nests at most 200 children; one more is refused with `409`. ' +
      'Nests `child_role_id` under this role. Refused with `403` when the child reaches an admin capability the caller does not hold, or any admin capability at all while a default role or a default group reaches this one; `409` on a cycle, and on a parent belonging to the tenant\u2019s built-in admin client, whose shape provisioning fixes. Answers the composites\u2019 new `ETag`, the one `GET …/composites` answers; `If-Match` is optional, and a stale one is refused with `412`.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/roles/:id/composites',
    capability: 'manage-tenant',
    responseSchema: listRoleCompositesResponseSchema,
    description:
      'The role\u2019s direct children only, not what they in turn include. Unpaged, like `GET /groups/:id/roles`: the list is one role\u2019s own edges, which an operator edits edge by edge, not a tenant-wide collection.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/roles/:id/composites/:childId',
    capability: 'manage-tenant',
    responseSchema: z.void(),
    successStatus: 204,
    description:
      'Removes one edge; `404` when there is none. Refused with `409` when the parent belongs to the tenant\u2019s built-in admin client, since every administrator holding it would lose the child. Answers the composites\u2019 new `ETag`; `If-Match` is optional, and a stale one is refused with `412`. ' +
      REMOVAL_CEILING +
      LAST_ADMINISTRATOR,
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/roles/:id/default',
    capability: 'manage-tenant',
    responseSchema: roleSchema,
    bodySchema: setRoleDefaultRequestSchema,
    description:
      'At most 200 roles are default at once; one more is refused with `409`. ' +
      'Sets whether every subject created afterwards, self-registered ones included, is granted this role. `true` is refused with `403` when the role reaches any admin capability, whoever the caller is; `false` is never refused. Answers the role\u2019s `ETag`; `If-Match` is optional, and a stale one is refused with `412`.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/groups',
    capability: 'manage-tenant',
    alsoAdmits: ['view-users'],
    responseSchema: listGroupsResponseSchema,
    querystringSchema: listGroupsQuerySchema,
    description:
      'Also readable with `view-users`, and so with `manage-users`, whose holder assigns groups ' +
      'and picks them from this list. Nothing else under `/groups` is.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/groups/count',
    capability: 'manage-tenant',
    responseSchema: countResponseSchema,
    querystringSchema: countGroupsQuerySchema,
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/groups',
    capability: 'manage-tenant',
    responseSchema: groupSchema,
    successStatus: 201,
    bodySchema: createGroupRequestSchema,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/groups/:id',
    capability: 'manage-tenant',
    responseSchema: groupSchema,
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/groups/:id',
    capability: 'manage-tenant',
    responseSchema: groupSchema,
    bodySchema: amendGroupRequestSchema,
    description:
      'Amends `description` (at most 1000 characters, `null` to clear) and reparents the group. ' +
      'A reparent is refused with `403` when the new parent\u2019s chain, or the old ' +
      'one it leaves, reaches an admin capability the caller does not hold.' +
      LAST_ADMINISTRATOR,
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/groups/:id',
    capability: 'manage-tenant',
    responseSchema: z.void(),
    successStatus: 204,
    description: `Deletes the group and its whole subtree. ${REMOVAL_CEILING}${LAST_ADMINISTRATOR}`,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/groups/:id/roles',
    capability: 'manage-tenant',
    responseSchema: setGroupRolesResponseSchema,
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/groups/:id/roles',
    capability: 'manage-tenant',
    responseSchema: setGroupRolesResponseSchema,
    bodySchema: setGroupRolesRequestSchema,
    description:
      'More than 200 entries is refused with `400`. ' +
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.' +
      DELTA_CEILING +
      LAST_ADMINISTRATOR,
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/groups/:id/default',
    capability: 'manage-tenant',
    responseSchema: groupSchema,
    bodySchema: setGroupDefaultRequestSchema,
    description:
      'At most 200 groups are default at once; one more is refused with `409`. ' +
      'Sets whether every subject created afterwards — by an administrator, by self-registration or by `odudu seed` — joins this group; an imported subject keeps the memberships its document lists. `true` is refused with `403` when the group\u2019s roles, or any ancestor\u2019s, reach an admin capability, whoever the caller is; `false` is never refused. While a group is a default, mapping a role that reaches a capability to it or to an ancestor, nesting one under a role it reaches, and moving it or an ancestor under a chain that reaches one are refused the same way. Answers the group\u2019s `ETag`; `If-Match` is optional, and a stale one is refused with `412`.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/scopes',
    capability: 'manage-tenant',
    responseSchema: listScopesResponseSchema,
    querystringSchema: listScopesQuerySchema,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/scopes/count',
    capability: 'manage-tenant',
    responseSchema: countResponseSchema,
    querystringSchema: countScopesQuerySchema,
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/scopes',
    capability: 'manage-tenant',
    responseSchema: clientScopeSchema,
    successStatus: 201,
    bodySchema: createScopeRequestSchema,
    description: 'A tenant defines at most 1,000 scopes; one more is refused with `409`.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/scopes/:id',
    capability: 'manage-tenant',
    responseSchema: clientScopeSchema,
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/scopes/:id',
    capability: 'manage-tenant',
    responseSchema: clientScopeSchema,
    bodySchema: amendScopeRequestSchema,
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/scopes/:id',
    capability: 'manage-tenant',
    responseSchema: z.void(),
    successStatus: 204,
    description:
      'Cascades to every client’s assignment and role mapping naming the scope. ' +
      'Refused with 409 for the scope named `openid`, which every client’s ' +
      'assignment of it — the tenant’s built-in admin client included — would ' +
      'otherwise be stripped of in the same stroke. ' +
      REMOVAL_CEILING,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/scopes/:id/roles',
    capability: 'manage-tenant',
    responseSchema: setScopeRolesResponseSchema,
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/scopes/:id/roles',
    capability: 'manage-tenant',
    responseSchema: setScopeRolesResponseSchema,
    bodySchema: setScopeRolesRequestSchema,
    description:
      'More than 200 entries is refused with `400`. ' +
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.' +
      DELTA_CEILING,
  },
  // The registry names come from the same ClaimMapperRegistry the issuance
  // path assembles claims from — see ScopeMappersRouteDeps.claimMappers.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/scopes/:id/mappers',
    capability: 'manage-tenant',
    responseSchema: scopeMappersSchema,
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/scopes/:id/mappers',
    capability: 'manage-tenant',
    responseSchema: scopeMappersSchema,
    bodySchema: setScopeMappersRequestSchema,
    description:
      'Replaces the whole binding set for the scope. Binding an unregistered mapper name is ' +
      'refused with 400, listing the registry’s own known names. ' +
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/scopes/:id/clients',
    capability: 'manage-tenant',
    responseSchema: listScopeClientsResponseSchema,
    querystringSchema: listScopeClientsQuerySchema,
    description:
      'The clients the scope is assigned to, each by its row id, `client_id`, name and ' +
      'assignment, in row-id order — and nothing else of the client, which reading takes ' +
      '`manage-clients`.',
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/scopes/:id/clients/:clientId',
    capability: 'manage-tenant',
    responseSchema: assignScopeToClientResponseSchema,
    bodySchema: assignScopeToClientRequestSchema,
    description:
      'Assigns the scope to the client as default or optional, replacing any existing assignment. ' +
      'Answers the client\u2019s new `ETag`, since the client\u2019s representation carries its scopes. ' +
      SERVICE_ACCOUNT_CEILING,
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/scopes/:id/clients/:clientId',
    capability: 'manage-tenant',
    responseSchema: z.void(),
    successStatus: 204,
    description:
      'Removes the client’s assignment of the scope, whether default or optional. Refused ' +
      'with 409 on the tenant’s built-in admin client, which could otherwise lock every ' +
      'administrator of the tenant out of /authorize. Answers the client\u2019s new `ETag`. ' +
      SERVICE_ACCOUNT_CEILING,
  },
  // Signing keys: manage-keys, not manage-tenant — a tenant admin who may
  // reconfigure clients need not also be trusted to rotate what signs
  // their tokens. No amend: a key is created, promoted or retired, never
  // patched.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/keys',
    capability: 'manage-keys',
    responseSchema: listKeysResponseSchema,
    querystringSchema: listKeysQuerySchema,
    description: 'Lists status, kid, alg, created_at and not_after — never the private half.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/keys',
    capability: 'manage-keys',
    responseSchema: signingKeySchema,
    successStatus: 201,
    bodySchema: createKeyRequestSchema,
    description:
      'Generates a key and stores it as rotating, published in JWKS immediately. Answers the ' +
      'key\u2019s `ETag`, which promote and retire honour as `If-Match`.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/keys/:id/promote',
    capability: 'manage-keys',
    responseSchema: signingKeySchema,
    description:
      'Demotes the current active key to rotating and promotes this one, atomically. ' +
      '`If-Match` is optional: a stale one, taken over the key, is refused with `412`.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/keys/:id/retire',
    capability: 'manage-keys',
    responseSchema: signingKeySchema,
    description:
      'Refused with 409 while the key is active, or while a client is registered against ' +
      'an algorithm no remaining key would produce. `If-Match` is optional: a stale one, ' +
      'taken over the key, is refused with `412`.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/lockouts',
    capability: 'manage-users',
    responseSchema: clearLockoutsResponseSchema,
    description:
      'Clears the run of failed sign-ins of up to 10,000 subjects a call, in id order, as ' +
      '`DELETE …/subjects/{id}/lockout` clears one; `remaining` says how many more are left ' +
      '(counted to 10,000), so a caller repeats the call until it is 0 — one call is not ' +
      'every subject. A subject holding an admin capability the caller does not keeps its ' +
      'count and is counted under `beyond_ceiling`.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/keys/:id',
    capability: 'manage-keys',
    responseSchema: z.void(),
    successStatus: 204,
    description:
      'Deletes a retired key, which is published nowhere and signs nothing. Refused with `409` ' +
      'for an active or rotating one, which `POST …/retire` retires first. `If-Match` is ' +
      'optional: a stale one is refused with `412`.',
  },
  // A tenant's own SMTP credential: manage-tenant, the same capability
  // `/settings` and `/flow` use. GET never carries a password; `configured`
  // is false and every other field null for a tenant with no row.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/smtp',
    capability: 'manage-tenant',
    responseSchema: smtpConfigSchema,
    description:
      '`effective` names whose relay the tenant\u2019s mail goes through: `tenant` for its own, ' +
      '`deployment` for the deployment\u2019s `ODUDU_SMTP_*` sender, `none` when mail is only logged.',
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/smtp',
    capability: 'manage-tenant',
    responseSchema: smtpConfigSchema,
    bodySchema: putSmtpRequestSchema,
    description:
      'Replaces the whole configuration except the password, which GET never hands back to ' +
      'resend: omitting `password` keeps the stored one, and `null` clears it. A kept ' +
      'password stays with the relay it was entered for: omitting it while `host`, `port` or ' +
      '`username` changes is refused with `400` naming `password`. Answers an ' +
      '`ETag`, as GET does; `If-Match` is optional, and a stale one is refused with `412`.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/smtp',
    capability: 'manage-tenant',
    responseSchema: z.void(),
    successStatus: 204,
    description:
      'Removes the tenant’s own relay, sending its mail back to the deployment’s own ' +
      'sender. 404 when the tenant has no SMTP configuration.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/smtp/test',
    capability: 'manage-tenant',
    responseSchema: testSmtpResponseSchema,
    bodySchema: testSmtpRequestSchema,
    description:
      'Sends one message synchronously and reports the transport’s own failure as a ' +
      '502, rather than the tenant discovering a bad configuration only when a user’s ' +
      'verification mail silently fails. 400 when the tenant has no SMTP configuration.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/mail',
    capability: 'manage-tenant',
    responseSchema: listMailResponseSchema,
    querystringSchema: listMailQuerySchema,
    description:
      'The tenant\u2019s outgoing mail, most recent first: `queued`, `retrying`, `sent`, or ' +
      '`failed` once every attempt is spent, with its attempts and the relay\u2019s last ' +
      'error. Never the body, which carries a sign-in link. The recipient is masked, wherever ' +
      'it appears, unless the caller also holds `view-users`.',
  },
  // A tenant's authentication flow: manage-tenant, the same capability as
  // roles, groups and scopes above. No partial edit — PUT replaces the
  // whole ordered list, renumbering indices contiguously regardless of what
  // the caller sent, since a flow's meaning is in its order.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/flow/executions',
    capability: 'manage-tenant',
    responseSchema: listExecutionsResponseSchema,
    description:
      'Answers the steps in order, and `available`: every authenticator name a step may ' +
      'name, from the registry a login dispatches through. The `ETag` covers the steps alone.',
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/flow/executions',
    capability: 'manage-tenant',
    responseSchema: listExecutionsResponseSchema,
    bodySchema: replaceExecutionsRequestSchema,
    description:
      'Refused with 400 for an empty list, a list where every step is disabled, an ' +
      'authenticator name the registry does not resolve, or the same authenticator named twice. ' +
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.',
  },
  // Read-only: view-audit carries no manage- counterpart, since nothing
  // ever amends a row here — reap is the only other writer, and it deletes
  // rather than amends.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/audit',
    capability: 'view-audit',
    responseSchema: listAuditResponseSchema,
    querystringSchema: listAuditQuerySchema,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/audit/count',
    capability: 'view-audit',
    responseSchema: countResponseSchema,
    querystringSchema: countAuditQuerySchema,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/audit/export',
    capability: 'view-audit',
    responseSchema: auditEventSchema,
    successMediaType: AUDIT_EXPORT_MEDIA_TYPE,
    querystringSchema: exportAuditQuerySchema,
    description:
      'Every row the same filters list, newest first, one JSON object per line, built in full ' +
      'before it is sent rather than streamed. Refused whole with `413` past 10,000 rows ' +
      'rather than cut short. Audited as `audit.export`.',
  },
];

export function requiredCapability(
  method: string,
  pattern: string,
): AdminCapability | null | undefined {
  const route = ADMIN_ROUTES.find((r) => r.method === method && r.pattern === pattern);
  return route === undefined ? undefined : route.capability;
}

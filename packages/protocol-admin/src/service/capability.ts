import {
  addRoleCompositeRequestSchema,
  listRoleCompositesResponseSchema,
  setRoleDefaultRequestSchema,
  amendClientRequestSchema,
  listAuditQuerySchema,
  listAuditResponseSchema,
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
  issuePasswordResponseSchema,
  listSubjectsQuerySchema,
  countSubjectsQuerySchema,
  listSubjectsResponseSchema,
  listTenantsQuerySchema,
  countTenantsQuerySchema,
  listTenantsResponseSchema,
  roleSchema,
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
// its target explicitly).
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
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/count',
    capability: 'view-users',
    responseSchema: countResponseSchema,
    querystringSchema: countSubjectsQuerySchema,
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
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.' +
      TARGET_CEILING +
      LAST_ADMINISTRATOR,
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
      'refused with 409, since every cross-tenant administrator authenticates against it.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/export',
    capability: 'manage-tenant',
    responseSchema: tenantDocumentSchema,
    successMediaType: TENANT_DOCUMENT_MEDIA_TYPE,
    querystringSchema: exportTenantQuerySchema,
    description:
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
  },
  // No `view-clients`: client metadata is configuration rather than a
  // population to browse, so every route below requires `manage-clients`.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/clients',
    capability: 'manage-clients',
    responseSchema: listClientsResponseSchema,
    querystringSchema: listClientsQuerySchema,
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
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/clients/:id',
    capability: 'manage-clients',
    responseSchema: clientSchema,
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/clients/:id',
    capability: 'manage-clients',
    responseSchema: clientSchema,
    bodySchema: amendClientRequestSchema,
    description: SERVICE_ACCOUNT_CEILING,
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
    description: SERVICE_ACCOUNT_CEILING,
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
      'Nests `child_role_id` under this role. Refused with `403` when the child reaches an admin capability the caller does not hold, or any admin capability at all while a default role reaches this one; `409` on a cycle, and on a parent belonging to the tenant\u2019s built-in admin client, whose shape provisioning fixes. Answers the composites\u2019 new `ETag`, the one `GET …/composites` answers; `If-Match` is optional, and a stale one is refused with `412`.',
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
      'Sets whether every subject created afterwards, self-registered ones included, is granted this role. `true` is refused with `403` when the role reaches any admin capability, whoever the caller is; `false` is never refused.',
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
      'Reparents the group. Refused with `403` when the new parent\u2019s chain, or the old ' +
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
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.' +
      DELTA_CEILING +
      LAST_ADMINISTRATOR,
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
      'resend: omitting `password` keeps the stored one, and `null` clears it. Answers an ' +
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
];

export function requiredCapability(
  method: string,
  pattern: string,
): AdminCapability | null | undefined {
  const route = ADMIN_ROUTES.find((r) => r.method === method && r.pattern === pattern);
  return route === undefined ? undefined : route.capability;
}

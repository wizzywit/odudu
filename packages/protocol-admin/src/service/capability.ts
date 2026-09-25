import {
  addRoleCompositeRequestSchema,
  amendClientRequestSchema,
  listAuditQuerySchema,
  listAuditResponseSchema,
  amendGroupRequestSchema,
  amendRoleRequestSchema,
  amendScopeRequestSchema,
  amendSettingsRequestSchema,
  amendSubjectRequestSchema,
  assignScopeToClientRequestSchema,
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
  listClientsResponseSchema,
  listCredentialsResponseSchema,
  listGroupsResponseSchema,
  listKeysResponseSchema,
  listRolesResponseSchema,
  listScopesResponseSchema,
  listSessionsResponseSchema,
  listSubjectsQuerySchema,
  listSubjectsResponseSchema,
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
  subjectSchema,
  tenantSchema,
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
  // The shape of a successful response, published at /admin/openapi.json.
  // Required, not optional: a route with no schema is a type error, not a
  // gap the document silently leaves out.
  readonly responseSchema: z.ZodType;
  // The status a successful response carries — omitted, it is 200. Only a
  // route whose success is something else (a create's 201) sets it.
  readonly successStatus?: number;
  // Fastify's ajv compiler (installAdminValidator) validates and coerces
  // against these when present, so a handler reads an already-shaped
  // request rather than parsing the wire format itself — the one authority
  // for what a querystring or body may contain, instead of a second one a
  // handler could quietly disagree with.
  readonly querystringSchema?: z.ZodType;
  readonly bodySchema?: z.ZodType;
  // Extra prose `/admin/openapi.json` carries beside the generated
  // capability summary — for a caveat a generated client's user needs
  // without reading this repository's own docs.
  readonly description?: string;
}

// The single list the router registers from (view/routes/router.ts): a
// route with no entry here fails at startup rather than shipping
// reachable and unguarded. `capability: null` means authentication
// alone — `whoami` is the only one. `/admin/tenants` carries no `:tenant`
// segment — it administers the tenant collection itself, which only a
// system-tenant admin reaches (router.ts resolves its target explicitly).
export const ADMIN_ROUTES: readonly AdminRoute[] = [
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/whoami',
    capability: null,
    responseSchema: z.object({ subjectId: z.string(), issuerTenantId: z.string() }),
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects',
    capability: 'view-users',
    responseSchema: listSubjectsResponseSchema,
    querystringSchema: listSubjectsQuerySchema,
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
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/subjects/:id',
    capability: 'manage-users',
    responseSchema: z.void(),
    successStatus: 204,
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
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.',
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
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.',
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
    pattern: '/admin/tenants/:tenant/subjects/:id/sessions/:sid',
    capability: 'manage-sessions',
    responseSchema: z.void(),
    successStatus: 204,
    description:
      'Ends the session and delivers a Back-Channel Logout Token to every registered ' +
      'client that used it. No Front-Channel Logout is attempted: there is no browser ' +
      'here to render its iframes in.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants',
    capability: MANAGE_TENANTS,
    responseSchema: listTenantsResponseSchema,
    querystringSchema: cursorQuerySchema,
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
    querystringSchema: cursorQuerySchema,
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
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/clients/:id',
    capability: 'manage-clients',
    responseSchema: z.void(),
    successStatus: 204,
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/clients/:id/secret',
    capability: 'manage-clients',
    responseSchema: rotateClientSecretResponseSchema,
  },
  // Roles, groups and client scopes: manage-tenant for all three, the same
  // shape (cursor pagination, ETag/If-Match, one audit call per mutation)
  // as every other resource group above.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/roles',
    capability: 'manage-tenant',
    responseSchema: listRolesResponseSchema,
    querystringSchema: cursorQuerySchema,
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
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/groups',
    capability: 'manage-tenant',
    responseSchema: listGroupsResponseSchema,
    querystringSchema: cursorQuerySchema,
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
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/groups/:id',
    capability: 'manage-tenant',
    responseSchema: z.void(),
    successStatus: 204,
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
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/scopes',
    capability: 'manage-tenant',
    responseSchema: listScopesResponseSchema,
    querystringSchema: cursorQuerySchema,
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
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.',
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
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/scopes/:id/clients/:clientId',
    capability: 'manage-tenant',
    responseSchema: clientSchema,
    bodySchema: assignScopeToClientRequestSchema,
    description:
      'Assigns the scope to the client as default or optional, replacing any existing assignment.',
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
    querystringSchema: cursorQuerySchema,
    description: 'Lists status, kid, alg, created_at and not_after — never the private half.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/keys',
    capability: 'manage-keys',
    responseSchema: signingKeySchema,
    successStatus: 201,
    bodySchema: createKeyRequestSchema,
    description: 'Generates a key and stores it as rotating, published in JWKS immediately.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/keys/:id/promote',
    capability: 'manage-keys',
    responseSchema: signingKeySchema,
    description: 'Demotes the current active key to rotating and promotes this one, atomically.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/keys/:id/retire',
    capability: 'manage-keys',
    responseSchema: signingKeySchema,
    description:
      'Refused with 409 while the key is active, or while a client is registered against ' +
      'an algorithm no remaining key would produce.',
  },
  // A tenant's own SMTP credential: manage-tenant, the same capability
  // `/settings` and `/flow` use. GET never carries a password; `configured`
  // is false and every other field null for a tenant with no row. No
  // `ETag`/`If-Match` — see the PUT description below for why that
  // deviates from the resource pattern's default.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/smtp',
    capability: 'manage-tenant',
    responseSchema: smtpConfigSchema,
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/smtp',
    capability: 'manage-tenant',
    responseSchema: smtpConfigSchema,
    bodySchema: putSmtpRequestSchema,
    description:
      'Replaces the whole configuration. Omitting `password` clears it, since GET never ' +
      'hands one back to resend unchanged. Carries no ETag/If-Match: PUT already fully ' +
      'replaces the row rather than partially amending it, and the password being ' +
      'write-only removes the one case a race would matter for — a caller can never read ' +
      'the current value to decide whether its own write should still apply.',
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
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/flow/executions',
    capability: 'manage-tenant',
    responseSchema: listExecutionsResponseSchema,
    bodySchema: replaceExecutionsRequestSchema,
    description:
      'Refused with 400 for an empty list, a list where every step is disabled, or an ' +
      'authenticator name the registry does not resolve. ' +
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

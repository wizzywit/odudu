import {
  domainSchema,
  listDomainsQuerySchema,
  listDomainsResponseSchema,
  passkeyImpactQuerySchema,
  passkeyImpactResponseSchema,
  registerDomainRequestSchema,
  addRoleCompositeRequestSchema,
  listRoleCompositesResponseSchema,
  setRoleDefaultRequestSchema,
  sendAccountLinkRequestSchema,
  sendActionsEmailRequestSchema,
  setGroupDefaultRequestSchema,
  amendClientRequestSchema,
  listAuditQuerySchema,
  listAuditResponseSchema,
  countAuditQuerySchema,
  exportAuditQuerySchema,
  auditEventSchema,
  AUDIT_EXPORT_MEDIA_TYPE,
  agentInstanceSchema,
  deleteAgentQuerySchema,
  listAgentApprovalsQuerySchema,
  listAgentApprovalsResponseSchema,
  listAgentsQuerySchema,
  listAgentsResponseSchema,
  revokeAgentResponseSchema,
  amendGroupRequestSchema,
  amendRoleRequestSchema,
  amendScopeRequestSchema,
  amendSettingsRequestSchema,
  amendProfileRequestSchema,
  amendSubjectRequestSchema,
  assignScopeToClientRequestSchema,
  assignScopeToClientResponseSchema,
  clientRecordSchema,
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
  listFlowsResponseSchema,
  flowSchema,
  saveFlowRequestSchema,
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
  listTermsAcceptancesQuerySchema,
  listTermsAcceptancesResponseSchema,
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
  listBuiltinScopesResponseSchema,
  listScopeClientsResponseSchema,
  deleteScopeQuerySchema,
  restoreBuiltinScopesResponseSchema,
  scopeImpactSchema,
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
  assistantSettingsSchema,
  assistantStatusSchema,
  putAssistantSettingsRequestSchema,
  assistantApprovalListSchema,
  assistantConversationExportSchema,
  assistantConversationSchema,
  assistantResumedConversationSchema,
  lastAssistantConversationResponseSchema,
  listAssistantConversationsQuerySchema,
  listAssistantConversationsResponseSchema,
  setConversationArchivedRequestSchema,
  setConversationArchivedResponseSchema,
  assistantActivityReplaySchema,
  assistantPromptfooCaseSchema,
  listAssistantActivityQuerySchema,
  listAssistantActivityResponseSchema,
  reportConversationResponseSchema,
  createConversationRequestSchema,
  decideApprovalRequestSchema,
  decideApprovalResponseSchema,
  sendMessageRequestSchema,
  setConversationModeRequestSchema,
  setConversationModeResponseSchema,
  stopConversationResponseSchema,
  SEND_MESSAGE_BODY_LIMIT,
  listEffectiveRolesResponseSchema,
  listTenantsQuerySchema,
  countTenantsQuerySchema,
  listTenantsResponseSchema,
  deleteTenantQuerySchema,
  removeCredentialQuerySchema,
  revokeRecoveryCodesQuerySchema,
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
  subjectDetailSchema,
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
  THEME_ASSET_BODY_LIMIT,
  previewThemeQuerySchema,
  themePreviewInfoSchema,
  previewMailQuerySchema,
  mailBrandingViewSchema,
  THEME_BODY_LIMIT,
  listMessageOverridesQuerySchema,
  listMessageOverridesResponseSchema,
  messageCatalogueResponseSchema,
  stylesheetHooksResponseSchema,
  messageOverrideSchema,
  putMessageOverrideRequestSchema,
  listThemeVersionsResponseSchema,
  themeAssetSchema,
  uploadThemeAssetQuerySchema,
  publishThemeResponseSchema,
  putThemeRequestSchema,
  themeViewSchema,
} from '@odudu/contracts/admin';
import { MANAGE_TENANTS, type TenantCapability } from '@odudu/domain-tenant';
import { z } from 'zod';
import { uploadLimitFor } from '#/service/theme-assets';

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
  // with whatever composes it. A read carries one for a list another
  // capability's writes pick from; the image routes admit `manage-clients`.
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
  // A body that is raw bytes, not JSON, read only by this route: the router
  // authenticates the caller and checks the limit `limitFor` names for this
  // query before it reads any of it, and a declared type outside
  // `contentTypes` is refused. Replaces `bodySchema`.
  readonly rawBody?: {
    readonly contentTypes: readonly string[];
    readonly limitFor: (query: unknown) => number | null;
    // What a refused declared type answers (status 415), before the body is
    // read, its detail naming the type declared; without it Fastify's own
    // generic refusal would.
    readonly unsupportedType?: { type: string; title: string };
  };
  // Extra prose `/admin/openapi.json` carries beside the generated
  // capability summary — for a caveat a generated client's user needs
  // without reading this repository's own docs.
  readonly description?: string;
  // The route refuses an `Idempotency-Key`. `secret`: the response carries a
  // secret shown once, which is never stored, so there is nothing to replay.
  // `not-atomic`: the route writes outside the request's transaction, so a
  // record could not prove the call happened. `external-io`: the handler waits
  // on another server (mail, DNS) while it holds the request's connection.
  readonly noIdempotency?: 'secret' | 'not-atomic' | 'external-io';
}

// Appended to the description of every route that mutates one subject.
const RETURN_TO =
  ' An optional body names a client to return to: `client_id`, and `redirect_uri` when the ' +
  'client registers more than one. The last page of the link then offers a way back to that ' +
  'registered address with `action_status` (`success`, or `error` for a link that cannot be ' +
  'used), a hint, since the "me" API holds the outcome. Absent, the link ends as it always ' +
  'did. `400` with its own problem type for a client that is not an enabled client of this ' +
  'tenant (`return-client-unknown`), an address it does not register ' +
  '(`return-redirect-uri-unregistered`), or none named where it registers several ' +
  '(`return-redirect-uri-required`).';

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

// What every theme route says about the cache and the draft, once.
const THEME_CACHE =
  'The pages of this process show a publish, a restore or a reset at once; another replica ' +
  'shows the previous theme for at most 30 seconds, the lifetime of its cache.';

const THEME_DRAFT =
  'Users never see a draft. `GET` answers the draft\u2019s `ETag` when there is one, and a write ' +
  'to an existing draft must send it as `If-Match`: refused with `428` when it is missing or ' +
  '`*`, and with `412` when it no longer matches, leaving the draft as it was. The first draft ' +
  'of a scope needs none.';

// The routes that make up a scope's theme, under the tenant or under one
// client. The tenant's own theme needs `manage-tenant`, a client's
// `manage-clients`, the capability every other client write needs.
function themeRoutes(
  base: string,
  capability: 'manage-tenant' | 'manage-clients',
  noun: string,
): readonly AdminRoute[] {
  return [
    {
      method: 'GET',
      pattern: `${base}/theme`,
      capability,
      responseSchema: themeViewSchema,
      description:
        `The ${noun}\u2019s draft and published theme, and for each piece the layer that ` +
        `supplies it (\`client\`, \`tenant\` or \`default\`). \`changed\` names the parts of the ` +
        'draft (`tokens`, `assets`, `stylesheet`, `templates`) that differ from the ' +
        `${noun}\u2019s own published theme, compared by the server on their stored form; it is ` +
        `empty without a draft, and nothing published compares as the empty theme. ${THEME_DRAFT}`,
    },
    {
      method: 'PUT',
      pattern: `${base}/theme`,
      capability,
      responseSchema: themeViewSchema,
      bodySchema: putThemeRequestSchema,
      bodyLimit: THEME_BODY_LIMIT,
      description:
        `Saves the whole draft of the ${noun}\u2019s theme: a part left out is absent, not kept. ` +
        'The templates, the stylesheet and the images are checked as they are on publish, ' +
        'except contrast, which only publishing checks; a refusal is `400` with `errors`, ' +
        'each naming its piece and, for a template or stylesheet, the line and column. A ' +
        'template may use only `{{t "key"}}` keys of the catalogue its page is filled from. ' +
        `A body over 4 MiB is refused with \`413\` before it is read. ${THEME_DRAFT}`,
    },
    {
      method: 'POST',
      pattern: `${base}/theme/publish`,
      capability,
      responseSchema: publishThemeResponseSchema,
      description:
        'Publishes the draft as the next version, which users see, and keeps the previous ' +
        'ones (at most 20 versions). Every check runs again, and a failing text or UI ' +
        'contrast pair is refused as a `400` naming the colour. A stylesheet or a template ' +
        'cannot be proven accessible, so each earns an entry in `warnings`, which does not ' +
        'block. `409` (`about:blank#theme-no-draft`) when there is no draft, which is also ' +
        'what the second of two simultaneous publishes of one draft receives, and ' +
        '`409` (`about:blank#theme-nothing-to-publish`) when the draft has the published ' +
        'content, which would only add a version identical to the last. `If-Match` is ' +
        `optional here and, when sent, must name the draft being published. ${THEME_CACHE}`,
    },
    {
      method: 'GET',
      pattern: `${base}/theme/versions`,
      capability,
      responseSchema: listThemeVersionsResponseSchema,
      description:
        'The published version and the archived ones, newest first, at most 20, without ' +
        'their bodies.',
    },
    {
      method: 'POST',
      pattern: `${base}/theme/versions/:versionId/restore`,
      capability,
      responseSchema: themeViewSchema,
      description:
        'Publishes a copy of an earlier version, whole, as the next version; the draft is ' +
        'left as it is. Refused with `409` (`about:blank#theme-assets-missing`) when an image ' +
        `the version names has been deleted, \`errors\` naming each. ${THEME_CACHE}`,
    },
    {
      method: 'GET',
      pattern: `${base}/theme/preview`,
      capability,
      responseSchema: z.string(),
      successMediaType: 'text/html',
      querystringSchema: previewThemeQuerySchema,
      description:
        `A page of the ${noun}\u2019s draft theme, rendered by the same code users are sent, ` +
        `with sample values${noun === 'client' ? ', over its tenant\u2019s published theme' : ''}. ` +
        'The answer is a whole HTML document under a policy of its own, for a frame whose ' +
        'parent is this origin: the stylesheet and images are carried inside it, so a draft ' +
        'image that no address serves still shows, and nothing in it needs a script. A page ' +
        'whose kind needs one (`passkey-enrolment`) is rendered without it, which the ' +
        '`X-Odudu-Preview-Script: omitted` header says. A scope with no draft shows its own ' +
        'published theme, then what is below it. A template that cannot be filled shows the default ' +
        'page, and `X-Odudu-Preview-Fallback` lists the kinds. Refused with `422` (`about:blank#theme-preview-too-large`) when the ' +
        'stylesheet and the images the page shows come to over about 2.2 MiB once inlined. Reads ' +
        'the draft only: nothing is saved and nothing is published.',
    },
    {
      method: 'GET',
      pattern: `${base}/theme/preview/info`,
      capability,
      responseSchema: themePreviewInfoSchema,
      querystringSchema: previewThemeQuerySchema,
      description:
        `What the preview of the same request shows and why, since a frame cannot read the ` +
        `headers of the page it loads. Takes the preview\u2019s own query and is computed by ` +
        `the code that renders it, so the two cannot disagree: whether the ${noun}\u2019s ` +
        '`draft`, its `published` theme or neither is the scope\u2019s own layer, the layer ' +
        'the page is `shown` from, the layers or stylesheets left out and why, the templates ' +
        'of this page kind that failed the checks, and whether the template could not be ' +
        'filled. Reads the draft and the published themes only, at most five statements ' +
        'whatever the theme names. `404` for a client that is not the tenant\u2019s.',
    },
    {
      method: 'DELETE',
      pattern: `${base}/theme/draft`,
      capability,
      responseSchema: themeViewSchema,
      description:
        `Discards the ${noun}\u2019s draft and nothing else: the published theme, its versions ` +
        'and what users see are untouched, so, unlike the reset, it never unpublishes the ' +
        'live theme. The draft\u2019s `ETag` is required as `If-Match`, refused with `428` when it is ' +
        'missing or `*` and with `412` when it no longer matches. A scope with no draft ' +
        'answers its theme as it is (`412` when an `ETag` names a draft that is gone). ' +
        'Answers the theme as it now is.',
    },
    {
      method: 'DELETE',
      pattern: `${base}/theme`,
      capability,
      responseSchema: themeViewSchema,
      description:
        `Resets the ${noun} to ${noun === 'client' ? 'its tenant\u2019s theme' : 'the default'}: ` +
        'the draft is deleted and the published version archived, where restore can bring ' +
        `it back. Answers the theme as it now is. ${THEME_CACHE}`,
    },
  ];
}

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
      '`admin_capabilities`, every name it holds and whether one is assigned to it directly. ' +
      'The people and service accounts only: an agent instance, which exists for one ' +
      'conversation or run, is left out unless `type=agent_instance` is asked for.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/count',
    capability: 'view-users',
    responseSchema: countResponseSchema,
    querystringSchema: countSubjectsQuerySchema,
    description:
      'How many subjects match, counting the people and service accounts only, as the list ' +
      'does: an agent instance is counted only when `type=agent_instance` is asked for.',
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
    responseSchema: subjectDetailSchema,
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/subjects/:id',
    capability: 'manage-users',
    responseSchema: subjectDetailSchema,
    bodySchema: amendSubjectRequestSchema,
    description:
      TARGET_CEILING.trimStart() +
      LAST_ADMINISTRATOR +
      ' `If-Match` is mandatory when the body renames the subject: an absent header, or `*`, is refused with `428`, and a stale one with `412`. Otherwise it is optional.' +
      ' A new `email` is not stored at once: it is held as `pending_email`, a verification link is mailed to it, and the person confirms it; the current address keeps working until then, and a verified current address is told. The person’s current address cancels a pending change, and `null` removes the address at once. `409` for an address another subject holds, and `409` with `no-mail-relay` when the tenant has no relay and the deployment no sender; `503` when the deployment has no public base URL to put in the link.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/subjects/:id',
    capability: 'manage-users',
    responseSchema: z.void(),
    successStatus: 204,
    description:
      TARGET_CEILING.trimStart() +
      LAST_ADMINISTRATOR +
      ' Refused with `409` (`about:blank#service-account`) for the service account of a client; delete the client instead. Refused with `409` (`about:blank#agent-instance`) for the subject of an agent instance; revoke the instance instead.',
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
    querystringSchema: removeCredentialQuerySchema,
    description:
      'Removes one credential; a `password` is refused with `409`. When the credential is the ' +
      'TOTP the subject holds, their whole set of recovery codes is revoked with it, and an ' +
      'owed set is dropped, since a code only stands in for a TOTP code (a passkey is not one); ' +
      'a later enrolment issues a fresh set. The subject is told by mail at their address on file, verified or not, if they ' +
      'have one. With `end_sessions=true` every live session of the subject ends in the same ' +
      'transaction, as `DELETE …/sessions` ends them, and also needs `manage-sessions`; the ' +
      'removal and the ending succeed or fail together.' +
      TARGET_CEILING,
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
    method: 'GET',
    pattern: '/admin/tenants/:tenant/subjects/:id/terms-acceptances',
    capability: 'view-users',
    responseSchema: listTermsAcceptancesResponseSchema,
    querystringSchema: listTermsAcceptancesQuerySchema,
    description:
      'The versions of the tenant\u2019s terms the subject accepted and when, newest first, paged by keyset on the time and the version: `limit` up to 200, and `next` (also the `link` header) names the following page; a response with no `next` is the last. `404` for a subject that does not exist.',
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
    noIdempotency: 'secret',
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
    bodySchema: sendAccountLinkRequestSchema.optional(),
    description:
      'Queues the reset-password link a self-service request sends, to the subject\u2019s own ' +
      'address. The link is never in this response or the audit trail. `409` with its own ' +
      'problem type when the subject has no email (`no-email`), when the tenant\u2019s ' +
      '`reset_password_allowed` is off so the link would be refused (`reset-password-off`), or ' +
      'when its mail would only be logged, `GET …/smtp`\u2019s `none` (`no-mail-relay`). ' +
      'Rate-limited per origin, as the self-service request is.' +
      RETURN_TO +
      TARGET_CEILING,
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/subjects/:id/verification',
    capability: 'manage-users',
    responseSchema: z.void(),
    successStatus: 202,
    bodySchema: sendAccountLinkRequestSchema.optional(),
    description:
      'Queues a fresh email-verification link to the subject\u2019s own address. The link is ' +
      'never in this response or the audit trail. `409` `no-email` or `no-mail-relay` as ' +
      '`POST …/password-reset` answers them. Rate-limited per origin.' +
      RETURN_TO +
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
      'a non-empty subset of `update-password`, `configure-totp`, `configure-passkey` and ' +
      '`generate-recovery-codes`, the required actions a link can finish. Following ' +
      'it sets a new password where `update-password` is named, and owes the rest, so the ' +
      'next sign-in asks for each; the link alone never enrols a factor. The ' +
      'link is never in this response or the audit trail. ' +
      'The same `409`s as `POST …/password-reset`, `reset-password-off` only when ' +
      '`update-password` is named. Rate-limited per origin.' +
      RETURN_TO +
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
    querystringSchema: revokeRecoveryCodesQuerySchema,
    description:
      'Revokes every recovery code the subject holds, spent or not, so none signs in again. ' +
      'Recovery codes carry no id of their own, so this is the only way to remove them. ' +
      '`204` whether or not any were held; `404` for a subject with no `users` row. ' +
      'While the subject still holds a TOTP, the `generate-recovery-codes` required ' +
      'action is added so their next sign-in asks for a fresh set, unless `require_new_set` is ' +
      '`false`; with no TOTP left a set would serve nothing, and none is asked for. ' +
      'The subject is told by mail at their address on file, if they have one. Removing the ' +
      'last TOTP through `DELETE …/credentials/{credentialId}` revokes the set the ' +
      'same way, without being asked.' +
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
      'Replaces the whole list, which names any of `verify-email`, `update-password`, `configure-totp`, `configure-passkey`, `generate-recovery-codes`, `update-profile` and `accept-terms`. `409` where an action cannot be owed: `no-email` for `verify-email` on a subject with no address, `terms-not-configured` for `accept-terms` while the tenant has no `terms_uri` (changing `terms_version` adds the action to nobody, so an administrator owes it again when the terms change), and `no-editable-profile-fields` for `update-profile` where the tenant requires a profile field a person may not edit; a person may edit every profile claim today, so no tenant is refused yet. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header, or `*`, is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.' +
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
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header, or `*`, is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.' +
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
      'Replaces the subject\u2019s direct memberships. `If-Match` is mandatory (`428` absent or `*`, `412` stale). Refused with `403` when the groups, their ancestors or the composites their roles nest reach an admin capability the caller does not hold.' +
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
    noIdempotency: 'not-atomic',
    capability: MANAGE_TENANTS,
    responseSchema: tenantSchema,
    successStatus: 201,
    bodySchema: createTenantRequestSchema,
    description:
      'A `display_name` is trimmed, and a blank one is stored as none (`null`), which the ' +
      'tenant\u2019s pages replace with its name.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenant-imports',
    noIdempotency: 'secret',
    capability: MANAGE_TENANTS,
    responseSchema: importTenantResponseSchema,
    successStatus: 201,
    bodySchema: importTenantRequestSchema,
    bodyLimit: TENANT_IMPORT_BODY_LIMIT,
    description:
      'A set over 200 entries, more than 1,000 scopes, more than 200 scopes marked for every new client, a client given more than 200 scopes, or more than 200 default roles or groups is refused in the same `400`, naming the limit and the count. ' +
      'Creates a new tenant from a document `GET /admin/tenants/{tenant}/export` answered, with ' +
      'its own signing key and a fresh secret for each confidential client, answered once here. ' +
      'A blank `display_name`, in the request or the document, is stored as none. ' +
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
      'Amends display_name and enabled. A `display_name` is trimmed, and a blank one is ' +
      'stored as none (`null`). `name` is refused with 400: it is already in the ' +
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
      '`view-users`, refused with `403` otherwise and with `413` above 10,000 subjects. ' +
      'The tenant\u2019s domains are not in it, and an import refuses a `domains` key as an ' +
      'unknown field, so a host can only be claimed by proving it.',
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
      '`display_name` is trimmed, and a blank one is stored as none (`null`). ' +
      '`enabled: false` ends every live session in the tenant, after the change has ' +
      'committed and in batches, as `PATCH /admin/tenants/{tenant}` does.',
  },
  ...themeRoutes('/admin/tenants/:tenant', 'manage-tenant', 'tenant'),
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/mail/preview',
    capability: 'manage-tenant',
    responseSchema: z.string(),
    successMediaType: 'text/html',
    querystringSchema: previewMailQuerySchema,
    description:
      'The address-verification mail as the tenant\u2019s published theme dresses it, built by ' +
      'the code that builds the real one, with a sample address and link. The answer is a ' +
      'whole HTML document under a policy of its own, for a frame whose parent is this ' +
      'origin: it licenses no script, and images only from the logo\u2019s origin. `scheme` ' +
      'fixes the light or the dark palette and logo, which a mail client otherwise chooses ' +
      'by its own setting. The preview is the tenant\u2019s own look; a client\u2019s is `GET /admin/tenants/{tenant}/clients/{id}/mail/preview`. Reads ' +
      'the published theme only: nothing is queued, saved or sent.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/mail/branding',
    capability: 'manage-tenant',
    responseSchema: mailBrandingViewSchema,
    description:
      'The colours and the logo the tenant\u2019s mail inherits from its published theme, ' +
      'for each scheme, and for each palette whether the theme or Odudu\u2019s default ' +
      'supplies it. A scheme the theme does not set shows the default\u2019s colours. A ' +
      'client\u2019s own is `GET /admin/tenants/{tenant}/clients/{id}/mail/branding`.',
  },
  // A tenant's own wording for the messages its pages show, per language. The
  // languages themselves are the `supported_locales` and `default_locale`
  // settings above.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/message-overrides',
    capability: 'manage-tenant',
    responseSchema: listMessageOverridesResponseSchema,
    querystringSchema: listMessageOverridesQuerySchema,
    description:
      'The overrides of one `locale`, in key order, each with its `etag`, the version to send ' +
      'back as `If-Match`. A tenant holds at most 500 across every ' +
      'locale, so a locale is listed in at most three pages of 200.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/message-catalogue',
    capability: 'manage-tenant',
    responseSchema: messageCatalogueResponseSchema,
    description:
      'The messages a tenant\u2019s pages and mail are filled from, as the keys a template may name in ' +
      '`{{t "key"}}` and a message override may be set under, each with its English text. ' +
      'The catalogue is part of the build and the same for every tenant, so the answer is ' +
      'built once and reads nothing from the database: three sections, one per package ' +
      'that fills pages, and a fourth of mail messages with no page kinds, a few hundred ' +
      'messages in all and well under 100 KB, never paged. A template of a page kind may ' +
      'name only a key of the section that lists that kind; an override may name the key ' +
      'of any section, mail included.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/theme/stylesheet-hooks',
    capability: 'manage-tenant',
    alsoAdmits: ['manage-clients'],
    responseSchema: stylesheetHooksResponseSchema,
    description:
      'Needs `manage-tenant`, or `manage-clients` since a client’s theme has a stylesheet ' +
      'too. What a stylesheet’s rules may name, as the stylesheet check accepts it and ' +
      'with the `version` of the list: the `classes` the pages render, one `page_kind_classes` ' +
      'entry per page kind, the `elements`, the `pseudo_classes` and `pseudo_elements` that may ' +
      'follow either, and the design `tokens` a declaration may read with `var()`. A ' +
      'stylesheet cannot define a custom property of its own. The lists are part of the build ' +
      'and the same for every tenant, so the answer is built once and reads nothing from the ' +
      'database: under 4 KB, never paged.',
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/message-overrides/:locale/:key',
    capability: 'manage-tenant',
    responseSchema: messageOverrideSchema,
    bodySchema: putMessageOverrideRequestSchema,
    description:
      'Sets the text a page shows in `locale` for the message `key`, replacing any earlier ' +
      'one. Two administrators editing the same key cannot overwrite one another unseen: ' +
      '`If-Match` naming the override\u2019s `etag` is required to replace one, and ' +
      '`If-None-Match: *` to create one. Neither header, or `*` as `If-Match`, is refused with `428`; a ' +
      '`If-Match` that is stale, or that names a key now gone, and `If-None-Match: *` for a key that now exists, with `412`. ' +
      'The answer carries the new `ETag`. `key` must be the key of a page message, such as `login.title`, else `400`; the ' +
      'text is checked as a message, so an unbalanced brace is refused with `400`, and so is an argument such as `{name}` that the page\u2019s English text of the same key does not read, because the page would not supply it. The text for `consent.heading` must use `{client}`, since the consent page has to tell the person which application is asking. Markup in ' +
      'it is shown as text, never rendered. `409` (`about:blank#message-overrides-full`) when ' +
      'the tenant already holds 500, though changing one that exists is always allowed. ' +
      'Pages in this process show the change at once; another replica shows the previous text ' +
      'for at most 30 seconds, the lifetime of its cache.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/message-overrides/:locale/:key',
    capability: 'manage-tenant',
    responseSchema: z.void(),
    successStatus: 204,
    description:
      'Removes the override, so the page shows the catalogue\u2019s text again. `If-Match` naming ' +
      'the override\u2019s `etag` is required: an absent header, or `*`, is refused with `428`, and a ' +
      'stale one with `412`; `404` when there is no override.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/theme/assets',
    capability: 'manage-tenant',
    alsoAdmits: ['manage-clients'],
    responseSchema: themeAssetSchema,
    successStatus: 201,
    querystringSchema: uploadThemeAssetQuerySchema,
    bodyLimit: THEME_ASSET_BODY_LIMIT,
    rawBody: {
      contentTypes: ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'],
      limitFor: uploadLimitFor,
      unsupportedType: {
        type: 'about:blank#asset-unsupported-type',
        title: 'Unsupported Media Type',
      },
    },
    description:
      'Needs `manage-tenant`, or `manage-clients` since a client\u2019s theme names tenant images. Uploads an image for the tenant\u2019s themes: the request body is the image itself, ' +
      'not JSON, and `kind` says which slot it is for. A declared `Content-Type` other than ' +
      '`image/png`, `image/jpeg`, `image/webp` or `application/octet-stream` is refused with ' +
      '`415`, and none of them is trusted: PNG, JPEG and WebP are told by the bytes. The ' +
      'image is decoded and stored re-encoded, which drops its metadata and anything ' +
      'appended, so `bytes` and `sha256` are the stored ones; the same picture uploaded ' +
      'twice is one image. An uploaded image is not served until a published theme names ' +
      'it. The caller is authenticated and the size checked before the body is read: `413` ' +
      'for a body over the kind\u2019s limit, `400` for a `kind` that is missing or unknown. ' +
      'Refused with `415` (`about:blank#asset-unsupported-type`) for bytes that are not one ' +
      'of the three, `422` (`about:blank#asset-animated`, `asset-corrupt`, ' +
      '`asset-dimensions`, `asset-timeout`), `413` (`about:blank#asset-too-large`) for an ' +
      'image whose stored size is over the limit, `409` (`about:blank#asset-cap`) when the ' +
      'tenant\u2019s stored images would pass 8 MiB, and `503` (`about:blank#asset-busy`) ' +
      'with `Retry-After` when the server is decoding as many images as it will at once.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/theme/assets/:assetId',
    capability: 'manage-tenant',
    alsoAdmits: ['manage-clients'],
    responseSchema: z.void(),
    successStatus: 204,
    description:
      'Needs `manage-tenant`, or `manage-clients`. Deletes an uploaded image. Refused with `409` (`about:blank#asset-in-use`) while a ' +
      'draft or a published theme of the tenant or of any of its clients names it, `errors` ' +
      'listing the first 20 by the theme\u2019s path and version; an archived version does ' +
      'not hold it, so restoring one that names a deleted image is refused. `404` for an ' +
      'image that does not exist or is another tenant\u2019s.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/theme/assets/:assetId/content',
    capability: 'manage-tenant',
    alsoAdmits: ['manage-clients'],
    responseSchema: z.string(),
    successMediaType: 'image/*',
    description:
      'Needs `manage-tenant`, or `manage-clients`. The stored bytes of an uploaded image, as ' +
      'they would be served, under the type they were stored as (`image/png`, `image/jpeg` ' +
      'or `image/webp`), whether or not a published theme names it: this is how an admin sees ' +
      'an image before any public address serves it. `X-Content-Type-Options: nosniff` and ' +
      '`Cache-Control: private, no-store`. At most 1.25 MiB, one statement. `400` for an ' +
      '`assetId` that is not an id, and `404` for an image that does not exist or is another ' +
      'tenant\u2019s.',
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
    noIdempotency: 'secret',
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
    responseSchema: clientRecordSchema,
    description: CLIENT_REACH,
  },
  {
    method: 'PATCH',
    pattern: '/admin/tenants/:tenant/clients/:id',
    capability: 'manage-clients',
    responseSchema: clientRecordSchema,
    bodySchema: amendClientRequestSchema,
    description:
      `${SERVICE_ACCOUNT_CEILING} ${CLIENT_LIST_BOUND}` +
      ' `If-Match` is mandatory when the body replaces a list field: an absent header, or `*`, is refused with `428`, and a stale one with `412`. Otherwise it is optional.' +
      ' A `grant_types` that adds `client_credentials` to a confidential client reuses the account it kept, with the roles it still holds, when an upgrade left one idle, and otherwise creates one with no roles; one that leaves it out deletes the account with the roles, token grants and sessions it held, and is refused with `409` when the account holds the last enabled administrator role.',
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
    noIdempotency: 'secret',
    capability: 'manage-clients',
    responseSchema: rotateClientSecretResponseSchema,
    querystringSchema: rotateClientSecretQuerySchema,
    description:
      'Answers the new secret once. `grace_seconds` (0 to 604800, default 0) keeps the ' +
      'secret it replaces authenticating that long beside it, and the response states ' +
      `when it stops in \`previous_secret_expires_at\`. ${SERVICE_ACCOUNT_CEILING}`,
  },
  ...themeRoutes('/admin/tenants/:tenant/clients/:id', 'manage-clients', 'client'),
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/clients/:id/mail/preview',
    capability: 'manage-clients',
    responseSchema: z.string(),
    successMediaType: 'text/html',
    querystringSchema: previewMailQuerySchema,
    description:
      'The address-verification mail as a mail whose flow began inside this client\u2019s ' +
      'sign-in is dressed: the client\u2019s published logo and colours over the tenant\u2019s, ' +
      'piece by piece, and the tenant\u2019s wording. A client that is disabled shows the ' +
      'tenant\u2019s look, as its mail would. Otherwise as the tenant\u2019s preview. ' +
      '`404` for a client the tenant does not hold.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/clients/:id/mail/branding',
    capability: 'manage-clients',
    responseSchema: mailBrandingViewSchema,
    description:
      'The colours and the logo that client\u2019s mail wears, for each scheme, and for each ' +
      'palette whether the client\u2019s theme (`client`), the tenant\u2019s (`tenant`) or ' +
      'Odudu\u2019s default supplies it. `404` for a client the tenant does not hold.',
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
    noIdempotency: 'secret',
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
  // A tenant's custom domains: reads under `view-domains`, which
  // `manage-domains` composes, every change under `manage-domains`.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/domains',
    capability: 'view-domains',
    responseSchema: listDomainsResponseSchema,
    querystringSchema: listDomainsQuerySchema,
    description:
      'Paged by host. Answers an `ETag` over which domain, if any, is the tenant\u2019s address, ' +
      'which `activate` and `deactivate` take in `If-Match`.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/domains',
    capability: 'manage-domains',
    responseSchema: domainSchema,
    successStatus: 201,
    bodySchema: registerDomainRequestSchema,
    description:
      'Registers a host, pending, and answers the TXT record to publish under `dns_record`. ' +
      'Refused with a typed `409` or `422` for the system tenant, a server with no public base ' +
      'URL, a tenant at its limit of domains, a host already registered, ' +
      'an IP address, `localhost`, this server\u2019s own host, a reserved name or ' +
      'a host that is not a lowercase punycode DNS name.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/domains/passkey-impact',
    capability: 'view-domains',
    responseSchema: passkeyImpactResponseSchema,
    querystringSchema: passkeyImpactQuerySchema,
    description:
      'How many subjects hold a passkey that switching the tenant\u2019s address to `canonical` ' +
      'would hide: those registered under a different relying party ID than that address uses. ' +
      'A passkey with no recorded ID is not counted. Counted to a ceiling, then `capped`.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/domains/:id',
    capability: 'view-domains',
    responseSchema: domainSchema,
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/domains/:id/verify',
    noIdempotency: 'external-io',
    capability: 'manage-domains',
    responseSchema: domainSchema,
    description:
      'Looks the TXT record up and verifies the domain when it holds the challenge; a domain ' +
      'whose record is not there yet stays `pending`. A tenant looks a host up at most once ' +
      'every 30 seconds and makes at most ten lookups a minute, otherwise `429` with ' +
      '`Retry-After`. A host another tenant verified first is refused here with `409`, not at ' +
      'registration.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/domains/:id/activate',
    capability: 'manage-domains',
    responseSchema: domainSchema,
    description:
      'Makes a verified domain the tenant\u2019s address, in one transaction that also lets the ' +
      'previous address\u2019s tokens stay valid for an hour. Refused with `409` for a domain that ' +
      'is not verified and when another change of the address landed first. `If-Match`, ' +
      'from a domains read, is required: `428` without it, `412` when stale. Already the ' +
      'address: answered unchanged.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/domains/:id/deactivate',
    capability: 'manage-domains',
    responseSchema: domainSchema,
    description:
      'Returns the tenant to its path address when this domain is its address, with the same ' +
      'hour for the domain\u2019s tokens. Makes no DNS lookup. A domain that is not the address is ' +
      'answered unchanged. `If-Match` is required: `428` without it, `412` when stale.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/domains/:id',
    capability: 'manage-domains',
    responseSchema: z.void(),
    successStatus: 204,
    description:
      'Refused with `409` while the domain is the tenant\u2019s address: deactivate it first.',
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
    description: 'A tenant defines at most 1,000 roles; one more is refused with `409`.',
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
    description: 'A tenant defines at most 10,000 groups; one more is refused with `409`.',
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
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header, or `*`, is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.' +
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
    description:
      'A tenant defines at most 1,000 scopes; one more is refused with `409`. ' +
      'At most 200 scopes are marked (`default_client_assignment`) for every new client; marking another is refused with `409`.',
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
    description:
      'Marking a scope for every new client (`default_client_assignment`) is refused with `409` once 200 are marked.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/scopes/:id',
    capability: 'manage-tenant',
    responseSchema: z.void(),
    successStatus: 204,
    querystringSchema: deleteScopeQuerySchema,
    description:
      'Cascades to every client’s assignment and role mapping naming the scope; ' +
      '`GET …/impact` counts them first. A built-in scope — one every tenant is ' +
      'given, decided by its name alone — is deleted only when `confirm` names it again, refused with `422` ' +
      '`builtin-scope-confirmation` otherwise, the detail naming the scope and what ' +
      'would go with it; `POST …/scopes/restore-builtins` creates it again, without ' +
      'what the cascade took. Refused with 409 for the scope named `openid`, which ' +
      'every client’s assignment of it — the tenant’s built-in admin client included — ' +
      'would otherwise be stripped of in the same stroke, whatever `confirm` says. ' +
      'The audit row carries `builtin` and both counts. ' +
      REMOVAL_CEILING,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/scopes/:id/impact',
    capability: 'manage-tenant',
    responseSchema: scopeImpactSchema,
    description:
      'What deleting the scope would take with it: how many clients carry it and how many ' +
      'roles are mapped to it, each counted up to the same ceiling the list counts stop at, ' +
      'and whether it is a built-in scope, which its name alone decides. Two bounded index reads, whatever the tenant holds.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/scopes/builtins',
    capability: 'manage-tenant',
    responseSchema: listBuiltinScopesResponseSchema,
    description:
      'Every built-in scope, in the order a new tenant is given them, and whether this tenant ' +
      'has it. One read over the name index.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/scopes/restore-builtins',
    capability: 'manage-tenant',
    responseSchema: restoreBuiltinScopesResponseSchema,
    description:
      'Creates each built-in scope the tenant is missing with the settings a new tenant is ' +
      'given, and answers the names it created, none when none was missing: repeating it is ' +
      'harmless. A name that exists is not recreated, whatever scope holds it, and that scope is not read or changed, edited or not, and the client ' +
      'assignments and role mappings a deletion took are not recreated. Refused with `409`, ' +
      'creating nothing, when the missing ones would pass the tenant’s scope limit or the ' +
      'limit on scopes marked for every new client.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/scopes/:id/roles',
    capability: 'manage-tenant',
    responseSchema: setScopeRolesResponseSchema,
    description:
      'Each role carries `admin_reach`, what it reaches of the admin vocabulary however deep it nests it. Derived on every read and outside the `ETag`.',
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/scopes/:id/roles',
    capability: 'manage-tenant',
    responseSchema: setScopeRolesResponseSchema,
    bodySchema: setScopeRolesRequestSchema,
    description:
      'More than 200 entries is refused with `400`. ' +
      'The answer carries each role’s `admin_reach`, as the `GET` does. ' +
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header, or `*`, is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.' +
      DELTA_CEILING,
  },
  // The registry names come from the same ClaimMapperRegistry the issuance
  // path assembles claims from — see ScopeMappersRouteDeps.claimMappers.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/scopes/:id/mappers',
    capability: 'manage-tenant',
    responseSchema: scopeMappersSchema,
    description:
      '`declared` names the mappers that declare the scope: what issuance runs for it while `bound` is empty. The `ETag` covers `bound` alone.',
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
      'The answer carries `declared` as the `GET` does. ' +
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header, or `*`, is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.',
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
      'A client carries at most 200 scopes: a new one past that is refused with `409`, while changing one it already carries is not. ' +
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
      'Refused with 409 while the key is active (`about:blank#key-active`), or while a client ' +
      'is registered against an algorithm no remaining key would produce ' +
      '(`#key-algorithm-needed`, naming at most 20 clients as `errors` entries of path ' +
      '`clients`, and the number left out as one of path `clients.more`). `If-Match` is optional: a stale one, ' +
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
      '(`about:blank#key-not-retired`) for an active or rotating one, which `POST …/retire` retires first. `If-Match` is ' +
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
    noIdempotency: 'external-io',
    capability: 'manage-tenant',
    responseSchema: testSmtpResponseSchema,
    bodySchema: testSmtpRequestSchema,
    description:
      'Sends one message to one address synchronously and reports a failure as a 502 ' +
      'whose detail is one fixed sentence for what failed (the relay could not be ' +
      'reached, refused the secure connection, refused the credentials or refused the ' +
      'message), never the relay\u2019s own words, rather than the tenant discovering a ' +
      'bad configuration only when a user\u2019s verification mail silently fails. ' +
      'Limited per origin like the other routes that send mail: `429` beyond it. ' +
      '400 when the tenant has no SMTP configuration or `to` is not exactly one address. ' +
      'The message wears the tenant\u2019s published theme and its wording; `client_id` ' +
      'dresses it as that client\u2019s mail instead (a disabled client shows the tenant\u2019s ' +
      'look), which also needs `manage-clients`: a caller without it is refused with ' +
      '`403`. `404` for a client the tenant does not hold.',
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
  // A tenant's authentication flows: manage-tenant, the same capability as
  // roles, groups and scopes above. No partial edit — PUT replaces the
  // whole ordered list, since a flow's meaning is in its order. The
  // `flow/executions` pair below reads and writes the default flow's steps.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/flows',
    capability: 'manage-tenant',
    responseSchema: listFlowsResponseSchema,
    description:
      'Every sign-in flow of the tenant, ordered by name, and `available`: every authenticator ' +
      'a step may name. A tenant holds at most 20 flows, so the list is never paged and `total` ' +
      'is all of them. Exactly one has `is_default`. Each has `client_count`, the clients that ' +
      'name it through `flow_id`. The `ETag` covers the flows and their counts.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/flows',
    capability: 'manage-tenant',
    responseSchema: flowSchema,
    bodySchema: saveFlowRequestSchema,
    successStatus: 201,
    description:
      'Creates a flow that is not the default. Refused with `409`: a name another flow of ' +
      'the tenant has (`#flow-name-taken`), or a tenant that already holds 20 flows ' +
      '(`#flow-limit`). A step list is refused with the `400` types of `PUT ' +
      '/flow/executions`; the unknown and the repeated authenticator carry `errors[]` ' +
      'naming the step as `steps[N].authenticator`, a step\u2019s unread `settings` as ' +
      '`steps[N].settings`, the others none. Answers an `ETag`.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/flows/:id',
    capability: 'manage-tenant',
    responseSchema: flowSchema,
    description: 'Answers the flow with an `ETag` that covers its name and steps.',
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/flows/:id',
    capability: 'manage-tenant',
    responseSchema: flowSchema,
    bodySchema: saveFlowRequestSchema,
    description:
      'Replaces the flow\u2019s name and steps, keeping its id and whether it is the default. ' +
      'Refused as `POST` refuses a step list or a name another flow has. `If-Match` is ' +
      'mandatory: the matching `GET` answers an `ETag`, an absent header, or `*`, is refused ' +
      'with `428`, and a stale one with `412`.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/flows/:id',
    capability: 'manage-tenant',
    responseSchema: z.void(),
    successStatus: 204,
    description:
      'Deletes a flow that is not the default. Refused with `409`: the default ' +
      '(`#default-flow`), since a client that names no flow signs in through it, and a flow ' +
      'some client names through `flow_id` (`#flow-in-use`), whose `detail` gives how many ' +
      'and the `client_id` of at most ten; unpoint those clients first. `If-Match` is ' +
      'mandatory, as for `PUT`: a flow another administrator has changed since it was read is ' +
      'not deleted unseen (`428` without the header or with `*`, `412` when stale), and both ' +
      'are answered before the refusals above.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/flows/:id/make-default',
    capability: 'manage-tenant',
    responseSchema: flowSchema,
    description:
      'Makes the flow the tenant\u2019s default, the one a sign-in runs when nothing names another, ' +
      'and the one `flow/executions` reads and writes; the flow that was the default stops being ' +
      'it, in the same transaction. The flow that already is the default is answered as it is. ' +
      '`If-Match` is mandatory, as for `PUT`. A sign-in already in flight takes its next step ' +
      'from the new default, since it records only which authenticators it has satisfied.',
  },
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
      'Refused with 400, each of its own type: an empty list (`about:blank#flow-empty`), a list ' +
      'where every step is disabled (`#flow-no-enabled-step`), a list nothing in which can start a ' +
      'login (`#flow-no-first-challenge`), an authenticator name the registry does not resolve ' +
      '(`#flow-unknown-authenticator`), or the same authenticator named twice ' +
      '(`#flow-duplicate-authenticator`), or a step whose `settings` its authenticator does not ' +
      'read (`#flow-step-settings`); the last three carry `errors[]` naming the step. ' +
      'Replaces the whole list. `If-Match` is mandatory: the matching `GET` answers an `ETag`, an absent header, or `*`, is refused with `428`, and a stale one with `412` — a last-write-wins here would silently reinstate what another administrator has just removed.',
  },
  // The agents an owner has running, and the approvals asked of owners: what a
  // sign-in handed an agent, so `manage-sessions` for all four, as for sessions
  // (no view-sessions: reached only by an operator who can also end one). No
  // agent token reaches any of them.
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/agents',
    capability: 'manage-sessions',
    responseSchema: listAgentsResponseSchema,
    querystringSchema: listAgentsQuerySchema,
    description:
      'The tenant\u2019s agent instances in id order, which is the order they were started in, so ' +
      'a parent comes before its children: `limit` up to 200, and `next` (also the `link` header) ' +
      'names the following page; a response with no `next` is the last. Narrowed by `owner` and ' +
      '`state`. Each carries its lineage (`owner`, `agent_client`, `parent`, `depth`), `expires_at` ' +
      'and the `remaining_budget` of its own slice. Never a token.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/agents/:id',
    capability: 'manage-sessions',
    responseSchema: agentInstanceSchema,
    description: 'One agent instance, as the list shows it. `404` for an id that is not one.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/agents/:id',
    capability: 'manage-sessions',
    querystringSchema: deleteAgentQuerySchema,
    responseSchema: revokeAgentResponseSchema,
    description:
      'Revokes the instance and every instance started beneath it, and the grants any of them ' +
      'acted in with everything exchanged from those, so no token of theirs is honoured again. ' +
      'Answers how many grants and instances it ended; an instance already revoked answers 0 and ' +
      'records nothing. With `dry_run=true` it answers the same counts and changes and records ' +
      'nothing, so a console can say what a revocation would end before it is asked for.' +
      TARGET_CEILING,
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/agent-approvals',
    capability: 'manage-sessions',
    responseSchema: listAgentApprovalsResponseSchema,
    querystringSchema: listAgentApprovalsQuerySchema,
    description:
      'The approvals agents asked of their owners, newest first: `limit` up to 200, and `next` ' +
      '(also the `link` header) names the following page; a response with no `next` is the last. ' +
      'Narrowed by `state`. Never the digest of the action an approval covers.',
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
    description:
      'Every read here runs under a five second statement timeout. Two filters whose rows are each common but that few rows share (an action and an actor, say) make Postgres read all of the cheaper one, so past the bound the read is refused with `400` of type `about:blank#audit-query-too-broad`: narrow it with `from` and `to`, which lead the index, or drop a filter. `from` and `to` are instants from 1970 to 9999, refused with `400` otherwise. ' +
      'Newest first, by an opaque cursor bound to the filters it was issued under.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/audit/count',
    capability: 'view-audit',
    responseSchema: countResponseSchema,
    querystringSchema: countAuditQuerySchema,
    description:
      'Every read here runs under a five second statement timeout. Two filters whose rows are each common but that few rows share (an action and an actor, say) make Postgres read all of the cheaper one, so past the bound the read is refused with `400` of type `about:blank#audit-query-too-broad`: narrow it with `from` and `to`, which lead the index, or drop a filter. `from` and `to` are instants from 1970 to 9999, refused with `400` otherwise.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/audit/export',
    capability: 'view-audit',
    responseSchema: auditEventSchema,
    successMediaType: AUDIT_EXPORT_MEDIA_TYPE,
    querystringSchema: exportAuditQuerySchema,
    description:
      'Every read here runs under a five second statement timeout. Two filters whose rows are each common but that few rows share (an action and an actor, say) make Postgres read all of the cheaper one, so past the bound the read is refused with `400` of type `about:blank#audit-query-too-broad`: narrow it with `from` and `to`, which lead the index, or drop a filter. `from` and `to` are instants from 1970 to 9999, refused with `400` otherwise. ' +
      'Every row the same filters list, newest first, one JSON object per line, built in full ' +
      'before it is sent rather than streamed. Refused whole with `413` past 10,000 rows ' +
      'rather than cut short. Audited as `audit.export`.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/assistant/status',
    capability: 'use-assistant',
    responseSchema: assistantStatusSchema,
    description:
      'Whether the console assistant is on in this deployment: `{ "enabled": false }` when no ' +
      'model is configured, otherwise the model each slot runs, the modes offered and the ' +
      'default, the models a person may choose and the provider, with the host of a ' +
      'self-hosted endpoint and never a key. A tenant that switched the assistant off reads ' +
      '`{ "enabled": false }` too, and the default mode is the tenant’s own.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/assistant/settings',
    capability: 'manage-assistant',
    alsoAdmits: ['read-assistant-activity'],
    responseSchema: assistantSettingsSchema,
    description:
      'Needs `manage-assistant`, or `read-assistant-activity`, which may read but not change. ' +
      'What this tenant chose for its assistant, each setting at its default until it chooses: ' +
      'whether it is on, the mode a person starts in, email masking, how long traces are kept, ' +
      'whether auditors see conversations, a month’s tokens for each model slot, the ' +
      'conversations a tenant may run at once and the steps of one turn. `404` where the ' +
      'deployment has no assistant configured. A system administrator holding ' +
      '`manage-tenants` and the capability may read another tenant\u2019s settings.',
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/assistant/settings',
    capability: 'manage-assistant',
    responseSchema: assistantSettingsSchema,
    bodySchema: putAssistantSettingsRequestSchema,
    description:
      'Replaces every setting, so a caller sends the whole document it read. A value outside ' +
      'its range, a missing setting and an unknown one are refused with `400`. A change is ' +
      'audited as `assistant.config` with each changed setting as before and after, and a save ' +
      'that changes nothing writes no row. Answers an `ETag`, as GET does; `If-Match` is ' +
      'optional, and a stale one is refused with `412`.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/assistant/conversations',
    capability: 'use-assistant',
    responseSchema: assistantConversationSchema,
    successStatus: 201,
    bodySchema: createConversationRequestSchema,
    noIdempotency: 'not-atomic',
    description:
      'Starts a conversation for the caller, in `ask` mode unless `act` is named, with the page ' +
      'the administrator has open as `page_context`: a `route` and, optionally, an `objectType` ' +
      'and `objectId`, each a short identifier and never free text. `400` for a profile this ' +
      'server does not offer. `404` when no model is configured.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/assistant/conversations',
    capability: 'use-assistant',
    responseSchema: listAssistantConversationsResponseSchema,
    querystringSchema: listAssistantConversationsQuerySchema,
    description:
      'The caller\u2019s own conversations, newest activity first, each with a title made from ' +
      'the first thing they asked, when it last took a message, its mode, whether it is hidden ' +
      'and whether it is reported. Never another person\u2019s: a person\u2019s conversations ' +
      'are theirs alone, whatever other capability they hold. `archived=true` lists the hidden ' +
      'ones and the default lists the rest. A page is one indexed read of at most `limit` ' +
      'rows, `limit` is at most 200, and `next` carries on from where it ended. `404` when no ' +
      'model is configured. Not offered to an agent.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/assistant/last-conversation',
    capability: 'use-assistant',
    responseSchema: lastAssistantConversationResponseSchema,
    description:
      'The caller\u2019s most recently active conversation that is not hidden, with its latest ' +
      'messages, or `{ "conversation": null }` when they have none, so the console can reopen ' +
      'it after a reload or a sign-in. `continuable` is true when a new message would be ' +
      'answered, including after the person signed out or the sign-in lapsed, and false when ' +
      'the sign-in was ended for another reason: the conversation can be read and a new message ' +
      'to it is refused with `409` (`about:blank#conversation-ended`). `404` when no model is ' +
      'configured. Not offered to an agent.',
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/assistant/conversations/:id/archived',
    capability: 'use-assistant',
    responseSchema: setConversationArchivedResponseSchema,
    bodySchema: setConversationArchivedRequestSchema,
    description:
      'Hides the caller\u2019s conversation from their list (`archived: true`) or brings it ' +
      'back. Nothing is removed, retention counts as before, and the conversation can still ' +
      'be opened by its id. Setting what is already set changes nothing. `404` for a ' +
      'conversation that is not the caller\u2019s. Not offered to an agent.',
  },
  {
    method: 'DELETE',
    pattern: '/admin/tenants/:tenant/assistant/conversations/:id',
    capability: 'use-assistant',
    responseSchema: z.void(),
    successStatus: 204,
    description:
      'Deletes the caller\u2019s own conversation: its messages, its trace and its approval ' +
      'cards go at once. A tombstone stays in the conversation\u2019s place (its id, owner, ' +
      'times, who deleted it, how many messages and turns it held and a keyed digest of its ' +
      'messages, never the text), and an `assistant.conversation_deleted` row is written in the ' +
      'same transaction; no audit row is touched. `409` while the conversation is reported ' +
      '(`about:blank#conversation-reported`) or an answer is running in it ' +
      '(`about:blank#conversation-busy`). It works while the tenant has the assistant switched ' +
      'off. `404` for a conversation that is not the caller\u2019s. Not offered to an agent.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/assistant/conversations/:id/export',
    capability: 'use-assistant',
    responseSchema: assistantConversationExportSchema,
    description:
      'The caller\u2019s own conversation as a JSON download: its fields and its messages, ' +
      'oldest first and at most 500, the text with secrets hidden (and email addresses where ' +
      'the tenant masks them) and, for an answer, the names of the tools it called but not ' +
      'their inputs or results. No one else can export a conversation: there is no route for ' +
      'an auditor or an operator. Audited as `assistant.conversation_exported`, in the ' +
      'transaction of the read. `404` for a conversation that is not the caller\u2019s. Not ' +
      'offered to an agent.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/assistant/conversations/:id/export/markdown',
    capability: 'use-assistant',
    responseSchema: z.string(),
    successMediaType: 'text/markdown',
    description:
      'The same export as a Markdown document: the title, then each message under who said it, ' +
      'with the tools an answer called. The same rules, the same audit row and the same `404`. ' +
      'Not offered to an agent.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/assistant/conversations/:id',
    capability: 'use-assistant',
    responseSchema: assistantResumedConversationSchema,
    description:
      'A conversation and its latest messages, oldest first, as the caller\u2019s own, with `archived` and `continuable` (true when a message would be answered under the sign-in held now). `404` for ' +
      'one that does not exist or belongs to another administrator, and when no model is configured.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/assistant/conversations/:id/messages',
    capability: 'use-assistant',
    responseSchema: z.string(),
    successMediaType: 'text/event-stream',
    bodySchema: sendMessageRequestSchema,
    bodyLimit: SEND_MESSAGE_BODY_LIMIT,
    noIdempotency: 'external-io',
    description:
      'Sends the caller\u2019s message and streams the turn as server-sent events of AI SDK UI ' +
      'message chunks. The message is stored before the model is called and each step is stored ' +
      'as it ends. Closing the connection ends the turn. Each model call is reserved against the ' +
      'tenant\u2019s token limits first, and a limit that refuses ends the turn with an error ' +
      'part that names the level and who can change it, never moving to a cheaper model. A ' +
      '`data-budget_warning` part says a level has passed 80 percent, and the last part, ' +
      '`data-turn_end`, carries a `stopReason`: `done`, `step_cap`, `budget_turn`, ' +
      '`budget_conversation`, `budget_admin`, `budget_tenant`, `aborted` or `error`. `409` while ' +
      'a turn of this conversation is running on this server. `429` with a `Retry-After` when ' +
      'this server is running as many turns as it admits, or when the tenant already has as many ' +
      'in progress, on any server, as its settings allow. `404` for a conversation that is not ' +
      'the caller\u2019s. A conversation whose grant ended with an earlier sign-in of the caller\u2019s ' +
      '(signing out, or a session that lapsed) is carried on first: a new grant is made from ' +
      'the sign-in the request came on, under the checks a first grant meets, and the old one ' +
      'ends, audited as `assistant.reattached`. Where that is refused nothing is stored and ' +
      'the answer is `409` with a problem type of its own: `about:blank#conversation-ended` ' +
      '(the sign-in ended for another reason), `about:blank#conversation-archived` (restore it ' +
      'first) or `about:blank#conversation-access-refused` (the sign-in held now may not carry ' +
      'it on).',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/assistant/conversations/:id/stop',
    capability: 'use-assistant',
    responseSchema: stopConversationResponseSchema,
    noIdempotency: 'not-atomic',
    description:
      'Ends the conversation\u2019s running turn: `{ "stopped": true }` when this server was ' +
      'running one, `false` when it was not. The turn stores what it had said.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/assistant/conversations/:id/approvals',
    capability: 'use-assistant',
    responseSchema: assistantApprovalListSchema,
    description:
      'The changes the assistant proposed in this conversation that still wait for the caller, ' +
      'newest first and never more than 20. Each card is written by the server: a title, the ' +
      'target, the state the server read just before the proposal, what the call would set and ' +
      'when the approval ends by the server\u2019s clock. `404` for a conversation that is not the ' +
      'caller\u2019s. Not offered to an agent.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/assistant/conversations/:id/approvals/:approvalId',
    capability: 'use-assistant',
    responseSchema: decideApprovalResponseSchema,
    bodySchema: decideApprovalRequestSchema,
    noIdempotency: 'not-atomic',
    description:
      'Approves or refuses one change, as the administrator the conversation belongs to and from ' +
      'their own console sign-in: a token the assistant or any agent holds is refused, and so is ' +
      'another administrator, whatever they may do elsewhere. Approving lets the one change run ' +
      'once, exactly as the card shows it, when the conversation is resumed. `404` for an ' +
      'approval that is not this conversation\u2019s or not the caller\u2019s, `409` for one that was ' +
      'already decided or has expired. Audited as `assistant.approval`.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/assistant/conversations/:id/resume',
    capability: 'use-assistant',
    responseSchema: z.string(),
    successMediaType: 'text/event-stream',
    noIdempotency: 'external-io',
    description:
      'Carries the conversation on after the changes it was waiting on were decided, and streams ' +
      'the rest of the answer as a message does. An approved change runs once and the assistant ' +
      'reads its result; a refused or expired one is closed as such. `409` while a change still ' +
      'waits for a decision, or when there is none to carry on from, or while a turn runs on ' +
      'this server. `429` as for a message. `404` for a conversation that is not the caller\u2019s.',
  },
  {
    method: 'PUT',
    pattern: '/admin/tenants/:tenant/assistant/conversations/:id/mode',
    capability: 'use-assistant',
    responseSchema: setConversationModeResponseSchema,
    bodySchema: setConversationModeRequestSchema,
    description:
      'Switches the conversation between `ask` and `act`. Leaving `act` withdraws the changes ' +
      'still waiting, as refused. `409` where `act` is not offered: the deployment cannot ' +
      'propose changes, or the tenant\u2019s limits do not allow the mode. `404` for a ' +
      'conversation that is not the caller\u2019s. Not offered to an agent.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/assistant/activity',
    capability: 'read-assistant-activity',
    responseSchema: listAssistantActivityResponseSchema,
    querystringSchema: listAssistantActivityQuerySchema,
    description:
      'The tenant\u2019s assistant conversations, newest activity first, each with its person, ' +
      'mode, turns, steps, tokens by model slot, why the latest turn stopped, the tools it ' +
      'called, the changes it proposed and whether it is reported (`report_old` for one reported ' +
      'more than 180 days ago). This is metadata, and a holder of the capability always gets it. ' +
      'A conversation\u2019s title is text: it is a placeholder unless the tenant\u2019s **Let auditors read ' +
      'conversation text** setting is on, and a list that then returns a title of someone else\u2019s ' +
      'conversation is audited once as `assistant.text_read` with part `list`. `person` and `conversation` narrow by owner and id; `tool`, `outcome` ' +
      '(the latest turn\u2019s stop reason) and `kind` (`approval`, `budget_refusal` or ' +
      '`tool_error`) look inside each conversation, and look at no more than 1,000 conversations ' +
      'a request, so a page they do not fill is returned short, even empty, with `next` to carry ' +
      'on from. `limit` is at most 200. `404` where the deployment has no assistant. Not offered ' +
      'to an agent.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/assistant/activity/conversations/:id',
    capability: 'read-assistant-activity',
    responseSchema: assistantActivityReplaySchema,
    description:
      'One conversation as the trace holds it: its latest 25 turns, oldest first, each with its ' +
      'steps (model, slot, tokens, request id), its events as they were recorded, why each ' +
      'model was chosen and why the turn stopped from the choices the server recorded; the ' +
      'changes the assistant proposed with where each stands; and what the person asked. The ' +
      'kinds, tool names, timings, token counts and sizes are always there. The text (what ' +
      'was asked and answered, and what the tools were given and returned, masked) is there ' +
      'only while the tenant\u2019s **Let auditors read conversation text** setting is on, and ' +
      '`text_visible` says which; otherwise each is replaced by a placeholder and its size. ' +
      'A read that returns text, by someone other than the conversation\u2019s owner, is ' +
      'audited as `assistant.text_read`. The system prompt is a hash. `404` for a conversation ' +
      'that is not this tenant\u2019s and where there is no assistant. Not offered to an agent.',
  },
  {
    method: 'GET',
    pattern: '/admin/tenants/:tenant/assistant/activity/conversations/:id/promptfoo',
    capability: 'read-assistant-activity',
    responseSchema: assistantPromptfooCaseSchema,
    description:
      'The conversation as one promptfoo test case, as a JSON download: the person\u2019s messages, ' +
      'the tools the assistant called with their inputs, the answers it gave and why each turn ' +
      'stopped, with `metadata.contains` and `metadata.excludes` saying what is and is not in it. ' +
      'It carries no assertions: whoever files it writes them. Text is subject to the same ' +
      'setting and the same record as the replay: while the setting is off the messages, inputs ' +
      'and answers are a placeholder and the case holds the tool names and stop reasons only. ' +
      'Not offered to an agent.',
  },
  {
    method: 'POST',
    pattern: '/admin/tenants/:tenant/assistant/conversations/:id/report',
    capability: 'use-assistant',
    alsoAdmits: ['read-assistant-activity'],
    responseSchema: reportConversationResponseSchema,
    description:
      'Keeps the conversation, with its trace, past the tenant\u2019s retention. Its owner may ' +
      'report it; someone who holds `read-assistant-activity` may report any conversation, since ' +
      'reporting shows no text. Reporting one that is already reported answers the ' +
      'same `reported_at` and changes nothing. A tenant keeps at most 100: `409` beyond that, ' +
      'and `near_limit` is true from 80. ' +
      '`404` for a conversation the caller may not report. Audited as `assistant.report`. Not ' +
      'offered to an agent.',
  },
];

export function requiredCapability(
  method: string,
  pattern: string,
): AdminCapability | null | undefined {
  const route = ADMIN_ROUTES.find((r) => r.method === method && r.pattern === pattern);
  return route === undefined ? undefined : route.capability;
}

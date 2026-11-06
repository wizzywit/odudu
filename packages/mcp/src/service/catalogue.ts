import { auditTools } from '#/service/tools/audit';
import { clientTools } from '#/service/tools/clients';
import { consentTools } from '#/service/tools/consents';
import { domainTools } from '#/service/tools/domains';
import { grantTools } from '#/service/tools/grants';
import { groupTools } from '#/service/tools/groups';
import { keyTools } from '#/service/tools/keys';
import { mailTools } from '#/service/tools/mail';
import { roleTools } from '#/service/tools/roles';
import { scopeTools } from '#/service/tools/scopes';
import { sessionTools } from '#/service/tools/sessions';
import { settingsTools } from '#/service/tools/settings';
import { subjectTools } from '#/service/tools/subjects';
import { whoamiTools } from '#/service/tools/whoami';
import { type RegisteredTool } from '#/service/tool';

// Sorted by name so `tools/list` answers in one order whatever the files do.
export const TOOLS: readonly RegisteredTool[] = [
  ...auditTools,
  ...clientTools,
  ...consentTools,
  ...domainTools,
  ...grantTools,
  ...groupTools,
  ...keyTools,
  ...mailTools,
  ...roleTools,
  ...scopeTools,
  ...sessionTools,
  ...settingsTools,
  ...subjectTools,
  ...whoamiTools,
].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const TENANT = '/admin/tenants/:tenant';

function route(method: string, suffix: string): string {
  return `${method} ${TENANT}${suffix}`;
}

const DENIED_READS: readonly string[] = [
  route('GET', '/export'),
  route('GET', '/audit/export'),
  route('GET', '/theme/assets/:assetId/content'),
];
const DESCRIPTIVE_WRITES: readonly string[] = [
  route('PATCH', '/clients/:id'),
  route('PATCH', '/scopes/:id'),
];
const DESTRUCTIVE: readonly string[] = [
  route('DELETE', ''),
  route('DELETE', '/sessions'),
  route('DELETE', '/subjects/:id/lockout'),
  route('DELETE', '/lockouts'),
  route('POST', '/keys'),
  route('POST', '/keys/:id/promote'),
  route('POST', '/keys/:id/retire'),
  route('DELETE', '/keys/:id'),
];
const PREVIEWS: readonly string[] = [
  route('GET', '/theme/preview'),
  route('GET', '/mail/preview'),
  route('GET', '/clients/:id/theme/preview'),
  route('GET', '/clients/:id/mail/preview'),
];
const BRANDING_READS: readonly string[] = [
  route('GET', '/theme'),
  route('GET', '/theme/versions'),
  route('GET', '/theme/preview/info'),
  route('GET', '/theme/stylesheet-hooks'),
  route('GET', '/mail/branding'),
  route('GET', '/message-overrides'),
  route('GET', '/message-catalogue'),
  route('GET', '/clients/:id/theme'),
  route('GET', '/clients/:id/theme/versions'),
  route('GET', '/clients/:id/theme/preview/info'),
  route('GET', '/clients/:id/mail/branding'),
];
const CREDENTIALS: readonly string[] = [
  route('GET', '/subjects/:id/profile'),
  route('GET', '/subjects/:id/credentials'),
  route('GET', '/registration-tokens'),
  route('GET', '/smtp'),
];
const TENANT_RECORDS: readonly string[] = [
  'GET /admin/tenants',
  'GET /admin/tenants/count',
  route('GET', ''),
];
const NARROWER_VIEWS: readonly string[] = [
  route('GET', '/subjects/username-policy'),
  route('GET', '/subjects/:id/required-actions'),
  route('GET', '/subjects/:id/roles'),
  route('GET', '/subjects/:id/effective-roles'),
  route('GET', '/subjects/:id/admin-capabilities'),
  route('GET', '/subjects/:id/groups'),
  route('GET', '/clients/:id/evaluate'),
  route('GET', '/clients/:id/installation'),
  route('GET', '/domains/passkey-impact'),
  route('GET', '/roles/:id/composites'),
  route('GET', '/groups/:id/roles'),
  route('GET', '/scopes/:id/impact'),
  route('GET', '/scopes/builtins'),
  route('GET', '/scopes/:id/roles'),
  route('GET', '/scopes/:id/mappers'),
  route('GET', '/scopes/:id/clients'),
  route('GET', '/flow/executions'),
];
const OTHER_WRITES: readonly string[] = [
  route('POST', '/subjects'),
  route('POST', '/subjects/bulk'),
  route('PATCH', '/subjects/:id'),
  route('DELETE', '/subjects/:id'),
  route('PATCH', '/subjects/:id/profile'),
  route('DELETE', '/subjects/:id/credentials/:credentialId'),
  route('DELETE', '/subjects/:id/consents/:clientId'),
  route('POST', '/subjects/:id/password'),
  route('POST', '/subjects/:id/password-reset'),
  route('POST', '/subjects/:id/verification'),
  route('POST', '/subjects/:id/actions-email'),
  route('DELETE', '/subjects/:id/recovery-codes'),
  route('PUT', '/subjects/:id/required-actions'),
  route('PUT', '/subjects/:id/roles'),
  route('PUT', '/subjects/:id/groups'),
  route('DELETE', '/subjects/:id/sessions'),
  route('DELETE', '/subjects/:id/sessions/:sid'),
  route('DELETE', '/subjects/:id/grants/:clientId'),
  'POST /admin/tenants',
  'POST /admin/tenant-imports',
  route('PATCH', ''),
  route('PATCH', '/settings'),
  route('PUT', '/theme'),
  route('POST', '/theme/publish'),
  route('POST', '/theme/versions/:versionId/restore'),
  route('DELETE', '/theme/draft'),
  route('DELETE', '/theme'),
  route('PUT', '/message-overrides/:locale/:key'),
  route('DELETE', '/message-overrides/:locale/:key'),
  route('POST', '/theme/assets'),
  route('DELETE', '/theme/assets/:assetId'),
  route('POST', '/clients'),
  route('DELETE', '/clients/:id'),
  route('POST', '/clients/:id/secret'),
  route('PUT', '/clients/:id/theme'),
  route('POST', '/clients/:id/theme/publish'),
  route('POST', '/clients/:id/theme/versions/:versionId/restore'),
  route('DELETE', '/clients/:id/theme/draft'),
  route('DELETE', '/clients/:id/theme'),
  route('DELETE', '/clients/:id/grants'),
  route('POST', '/registration-tokens'),
  route('DELETE', '/registration-tokens/:id'),
  route('POST', '/domains'),
  route('POST', '/domains/:id/verify'),
  route('POST', '/domains/:id/activate'),
  route('POST', '/domains/:id/deactivate'),
  route('DELETE', '/domains/:id'),
  route('POST', '/roles'),
  route('PATCH', '/roles/:id'),
  route('DELETE', '/roles/:id'),
  route('POST', '/roles/:id/composites'),
  route('DELETE', '/roles/:id/composites/:childId'),
  route('PUT', '/roles/:id/default'),
  route('POST', '/groups'),
  route('PATCH', '/groups/:id'),
  route('DELETE', '/groups/:id'),
  route('PUT', '/groups/:id/roles'),
  route('PUT', '/groups/:id/default'),
  route('POST', '/scopes'),
  route('DELETE', '/scopes/:id'),
  route('POST', '/scopes/restore-builtins'),
  route('PUT', '/scopes/:id/roles'),
  route('PUT', '/scopes/:id/mappers'),
  route('PUT', '/scopes/:id/clients/:clientId'),
  route('DELETE', '/scopes/:id/clients/:clientId'),
  route('PUT', '/smtp'),
  route('DELETE', '/smtp'),
  route('POST', '/smtp/test'),
  route('PUT', '/flow/executions'),
];

const DENIED =
  'An agent is refused this read: it returns a whole tenant, or a file, in one call, which a ' +
  'person fetches with their own token (AGENT_DENIED_READS).';
const DESCRIPTIVE =
  'A reversible write of descriptive fields, which mcp:write admits (AGENT_WRITE_ROUTES); its ' +
  'tool is the write tool for this route.';
const DESTRUCTIVE_REASON =
  'P5b: irreversible or wide in effect, so it needs the owner approving it separately, which ' +
  'P5b adds. P5a agents cannot call it.';
const OTHER_WRITE =
  'Not an agent write: mcp:write admits only the descriptive fields of a client and a scope, ' +
  'and nothing else writes in P5a.';
const PREVIEW = 'Renders a page for a browser frame, not data an agent reads.';
const BRANDING =
  'Branding, theme and message wording are outside the read catalogue: an agent cannot change ' +
  'them, so reading them serves nothing.';
const PERSONAL =
  'Holds personal data beyond the subject record, a credential, or a mail relay login: outside ' +
  'the read catalogue, which stops at what administering a tenant needs.';
const TENANT_RECORD =
  'The tenant record, or every tenant: whoami and get_settings answer what an agent needs of ' +
  'the tenant it acts in, and an agent never acts across tenants.';
const NARROWER =
  'Outside the read catalogue: a narrower view of a record whose list and get tools are in ' +
  'it, or a configuration read no catalogue family names.';

function because(reason: string, routes: readonly string[]): [string, string][] {
  return routes.map((key) => [key, reason]);
}

// Every admin route an MCP tool does not serve, with why. The coverage test
// holds this and TOOLS to the route table both ways.
export const NOT_TOOLS: Readonly<Record<string, string>> = Object.fromEntries([
  ...because(DENIED, DENIED_READS),
  ...because(DESCRIPTIVE, DESCRIPTIVE_WRITES),
  ...because(DESTRUCTIVE_REASON, DESTRUCTIVE),
  ...because(OTHER_WRITE, OTHER_WRITES),
  ...because(PREVIEW, PREVIEWS),
  ...because(BRANDING, BRANDING_READS),
  ...because(PERSONAL, CREDENTIALS),
  ...because(TENANT_RECORD, TENANT_RECORDS),
  ...because(NARROWER, NARROWER_VIEWS),
]);

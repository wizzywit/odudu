import { auditTools } from '#/service/tools/audit';
import { clientTools } from '#/service/tools/clients';
import { consentTools } from '#/service/tools/consents';
import { domainTools } from '#/service/tools/domains';
import { flowTools } from '#/service/tools/flow';
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
  ...flowTools,
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

const R = route;

// A reason is shared only by routes of one family or by the writes the one
// agent-write allowlist covers; every other withheld read says why itself.
type Entry = readonly [reason: string, routes: readonly string[]];

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

const WITHHELD: readonly Entry[] = [
  [
    'An agent is refused this read: a whole tenant document in one call, which a person fetches with their own token.',
    [R('GET', '/export')],
  ],
  [
    'An agent is refused this read: the audit trail as one download of up to 10,000 events, which a person fetches with their own token; list_audit pages it.',
    [R('GET', '/audit/export')],
  ],
  [
    'An agent is refused this read: the bytes of an uploaded theme image, which a person fetches with their own token.',
    [R('GET', '/theme/assets/:assetId/content')],
  ],
  [
    'A reversible write of descriptive fields, which mcp:write admits for a client; its tool is the write tool for this route.',
    [R('PATCH', '/clients/:id')],
  ],
  [
    'A reversible write of descriptive fields, which mcp:write admits for a scope; its tool is the write tool for this route.',
    [R('PATCH', '/scopes/:id')],
  ],
  [
    'Destructive or wide in effect (tenant delete, end every session, clear a lockout, change a signing key): not offered to an agent until the owner can approve each call separately.',
    [
      R('DELETE', ''),
      R('DELETE', '/sessions'),
      R('DELETE', '/subjects/:id/lockout'),
      R('DELETE', '/lockouts'),
      R('POST', '/keys'),
      R('POST', '/keys/:id/promote'),
      R('POST', '/keys/:id/retire'),
      R('DELETE', '/keys/:id'),
    ],
  ],
  [
    'Not an agent write: mcp:write admits only the descriptive fields of a client and a scope, and nothing else writes.',
    OTHER_WRITES,
  ],
  [
    'Renders the theme as a page for a browser frame, not data an agent reads.',
    [R('GET', '/theme/preview'), R('GET', '/clients/:id/theme/preview')],
  ],
  [
    'Renders a mail template as a page for a browser frame, not data an agent reads.',
    [R('GET', '/mail/preview'), R('GET', '/clients/:id/mail/preview')],
  ],
  [
    "Theme documents are authored markup and stylesheets, large and nearly all free text; the read catalogue does not offer them and the console's Branding screens read them.",
    [
      R('GET', '/theme'),
      R('GET', '/theme/versions'),
      R('GET', '/theme/preview/info'),
      R('GET', '/theme/stylesheet-hooks'),
      R('GET', '/clients/:id/theme'),
      R('GET', '/clients/:id/theme/versions'),
      R('GET', '/clients/:id/theme/preview/info'),
    ],
  ],
  [
    "The mail look (logo, colours, footer) is authored branding text, not offered by the read catalogue; the console's Branding screens read it.",
    [R('GET', '/mail/branding'), R('GET', '/clients/:id/mail/branding')],
  ],
  [
    "Message wording overrides and the catalogue of messages they replace are localised page text, not offered by the read catalogue; the console's Branding screens read them.",
    [R('GET', '/message-overrides'), R('GET', '/message-catalogue')],
  ],
  [
    'Personal data beyond the subject record (the profile claims: birth date, address, phone): get_subject is the read an agent is offered.',
    [R('GET', '/subjects/:id/profile')],
  ],
  [
    "Lists a subject's registered credentials (passkeys, authenticators): credential metadata, not offered to an agent.",
    [R('GET', '/subjects/:id/credentials')],
  ],
  [
    'Lists registration tokens, which are credentials that let a client register itself: not offered to an agent.',
    [R('GET', '/registration-tokens')],
  ],
  [
    'The mail relay configuration, with its host and login username: not offered to an agent; list_mail shows delivery status.',
    [R('GET', '/smtp')],
  ],
  [
    'Lists every tenant (manage-tenants): an agent acts inside the one tenant its token names, never across tenants.',
    ['GET /admin/tenants', 'GET /admin/tenants/count'],
  ],
  [
    'The tenant record: whoami and get_settings answer what an agent needs of the tenant it acts in.',
    [R('GET', '')],
  ],
  [
    "Answers one subject's id token, access token and userinfo claims, which are personal data, under manage-clients, which does not include view-users; its open claim records have no schema to bound them.",
    [R('GET', '/clients/:id/evaluate')],
  ],
  [
    "Restates what get_client returns (client id, type, authentication method, redirect URIs, grants, default scope) plus the issuer and discovery address, which the tenant's published metadata already gives.",
    [R('GET', '/clients/:id/installation')],
  ],
  [
    'Answers the username_editable setting alone, which get_settings returns with the rest.',
    [R('GET', '/subjects/username-policy')],
  ],
  [
    'Previews what moving the canonical address would do to passkeys (a capped count for a candidate address), an input to a change an agent cannot make.',
    [R('GET', '/domains/passkey-impact')],
  ],
  [
    'Says which built-in scopes are absent, only so that restoring them can be offered; list_scopes shows what exists and an agent cannot restore.',
    [R('GET', '/scopes/builtins')],
  ],
  [
    'Counts what deleting a scope would take with it, an input to a deletion an agent cannot make.',
    [R('GET', '/scopes/:id/impact')],
  ],
];

// Every admin route an MCP tool does not serve, with why. The coverage test
// holds this and TOOLS to the route table both ways.
export const NOT_TOOLS: Readonly<Record<string, string>> = Object.fromEntries(
  WITHHELD.flatMap(([reason, routes]) => routes.map((key) => [key, reason])),
);

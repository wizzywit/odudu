import { brandingTools } from '#/service/tools/branding';
import { clientBrandingTools } from '#/service/tools/client-branding';
import { auditTools } from '#/service/tools/audit';
import { clientMetadataTool } from '#/service/tools/client-metadata';
import { clientTools } from '#/service/tools/clients';
import { consentTools } from '#/service/tools/consents';
import { domainTools } from '#/service/tools/domains';
import { flowTools } from '#/service/tools/flow';
import { grantTools } from '#/service/tools/grants';
import { groupTools } from '#/service/tools/groups';
import { groupWriteTools } from '#/service/tools/groups-write';
import { keyTools } from '#/service/tools/keys';
import { mailTools } from '#/service/tools/mail';
import { roleTools } from '#/service/tools/roles';
import { roleWriteTools } from '#/service/tools/roles-write';
import { scopeMetadataTool } from '#/service/tools/scope-metadata';
import { scopeCheckTools } from '#/service/tools/scope-checks';
import { scopeTools } from '#/service/tools/scopes';
import { createScopeTool } from '#/service/tools/scopes-write';
import { sessionTools } from '#/service/tools/sessions';
import { settingsTools } from '#/service/tools/settings';
import { subjectTools } from '#/service/tools/subjects';
import { ownTenantTool } from '#/service/tools/tenant';
import { instanceTenantTools } from '#/service/tools/tenants';
import { whoamiTools } from '#/service/tools/whoami';
import { type RegisteredTool } from '#/service/tool';

// Sorted by name so `tools/list` answers in one order whatever the files do.
export const TOOLS: readonly RegisteredTool[] = [
  ...auditTools,
  ...brandingTools,
  ...clientBrandingTools,
  ...clientTools,
  ...consentTools,
  ...domainTools,
  ...flowTools,
  ...grantTools,
  ...groupTools,
  ...groupWriteTools,
  ...keyTools,
  ...mailTools,
  ...roleTools,
  ...roleWriteTools,
  ...scopeCheckTools,
  ...scopeTools,
  ...sessionTools,
  ...settingsTools,
  ...subjectTools,
  ...instanceTenantTools,
  ...whoamiTools,
  clientMetadataTool,
  createScopeTool,
  scopeMetadataTool,
  ownTenantTool,
].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const TENANT = '/admin/tenants/:tenant';

function route(method: string, suffix: string): string {
  return `${method} ${TENANT}${suffix}`;
}

const R = route;

// `kind` is the route's class in `docs/protocols/mcp-route-classes.md`, and says
// why it is withheld. `denied` and `sensitive` reads are also refused by the
// admin door (`AGENT_DENIED_READS`), as a holder of the bearer could otherwise
// call them; `not-useful` reads the door admits; `content` writes grant nothing
// and have no tool yet; `access-changing`, `credential` and `destructive`
// writes are not offered, and their reason begins with the class.
export type NotToolKind =
  | 'denied'
  | 'sensitive'
  | 'not-useful'
  | 'content'
  | 'access-changing'
  | 'credential'
  | 'destructive';
type Entry = readonly [reason: string, routes: readonly string[], kind: NotToolKind];

const OWNER_APPROVAL = 'not offered to an agent until the owner can approve each call separately';

const WITHHELD: readonly Entry[] = [
  [
    'An agent is refused this read: a whole tenant document in one call, which a person fetches with their own token.',
    [R('GET', '/export')],
    'denied',
  ],
  [
    'An agent is refused this read: the audit trail as one download of up to 10,000 events, which a person fetches with their own token; list_audit pages it.',
    [R('GET', '/audit/export')],
    'denied',
  ],
  [
    'An agent is refused this read: the bytes of an uploaded theme image, which a person fetches with their own token.',
    [R('GET', '/theme/assets/:assetId/content')],
    'denied',
  ],
  [
    'Content write with no tool yet: it changes only wording, a description or a draft and grants nothing, so the admin door admits it field by field once a tool names those fields.',
    [
      R('PATCH', '/settings'),
      R('PUT', '/theme'),
      R('PUT', '/clients/:id/theme'),
      R('PUT', '/message-overrides/:locale/:key'),
      R('DELETE', '/message-overrides/:locale/:key'),
    ],
    'content',
  ],
  [
    'Content write that needs a binary payload and answers nothing an agent can read, so it is not offered; a person uploads a theme image in the console.',
    [R('POST', '/theme/assets')],
    'content',
  ],
  [
    `Access-changing: it creates or changes a person who can sign in, or what is recorded about them (username, email, whether the account is on, profile claims, required actions), which relying parties trust; ${OWNER_APPROVAL}.`,
    [
      R('POST', '/subjects'),
      R('POST', '/subjects/bulk'),
      R('PATCH', '/subjects/:id'),
      R('PATCH', '/subjects/:id/profile'),
      R('PUT', '/subjects/:id/required-actions'),
    ],
    'access-changing',
  ],
  [
    `Access-changing: it sends mail that lets a person prove an address, reset a password or act on their account, so a person who reads it may sign in; ${OWNER_APPROVAL}.`,
    [
      R('POST', '/subjects/:id/password-reset'),
      R('POST', '/subjects/:id/verification'),
      R('POST', '/subjects/:id/actions-email'),
      R('POST', '/smtp/test'),
    ],
    'access-changing',
  ],
  [
    `Access-changing: it grants or removes roles, group membership, defaults, scope mappings or client assignments, which decide what a token carries and who may do what; ${OWNER_APPROVAL}.`,
    [
      R('PUT', '/subjects/:id/roles'),
      R('PUT', '/subjects/:id/groups'),
      R('POST', '/roles/:id/composites'),
      R('DELETE', '/roles/:id/composites/:childId'),
      R('PUT', '/roles/:id/default'),
      R('PUT', '/groups/:id/roles'),
      R('PUT', '/groups/:id/default'),
      R('POST', '/scopes/restore-builtins'),
      R('PUT', '/scopes/:id/roles'),
      R('PUT', '/scopes/:id/mappers'),
      R('PUT', '/scopes/:id/clients/:clientId'),
      R('DELETE', '/scopes/:id/clients/:clientId'),
    ],
    'access-changing',
  ],
  [
    `Access-changing: it changes whether and how people sign in to the tenant (the tenant itself, the sign-in flow, the domains it answers on) or creates another tenant with its own administrators; ${OWNER_APPROVAL}.`,
    [
      R('PATCH', ''),
      R('PUT', '/flow/executions'),
      R('POST', '/domains'),
      R('POST', '/domains/:id/verify'),
      R('POST', '/domains/:id/activate'),
      R('POST', '/domains/:id/deactivate'),
      'POST /admin/tenants',
    ],
    'access-changing',
  ],
  [
    `Access-changing: it puts a theme live on the pages where a person types a password or approves an application; ${OWNER_APPROVAL}.`,
    [
      R('POST', '/theme/publish'),
      R('POST', '/theme/versions/:versionId/restore'),
      R('POST', '/clients/:id/theme/publish'),
      R('POST', '/clients/:id/theme/versions/:versionId/restore'),
    ],
    'access-changing',
  ],
  [
    `Credential: it sets a password, or makes a secret, a registration token or key material that is shown once or lets its holder in; ${OWNER_APPROVAL}.`,
    [
      R('POST', '/subjects/:id/password'),
      R('POST', '/clients'),
      R('POST', '/clients/:id/secret'),
      R('POST', '/registration-tokens'),
      R('POST', '/keys'),
    ],
    'credential',
  ],
  [
    `Credential: it sets the mail relay login, or imports a tenant together with secrets; ${OWNER_APPROVAL}.`,
    [R('PUT', '/smtp'), 'POST /admin/tenant-imports'],
    'credential',
  ],
  [
    `Destructive or wide in effect (tenant delete, end every session, clear a lockout, change a signing key): ${OWNER_APPROVAL}.`,
    [
      R('DELETE', ''),
      R('DELETE', '/sessions'),
      R('DELETE', '/subjects/:id/lockout'),
      R('DELETE', '/lockouts'),
      R('POST', '/keys/:id/promote'),
      R('POST', '/keys/:id/retire'),
      R('DELETE', '/keys/:id'),
    ],
    'destructive',
  ],
  [
    `Destructive: it deletes or ends a record, a draft, a grant, a session or a credential, which another call cannot bring back as it was; ${OWNER_APPROVAL}.`,
    [
      R('DELETE', '/subjects/:id'),
      R('DELETE', '/subjects/:id/credentials/:credentialId'),
      R('DELETE', '/subjects/:id/consents/:clientId'),
      R('DELETE', '/subjects/:id/recovery-codes'),
      R('DELETE', '/subjects/:id/sessions'),
      R('DELETE', '/subjects/:id/sessions/:sid'),
      R('DELETE', '/subjects/:id/grants/:clientId'),
      R('DELETE', '/theme/draft'),
      R('DELETE', '/theme'),
      R('DELETE', '/theme/assets/:assetId'),
      R('DELETE', '/clients/:id'),
      R('DELETE', '/clients/:id/theme/draft'),
      R('DELETE', '/clients/:id/theme'),
      R('DELETE', '/clients/:id/grants'),
      R('DELETE', '/registration-tokens/:id'),
      R('DELETE', '/domains/:id'),
      R('DELETE', '/roles/:id'),
      R('DELETE', '/groups/:id'),
      R('DELETE', '/scopes/:id'),
      R('DELETE', '/smtp'),
    ],
    'destructive',
  ],
  [
    'Renders the theme as a page for a browser frame, not data an agent reads.',
    [R('GET', '/theme/preview'), R('GET', '/clients/:id/theme/preview')],
    'not-useful',
  ],
  [
    'Renders a mail template as a page for a browser frame, not data an agent reads.',
    [R('GET', '/mail/preview'), R('GET', '/clients/:id/mail/preview')],
    'not-useful',
  ],
  [
    'Personal data beyond the subject record (the profile claims: birth date, address, phone): get_subject is the read an agent is offered.',
    [R('GET', '/subjects/:id/profile')],
    'sensitive',
  ],
  [
    "Lists a subject's registered credentials (passkeys, authenticators): credential metadata, not offered to an agent.",
    [R('GET', '/subjects/:id/credentials')],
    'sensitive',
  ],
  [
    'Lists registration tokens, which are credentials that let a client register itself: not offered to an agent.',
    [R('GET', '/registration-tokens')],
    'sensitive',
  ],
  [
    'The mail relay configuration, with its host and login username: not offered to an agent; list_mail shows delivery status.',
    [R('GET', '/smtp')],
    'sensitive',
  ],
  [
    "Answers one subject's id token, access token and userinfo claims, which are personal data, under manage-clients, which does not include view-users; its open claim records have no schema to bound them.",
    [R('GET', '/clients/:id/evaluate')],
    'sensitive',
  ],
];

// Every admin route an MCP tool does not serve, with why. The coverage test
// holds this and TOOLS to the route table both ways.
export const NOT_TOOLS: Readonly<Record<string, string>> = Object.fromEntries(
  WITHHELD.flatMap(([reason, routes]) => routes.map((key) => [key, reason])),
);

export const NOT_TOOL_KINDS: Readonly<Record<string, NotToolKind>> = Object.fromEntries(
  WITHHELD.flatMap(([, routes, kind]) => routes.map((key) => [key, kind])),
);

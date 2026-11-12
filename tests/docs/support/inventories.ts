import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { documentedJsonSchema } from '../../../packages/contracts/src/admin/docs.js';
import {
  auditEventSchema,
  listAuditQuerySchema,
} from '../../../packages/contracts/src/admin/audit.js';
import {
  clientFieldsSchema,
  createClientRequestSchema,
} from '../../../packages/contracts/src/admin/clients.js';
import { groupFieldsSchema } from '../../../packages/contracts/src/admin/groups.js';
import { signingKeySchema } from '../../../packages/contracts/src/admin/keys.js';
import { mailMessageSchema } from '../../../packages/contracts/src/admin/mail.js';
import {
  mintRegistrationTokenRequestSchema,
  registrationTokenSchema,
} from '../../../packages/contracts/src/admin/registration-tokens.js';
import { roleFieldsSchema } from '../../../packages/contracts/src/admin/roles.js';
import { clientScopeSchema } from '../../../packages/contracts/src/admin/scopes.js';
import { putSmtpRequestSchema } from '../../../packages/contracts/src/admin/smtp.js';
import { subjectSchema } from '../../../packages/contracts/src/admin/subjects.js';
import { tenantSchema } from '../../../packages/contracts/src/admin/tenants.js';
import { TENANT_SETTING_NAMES } from '../../../packages/domain-tenant/src/index.js';
import { CLI_COMMANDS } from '../../../apps/server/src/cli/registry.js';
import { REPO_ROOT } from '../markdown.js';

// One thing the documentation must explain. `names` are the spellings under
// which a page may name it: any one found, as whole words and ignoring case,
// counts. `key` identifies it in tests/docs/not-documented.json.
export interface Item {
  /** True when the generated API reference already explains it. */
  readonly explained?: boolean;
  readonly inventory: string;
  readonly key: string;
  readonly names: readonly string[];
}

const CONTENT = path.join(REPO_ROOT, 'apps/docs/content/en');
const CONSOLE_SRC = path.join(REPO_ROOT, 'apps/admin-console/src');
const SCREEN_ROOTS = ['features', 'pages'].map((layer) => path.join(CONSOLE_SRC, layer));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
  );
}

// The pages a person writes. The generated reference and the transcripts name
// every field by construction, so a name found only there is not explained.
export function writtenPages(): { readonly file: string; readonly text: string }[] {
  return walk(CONTENT)
    .filter((file) => /\.mdx?$/u.test(file))
    .filter((file) => !/\/reference\/(generated|transcripts)\//u.test(file))
    .map((file) => ({ file: path.relative(CONTENT, file), text: readFileSync(file, 'utf8') }));
}

const NOISE = /^(loading|checking|reading|move \$|any )|\$\{| sections$/iu;

// Every label a console screen shows: `label="…"` on a control, `label: '…'`
// in a section table, and the FIELD, SECTION and tab-label constants.
function consoleLabels(): Item[] {
  const found = new Map<string, Item>();
  const files = SCREEN_ROOTS.flatMap((root) =>
    walk(root).filter((file) => /\.tsx?$/u.test(file) && !file.includes('.test.')),
  );
  for (const file of files) {
    const feature = path.relative(CONSOLE_SRC, file).split(path.sep)[1] ?? '';
    const source = readFileSync(file, 'utf8');
    const visible = source
      .split('\n')
      .filter((line) => !/<(LiveMessage|LastAction|CopyValue)\b/u.test(line))
      .join('\n')
      .replaceAll('aria-label', 'aria');
    const labels = [
      ...[...visible.matchAll(/\blabel(?:=|:\s*)\s*\{?\s*['"]([^'"\n]+)['"]/gu)].map((m) => m[1]),
      ...[
        ...source.matchAll(/\b(?:FIELD|SECTION|[A-Z_]*TAB_LABELS)\b[^=]*=\s*\{([^}]*)\}/gu),
      ].flatMap((block) =>
        [...(block[1] ?? '').matchAll(/:\s*['"]([^'"\n]+)['"]/gu)].map((m) => m[1]),
      ),
    ];
    for (const label of labels) {
      if (label === undefined || NOISE.test(label) || label.length < 3) continue;
      const key = `${feature}: ${label}`;
      found.set(key, { inventory: 'console-labels', key, names: [label] });
    }
  }
  return [...found.values()];
}

function shapeKeys(schema: unknown): string[] {
  return Object.keys((schema as { shape: Record<string, unknown> }).shape);
}

// Fields every record carries or that only join one record to another.
const PLUMBING = new Set([
  'id',
  'tenant_id',
  'created_at',
  'updated_at',
  'next',
  'items',
  'cursor',
  'limit',
]);

const CONTRACTS: readonly (readonly [string, unknown])[] = [
  ['client', clientFieldsSchema],
  ['create client', createClientRequestSchema],
  ['group', groupFieldsSchema],
  ['role', roleFieldsSchema],
  ['scope', clientScopeSchema],
  ['subject', subjectSchema],
  ['signing key', signingKeySchema],
  ['registration token', registrationTokenSchema],
  ['mint registration token', mintRegistrationTokenRequestSchema],
  ['smtp relay', putSmtpRequestSchema],
  ['mail message', mailMessageSchema],
  ['audit event', auditEventSchema],
  ['audit filter', listAuditQuerySchema],
  ['tenant', tenantSchema],
];

function contractFields(): Item[] {
  const found = new Map<string, Item>();
  for (const [entity, schema] of CONTRACTS) {
    for (const field of shapeKeys(schema)) {
      if (PLUMBING.has(field)) continue;
      const key = `${entity}.${field}`;
      const described = documentedJsonSchema(schema as Parameters<typeof documentedJsonSchema>[0])
        .properties?.[field];
      found.set(key, {
        inventory: 'contract-fields',
        key,
        explained: typeof described === 'object' && (described.description ?? '').length > 0,
        names: [field, field.replaceAll('_', ' ')],
      });
    }
  }
  return [...found.values()];
}

// The console's label for each setting, from the tables that build its form.
function settingLabels(): Map<string, string> {
  const labels = new Map<string, string>();
  for (const file of ['accessSections.ts', 'platformSections.ts']) {
    const source = readFileSync(path.join(CONSOLE_SRC, 'pages/settings/services', file), 'utf8');
    for (const m of source.matchAll(/name:\s*'([a-z_]+)',\s*label:\s*'([^'\n]+)'/gu)) {
      labels.set(m[1] ?? '', m[2] ?? '');
    }
  }
  return labels;
}

// Settings whose control is built outside the settings tables.
const ALIAS: Readonly<Record<string, readonly string[]>> = {
  otp_required: ['Ask every subject for a one-time password'],
};

function tenantSettings(): Item[] {
  const labels = settingLabels();
  return TENANT_SETTING_NAMES.map((name) => ({
    inventory: 'tenant-settings',
    key: name,
    names: [
      name,
      name.replaceAll('_', ' '),
      ...(labels.has(name) ? [labels.get(name) ?? ''] : []),
      ...(ALIAS[name] ?? []),
    ],
  }));
}

function cliCommands(): Item[] {
  return CLI_COMMANDS.flatMap((command) => [
    { inventory: 'cli-commands', key: command.name, names: [`odudu ${command.name}`] },
    ...command.subcommands.map((sub) => ({
      inventory: 'cli-commands',
      key: `${command.name} ${sub.name}`,
      names: [`${command.name} ${sub.name}`, `odudu ${command.name} ${sub.name}`],
    })),
  ]);
}

// Each renderer file in a package's view layer is one kind of page. The aliases
// are what a page of documentation calls it; a renderer added without a row
// here fails pageKindsAreListed.
export const PAGE_KIND_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'registration-html': ['create an account', 'self-registration'],
  'required-actions-html': ['required action'],
  'reset-html': ['reset your password', 'password reset', 'forgot password'],
  'verification-html': ['verify your email', 'verification link', 'confirm your email'],
  'passkey-enrolment-html': ['passkey'],
  'recovery-codes-html': ['recovery code'],
  'required-action-html': ['required action'],
  'totp-enrolment-html': ['authenticator app', 'one-time password'],
  'update-password-html': ['change your password', 'choose a new password', 'update your password'],
  'refusal-html': ['refusal page', 'refused'],
  'authorize-html': ['sign-in page', 'sign in page', 'login page'],
  'consent-html': ['consent screen', 'consent page'],
  'logout-html': ['signed out', 'sign-out page', 'logout page'],
  'not-found-html': ['not found', '404'],
  'select-account-html': ['select account', 'choose an account', 'select_account'],
  'server-error-html': ['server error', 'something went wrong'],
  'throttled-html': ['too many attempts', 'throttled'],
  'previous-address-html': ['previous address', 'address has moved'],
};

export function pageKindFiles(): string[] {
  return ['account', 'authn-flows', 'console-gateway', 'protocol-oidc'].flatMap((pkg) =>
    readdirSync(path.join(REPO_ROOT, 'packages', pkg, 'src/view'))
      .filter((name) => name.endsWith('-html.ts'))
      .map((name) => name.replace(/\.ts$/u, '')),
  );
}

function pageKinds(): Item[] {
  return [...new Set(pageKindFiles())].map((stem) => ({
    inventory: 'server-pages',
    key: stem,
    names: PAGE_KIND_ALIASES[stem] ?? [stem],
  }));
}

// Parameters and endpoints a developer integrating an application meets. Each
// literal is checked against the protocol source, so a name here is real.
export const PROTOCOL_TERMS: readonly (readonly [string, string])[] = [
  ['authorization endpoint', 'authorization_endpoint'],
  ['token endpoint', 'token_endpoint'],
  ['userinfo endpoint', 'userinfo_endpoint'],
  ['jwks endpoint', 'jwks_uri'],
  ['revocation endpoint', 'revocation_endpoint'],
  ['introspection endpoint', 'introspection_endpoint'],
  ['end session endpoint', 'end_session_endpoint'],
  ['registration endpoint', 'registration_endpoint'],
  ['discovery document', 'openid-configuration'],
  ['client_id', 'client_id'],
  ['redirect_uri', 'redirect_uri'],
  ['response_type', 'response_type'],
  ['scope', 'scope'],
  ['state', 'state'],
  ['nonce', 'nonce'],
  ['code_challenge', 'code_challenge'],
  ['code_challenge_method', 'code_challenge_method'],
  ['code_verifier', 'code_verifier'],
  ['prompt', 'prompt'],
  ['max_age', 'max_age'],
  ['id_token_hint', 'id_token_hint'],
  ['grant_type', 'grant_type'],
  ['refresh_token', 'refresh_token'],
  ['client_assertion', 'client_assertion'],
  ['client_assertion_type', 'client_assertion_type'],
  ['post_logout_redirect_uri', 'post_logout_redirect_uri'],
  ['subject_token', 'subject_token'],
  ['audience', 'audience'],
  ['request_uri', 'request_uri'],
  ['claims', 'claims'],
  ['ui_locales', 'ui_locales'],
  ['response_mode', 'response_mode'],
  ['action', 'action'],
  ['action_status', 'action_status'],
];

function protocolTerms(): Item[] {
  return PROTOCOL_TERMS.map(([name]) => ({
    inventory: 'protocol-terms',
    key: name,
    names: [name, name.replaceAll('_', ' ')],
  }));
}

// What a newcomer asks about, each with the words a page may use for it.
export const CONCEPT_TERMS: readonly (readonly [string, readonly string[]])[] = [
  ['tenant', ['tenant']],
  ['subject', ['subject']],
  ['client', ['client']],
  ['scope', ['scope']],
  ['role', ['role']],
  ['group', ['group']],
  ['session', ['session']],
  ['token', ['access token']],
  ['consent', ['consent']],
  ['audit', ['audit trail', 'audit event']],
  ['recovery codes', ['recovery code']],
  ['full scope', ['full_scope_allowed', 'include all roles', 'full scope']],
  ['built-in scopes', ['built-in scope']],
  ['restore built-in scopes', ['restore']],
  ['service accounts', ['service account']],
  ['client authentication methods', ['client_secret_basic', 'private_key_jwt']],
  ['idempotency', ['idempotency']],
  ['error model', ['problem+json', 'problem details']],
  ['remember me', ['remember me']],
  ['brute force and lockout', ['lockout']],
  ['retention', ['retention']],
  ['signing key rotation', ['rotate', 'rotation']],
  ['mail relay', ['smtp', 'mail relay']],
  ['backup', ['backup']],
  ['upgrade', ['upgrade']],
  ['passkeys', ['passkey']],
  ['one-time passwords', ['one-time password', 'totp']],
  ['pkce', ['pkce']],
  ['refresh token rotation', ['refresh token']],
  ['token exchange', ['token exchange']],
  ['dynamic client registration', ['dynamic client registration', 'registration token']],
  ['composite roles', ['composite']],
  ['default roles and groups', ['default role', 'default group', 'new subjects']],
  ['back-channel logout', ['back-channel logout', 'backchannel']],
  ['front-channel logout', ['front-channel logout', 'frontchannel']],
  ['multi-tenancy', ['multi-tenant', 'multi-tenancy', 'multiple tenants']],
  ['issuer', ['issuer']],
  ['discovery', ['discovery']],
  ['reverse proxy', ['reverse proxy', 'proxy']],
  ['password policy', ['password policy']],
  ['mcp', ['mcp']],
  ['kubernetes', ['kubernetes']],
  ['licence', ['licence', 'license']],
  ['vulnerability reporting', ['vulnerability', 'vulnerabilities']],
];

function conceptTerms(): Item[] {
  return CONCEPT_TERMS.map(([term, names]) => ({
    inventory: 'concept-terms',
    key: term,
    names: [...names],
  }));
}

export function inventories(): Record<string, Item[]> {
  return {
    'console-labels': consoleLabels(),
    'contract-fields': contractFields(),
    'tenant-settings': tenantSettings(),
    'cli-commands': cliCommands(),
    'server-pages': pageKinds(),
    'protocol-terms': protocolTerms(),
    'concept-terms': conceptTerms(),
  };
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export function mentions(text: string, names: readonly string[]): boolean {
  return names.some((name) =>
    new RegExp(`(?<![A-Za-z0-9_])${escape(name)}(?![A-Za-z0-9_])`, 'iu').test(text),
  );
}

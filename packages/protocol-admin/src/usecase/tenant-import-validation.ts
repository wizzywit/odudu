import { startsALogin } from '@odudu/authn-flows';
import {
  EXPORT_SUBJECT_CAP,
  smtpPortSchema,
  tenantDocumentSchema,
  type ExportedClient,
  type ImportError,
  type RoleReference,
  type TenantDocument,
} from '@odudu/contracts/admin';
import { isEmailAddress, isValidE164 } from '@odudu/domain-identity';
import {
  ADMIN_CLIENT_ID,
  capabilityRoleGraph,
  isReservedTenantName,
  isValidTenantName,
  TENANT_DEFAULT_SCOPE_NAMES,
  TENANT_NAME_RULE,
  tenantSettingProblems,
} from '@odudu/domain-tenant';
import {
  clientTokenTtlProblem,
  isWellFormedWebOrigin,
  parseClientMetadata,
  type ClientMetadata,
} from '@odudu/protocol-oidc';
import { validateFlowSteps } from '#/service/flow-validation';
import { CLAIM_KEY, PHONE_E164_MESSAGE, shapeInvalidityFor } from '#/usecase/profile';
import { tooManySubjectsDetail } from '#/usecase/tenant-export';

export interface ImportEnvironment {
  readonly knownMappers: readonly string[];
  readonly knownAuthenticators: readonly string[];
  readonly tlsClientAuthEnabled: boolean;
  /** The caller's own admin-client role names, the ceiling on what an import may grant. */
  readonly callerCapabilities: ReadonlySet<string>;
}

export type ValidateImportOutcome =
  | { readonly kind: 'invalid'; readonly errors: readonly ImportError[] }
  | {
      readonly kind: 'valid';
      readonly document: TenantDocument;
      /** Each client's metadata as `parseClientMetadata` narrowed it, by `client_id`. */
      readonly metadata: ReadonlyMap<string, ClientMetadata>;
    };

// client_scopes_name_check (0016_client_scopes.sql): RFC 6749 §3.3's scope-token.
const SCOPE_NAME = /^[\x21\x23-\x5B\x5D-\x7E]+$/u;
const GROUP_PATH = /^(?:\/[^/]+)+$/u;

export function roleKey(reference: RoleReference): string {
  return `${reference.client ?? ''}\u0000${reference.name}`;
}

function describeRole(reference: RoleReference): string {
  return reference.client === null ? reference.name : `${reference.client}:${reference.name}`;
}

function pathOf(segments: readonly PropertyKey[]): string {
  return segments.reduce<string>(
    (path, segment) =>
      typeof segment === 'number' ? `${path}[${String(segment)}]` : `${path}.${String(segment)}`,
    'document',
  );
}

function metadataInput(client: ExportedClient): Record<string, unknown> {
  const optional: Record<string, unknown> = {
    jwks: client.jwks,
    jwks_uri: client.jwks_uri,
    frontchannel_logout_uri: client.frontchannel_logout_uri,
    backchannel_logout_uri: client.backchannel_logout_uri,
    userinfo_signed_response_alg: client.userinfo_signed_response_alg,
    userinfo_encrypted_response_alg: client.userinfo_encrypted_response_alg,
    userinfo_encrypted_response_enc: client.userinfo_encrypted_response_enc,
    tls_client_auth_subject_dn: client.tls_client_auth_subject_dn,
  };
  return {
    redirect_uris: client.redirect_uris,
    grant_types: client.grant_types,
    token_endpoint_auth_method: client.token_endpoint_auth_method,
    backchannel_logout_session_required: client.backchannel_logout_session_required,
    frontchannel_logout_session_required: client.frontchannel_logout_session_required,
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== null)),
  };
}

class Problems {
  readonly list: ImportError[] = [];
  add(path: string, message: string): void {
    this.list.push({ path, message });
  }
}

function nameProblems(name: string, problems: Problems): void {
  if (!isValidTenantName(name)) problems.add('name', TENANT_NAME_RULE);
  else if (isReservedTenantName(name)) {
    problems.add('name', `the name ${JSON.stringify(name)} is reserved`);
  }
}

// Each name, keyed, to the index of its first occurrence; a later repeat is
// reported against that first one.
function indexUnique<T>(
  items: readonly T[],
  key: (item: T) => string,
  path: (index: number) => string,
  what: (item: T) => string,
  problems: Problems,
): Map<string, number> {
  const seen = new Map<string, number>();
  items.forEach((item, index) => {
    const first = seen.get(key(item));
    if (first === undefined) seen.set(key(item), index);
    else problems.add(path(index), `${what(item)} repeats ${path(first)}`);
  });
  return seen;
}

/**
 * The role graph a new tenant would hold: the document's roles over the
 * capability roles provisioning creates, with both sets of composites.
 */
class RoleGraph {
  private readonly edges = new Map<string, Set<string>>();
  private readonly known = new Set<string>();

  constructor(document: TenantDocument) {
    const provisioned = capabilityRoleGraph();
    for (const name of provisioned.roles)
      this.known.add(roleKey({ name, client: ADMIN_CLIENT_ID }));
    for (const [parent, child] of provisioned.composites) {
      this.link(
        roleKey({ name: parent, client: ADMIN_CLIENT_ID }),
        roleKey({ name: child, client: ADMIN_CLIENT_ID }),
      );
    }
    for (const role of document.roles) {
      const parent = roleKey(role);
      this.known.add(parent);
      for (const child of role.composites) this.link(parent, roleKey(child));
    }
  }

  private link(parent: string, child: string): void {
    const children = this.edges.get(parent) ?? new Set<string>();
    children.add(child);
    this.edges.set(parent, children);
  }

  has(reference: RoleReference): boolean {
    return this.known.has(roleKey(reference));
  }

  /** Every role `from` reaches through composites, each of `from` included. */
  reach(from: readonly RoleReference[]): Set<string> {
    const reached = new Set<string>();
    const pending = from.map(roleKey);
    for (let key = pending.pop(); key !== undefined; key = pending.pop()) {
      if (reached.has(key)) continue;
      reached.add(key);
      for (const child of this.edges.get(key) ?? []) pending.push(child);
    }
    return reached;
  }

  /** The admin capabilities `from` reaches, by name. */
  capabilities(from: readonly RoleReference[]): string[] {
    const prefix = `${ADMIN_CLIENT_ID}\u0000`;
    return [...this.reach(from)]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort();
  }
}

function roleProblems(document: TenantDocument, graph: RoleGraph, problems: Problems): void {
  const provisioned = capabilityRoleGraph();
  const builtinNames = new Set(provisioned.roles);
  const clientIds = new Set(document.clients.map((client) => client.client_id));
  indexUnique(
    document.roles,
    roleKey,
    (index) => `document.roles[${String(index)}]`,
    (role) => `the role ${describeRole(role)}`,
    problems,
  );

  document.roles.forEach((role, index) => {
    const path = `document.roles[${String(index)}]`;
    if (role.builtin) {
      if (role.client !== ADMIN_CLIENT_ID || !builtinNames.has(role.name)) {
        problems.add(
          path,
          `${describeRole(role)} is marked builtin, but a new tenant provisions no such role`,
        );
      }
    } else if (role.client === ADMIN_CLIENT_ID) {
      problems.add(
        path,
        `a document cannot create a role on ${ADMIN_CLIENT_ID}: its roles are the capabilities a new tenant provisions`,
      );
    } else if (role.client !== null && !clientIds.has(role.client)) {
      problems.add(`${path}.client`, `names no client ${role.client} in the document`);
    }
    if (!role.builtin && (role.name === '' || role.name.includes(':'))) {
      problems.add(`${path}.name`, 'a role name is not empty and holds no colon');
    }
    role.composites.forEach((child, childIndex) => {
      if (!graph.has(child)) {
        problems.add(
          `${path}.composites[${String(childIndex)}]`,
          `names no role ${describeRole(child)}`,
        );
      }
    });
    if (graph.reach(role.composites).has(roleKey(role))) {
      problems.add(`${path}.composites`, `${describeRole(role)} would reach itself through them`);
    }
    if (role.builtin && role.client === ADMIN_CLIENT_ID) {
      const provisionedChildren = new Set(
        provisioned.composites
          .filter(([parent]) => parent === role.name)
          .map(([, child]) => roleKey({ name: child, client: ADMIN_CLIENT_ID })),
      );
      role.composites.forEach((child, childIndex) => {
        if (provisionedChildren.has(roleKey(child))) return;
        problems.add(
          `${path}.composites[${String(childIndex)}]`,
          `nests ${describeRole(child)} under ${role.name}, which a new tenant provisions without it: nothing is nested under a capability role`,
        );
      });
      const kept = new Set(role.composites.map(roleKey));
      for (const [parent, child] of provisioned.composites) {
        if (parent !== role.name) continue;
        if (!kept.has(roleKey({ name: child, client: ADMIN_CLIENT_ID }))) {
          problems.add(
            `${path}.composites`,
            `leaves out ${child}, which a capability role keeps: removing it would strip it from every holder`,
          );
        }
      }
    }
  });
}

function referenceProblems(
  references: readonly RoleReference[],
  path: string,
  graph: RoleGraph,
  problems: Problems,
): void {
  references.forEach((reference, index) => {
    if (!graph.has(reference)) {
      problems.add(`${path}[${String(index)}]`, `names no role ${describeRole(reference)}`);
    }
  });
}

function groupProblems(document: TenantDocument, graph: RoleGraph, problems: Problems): void {
  const paths = indexUnique(
    document.groups,
    (group) => group.path,
    (index) => `document.groups[${String(index)}]`,
    (group) => `the group ${group.path}`,
    problems,
  );
  document.groups.forEach((group, index) => {
    const path = `document.groups[${String(index)}]`;
    if (!GROUP_PATH.test(group.path)) {
      problems.add(`${path}.path`, 'a group path is one or more /-separated, non-empty names');
    } else {
      const parent = group.path.slice(0, group.path.lastIndexOf('/'));
      if (parent !== '' && !paths.has(parent)) {
        problems.add(`${path}.path`, `its parent ${parent} is not in the document`);
      }
    }
    referenceProblems(group.roles, `${path}.roles`, graph, problems);
  });
}

function scopeProblems(
  document: TenantDocument,
  graph: RoleGraph,
  environment: ImportEnvironment,
  problems: Problems,
): void {
  const defaults = new Set(TENANT_DEFAULT_SCOPE_NAMES);
  const mappers = new Set(environment.knownMappers);
  const clientIds = new Set(document.clients.map((client) => client.client_id));
  const names = indexUnique(
    document.scopes,
    (scope) => scope.name,
    (index) => `document.scopes[${String(index)}]`,
    (scope) => `the scope ${scope.name}`,
    problems,
  );
  // Deleting `openid` takes it off the built-in admin client too, which
  // locks every administrator out (`deleteScope`, #/usecase/scopes.ts).
  if (!names.has('openid')) {
    problems.add('document.scopes', 'openid is missing, and a tenant cannot be without it');
  }
  document.scopes.forEach((scope, index) => {
    const path = `document.scopes[${String(index)}]`;
    if (scope.builtin && !defaults.has(scope.name)) {
      problems.add(
        path,
        `${scope.name} is marked builtin, but a new tenant provisions no such scope`,
      );
    }
    if (!scope.builtin && defaults.has(scope.name)) {
      problems.add(path, `${scope.name} is provisioned by every new tenant, so it is builtin`);
    }
    if (!SCOPE_NAME.test(scope.name)) {
      problems.add(`${path}.name`, 'a scope name is an RFC 6749 scope-token');
    }
    referenceProblems(scope.roles, `${path}.roles`, graph, problems);
    scope.mappers.forEach((mapper, mapperIndex) => {
      if (!mappers.has(mapper)) {
        problems.add(`${path}.mappers[${String(mapperIndex)}]`, `names no claim mapper ${mapper}`);
      }
    });
    indexUnique(
      scope.clients,
      (entry) => entry.client_id,
      (clientIndex) => `${path}.clients[${String(clientIndex)}]`,
      (entry) => `the assignment to ${entry.client_id}`,
      problems,
    );
    scope.clients.forEach((entry, clientIndex) => {
      if (!clientIds.has(entry.client_id)) {
        problems.add(
          `${path}.clients[${String(clientIndex)}]`,
          `names no client ${entry.client_id} in the document`,
        );
      }
    });
  });
}

function subjectProblems(document: TenantDocument, graph: RoleGraph, problems: Problems): void {
  const subjects = document.subjects ?? [];
  if (subjects.length > EXPORT_SUBJECT_CAP) {
    problems.add('document.subjects', tooManySubjectsDetail(EXPORT_SUBJECT_CAP));
  }
  const groupPaths = new Set(document.groups.map((group) => group.path));
  indexUnique(
    subjects,
    (subject) => subject.username,
    (index) => `document.subjects[${String(index)}].username`,
    (subject) => `the username ${subject.username}`,
    problems,
  );
  indexUnique(
    subjects.filter((subject) => subject.email !== null),
    (subject) => subject.email ?? '',
    (index) => `document.subjects[${String(index)}].email`,
    () => 'the email address',
    problems,
  );
  subjects.forEach((subject, index) => {
    const path = `document.subjects[${String(index)}]`;
    if (subject.username === '') problems.add(`${path}.username`, 'a username is not empty');
    if (subject.email !== null && !isEmailAddress(subject.email)) {
      problems.add(`${path}.email`, 'is not an address the email claim may carry');
    }
    referenceProblems(subject.roles, `${path}.roles`, graph, problems);
    subject.groups.forEach((group, groupIndex) => {
      if (!groupPaths.has(group)) {
        problems.add(`${path}.groups[${String(groupIndex)}]`, `names no group ${group}`);
      }
    });
    for (const [field, value] of Object.entries(subject.profile)) {
      if (typeof value !== 'string' || CLAIM_KEY[field] === undefined) continue;
      const invalidity = shapeInvalidityFor(field, value);
      if (invalidity !== null) problems.add(`${path}.profile.${field}`, invalidity);
    }
    const phone = subject.profile.phone_number;
    if (subject.profile.phone_number_verified && (phone === null || !isValidE164(phone))) {
      problems.add(`${path}.profile.phone_number`, PHONE_E164_MESSAGE);
    }
  });
}

function flowAndSmtpProblems(
  document: TenantDocument,
  environment: ImportEnvironment,
  problems: Problems,
): void {
  const flow = validateFlowSteps(document.flow, environment.knownAuthenticators);
  if (flow.kind === 'empty') problems.add('document.flow', 'a flow has at least one step');
  if (flow.kind === 'unresolvable_authenticator') {
    problems.add('document.flow', `names no authenticator ${flow.name}`);
  }
  if (flow.kind === 'duplicate_authenticator') {
    problems.add('document.flow', `names ${flow.name} more than once`);
  }
  if (flow.kind === 'no_enabled_step') problems.add('document.flow', 'every step is disabled');
  if (flow.kind === 'ok' && !startsALogin(document.flow)) {
    problems.add('document.flow', 'no step can render the first challenge of a login');
  }

  const smtp = document.smtp;
  if (smtp === null) return;
  if (smtp.host === '') problems.add('document.smtp.host', 'is empty');
  if (!smtpPortSchema.safeParse(smtp.port).success) {
    problems.add('document.smtp.port', 'is not a port');
  }
  if (smtp.from_address === '') problems.add('document.smtp.from_address', 'is empty');
  if (smtp.username === '') problems.add('document.smtp.username', 'is empty; use null');
  if (smtp.username !== null && !smtp.starttls) {
    problems.add(
      'document.smtp.starttls',
      'starttls must be true when a username or password is configured',
    );
  }
}

function clientProblems(
  document: TenantDocument,
  graph: RoleGraph,
  environment: ImportEnvironment,
  problems: Problems,
): Map<string, ClientMetadata> {
  const metadata = new Map<string, ClientMetadata>();
  indexUnique(
    document.clients,
    (client) => client.client_id,
    (index) => `document.clients[${String(index)}].client_id`,
    (client) => `the client_id ${client.client_id}`,
    problems,
  );
  // `lockCapacity` (@odudu/domain-tenant) counts the built-in admin client too.
  if (document.clients.length + 1 > document.settings.max_clients) {
    problems.add(
      'document.clients',
      `max_clients is ${String(document.settings.max_clients)}, which admits ` +
        `${String(document.settings.max_clients - 1)} clients besides ${ADMIN_CLIENT_ID}`,
    );
  }
  document.clients.forEach((client, index) => {
    const path = `document.clients[${String(index)}]`;
    if (client.client_id === ADMIN_CLIENT_ID) {
      problems.add(`${path}.client_id`, `${ADMIN_CLIENT_ID} is provisioned by every new tenant`);
    }
    if (client.client_id === '') problems.add(`${path}.client_id`, 'is empty');
    const parsed = parseClientMetadata(metadataInput(client), {
      tlsClientAuthEnabled: environment.tlsClientAuthEnabled,
    });
    if (parsed.kind === 'invalid') {
      const at = parsed.field === undefined ? path : `${path}.${parsed.field}`;
      problems.add(at, parsed.description);
    } else {
      metadata.set(client.client_id, parsed.metadata);
      const type = parsed.metadata.tokenEndpointAuthMethod === 'none' ? 'public' : 'confidential';
      if (client.type !== type) {
        problems.add(
          `${path}.type`,
          `token_endpoint_auth_method ${parsed.metadata.tokenEndpointAuthMethod} makes it ${type}`,
        );
      }
    }
    for (const field of ['access_token_ttl_seconds', 'refresh_token_ttl_seconds'] as const) {
      const outOfRange = clientTokenTtlProblem(field, client[field]);
      if (outOfRange !== null) problems.add(`${path}.${field}`, outOfRange);
    }
    client.web_origins.forEach((origin, originIndex) => {
      if (!isWellFormedWebOrigin(origin)) {
        problems.add(`${path}.web_origins[${String(originIndex)}]`, 'is not an origin');
      }
    });
    referenceProblems(
      client.service_account_roles,
      `${path}.service_account_roles`,
      graph,
      problems,
    );
    if (client.type === 'public' && client.service_account_roles.length > 0) {
      problems.add(`${path}.service_account_roles`, 'a public client has no service account');
    }
  });
  return metadata;
}

// The default-role rule (`setRoleDefault`, #/usecase/roles.ts) and the
// capability ceiling every grant through the admin API is held to.
function invariantProblems(
  document: TenantDocument,
  graph: RoleGraph,
  environment: ImportEnvironment,
  problems: Problems,
): void {
  const provisionedEdges = new Set(
    capabilityRoleGraph().composites.map(
      ([parent, child]) =>
        `${roleKey({ name: parent, client: ADMIN_CLIENT_ID })}>${roleKey({ name: child, client: ADMIN_CLIENT_ID })}`,
    ),
  );
  const ceiling = (references: readonly RoleReference[], path: string): void => {
    const denied = graph
      .capabilities(references)
      .filter((capability) => !environment.callerCapabilities.has(capability));
    if (denied.length > 0) {
      problems.add(path, `grants ${denied.join(', ')}, which the caller does not hold`);
    }
  };

  document.roles.forEach((role, index) => {
    const path = `document.roles[${String(index)}]`;
    if (role.default_for_new_subjects) {
      const reached = graph.capabilities([role]);
      if (reached.length > 0) {
        problems.add(
          `${path}.default_for_new_subjects`,
          `a role every new subject receives reaches ${reached.join(', ')}`,
        );
      }
    }
    role.composites.forEach((child, childIndex) => {
      if (provisionedEdges.has(`${roleKey(role)}>${roleKey(child)}`)) return;
      ceiling([child], `${path}.composites[${String(childIndex)}]`);
    });
  });
  document.groups.forEach((group, index) => {
    ceiling(group.roles, `document.groups[${String(index)}].roles`);
  });
  document.scopes.forEach((scope, index) => {
    ceiling(scope.roles, `document.scopes[${String(index)}].roles`);
  });
  document.clients.forEach((client, index) => {
    ceiling(
      client.service_account_roles,
      `document.clients[${String(index)}].service_account_roles`,
    );
  });
  (document.subjects ?? []).forEach((subject, index) => {
    ceiling(subject.roles, `document.subjects[${String(index)}].roles`);
  });
}

/**
 * Everything an import can be refused for, decided before anything is
 * written and reported together, each problem with its path: the schema,
 * then every cross-reference and setting range, then each client through
 * `parseClientMetadata` and its token lifetimes, then the rules the admin
 * API holds every write to.
 */
export function validateTenantImport(
  name: string,
  candidate: unknown,
  environment: ImportEnvironment,
): ValidateImportOutcome {
  const problems = new Problems();
  nameProblems(name, problems);

  const parsed = tenantDocumentSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.add(pathOf(issue.path), issue.message);
    return { kind: 'invalid', errors: problems.list };
  }
  const document = parsed.data;
  const graph = new RoleGraph(document);

  roleProblems(document, graph, problems);
  groupProblems(document, graph, problems);
  scopeProblems(document, graph, environment, problems);
  subjectProblems(document, graph, problems);
  for (const problem of tenantSettingProblems(document.settings)) {
    problems.add(`document.settings.${problem.name}`, problem.message);
  }
  flowAndSmtpProblems(document, environment, problems);
  const metadata = clientProblems(document, graph, environment, problems);
  invariantProblems(document, graph, environment, problems);

  return problems.list.length > 0
    ? { kind: 'invalid', errors: problems.list }
    : { kind: 'valid', document, metadata };
}

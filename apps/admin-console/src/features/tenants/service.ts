import { isTenantName, TENANT_NAME_RULE } from '@odudu/contracts';
import { TENANT_IMPORT_BODY_LIMIT, type ImportError, type Tenant } from '@odudu/contracts/admin';
import type { Crumb } from '#/shared/service/breadcrumb.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';
import type { GatewayFailure, Problem } from '#/shared/service/result.ts';

export type { Tenant };

export const NAME_RULE = `${TENANT_NAME_RULE.charAt(0).toUpperCase()}${TENANT_NAME_RULE.slice(1)}.`;

export function nameProblem(name: string): string | null {
  if (name === '') return 'Enter a name for the tenant.';
  return isTenantName(name) ? null : NAME_RULE;
}

const SYSTEM_ISSUER_TAIL = '/tenants/system';

// Every tenant's issuer is the public base's `/tenants/<name>`, so the one
// the console can read, the system tenant's, shows where a new one will be.
export function issuerPreview(systemIssuer: string | undefined, name: string): string | null {
  if (systemIssuer?.endsWith(SYSTEM_ISSUER_TAIL) !== true || !isTenantName(name)) return null;
  return `${systemIssuer.slice(0, -SYSTEM_ISSUER_TAIL.length)}/tenants/${name}`;
}

// The UTC day, so one export taken twice in an evening is named the same
// wherever the person is.
export function exportFileName(tenant: string, now: Date): string {
  return `${tenant}-${now.toISOString().slice(0, 10)}.odudu-tenant.json`;
}

export const EXPORT_MEDIA_TYPE = 'application/vnd.odudu.tenant+json';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsed(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

// What an export says it left out, by JSON path; read only to show it, since
// the file saved is the text as the server sent it.
export function omittedOf(text: string): readonly string[] {
  const document = parsed(text);
  if (!isRecord(document)) return [];
  const omitted = document.omitted;
  return Array.isArray(omitted)
    ? omitted.filter((path): path is string => typeof path === 'string')
    : [];
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function importFileProblem(bytes: number): string | null {
  if (bytes <= TENANT_IMPORT_BODY_LIMIT) return null;
  return `The file is larger than ${fileSize(TENANT_IMPORT_BODY_LIMIT)}, the most an import accepts.`;
}

export type ParsedDocument = { ok: true; document: unknown } | { ok: false; message: string };

export function parseDocument(text: string): ParsedDocument {
  const document = parsed(text);
  return document === undefined
    ? { ok: false, message: 'The file is not JSON, so it cannot be a tenant document.' }
    : { ok: true, document };
}

export interface ImportedSecret {
  clientId: string;
  secret: string;
}

export type ImportOutcome =
  | { ok: true; tenant: Tenant; secrets: number }
  | { ok: false; kind: 'file'; message: string }
  | { ok: false; kind: 'refused'; failure: GatewayFailure };

// What looking for the tenant after a lost answer found.
export type Found = { tenant: string } | { missing: string };

export function foundOf(tenant: Pick<Tenant, 'name'> | null, name: string): Found {
  return tenant === null ? { missing: name } : { tenant: tenant.name };
}

export interface ChosenFile {
  name: string;
  size: string;
}

export function chosenFileOf(file: { name: string; size: number } | null): ChosenFile | null {
  return file === null ? null : { name: file.name, size: fileSize(file.size) };
}

// Chosen from the picker: nothing chosen is nothing wrong yet.
export function fileChosenProblem(file: { size: number } | null): string | null {
  return file === null ? null : importFileProblem(file.size);
}

export function fileRequiredProblem(file: { size: number } | null): string | null {
  return file === null ? 'Choose a tenant document to import.' : importFileProblem(file.size);
}

// Most often a reverse proxy's own limit, lower than the import route's.
const TOO_LARGE =
  'The server, or a proxy in front of it, refused a body this large; see the deployment note on body limits.';

const IMPORT_NETWORK =
  'Could not confirm the import. It was not sent again, since its client secrets are shown only once; check whether the tenant exists.';

function refusedImport(outcome: ImportOutcome | null): GatewayFailure | null {
  return outcome !== null && !outcome.ok && outcome.kind === 'refused' ? outcome.failure : null;
}

function importProblem(outcome: ImportOutcome | null): Problem | null {
  const failure = refusedImport(outcome);
  return failure?.kind === 'problem' ? failure.problem : null;
}

// Every problem the import found in the document, each at its JSON path.
export function importErrors(outcome: ImportOutcome | null): readonly ImportError[] {
  const problem = importProblem(outcome);
  return problem?.status === 400 ? (problem.errors ?? []) : [];
}

export function importNameError(outcome: ImportOutcome | null): string | undefined {
  const problem = importProblem(outcome);
  if (problem?.status === 409) return problem.detail ?? problem.title;
  return importErrors(outcome).find((error) => error.path === 'name')?.message;
}

export function importFileRefusal(outcome: ImportOutcome | null): string | undefined {
  return outcome !== null && !outcome.ok && outcome.kind === 'file' ? outcome.message : undefined;
}

// The tenant that now exists, whether the import said so or a look afterwards did.
export function importedTenantOf(
  outcome: ImportOutcome | null,
  found: Found | null,
): string | null {
  if (outcome?.ok === true) return outcome.tenant.name;
  return found !== null && 'tenant' in found ? found.tenant : null;
}

export function importUnconfirmed(outcome: ImportOutcome | null, found: Found | null): boolean {
  return refusedImport(outcome)?.kind === 'network' && importedTenantOf(outcome, found) === null;
}

export function importMessage(outcome: ImportOutcome | null, found: Found | null): string | null {
  if (importedTenantOf(outcome, found) !== null) return null;
  if (found !== null && 'missing' in found)
    return `${found.missing} was not imported. Import it again.`;
  const failure = refusedImport(outcome);
  if (failure === null) return null;
  if (failure.kind === 'network') return IMPORT_NETWORK;
  if (failure.kind !== 'problem') {
    return 'The import could not be read back. This is a fault in the console; check whether the tenant exists.';
  }
  const { problem } = failure;
  if (problem.status === 403) return 'Importing a tenant needs the manage-tenants capability.';
  if (problem.status === 413) return TOO_LARGE;
  return problem.detail ?? problem.title;
}

export function secretPlace(outcome: ImportOutcome | null, shown: number): string {
  return outcome?.ok === true ? `${String(shown + 1)} of ${String(outcome.secrets)}` : '';
}

// Only once every client secret has been shown does the page offer the way on.
export function importedLink(
  tenant: string | null,
  secretsLeft: boolean,
): { tenant: string; recordHref: string } | null {
  return tenant === null || secretsLeft ? null : { tenant, recordHref: tenantHref(tenant) };
}

// A tenant's guided creation, as far as it has gone. The typed values are
// kept so a reload resumes it; the one-time password never is.
export type Creation =
  | { step: 'tenant'; name: string; displayName: string }
  | {
      step: 'administrator';
      tenant: string;
      // Where the tenant came from, which decides what the page says of it.
      origin: 'created' | 'imported' | 'existing';
      username: string;
      email: string;
      subjectId: string | null;
      granted: boolean;
      // What the grant gives: tenant-admin, or a set of capabilities.
      holdings: readonly string[];
    }
  | { step: 'done'; tenant: string; username: string; holdings?: readonly string[] | undefined };

export const FRESH_CREATION: Creation = { step: 'tenant', name: '', displayName: '' };

export function administratorOf(
  tenant: string,
  origin: 'created' | 'imported' | 'existing',
): Creation {
  return {
    step: 'administrator',
    tenant,
    origin,
    username: '',
    email: '',
    subjectId: null,
    granted: false,
    holdings: ['tenant-admin'],
  };
}

// Creating a tenant, adding an administrator to one existing tenant, and
// adding one of system's own: each flow keeps its own progress, so a page
// only ever resumes its own.
export type CreationFlow = 'tenant' | 'system-administrator' | `administrator/${string}`;

export function flowOf(tenant: string): CreationFlow {
  return tenant === SYSTEM_TENANT ? 'system-administrator' : `administrator/${tenant}`;
}

function tenantOf(flow: CreationFlow): string | null {
  if (flow === 'tenant') return null;
  return flow === 'system-administrator' ? SYSTEM_TENANT : flow.slice('administrator/'.length);
}

export function freshCreation(flow: CreationFlow): Creation {
  const tenant = tenantOf(flow);
  return tenant === null ? FRESH_CREATION : administratorOf(tenant, 'existing');
}

// A tenant's creation carries on into the administrator of the tenant it created.
export function belongsTo(flow: CreationFlow, creation: Creation): boolean {
  const tenant = tenantOf(flow);
  if (creation.step === 'tenant') return tenant === null;
  if (tenant !== null) return creation.tenant === tenant;
  return (
    creation.tenant !== SYSTEM_TENANT && (creation.step === 'done' || creation.origin === 'created')
  );
}

const SYSTEM_BASE = '/console/system';

export const TENANTS_HREF = `${SYSTEM_BASE}/tenants`;
// Beside the list rather than under it: `new` and `import` are tenant names
// too, and a record's address would otherwise shadow them.
export const NEW_TENANT_HREF = `${SYSTEM_BASE}/new-tenant`;
export const IMPORT_TENANT_HREF = `${SYSTEM_BASE}/import-tenant`;

export const SYSTEM_ADMINS_HREF = `${SYSTEM_BASE}/system-admins`;
export const NEW_SYSTEM_ADMIN_HREF = `${SYSTEM_ADMINS_HREF}/new`;

// system's administrators are its system administrators, so their guided
// step sits under that area and the rail keeps the operator's place.
export function administratorStepHref(tenant: string): string {
  return tenant === SYSTEM_TENANT
    ? NEW_SYSTEM_ADMIN_HREF
    : `${tenantHref(tenant)}/new-administrator`;
}

// The rail group, then the list, then the page: the group is a heading, not
// a page, so it has no address.
export function tenantsTrail(current: string): readonly Crumb[] {
  return [{ label: 'System' }, { label: 'Tenants', href: TENANTS_HREF }, { label: current }];
}

// A tenant's own administrator step sits under its record.
export function tenantAdministratorTrail(name: string): readonly Crumb[] {
  return [
    { label: 'System' },
    { label: 'Tenants', href: TENANTS_HREF },
    { label: name, href: tenantHref(name) },
    { label: 'Add an administrator' },
  ];
}

// A created or imported tenant has no administrator yet, so this is its first.
export function administratorTitle(
  name: string,
  origin: 'created' | 'imported' | 'existing',
): string {
  return origin === 'existing'
    ? `Add an administrator to ${name}`
    : `First administrator of ${name}`;
}

export function systemAdminsTrail(current: string): readonly Crumb[] {
  return [
    { label: 'System' },
    { label: 'System administrators', href: SYSTEM_ADMINS_HREF },
    { label: current },
  ];
}

export function tenantHref(name: string): string {
  return `${TENANTS_HREF}/${encodeURIComponent(name)}`;
}

export function enterHref(name: string): string {
  return `/console/${encodeURIComponent(name)}`;
}

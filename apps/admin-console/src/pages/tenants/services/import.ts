import type { ImportError } from '#/pages/tenants/types/importError';
import type { Tenant } from '#/pages/tenants/types/tenant';
import { counted } from '#/shared/lib/services/format';
import { failureTextWith } from '#/shared/lib/services/failure';
import type { GatewayFailure, Problem } from '#/shared/lib/services/result';
import { tenantHref } from '#/pages/tenants/services/systemAddress';

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
export function importProblemsHeading(count: number): string {
  return `${counted(count, 'problem', 'problems')} in the document`;
}

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

const IMPORT_UNREADABLE =
  'The import could not be read back. This is a fault in the console; check whether the tenant exists.';

const importFailureText = failureTextWith({
  network: () => IMPORT_NETWORK,
  schema: () => IMPORT_UNREADABLE,
  defect: () => IMPORT_UNREADABLE,
  problem: ({ status, detail, title }) => {
    if (status === 403) return 'Importing a tenant needs the manage-tenants capability.';
    if (status === 413) return TOO_LARGE;
    return detail ?? title;
  },
});

export function importMessage(outcome: ImportOutcome | null, found: Found | null): string | null {
  if (importedTenantOf(outcome, found) !== null) return null;
  if (found !== null && 'missing' in found)
    return `${found.missing} was not imported. Import it again.`;
  const failure = refusedImport(outcome);
  if (failure === null) return null;
  return importFailureText(failure);
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

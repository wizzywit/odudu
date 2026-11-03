import { writeRefusal } from '#/shared/lib/services/capabilities';
import { isMissing, isUnknownTenant, writeFailureText } from '#/shared/lib/services/failure';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/lib/services/principal';
import type { GatewayFailure, GatewayResult, Problem } from '#/shared/lib/services/result';
import { tenantRecord } from '#/pages/tenants/services/tenantRecordTabs';

// What `DELETE /admin/tenants/:tenant` takes of the caller.
export const DELETE_NEEDS: readonly AdminCapability[] = ['manage-tenants'];

const SYSTEM_FIXED =
  'system cannot be deleted: it is the tenant every cross-tenant administrator signs in to.';

function disableFirst(name: string): string {
  return `Disable ${name} first. Disabling ends its sessions and tells their relying parties, and only a disabled tenant can be deleted.`;
}

export type DeleteState =
  | { kind: 'hidden' }
  | { kind: 'fixed'; text: string }
  | { kind: 'disable-first'; text: string }
  | { kind: 'ready' };

// The server refuses the system tenant and an enabled one; the Tenants area
// is only reached from `system`, so the tenant an operator is signed in to
// is always the first of those.
export function deleteState({
  name,
  enabled,
  missing,
}: {
  name: string;
  enabled: boolean;
  missing: readonly AdminCapability[];
}): DeleteState {
  if (missing.length > 0) return { kind: 'hidden' };
  if (name === SYSTEM_TENANT) return { kind: 'fixed', text: SYSTEM_FIXED };
  if (enabled) return { kind: 'disable-first', text: disableFirst(name) };
  return { kind: 'ready' };
}

// Every table holding a tenant's rows references `tenants` ON DELETE
// CASCADE, directly or through a subject or a client (apps/docs/content/en/reference/transcripts/admin-paths/delete-admintenantstenant.md).
export function deleteConsequence(name: string): string {
  return `Deleting ${name} removes it and everything in it, permanently: its subjects with their credentials, sessions and grants; its clients and their secrets; its groups, roles and scopes; its signing keys, so no token it issued can be verified again; its settings, mail relay and registration tokens; and its audit trail. The deletion itself is recorded in the system tenant's audit trail. This cannot be undone. An export taken first can create a new tenant with the same configuration.`;
}

function refusalText(name: string, problem: Problem): string | null {
  switch (problem.type) {
    case 'about:blank#tenant-enabled':
      return `${name} was enabled again. ${disableFirst(name)}`;
    case 'about:blank#sessions-live':
      return `${name} still has live sessions. Disable it again to end them and tell their relying parties, then delete it.`;
    case 'about:blank#logout-deliveries-pending':
      return `Back-Channel Logout Tokens for ${name} are still waiting to be sent, and deleting it would discard them. Try again once they have been sent.`;
    default:
      return problem.status === 409 ? SYSTEM_FIXED : writeRefusal(problem, 'manage-tenants');
  }
}

export function deleteFailure(name: string, failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name,
    verb: 'deleted',
    lookAt: 'the tenants',
    refused: (problem) => refusalText(name, problem),
  });
}

// A tenant somebody else deleted first is where the delete meant it to be.
export function settledDeletion(result: GatewayResult<undefined>): GatewayResult<undefined> {
  if (!isMissing(result)) return result;
  return { ok: true, status: 404, data: undefined, etag: null, next: null };
}

// A cached entry of a deleted tenant: everything keyed under its name, and
// its record in the system tenant.
export function heldForTenant(
  queryKey: readonly unknown[],
  name: string,
  recordKind: string,
): boolean {
  const [kind, at, record] = queryKey;
  if (at === name) return true;
  return kind === recordKind && at === SYSTEM_TENANT && record === tenantRecord(name);
}

// The admin API answers a tenant it does not know, one just deleted among
// them, with a plain 401 rather than a 404; as a record it is not found.
export function missingIfUnknown<T>(result: GatewayResult<T>): GatewayResult<T> {
  if (!isUnknownTenant(result)) return result;
  return {
    ok: false,
    kind: 'problem',
    problem: { type: 'about:blank', title: 'Not Found', status: 404 },
  };
}

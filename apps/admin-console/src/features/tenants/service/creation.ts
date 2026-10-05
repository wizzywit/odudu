import { holdingsProblem } from '#/shared/service/administrators.ts';
import { andList } from '#/shared/service/format.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';
import { requiredProblem } from '#/shared/service/fieldErrors.ts';

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

// Whether the step is the first administrator of a tenant just made, or a
// further one to a tenant that has some.
export function choosesHoldings(step: { origin: string; granted: boolean }): boolean {
  return step.origin === 'existing' && !step.granted;
}

// What the administrator step refuses to send, by the field it belongs under.
export function administratorProblem(step: {
  username: string;
  holdings: readonly string[];
}): { username: string } | { holdings: string } | null {
  const username = requiredProblem(step.username, 'Enter a username for the administrator.');
  if (username !== null) return { username };
  const holdings = holdingsProblem(step.holdings);
  return holdings === null ? null : { holdings };
}

// A subject created but not finished, which starting over would drop.
export interface Unfinished {
  tenant: string;
  username: string;
  // Whether tenant-admin landed, leaving only the one-time password.
  granted: boolean;
}

export function unfinishedOf(creation: Creation): Unfinished | null {
  if (creation.step !== 'administrator' || creation.subjectId === null) return null;
  return { tenant: creation.tenant, username: creation.username, granted: creation.granted };
}

// What they hold, as a sentence fragment.
export function holdsText(holdings?: readonly string[]): string {
  if (holdings === undefined || holdings.includes('tenant-admin') || holdings.length === 0) {
    return 'tenant-admin';
  }
  return andList(holdings);
}

export function systemHoldsText(holds: string): string {
  return holds === 'tenant-admin'
    ? 'is a system administrator, holding tenant-admin in'
    : `holds ${holds} in`;
}

// Starting over from a tenant's own administrator adds another to it.
export function againOf(flow: CreationFlow): 'tenant' | 'administrator' {
  return flow === 'tenant' ? 'tenant' : 'administrator';
}

// Resumed when the subject was already created, since a retry would find its
// username taken and leave it without a role.
export function resumesAdministrator(stored: Creation | null): boolean {
  return stored?.step === 'administrator' && stored.subjectId !== null;
}

export function titleOrigin(stored: Creation | null): 'created' | 'imported' | 'existing' {
  return stored?.step === 'administrator' ? stored.origin : 'existing';
}

import type { Client } from '#/entities/client';
import type { Scope } from '#/entities/scope';
import { writeRefusal } from '#/shared/lib/services/capabilities';
import { writeFailureText } from '#/shared/lib/services/failure';
import { counted, shown } from '#/shared/lib/services/format';
import type { GatewayFailure, Problem } from '#/shared/lib/services/result';

export const SCOPES_CAPABILITY = 'manage-tenant';

type Assignment = Client['scopes'][number];

// How many assigned scopes the tab draws at once from a list it already holds; no request is made.
export const SCOPES_PAGE = 50;

export function assignedScopes(scopes: readonly Assignment[]): readonly Assignment[] {
  return [...scopes].sort((a, b) => a.name.localeCompare(b.name));
}

export function shownScopes(scopes: readonly Assignment[], limit: number) {
  return shown(assignedScopes(scopes), limit);
}

export function scopeCount(count: number): string {
  return `${counted(count, 'scope', 'scopes')} assigned.`;
}

export const NO_SCOPES = 'No scope is assigned: a request to this client can ask for none.';

// Why a scope cannot be chosen to assign: it already is, and its assignment is changed in the list.
export function alreadyAssigned(
  scope: Pick<Scope, 'id'>,
  assigned: readonly Assignment[],
): string | null {
  const held = assigned.find((each) => each.id === scope.id);
  return held === undefined ? null : `already assigned as ${held.assignment}`;
}

export function scopeRefusal(problem: Problem): string | null {
  return writeRefusal(problem, SCOPES_CAPABILITY);
}

export const ASSIGN_LABEL = 'Assign scope';
export const PICKER_LABEL = 'Scope to assign';
export const ASSIGNED_HEADING = 'Assigned scopes';
export const ASSIGN_HEADING = 'Assign a scope';

// The assign button names the scope chosen, once there is one.
export function assignButtonText(chosen: string | null): string {
  return chosen === null ? ASSIGN_LABEL : `${ASSIGN_LABEL} ${chosen}`;
}

// A lost answer is never sent again; the assigned list says whether it took.
export function scopeFailureText(
  failure: GatewayFailure,
  scope: string,
  verb: 'assigned' | 'unassigned',
): string {
  return writeFailureText(failure, {
    name: scope,
    verb,
    lookAt: 'the assigned scopes',
    refused: scopeRefusal,
  });
}

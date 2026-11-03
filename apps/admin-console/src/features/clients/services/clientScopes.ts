import type { Client, ClientScope } from '@odudu/contracts/admin';
import { writeRefusal } from '#/shared/services/capabilities';
import { writeFailureText } from '#/shared/services/failure';
import { counted } from '#/shared/services/format';
import type { GatewayFailure, Problem } from '#/shared/services/result';

export const SCOPES_CAPABILITY = 'manage-tenant';

type Assignment = Client['scopes'][number];

// How many assigned scopes the tab draws at once from a list it already holds; no request is made.
export const SCOPES_PAGE = 50;

export function assignedScopes(scopes: readonly Assignment[]): readonly Assignment[] {
  return [...scopes].sort((a, b) => a.name.localeCompare(b.name));
}

export function shownScopes(scopes: readonly Assignment[], shown: number): readonly Assignment[] {
  return assignedScopes(scopes).slice(0, shown);
}

export function moreScopes(scopes: readonly Assignment[], shown: number): number {
  return Math.max(0, scopes.length - shown);
}

export function scopeCount(count: number): string {
  return `${counted(count, 'scope', 'scopes')} assigned.`;
}

export const NO_SCOPES = 'No scope is assigned: a request to this client can ask for none.';

// Why a scope cannot be chosen to assign: it already is, and its assignment is changed in the list.
export function alreadyAssigned(
  scope: Pick<ClientScope, 'id'>,
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

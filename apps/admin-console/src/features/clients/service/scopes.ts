import type { Client, ClientScope } from '@odudu/contracts/admin';
import { writeRefusal } from '#/shared/service/capabilities';
import { writeFailureText } from '#/shared/service/failure.ts';
import type { GatewayFailure, Problem } from '#/shared/service/result.ts';
import type { Choice } from '#/features/clients/service/choices.ts';

export const SCOPES_CAPABILITY = 'manage-tenant';

type Assignment = Client['scopes'][number];

export const ASSIGNMENTS: readonly Choice[] = [
  { id: 'default', label: 'Default' },
  { id: 'optional', label: 'Optional' },
];

export const ASSIGNMENT_RULE =
  'A default scope goes to a request that names no scope. An optional scope goes only to a request that names it.';

export const SCOPES_PAGE = 50;

export function assignmentOf(value: string): Assignment['assignment'] {
  return value === 'optional' ? 'optional' : 'default';
}

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
  return count === 1 ? '1 scope assigned.' : `${String(count)} scopes assigned.`;
}

export function assignedText(client: string, scope: string, assignment: string): string {
  return `${scope} is assigned to ${client} as ${assignment}.`;
}

export function unassignedText(client: string, scope: string): string {
  return `${scope} is no longer assigned to ${client}.`;
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

import type { Choice } from '#/shared/lib/services/choice';

export const ASSIGNMENTS: readonly Choice[] = [
  { id: 'default', label: 'Default' },
  { id: 'optional', label: 'Optional' },
];

export const ASSIGNMENT_RULE =
  'A default scope goes to a request that names no scope. An optional scope goes only to a request that names it.';

export function assignmentOf(value: string): 'default' | 'optional' {
  return value === 'optional' ? 'optional' : 'default';
}

export function assignedText(scope: string, client: string, assignment: string): string {
  return `${scope} is assigned to ${client} as ${assignment}.`;
}

export function unassignedText(scope: string, client: string): string {
  return `${scope} is no longer assigned to ${client}.`;
}

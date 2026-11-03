import type { Choice } from '#/shared/lib/services/choice';

export const ID_TOKEN_LABEL = 'In the ID token';
export const ACCESS_TOKEN_LABEL = 'In the access token';
export const NEW_CLIENT_LABEL = 'For a client made from now on';

export const NEW_CLIENT_CHOICES: readonly Choice[] = [
  { id: 'none', label: 'Not assigned' },
  { id: 'default', label: 'Assigned as default' },
  { id: 'optional', label: 'Assigned as optional' },
];

export function assignmentName(value: unknown): string {
  return NEW_CLIENT_CHOICES.find((choice) => choice.id === value)?.label ?? String(value);
}

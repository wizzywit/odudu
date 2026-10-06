import { requiredProblem } from '#/shared/service/fieldErrors.ts';

export type NewClientType = 'confidential' | 'public';

export interface TypeChoice {
  id: NewClientType;
  label: string;
  description: string;
}

export const TYPE_CHOICES: readonly TypeChoice[] = [
  {
    id: 'confidential',
    label: 'Confidential',
    description:
      'An application with a server of its own that keeps a secret. It is given a client secret, shown once.',
  },
  {
    id: 'public',
    label: 'Public',
    description:
      'An application that cannot keep a secret, such as one that runs in a browser or on a phone. It has no secret.',
  },
];

// What a select hands back, narrowed; the safer type for anything else.
export function newClientType(value: string): NewClientType {
  return TYPE_CHOICES.find((choice) => choice.id === value)?.id ?? 'confidential';
}

// The form's fields as the admin API names them, which a refusal is placed under.
export const NEW_CLIENT_FIELDS = ['client_id', 'name', 'description', 'redirect_uris'] as const;

export type NewClientField = (typeof NEW_CLIENT_FIELDS)[number];

export function clientIdProblem(clientId: string): string | null {
  return requiredProblem(clientId, 'Enter a client ID.');
}

export const SECRET_LABEL = 'client secret';

export function secretTitle(name: string): string {
  return `Client secret for ${name}`;
}

export function secretNote(name: string): string {
  return `${name} was created. Its application authenticates to the token endpoint with this secret.`;
}

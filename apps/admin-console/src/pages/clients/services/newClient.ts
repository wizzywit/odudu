import { requiredProblem } from '#/shared/lib/services/fieldErrors';

export const NEW_CLIENT_TITLE = 'Create a client';

export type NewClientKind = 'confidential' | 'service' | 'public';

export interface KindChoice {
  id: NewClientKind;
  label: string;
  description: string;
}

export const KIND_CHOICES: readonly KindChoice[] = [
  {
    id: 'confidential',
    label: 'Web application',
    description:
      'An application with a server of its own that signs people in and keeps a secret. It is given a client secret, shown once.',
  },
  {
    id: 'service',
    label: 'Service',
    description:
      'A back end that calls an API as itself, with no one signing in. It is given a client secret, shown once, and no redirect URI.',
  },
  {
    id: 'public',
    label: 'Public application',
    description:
      'An application that cannot keep a secret, such as one that runs in a browser or on a phone. It has no secret.',
  },
];

// What a select hands back, narrowed; the safer kind for anything else.
export function newClientKind(value: string): NewClientKind {
  return KIND_CHOICES.find((choice) => choice.id === value)?.id ?? 'confidential';
}

// A service signs nobody in, so it has nowhere to send a browser back to.
export function asksRedirects(kind: NewClientKind): boolean {
  return kind !== 'service';
}

// The form's fields as the admin API names them, which a refusal is placed under.
export const NEW_CLIENT_FIELDS = ['client_id', 'name', 'description', 'redirect_uris'] as const;

export type NewClientField = (typeof NEW_CLIENT_FIELDS)[number];

export function clientIdProblem(clientId: string): string | null {
  return requiredProblem(clientId, 'Enter a client ID.');
}

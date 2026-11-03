// The secret an answer carries is split off here, so what goes on is the client alone.
export function splitSecret<T extends { client_secret?: string | undefined }>(
  answer: T,
): { secret: string | null; rest: Omit<T, 'client_secret'> } {
  const { client_secret: secret, ...rest } = answer;
  return { secret: secret ?? null, rest };
}

// A secret is acknowledged before the page moves on; a client without one has nothing to wait for.
export function afterCreation(secret: string | null): 'acknowledge' | 'land' {
  return secret === null ? 'land' : 'acknowledge';
}

export const SECRET_LABEL = 'client secret';

// The client made once there is one, else the ID being typed.
export function secretName(made: { name: string } | null, clientId: string): string {
  return made?.name ?? clientId;
}

export function secretTitle(name: string): string {
  return `Client secret for ${name}`;
}

export function secretNote(name: string): string {
  return `${name} was created. Its application authenticates to the token endpoint with this secret.`;
}

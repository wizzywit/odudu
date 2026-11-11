// The body of a refused request, in the shape OAuth 2.0 errors have.
export interface MeError {
  readonly error: string;
  readonly error_description: string;
}

export function invalidRequest(description: string): MeError {
  return { error: 'invalid_request', error_description: description };
}

export function notFound(description: string): MeError {
  return { error: 'not_found', error_description: description };
}

export const AGENT_NOT_PERMITTED_MESSAGE =
  'A token issued to an agent may read this account and may not change it; the person makes the change themselves';

export function agentNotPermitted(): MeError {
  return { error: 'agent_not_permitted', error_description: AGENT_NOT_PERMITTED_MESSAGE };
}

// The first problem a body has, named by where it is.
export function invalidBody(issues: readonly { path: PropertyKey[]; message: string }[]): MeError {
  const first = issues[0];
  const where =
    first === undefined || first.path.length === 0 ? '' : `${first.path.map(String).join('.')}: `;
  return invalidRequest(`The request body is not valid: ${where}${first?.message ?? 'no detail'}`);
}

export function conflict(description: string): MeError {
  return { error: 'conflict', error_description: description };
}

export function usernameNotEditable(): MeError {
  return invalidRequest(
    'username: this tenant has not enabled username editing (username_editable)',
  );
}

// The deployment has no way to send the mail a change of address needs. It
// does not depend on the address asked for, so it tells nothing about it.
export function mailUnavailable(): MeError {
  return {
    error: 'mail_unavailable',
    error_description: 'This server cannot send mail, so an address cannot be changed here',
  };
}

// Another subject in the tenant holds the username a person asked for.
export class UsernameTakenError extends Error {
  constructor() {
    super('username already held');
    this.name = 'UsernameTakenError';
  }
}

// What each refusal of a removal says. The text of an API error is English
// whatever the language of the person's pages (ADR 0043).
export const REMOVAL_REFUSAL_MESSAGES = {
  last_sign_in_method:
    'This is the last way this account can be signed in to; add another before removing it',
  last_second_factor:
    'This tenant requires a second factor and this is the last one; add another before removing it',
} as const;

export function removalRefused(code: keyof typeof REMOVAL_REFUSAL_MESSAGES): MeError {
  return { error: code, error_description: REMOVAL_REFUSAL_MESSAGES[code] };
}

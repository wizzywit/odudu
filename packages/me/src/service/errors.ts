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

// Changing the address needs a mailed proof of the new one, which this API
// does not offer.
export function emailChangeUnsupported(): MeError {
  return {
    error: 'email_change_unsupported',
    error_description: 'The email address cannot be changed through this API',
  };
}

// Another subject in the tenant holds the username a person asked for.
export class UsernameTakenError extends Error {
  constructor() {
    super('username already held');
    this.name = 'UsernameTakenError';
  }
}

// What each refusal of a removal says, in the languages the catalogue carries.
export const REMOVAL_REFUSAL_MESSAGES = {
  last_sign_in_method: {
    en: 'This is the last way this account can be signed in to; add another before removing it',
    ar: 'هذه آخر وسيلة لتسجيل الدخول إلى هذا الحساب؛ أضف وسيلة أخرى قبل إزالتها',
  },
  last_second_factor: {
    en: 'This tenant requires a second factor and this is the last one; add another before removing it',
    ar: 'تشترط هذه الجهة عاملاً ثانياً وهذا آخر عامل؛ أضف عاملاً آخر قبل إزالته',
  },
} as const;

export function removalRefused(code: keyof typeof REMOVAL_REFUSAL_MESSAGES): MeError {
  return { error: code, error_description: REMOVAL_REFUSAL_MESSAGES[code].en };
}

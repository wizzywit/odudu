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

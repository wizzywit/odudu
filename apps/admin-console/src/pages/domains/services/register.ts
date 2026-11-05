import { DOMAINS_WORDS } from '#/pages/domains/services/domainsWords';

export const HOST_NEEDED = 'Enter the host the tenant will sign in at, such as login.acme.com.';

export function trimmedHost(host: string): string {
  return host.trim();
}

// Whether a host is a name, a lowercase punycode one the operator may serve,
// is the server's to judge; only an empty field is refused here.
export function hostProblem(host: string): string | null {
  return trimmedHost(host) === '' ? HOST_NEEDED : null;
}

export interface RegisterRequest {
  // The host to register, or null when nothing is sent.
  send: string | null;
  error: string | undefined;
}

export function registerRequest(host: string): RegisterRequest {
  const problem = hostProblem(host);
  return problem === null
    ? { send: trimmedHost(host), error: undefined }
    : { send: null, error: problem };
}

export function registerLabel(busy: boolean): string {
  return busy ? DOMAINS_WORDS.register.registering : DOMAINS_WORDS.register.submit;
}

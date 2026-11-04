export const HOST_NEEDED = 'Enter the host the tenant will sign in at, such as login.acme.com.';

export function trimmedHost(host: string): string {
  return host.trim();
}

// Whether a host is a name, a lowercase punycode one the operator may serve,
// is the server's to judge; only an empty field is refused here.
export function hostProblem(host: string): string | null {
  return trimmedHost(host) === '' ? HOST_NEEDED : null;
}

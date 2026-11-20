export type Gate = 'ok' | 'method-not-allowed' | 'forbidden';

export interface GateInput {
  method: string;
  allow: 'GET' | 'POST';
  // The value of the `X-Odudu-BFF` header, null when absent.
  customHeader: string | null;
  origin: string | null;
  allowedOrigins: string[];
}

// Whether a request may reach a route. A route accepts one method. A POST,
// the only kind that changes state, must also carry the custom header, which a
// cross-origin page cannot add without a preflight the BFF does not answer
// (RFC 10017 section 6.1.3.3.2), and an `Origin` the app is served from.
export function gate(input: GateInput): Gate {
  if (input.method !== input.allow) return 'method-not-allowed';
  if (input.allow === 'GET') return 'ok';
  const hasHeader = input.customHeader !== null && input.customHeader !== '';
  const originOk = input.origin !== null && input.allowedOrigins.includes(input.origin);
  return hasHeader && originOk ? 'ok' : 'forbidden';
}

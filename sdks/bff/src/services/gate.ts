export type Gate = 'ok' | 'method-not-allowed' | 'forbidden';

export interface GateInput {
  method: string;
  allow: 'GET' | 'POST';
  // The value of the `X-Odudu-BFF` header, null when absent.
  customHeader: string | null;
  origin: string | null;
  allowedOrigins: string[];
  // A GET too must carry the custom header, as the `session` read does.
  requireHeader?: boolean;
}

// Whether a request may reach a route. A route accepts one method. A POST,
// the only kind that changes state, must also carry the custom header, which a
// cross-origin page cannot add without a preflight the BFF does not answer
// (RFC 10017 section 6.1.3.3.2), and an `Origin` the app is served from.
export function gate(input: GateInput): Gate {
  if (input.method !== input.allow) return 'method-not-allowed';
  if (input.allow === 'GET') return input.requireHeader === true ? readGate(input) : 'ok';
  const hasHeader = input.customHeader !== null && input.customHeader !== '';
  const originOk = input.origin !== null && input.allowedOrigins.includes(input.origin);
  return hasHeader && originOk ? 'ok' : 'forbidden';
}

function readGate(input: GateInput): Gate {
  return proxyGate(input) === 'ok' ? 'ok' : 'forbidden';
}

export interface ProxyGateInput {
  method: string;
  customHeader: string | null;
  origin: string | null;
  allowedOrigins: string[];
}

// Whether a request may use the proxy. Every call carries the custom header,
// a read included (RFC 10017 section 6.1.3.3.2), because the proxy spends the
// person's token on it. An `Origin`, when the browser sends one, must be an
// allowed one; a method that can change state must send one, since a browser
// always does for those.
export function proxyGate(input: ProxyGateInput): 'ok' | 'forbidden' {
  if (input.customHeader === null || input.customHeader === '') return 'forbidden';
  if (input.origin === null) {
    return input.method === 'GET' || input.method === 'HEAD' ? 'ok' : 'forbidden';
  }
  return input.allowedOrigins.includes(input.origin) ? 'ok' : 'forbidden';
}

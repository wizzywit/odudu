export type RelayFailureKind = 'connection' | 'tls' | 'auth' | 'rejected' | 'other';

const DETAIL: Readonly<Record<RelayFailureKind, string>> = {
  connection: 'the relay could not be reached',
  tls: 'the relay refused the secure connection',
  auth: 'the relay refused the username or password',
  rejected: 'the relay refused the message',
  other: 'the message could not be sent',
};

const CONNECTION = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED']);

function field(error: unknown, name: 'code' | 'responseCode'): unknown {
  return typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)[name]
    : undefined;
}

// Chosen from the transport's own code and the relay's response code, never
// from its text: what a relay says about itself does not reach the caller.
export function relayFailure(error: unknown): { kind: RelayFailureKind; detail: string } {
  const code = field(error, 'code');
  const response = field(error, 'responseCode');
  let kind: RelayFailureKind = 'other';
  if (typeof code === 'string' && CONNECTION.has(code)) kind = 'connection';
  else if (code === 'ETLS') kind = 'tls';
  else if (code === 'EAUTH') kind = 'auth';
  else if (code === 'EENVELOPE' || code === 'EMESSAGE' || typeof response === 'number') {
    kind = 'rejected';
  }
  return { kind, detail: DETAIL[kind] };
}

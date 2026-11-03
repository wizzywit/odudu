import { CLIENT_AUTH_METHODS } from '@odudu/contracts/admin';
import type { Client } from '#/entities/client';
import type { Choice } from '#/shared/services/choice';

const AUTH_LABELS: Readonly<Record<string, string>> = {
  client_secret_basic: 'Secret in a Basic header',
  client_secret_post: 'Secret in the request body',
  private_key_jwt: 'Signed assertion (private_key_jwt)',
  tls_client_auth: 'Client certificate (tls_client_auth)',
  none: 'None',
};

const AUTH_NOTES: Readonly<Record<string, string>> = {
  client_secret_basic:
    'The secret travels in an Authorization header, the form most libraries speak.',
  client_secret_post: 'The secret travels in the body of the token request.',
  private_key_jwt:
    'The client signs an assertion with a private key, which the keys it publishes below verify.',
  tls_client_auth:
    'The client presents a certificate whose subject is matched against the one below. It needs this server to sit behind a proxy it trusts, which the server checks when this is saved.',
};

// A public client has no secret, and a confidential one cannot become
// public: either would change its security model, so the server refuses it.
export const PUBLIC_AUTH_FIXED =
  'A public client authenticates with nothing, and a client cannot change between public and confidential once it is made.';

export function authOptions(client: Pick<Client, 'type'>): Choice[] {
  return CLIENT_AUTH_METHODS.filter(
    (method) => (method === 'none') === (client.type === 'public'),
  ).map((id) => ({ id, label: AUTH_LABELS[id] ?? id }));
}

export function authNote(method: string): string | undefined {
  return AUTH_NOTES[method];
}

export function needsSubjectDn(method: string): boolean {
  return method === 'tls_client_auth';
}

export const SUBJECT_DN_RULE =
  "The distinguished name the certificate's subject must equal, such as CN=billing,O=Example. Required for this method.";

// The subject is kept only for the method that reads it.
export function authPayload(values: {
  token_endpoint_auth_method: string;
  tls_client_auth_subject_dn: string;
}): {
  token_endpoint_auth_method: string;
  tls_client_auth_subject_dn: string;
} {
  return {
    token_endpoint_auth_method: values.token_endpoint_auth_method,
    tls_client_auth_subject_dn: needsSubjectDn(values.token_endpoint_auth_method)
      ? values.tls_client_auth_subject_dn.trim()
      : '',
  };
}

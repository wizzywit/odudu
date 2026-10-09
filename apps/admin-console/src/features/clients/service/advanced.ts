import {
  CLIENT_AUTH_METHODS,
  USERINFO_ENCRYPTION_ALGS,
  USERINFO_ENCRYPTION_ENC_DEFAULT,
  USERINFO_ENCRYPTION_ENCS,
  USERINFO_SIGNING_ALGS,
  type Client,
} from '@odudu/contracts/admin';
import { AUTO, sentOf, type Choice } from '#/features/clients/service/choices.ts';

export const SECTIONS_ADVANCED = {
  auth: 'Client authentication',
  keys: 'Client keys',
  userinfo: 'UserInfo response',
  audiences: 'Audiences',
  exchange: 'Token exchange',
  secret: 'Client secret',
  fixed: 'Fixed by design',
} as const;

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

export type KeySource = 'none' | 'uri' | 'inline';

export const KEY_SOURCES: readonly Choice[] = [
  { id: 'none', label: 'None published' },
  { id: 'uri', label: 'A JWKS URI' },
  { id: 'inline', label: 'A key set pasted here' },
];

export const KEYS_RULE =
  'The public keys the server verifies the client with and encrypts to. A key set is kept as given and served back by every read, so a private key is refused.';

export const JWKS_URI_RULE =
  'An https address the server fetches the key set from. It must not point inside a private network.';

export function keySourceOf(client: Pick<Client, 'jwks' | 'jwks_uri'>): KeySource {
  if (client.jwks !== null && client.jwks !== undefined) return 'inline';
  return client.jwks_uri === null ? 'none' : 'uri';
}

export function jwksText(jwks: unknown): string {
  return jwks === null || jwks === undefined ? '' : JSON.stringify(jwks, null, 2);
}

export type Jwks = { ok: true; value: unknown } | { ok: false; problem: string };

// Shape only: which members a key may carry is the server's to judge, and
// it says so in its own words beside the field.
export function parseJwks(text: string): Jwks {
  if (text.trim() === '')
    return { ok: false, problem: 'Paste the key set, or choose another key source.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'This is not valid JSON.' };
  }
  const keys =
    typeof parsed === 'object' && parsed !== null ? (parsed as { keys?: unknown }).keys : undefined;
  if (!Array.isArray(keys)) {
    return { ok: false, problem: 'A key set is a JSON object with a "keys" array.' };
  }
  return { ok: true, value: parsed };
}

export const KEYS_BLOCKED = 'Correct the key source above before saving.';

export interface KeysProblem {
  field: 'jwks' | 'jwks_uri';
  message: string;
}

// What the chosen source lacks, once the section has been edited: a stored
// source is whole, and an untouched section holds nothing back.
export function keysProblem(
  values: { key_source: string; jwks_uri: string; jwks: string },
  edited: boolean,
): KeysProblem | undefined {
  if (!edited) return undefined;
  if (values.key_source === 'uri' && values.jwks_uri.trim() === '') {
    return { field: 'jwks_uri', message: 'Enter the address, or choose another key source.' };
  }
  if (values.key_source !== 'inline') return undefined;
  const parsed = parseJwks(values.jwks);
  return parsed.ok ? undefined : { field: 'jwks', message: parsed.problem };
}

// The other source is cleared, since the server holds the two exclusive.
export function keysPayload(values: { key_source: string; jwks_uri: string; jwks: string }): {
  jwks: unknown;
  jwks_uri: string | null;
} {
  const parsed = values.key_source === 'inline' ? parseJwks(values.jwks) : null;
  return {
    jwks: parsed?.ok === true ? parsed.value : null,
    jwks_uri: values.key_source === 'uri' ? values.jwks_uri.trim() : null,
  };
}

export const USERINFO_RULE =
  'How UserInfo answers this client: signed, and then encrypted to a key it publishes above. Left alone it answers plain JSON.';

export function userinfoSigningOptions(): Choice[] {
  return [
    { id: AUTO, label: 'Plain JSON, not signed' },
    ...USERINFO_SIGNING_ALGS.map((id) => ({
      id,
      label: id === 'none' ? 'An unsigned JWT (none)' : id,
    })),
  ];
}

export function userinfoEncryptionOptions(): Choice[] {
  return [
    { id: AUTO, label: 'Not encrypted' },
    ...USERINFO_ENCRYPTION_ALGS.map((id) => ({ id, label: id })),
  ];
}

export function userinfoContentOptions(): Choice[] {
  return [
    { id: AUTO, label: `Default (${USERINFO_ENCRYPTION_ENC_DEFAULT})` },
    ...USERINFO_ENCRYPTION_ENCS.map((id) => ({ id, label: id })),
  ];
}

export function encryptsUserinfo(algorithm: string): boolean {
  return algorithm !== AUTO;
}

// A content encryption names an algorithm to go with, so it is dropped with it.
export function userinfoPayload(values: {
  userinfo_signed_response_alg: string;
  userinfo_encrypted_response_alg: string;
  userinfo_encrypted_response_enc: string;
}): {
  userinfo_signed_response_alg: string | null;
  userinfo_encrypted_response_alg: string | null;
  userinfo_encrypted_response_enc: string | null;
} {
  const encrypted = encryptsUserinfo(values.userinfo_encrypted_response_alg);
  return {
    userinfo_signed_response_alg: sentOf(values.userinfo_signed_response_alg),
    userinfo_encrypted_response_alg: sentOf(values.userinfo_encrypted_response_alg),
    userinfo_encrypted_response_enc: encrypted
      ? sentOf(values.userinfo_encrypted_response_enc)
      : null,
  };
}

export const AUDIENCES_RULE =
  'The resource servers tokens issued to this client are meant for, which a token names as its audience. A request may narrow them with a resource, never widen them.';

export const EXCHANGE_LABEL = 'Allow impersonation in token exchange';
export const EXCHANGE_RULE =
  'On, this client may exchange a token for one that stands for the subject with no actor named. Off, an exchange it makes names the client as the actor. It has no effect unless the client holds the token exchange grant.';

export const FIXED_BY_DESIGN: readonly { label: string; value: string; why: string }[] = [
  {
    label: 'Response type',
    value: 'code',
    why: 'Every client signs people in with the authorization code flow; no token is ever returned through the browser.',
  },
  {
    label: 'PKCE',
    value: 'S256',
    why: 'An authorization request carries a code challenge, and the plain method is refused.',
  },
];

export const SECRET_RULE =
  'Rotating makes a new secret, shown once. Until its grace period ends the previous secret keeps authenticating beside it, so an application can be given the new one without a gap. A grace of 0 s replaces it at once, the right answer to a leak.';

const PUBLIC_SECRET_FIXED = 'A public client has no secret to rotate.';

/** Why a client has no secret to rotate, or `null` when it holds one. */
export function secretFixedNote(client: {
  type: string;
  token_endpoint_auth_method: string;
}): string | null {
  if (client.type === 'public') return PUBLIC_SECRET_FIXED;
  const method = client.token_endpoint_auth_method;
  if (method === 'client_secret_basic' || method === 'client_secret_post') return null;
  return `A client that authenticates with ${method} has no secret to rotate.`;
}

import * as oauth from 'oauth4webapi';
import { OduduError } from '#/services/odudu-error';
import type { ServerMetadata, SignInOptions } from '#/types';

export interface Secrets {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export function newSecrets(): Secrets {
  return {
    state: oauth.generateRandomState(),
    nonce: oauth.generateRandomNonce(),
    codeVerifier: oauth.generateRandomCodeVerifier(),
  };
}

// The authorization request. It sends no `login_hint`: Odudu ignores it.
export async function authorizationUrl(
  metadata: ServerMetadata,
  options: SignInOptions,
  secrets: Secrets,
  scope: string,
  resources: string[],
  silent: boolean,
): Promise<string> {
  if (metadata.authorization_endpoint === undefined) {
    throw new OduduError('discovery_failed', 'the metadata names no authorization endpoint');
  }
  const url = new URL(metadata.authorization_endpoint);
  const params = url.searchParams;
  params.set('response_type', 'code');
  params.set('client_id', options.clientId);
  params.set('redirect_uri', options.redirectUri);
  params.set('scope', scope);
  params.set('code_challenge', await oauth.calculatePKCECodeChallenge(secrets.codeVerifier));
  params.set('code_challenge_method', 'S256');
  params.set('state', secrets.state);
  params.set('nonce', secrets.nonce);
  for (const resource of resources) params.append('resource', resource);
  if (options.prompt !== undefined) params.set('prompt', options.prompt);
  if (silent) params.set('prompt', 'none');
  if (options.action !== undefined) params.set('action', options.action);
  return url.href;
}

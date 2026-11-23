import { OduduError } from '#/services/odudu-error';
import type { ServerMetadata, SignOutOptions } from '#/types';

// The RP-initiated logout address (OIDC RP-Initiated Logout 1.0 section 2).
export function signOutAddress(
  metadata: ServerMetadata,
  options: SignOutOptions,
  allowInsecure: boolean,
): string {
  if (metadata.end_session_endpoint === undefined) {
    throw new OduduError('discovery_failed', 'the metadata names no end_session_endpoint');
  }
  const url = new URL(metadata.end_session_endpoint);
  // The ID token goes in the query, so it never leaves over plain http.
  if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) {
    throw new OduduError('discovery_failed', 'the end_session_endpoint is not an https address');
  }
  url.searchParams.set('id_token_hint', options.idToken);
  if (options.postLogoutRedirectUri !== undefined) {
    url.searchParams.set('post_logout_redirect_uri', options.postLogoutRedirectUri);
  }
  if (options.state !== undefined) url.searchParams.set('state', options.state);
  return url.href;
}

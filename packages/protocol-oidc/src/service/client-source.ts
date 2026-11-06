import { cimdConsentHost } from '#/service/client-id-metadata';
import { needsApproval } from '#/service/consent';

const ORIGINS_SHOWN = 5;

// Where a client that nobody at the tenant set up came from, for the consent
// page to put beside the name the client chose for itself.
export type ClientSource =
  | { readonly kind: 'metadata'; readonly host: string; readonly redirectUris: readonly string[] }
  | {
      readonly kind: 'self-registered';
      // Where this request's own redirect_uri sends the person, always shown;
      // `origins` are the other registered ones, bounded.
      readonly sentTo: string | null;
      readonly origins: readonly string[];
      readonly more: number;
    };

// scheme://host[:port] for a web address, scheme: for a private-use one.
// A stored value that is not a URL is shown as it is: the page escapes it, and
// hiding it would hide an address the client holds.
function originOf(uri: string): string {
  if (!URL.canParse(uri)) return uri;
  const url = new URL(uri);
  return url.origin === 'null' ? url.protocol : url.origin;
}

export function clientSourceOf(
  client: { readonly clientId: string; readonly registrationOrigin: string },
  redirectUris: readonly string[],
  requestRedirectUri?: string,
): ClientSource | null {
  if (client.registrationOrigin === 'cimd') {
    return { kind: 'metadata', host: cimdConsentHost(client.clientId), redirectUris };
  }
  if (!needsApproval(client.registrationOrigin)) return null;
  const sentTo = requestRedirectUri === undefined ? null : originOf(requestRedirectUri);
  const origins = [...new Set(redirectUris.map(originOf))].filter((origin) => origin !== sentTo);
  return {
    kind: 'self-registered',
    sentTo,
    origins: origins.slice(0, ORIGINS_SHOWN),
    more: Math.max(0, origins.length - ORIGINS_SHOWN),
  };
}

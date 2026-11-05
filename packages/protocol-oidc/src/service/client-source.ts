import { cimdConsentHost } from '#/service/client-id-metadata';

// Where a client that arrived through its metadata document came from, for
// the consent page to put beside the name the document chose for itself.
export interface ClientSource {
  readonly host: string;
  readonly redirectUris: readonly string[];
}

export function clientSourceOf(
  client: { readonly clientId: string; readonly registrationOrigin: string },
  redirectUris: readonly string[],
): ClientSource | null {
  return client.registrationOrigin === 'cimd'
    ? { host: cimdConsentHost(client.clientId), redirectUris }
    : null;
}

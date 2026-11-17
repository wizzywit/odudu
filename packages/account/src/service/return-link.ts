export type ReturnStatus = 'success' | 'error';

// The registered address with the ending of the link added, for the page's
// way back to the application. Only a hint, as the actions' own is: the
// application reads the outcome from the "me" API, never from this. Null for a
// string that is not an address, which a registration cannot hold but a
// column could.
export function returnHref(uri: string | null | undefined, status: ReturnStatus): string | null {
  if (uri === null || uri === undefined || !URL.canParse(uri)) return null;
  const href = new URL(uri);
  href.searchParams.set('action_status', status);
  return href.toString();
}

export interface ReturnClient {
  readonly enabled: boolean;
  readonly redirectUris: readonly string[];
}

// The address a link was issued to return to, kept only while the client that
// registered it still does: the registration is read when the link is opened,
// not when it was issued.
export function registeredReturn(client: ReturnClient | null, uri: string): string | null {
  return client?.enabled === true && client.redirectUris.includes(uri) ? uri : null;
}

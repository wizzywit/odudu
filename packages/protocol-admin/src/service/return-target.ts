export type ReturnUriChoice =
  | { readonly kind: 'ok'; readonly uri: string }
  | { readonly kind: 'unregistered' }
  | { readonly kind: 'required' };

// Which of a client's registered redirect URIs a link returns to. A named one
// must match exactly, as /authorize matches it; unnamed, the client's only one
// is used, and a client with several or none has to be told which.
export function chooseReturnUri(
  registered: readonly string[],
  requested: string | undefined,
): ReturnUriChoice {
  if (requested !== undefined) {
    return registered.includes(requested)
      ? { kind: 'ok', uri: requested }
      : { kind: 'unregistered' };
  }
  const [only] = registered;
  return registered.length === 1 && only !== undefined
    ? { kind: 'ok', uri: only }
    : { kind: 'required' };
}

export type ReturnRequest =
  | { readonly kind: 'none' }
  | { readonly kind: 'named'; readonly clientId: string; readonly redirectUri?: string }
  | { readonly kind: 'orphan_redirect' };

// What a send request says about where its link returns to: nothing, a client
// (and perhaps which of its addresses), or an address with no client to own it.
export function returnRequestOf(body: {
  readonly client_id?: string | undefined;
  readonly redirect_uri?: string | undefined;
}): ReturnRequest {
  if (body.client_id === undefined) {
    return body.redirect_uri === undefined ? { kind: 'none' } : { kind: 'orphan_redirect' };
  }
  return body.redirect_uri === undefined
    ? { kind: 'named', clientId: body.client_id }
    : { kind: 'named', clientId: body.client_id, redirectUri: body.redirect_uri };
}

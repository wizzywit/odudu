export type ResourceOutcome =
  | { readonly kind: 'ok'; readonly audience: readonly string[] }
  | { readonly kind: 'invalid_target' };

// RFC 8707 §2: an absolute URI, no fragment. This server accepts one value,
// so two is a refusal rather than a choice — a token minted for the first of
// two named audiences is a token for an audience the client did not mean.
export function parseResource(
  raw: string | string[] | undefined,
  registered: readonly string[],
): ResourceOutcome {
  if (raw === undefined) {
    // A client that registered no audience asked for nothing in
    // particular, so it gets nothing in particular: the issuer alone,
    // appended downstream. An explicit `resource` from such a client is
    // still a refusal below — it named a target it is not allowed at.
    return { kind: 'ok', audience: registered };
  }
  if (Array.isArray(raw)) return { kind: 'invalid_target' };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { kind: 'invalid_target' };
  }
  if (parsed.hash !== '') return { kind: 'invalid_target' };
  if (!registered.includes(raw)) return { kind: 'invalid_target' };
  return { kind: 'ok', audience: [raw] };
}

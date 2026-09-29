// Returned verbatim, quotes and any weak prefix included: `If-Match` must
// carry exactly the entity-tag the read was served with.
export function readEtag(headers: Headers): string | null {
  return headers.get('etag');
}

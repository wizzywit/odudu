export function isLoopbackHost(hostname: string): boolean {
  // RFC 8252 §8.3 prefers the literal forms over `localhost`, whose
  // resolution is under the resolver's control — accepted here all the
  // same because nothing in RFC 7591 §5 forbids the weaker form.
  return hostname === '127.0.0.1' || hostname === '[::1]' || hostname === 'localhost';
}

// A page a person opens from one of Odudu's own pages: an https address to any
// host, or http to a loopback host, with no fragment (RFC 7591 §2's
// `client_uri`, `policy_uri` and `tos_uri`, and a tenant's terms).
export function isValidWebPageUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash !== '') return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && isLoopbackHost(url.hostname);
}

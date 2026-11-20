const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
];

// Headers the BFF owns on the way upstream: the browser's credentials and the
// markers of the request that came from it.
const NOT_FORWARDED = [
  'cookie',
  'host',
  'origin',
  'x-odudu-bff',
  'authorization',
  // The client's claim about its own address, which the upstream could trust.
  'forwarded',
  'x-real-ip',
];

function namedByConnection(headers: Headers): string[] {
  return (headers.get('connection') ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== '');
}

function without(headers: Headers, dropped: string[]): Headers {
  const drop = new Set([...HOP_BY_HOP, ...namedByConnection(headers), ...dropped]);
  const kept = new Headers();
  headers.forEach((value, name) => {
    if (!drop.has(name) && !name.startsWith('x-forwarded-')) kept.append(name, value);
  });
  return kept;
}

// What the upstream is sent: the browser's headers less its cookie, the
// hop-by-hop headers and the BFF's own, with the session's access token.
// Encoding is left to the client library, which decodes the answer, so the body
// is asked for as it is.
export function upstreamRequestHeaders(incoming: Headers, accessToken: string): Headers {
  const headers = without(incoming, NOT_FORWARDED);
  headers.set('authorization', `Bearer ${accessToken}`);
  headers.set('accept-encoding', 'identity');
  return headers;
}

// What the browser is sent: the upstream's headers less its cookies, which
// belong to the upstream and not to this origin, and the hop-by-hop headers.
export function browserResponseHeaders(upstream: Headers): Headers {
  const headers = without(upstream, ['set-cookie']);
  const encoding = headers.get('content-encoding');
  if (encoding !== null && encoding.toLowerCase() !== 'identity') {
    headers.delete('content-encoding');
    headers.delete('content-length');
  }
  return headers;
}

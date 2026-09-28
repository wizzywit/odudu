const CONSOLE_ADMIN = '/console/api/admin/';
const ADMIN = '/admin/';

const FORWARDED_REQUEST_HEADERS = ['content-type', 'if-match', 'if-none-match', 'accept'] as const;

const PASSED_RESPONSE_HEADERS = [
  'content-type',
  'etag',
  'location',
  'link',
  'cache-control',
] as const;

type IncomingHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;
type UpstreamHeaders = Readonly<Record<string, string | number | readonly string[] | undefined>>;
export type PassedHeaders = Record<string, string | string[]>;

// The in-process call resolves dot segments, `%2e` and `\` included, as a
// URL parser does, so the check is made on the path as it will resolve.
export function upstreamPath(consoleUrl: string): string | null {
  if (!consoleUrl.startsWith(CONSOLE_ADMIN)) return null;
  const path = consoleUrl.slice('/console/api'.length);
  return new URL(path, 'http://upstream.invalid').pathname.startsWith(ADMIN) ? path : null;
}

export function rewriteUri(uri: string): string {
  return uri.startsWith(ADMIN) ? `/console/api${uri}` : uri;
}

// RFC 8288 §3: each link's target is the URI-reference between < and >.
export function rewriteLink(value: string): string {
  return value.replace(/<([^>]*)>/gu, (_match, uri: string) => `<${rewriteUri(uri)}>`);
}

export function forwardedRequestHeaders(headers: IncomingHeaders): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = headers[name];
    if (value === undefined) continue;
    kept[name] = typeof value === 'string' ? value : value.join(', ');
  }
  return kept;
}

export function passedResponseHeaders(headers: UpstreamHeaders): PassedHeaders {
  const kept: PassedHeaders = {};
  for (const name of PASSED_RESPONSE_HEADERS) {
    const value = headers[name];
    if (value === undefined) continue;
    const values = typeof value === 'object' ? [...value] : String(value);
    if (name === 'location') kept[name] = mapValues(values, rewriteUri);
    else if (name === 'link') kept[name] = mapValues(values, rewriteLink);
    else kept[name] = values;
  }
  return kept;
}

function mapValues(
  values: string | string[],
  rewrite: (value: string) => string,
): string | string[] {
  return typeof values === 'string' ? rewrite(values) : values.map(rewrite);
}

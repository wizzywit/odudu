import * as oauth from 'oauth4webapi';
import { OduduError } from '#/services/odudu-error';
import type { Deps, ServerMetadata } from '#/types';

type CustomFetch = (
  url: string,
  options: oauth.CustomFetchOptions<string, RequestInit['body']>,
) => Promise<Response>;

// Hands the library's request to the caller's `fetch` member by member, which
// keeps an absent body or signal absent rather than present and undefined.
function throughFetch(fetcher: typeof fetch): CustomFetch {
  return (url, options) =>
    fetcher(url, {
      method: options.method,
      headers: options.headers,
      redirect: options.redirect,
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
}

// The options every oauth4webapi request here takes.
export function requestOptions(deps: Deps): {
  [oauth.customFetch]?: CustomFetch;
  [oauth.allowInsecureRequests]?: boolean;
} {
  return {
    ...(deps.fetch === undefined ? {} : { [oauth.customFetch]: throughFetch(deps.fetch) }),
    ...(deps.allowInsecureRequests === true ? { [oauth.allowInsecureRequests]: true } : {}),
  };
}

export async function fetchMetadata(issuer: string, deps: Deps): Promise<ServerMetadata> {
  try {
    const url = new URL(issuer);
    const response = await oauth.discoveryRequest(url, {
      algorithm: 'oidc',
      ...requestOptions(deps),
    });
    return await oauth.processDiscoveryResponse(url, response);
  } catch (cause) {
    throw new OduduError('discovery_failed', `could not read the metadata of ${issuer}`, { cause });
  }
}

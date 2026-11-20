import { logoutUrl, proxyUrl, sessionUrl, withBffHeader } from '#/services/bff';

export function requestSession(baseUrl: string): Promise<Response> {
  return fetch(sessionUrl(baseUrl), {
    headers: withBffHeader(undefined),
    credentials: 'same-origin',
  });
}

export function requestLogout(baseUrl: string): Promise<Response> {
  return fetch(logoutUrl(baseUrl), {
    method: 'POST',
    headers: withBffHeader(undefined),
    credentials: 'same-origin',
  });
}

export function requestProxy(baseUrl: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(proxyUrl(baseUrl, path), {
    ...init,
    headers: withBffHeader(init?.headers),
    credentials: 'same-origin',
  });
}

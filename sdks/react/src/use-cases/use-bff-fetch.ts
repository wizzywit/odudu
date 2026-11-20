import { callThroughProxy } from '#/repository/bff-session';
import { browserHasNoProxy } from '#/services/errors';
import { useAuthContext } from '#/use-cases/auth-context';

// `fetch` for the BFF's proxy: `path` is `<upstream name>/<path>`. The BFF
// answers 401 when the session is over, and the status follows.
export function useBffFetch(): (path: string, init?: RequestInit) => Promise<Response> {
  const { mode, sessionEnded } = useAuthContext();
  if (mode.kind !== 'bff') throw browserHasNoProxy();
  return async (path, init) => {
    const response = await callThroughProxy(mode.baseUrl, path, init);
    if (response.status === 401) sessionEnded();
    return response;
  };
}

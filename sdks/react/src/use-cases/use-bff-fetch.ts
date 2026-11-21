import { callThroughProxy } from '#/repository/bff-session';
import { browserHasNoProxy } from '#/services/errors';
import { useAuthContext } from '#/use-cases/auth-context';

// `fetch` for the BFF's proxy: `path` is `<upstream name>/<path>`. The BFF marks
// its own 401, the one that says the session is over, with `X-Odudu-Session:
// ended`, and the status follows that alone: an API's own 401 comes back
// unmarked and leaves the person signed in.
export function useBffFetch(): (path: string, init?: RequestInit) => Promise<Response> {
  const { mode, sessionEnded } = useAuthContext();
  if (mode.kind !== 'bff') throw browserHasNoProxy();
  return async (path, init) => {
    const response = await callThroughProxy(mode.baseUrl, path, init);
    if (response.status === 401 && response.headers.get('x-odudu-session') === 'ended') {
      sessionEnded();
    }
    return response;
  };
}

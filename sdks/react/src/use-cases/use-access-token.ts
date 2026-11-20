import { bffHasNoToken } from '#/services/errors';
import { useAuthContext } from '#/use-cases/auth-context';

// A function that resolves to a fresh access token for `resource` (the issuer's
// own when omitted). Browser mode only: with a BFF the browser holds no token.
export function useAccessToken(resource?: string): () => Promise<string> {
  const { mode, accessToken } = useAuthContext();
  if (mode.kind === 'bff') throw bffHasNoToken();
  return () => accessToken(resource);
}

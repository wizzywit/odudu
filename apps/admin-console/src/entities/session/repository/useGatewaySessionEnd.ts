import { logOut } from '#/entities/session/adapter/logout';
import { useTransport } from '#/shared/api/transport/useTransport';

// Ends the gateway's session whatever it answers: the caller leaves the
// console next in any case.
export function useGatewaySessionEnd(): () => Promise<void> {
  const { auth } = useTransport();
  return async () => {
    await logOut(auth).catch(() => undefined);
  };
}

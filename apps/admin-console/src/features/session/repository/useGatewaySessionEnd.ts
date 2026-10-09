import { logOut } from '#/features/session/adapter/logout.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// Ends the gateway's session whatever it answers: the caller leaves the
// console next in any case.
export function useGatewaySessionEnd(): () => Promise<void> {
  const { auth } = useTransport();
  return async () => {
    await logOut(auth).catch(() => undefined);
  };
}

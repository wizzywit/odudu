import { createContext, useContext } from 'react';
import type { Transport } from '#/shared/transport/transport.ts';

export const TransportContext = createContext<Transport | null>(null);

export function useTransport(): Transport {
  const transport = useContext(TransportContext);
  if (transport === null) throw new Error('useTransport needs a TransportContext above it');
  return transport;
}

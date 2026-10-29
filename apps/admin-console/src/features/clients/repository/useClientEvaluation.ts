import { useQuery } from '@tanstack/react-query';
import { evaluateClaims } from '#/features/clients/adapter/operations';
import { askedParts, evaluationOf, type Asked, type Evaluation } from '#/features/clients/service';
import { evaluateKey } from '#/shared/repository/queryKeys';
import { freshness } from '#/shared/service/read';
import { useTransport } from '#/shared/transport/useTransport';

// A read, made when asked for and again only when the question changes.
export function useEvaluation(tenant: string, clientDbId: string, asked: Asked | null): Evaluation {
  const { gateway } = useTransport();
  const query = useQuery({
    queryKey: evaluateKey(tenant, clientDbId, ...askedParts(asked)),
    enabled: asked !== null,
    // Each ask is audited, so only the person asking makes one: not a
    // refocused window, a reconnect or a remount.
    ...freshness(true),
    gcTime: 0,
    refetchOnReconnect: false,
    refetchOnMount: false,
    queryFn: () =>
      asked === null ? Promise.resolve(null) : evaluateClaims(gateway, tenant, clientDbId, asked),
  });
  return evaluationOf(asked, query.data);
}

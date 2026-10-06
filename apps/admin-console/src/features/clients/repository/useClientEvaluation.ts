import type { EvaluateClaimsResponse } from '@odudu/contracts/admin';
import { useQuery } from '@tanstack/react-query';
import { evaluateClaims } from '#/features/clients/adapter/operations.ts';
import { readAdministratorPage } from '#/shared/adapter/administrators.ts';
import { usePicker } from '#/shared/repository/usePicker.ts';
import type { PickerState } from '#/shared/service/picker.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export type { PickerState };

// The subjects to choose from, searched by username on the server.
export function useSubjectPicker(tenant: string) {
  return usePicker({
    tenant,
    resource: 'subjects',
    field: 'username',
    read: (gateway, query) => readAdministratorPage(gateway, tenant, query),
  });
}

export interface Evaluation {
  // Nothing was asked, the answer is awaited, or it came.
  status: 'idle' | 'loading' | 'ready';
  result: GatewayResult<EvaluateClaimsResponse> | null;
}

// A read, made when asked for and again only when the question changes.
export function useEvaluation(
  tenant: string,
  clientDbId: string,
  asked: { subject: string; scope: string; press: number } | null,
): Evaluation {
  const { gateway } = useTransport();
  const query = useQuery({
    queryKey: [
      'evaluate',
      tenant,
      clientDbId,
      asked?.subject ?? '',
      asked?.scope ?? '',
      asked?.press ?? 0,
    ],
    enabled: asked !== null,
    // Each ask is audited, so only the person asking makes one: not a
    // refocused window, a reconnect or a remount.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    queryFn: () =>
      asked === null ? Promise.resolve(null) : evaluateClaims(gateway, tenant, clientDbId, asked),
  });
  if (asked === null) return { status: 'idle', result: null };
  return query.data === undefined
    ? { status: 'loading', result: null }
    : { status: 'ready', result: query.data };
}

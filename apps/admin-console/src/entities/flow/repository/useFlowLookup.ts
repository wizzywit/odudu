import type { FlowWire } from '#/entities/flow/types/flow';
import { findFlow } from '#/entities/flow/repository/findFlow';
import type { GatewayResult } from '#/shared/api/transport/gateway';
import { useTransport } from '#/shared/api/transport/useTransport';

// Looks a flow up by name in the tenant's list, over the transport this session holds.
export function useFlowLookupRead(): (
  tenant: string,
  name: string,
) => Promise<GatewayResult<FlowWire | null>> {
  const { gateway } = useTransport();
  return (tenant, name) => findFlow(gateway, tenant, name);
}

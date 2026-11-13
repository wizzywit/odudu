import type { FlowWire } from '#/entities/flow/types/flow';
import { readFlows } from '#/entities/flow/adapter/flows';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';

// For a creation whose answer was lost: the flow of that name, if the tenant has it.
export async function findFlow(
  gateway: Gateway,
  tenant: string,
  name: string,
): Promise<GatewayResult<FlowWire | null>> {
  const result = await readFlows(gateway, tenant);
  if (!result.ok) return result;
  return { ...result, data: result.data.items.find((flow) => flow.name === name) ?? null };
}

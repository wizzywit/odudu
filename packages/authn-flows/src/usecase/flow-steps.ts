import { type TenantScopedDatabase } from '@odudu/db';
import { flowRepository } from '#/repository/flows';
import { type FlowStep } from '#/schema/flow';
import { resolveFlow } from '#/service/flow';

// The steps of the flow a sign-in runs: the one it names, else the tenant's
// default, read with one query either way. A flow that is not there, or a
// tenant with no default, has nothing to run, so the sign-in fails as one
// whose flow is empty does, and says nothing of why.
export async function flowSteps(
  tx: TenantScopedDatabase,
  tenantId: string,
  flowId: string | null,
): Promise<readonly FlowStep[]> {
  const found = await flowRepository(tx).forSignIn(tenantId, flowId);
  const resolved = resolveFlow(found === null ? [] : [found], flowId);
  return resolved.kind === 'ok' ? resolved.flow.steps : [];
}

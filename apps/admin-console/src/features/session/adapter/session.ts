import { whoamiResponseSchema } from '@odudu/contracts/admin';
import { z } from 'zod';
import type { Authority, Principal } from '#/features/session/service';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';

// GET /console/api/session is the gateway's own, so it has no contract in
// @odudu/contracts; whoami's does.
const sessionSchema = z
  .object({ tenant: z.string(), subject_id: z.string(), username: z.string() })
  .transform((body): Principal => ({
    tenant: body.tenant,
    subjectId: body.subject_id,
    username: body.username,
  }));

const authoritySchema = whoamiResponseSchema.transform((body): Authority => ({
  capabilities: body.capabilities,
  crossTenant: body.crossTenant,
}));

export function readSession(gateway: Gateway): Promise<GatewayResult<Principal>> {
  return gateway.request('GET', 'session', { schema: sessionSchema });
}

export function readAuthority(gateway: Gateway, tenant: string): Promise<GatewayResult<Authority>> {
  return gateway.request('GET', `admin/tenants/${encodeURIComponent(tenant)}/whoami`, {
    schema: authoritySchema,
  });
}

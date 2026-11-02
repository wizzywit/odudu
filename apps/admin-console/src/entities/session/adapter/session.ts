import { whoamiResponseSchema } from '@odudu/contracts/admin';
import { z } from 'zod';
import type { Authority } from '#/shared/services/principal';
import type { Principal } from '#/entities/session/types/principal';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { adminCall } from '#/shared/adapter/route';

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
  return adminCall(gateway, 'GET', tenant, ['whoami'], {
    schema: authoritySchema,
  });
}

import type { SendActionsEmailRequest } from '@odudu/contracts/admin';
import { z } from 'zod';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';

// Each answers 202 with no body: the link is never in the response.
const accepted = z.undefined();

export function sendPasswordReset(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<undefined>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(subjectId);
  return gateway.request('POST', `admin/tenants/${t}/subjects/${id}/password-reset`, {
    schema: accepted,
  });
}

export function sendVerification(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<undefined>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(subjectId);
  return gateway.request('POST', `admin/tenants/${t}/subjects/${id}/verification`, {
    schema: accepted,
  });
}

export function sendActionsEmail(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  body: SendActionsEmailRequest,
): Promise<GatewayResult<undefined>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(subjectId);
  return gateway.request('POST', `admin/tenants/${t}/subjects/${id}/actions-email`, {
    body,
    schema: accepted,
  });
}

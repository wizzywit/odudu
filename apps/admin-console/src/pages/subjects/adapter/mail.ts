import type { SendActionsEmailRequest } from '@odudu/contracts/admin';
import { z } from 'zod';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { adminCall } from '#/shared/adapter/route';

export type MailRequest =
  { kind: 'reset' } | { kind: 'verification' } | { kind: 'actions'; body: SendActionsEmailRequest };

// Each answers 202 with no body: the link is never in the response.
const accepted = z.undefined();

export function sendPasswordReset(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'POST', tenant, ['subjects', subjectId, 'password-reset'], {
    schema: accepted,
  });
}

export function sendVerification(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'POST', tenant, ['subjects', subjectId, 'verification'], {
    schema: accepted,
  });
}

export function sendActionsEmail(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  body: SendActionsEmailRequest,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'POST', tenant, ['subjects', subjectId, 'actions-email'], {
    body,
    schema: accepted,
  });
}

export function sendMail(
  gateway: Gateway,
  tenant: string,
  subjectId: string,
  request: MailRequest,
): Promise<GatewayResult<undefined>> {
  if (request.kind === 'reset') return sendPasswordReset(gateway, tenant, subjectId);
  if (request.kind === 'verification') return sendVerification(gateway, tenant, subjectId);
  return sendActionsEmail(gateway, tenant, subjectId, request.body);
}

import {
  smtpConfigSchema,
  testSmtpResponseSchema,
  type PutSmtpRequest,
  type SmtpConfig,
  type TestSmtpResponse,
} from '@odudu/contracts/admin';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { adminCall, nothing } from '#/shared/adapter/route';

// A full replace, except for the password: left out, the stored one is kept.
export function putSmtp(
  gateway: Gateway,
  tenant: string,
  relay: PutSmtpRequest,
  ifMatch: string,
): Promise<GatewayResult<SmtpConfig>> {
  return adminCall(gateway, 'PUT', tenant, ['smtp'], {
    body: relay,
    ifMatch,
    schema: smtpConfigSchema,
  });
}

export function deleteSmtp(gateway: Gateway, tenant: string): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['smtp'], { schema: nothing });
}

export function testSmtp(
  gateway: Gateway,
  tenant: string,
  to: string,
  clientId: string | null,
): Promise<GatewayResult<TestSmtpResponse>> {
  return adminCall(gateway, 'POST', tenant, ['smtp', 'test'], {
    body: clientId === null ? { to } : { to, client_id: clientId },
    schema: testSmtpResponseSchema,
  });
}

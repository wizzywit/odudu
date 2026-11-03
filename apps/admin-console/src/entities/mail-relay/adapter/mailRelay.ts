import { smtpConfigSchema } from '@odudu/contracts/admin';
import { adminCall } from '#/shared/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import type { SmtpConfig } from '#/entities/mail-relay/types/mailRelay';

// The relay the tenant has set, read by the email page and the overview.
export function readSmtp(gateway: Gateway, tenant: string): Promise<GatewayResult<SmtpConfig>> {
  return adminCall(gateway, 'GET', tenant, ['smtp'], {
    schema: smtpConfigSchema,
  });
}

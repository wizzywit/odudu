import { putSmtp } from '#/pages/email/adapter/smtp';
import { relayRequest, type RelayValues } from '#/pages/email/services/relay';
import type { SaveInput } from '#/shared/lib/repository/useSectionSave';
import type { Gateway } from '#/shared/api/transport/gateway';

export function smtpSave(tenant: string) {
  return (gateway: Gateway, { values, ifMatch }: SaveInput<RelayValues>) =>
    putSmtp(gateway, tenant, relayRequest(values), ifMatch);
}

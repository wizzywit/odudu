import { putSmtp } from '#/pages/email/adapter/smtp';
import { relayRequest, type RelayValues } from '#/pages/email/services/relay';
import type { SaveInput } from '#/shared/repository/useSectionSave';
import type { Gateway } from '#/shared/transport/gateway';

export function smtpSave(tenant: string) {
  return (gateway: Gateway, { values, ifMatch }: SaveInput<RelayValues>) =>
    putSmtp(gateway, tenant, relayRequest(values), ifMatch);
}

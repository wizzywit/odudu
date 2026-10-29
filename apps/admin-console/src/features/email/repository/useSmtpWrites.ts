import type { TestSmtpResponse } from '@odudu/contracts/admin';
import { deleteSmtp, testSmtp } from '#/features/email/adapter/smtp';
import { useGatewayWrite, type Write } from '#/shared/repository/useWrite';
import type { GatewayResult } from '#/shared/transport/gateway';

export interface TestRequest {
  to: string;
  // The client's row id the message is dressed as, or none for the tenant's own look.
  clientId: string | null;
}

export function useSmtpTest(tenant: string): Write<TestRequest, GatewayResult<TestSmtpResponse>> {
  return useGatewayWrite({
    send: (gateway, request: TestRequest) =>
      testSmtp(gateway, tenant, request.to, request.clientId),
  });
}

export function useSmtpRemove(tenant: string): Write<void, GatewayResult<undefined>> {
  return useGatewayWrite({ send: (gateway) => deleteSmtp(gateway, tenant) });
}

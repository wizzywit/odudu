import { sendMail, type MailRequest } from '#/pages/subjects/adapter/mail';
import { useWrite } from '#/shared/lib/repository/useWrite';
import type { GatewayResult } from '#/shared/api/transport/gateway';

export type { MailRequest };

export interface MailSend {
  busy: boolean;
  send: (request: MailRequest) => Promise<GatewayResult<undefined>>;
}

// A mail is never sent twice on its own: a lost answer is said, not retried.
export function useMailSend(tenant: string, id: string): MailSend {
  const mutation = useWrite({
    send: (gateway, request: MailRequest) => sendMail(gateway, tenant, id, request),
  });
  return { busy: mutation.busy, send: mutation.run };
}

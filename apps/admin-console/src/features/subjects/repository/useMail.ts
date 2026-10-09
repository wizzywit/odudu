import { useMutation } from '@tanstack/react-query';
import { sendMail, type MailRequest } from '#/features/subjects/adapter/mail.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export type { MailRequest };

export interface MailSend {
  busy: boolean;
  send: (request: MailRequest) => Promise<GatewayResult<undefined>>;
}

// A mail is never sent twice on its own: a lost answer is said, not retried.
export function useMailSend(tenant: string, id: string): MailSend {
  const { gateway } = useTransport();
  const mutation = useMutation({
    mutationFn: (request: MailRequest) => sendMail(gateway, tenant, id, request),
  });
  return { busy: mutation.isPending, send: (request) => mutation.mutateAsync(request) };
}

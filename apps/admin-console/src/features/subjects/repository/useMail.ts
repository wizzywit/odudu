import type { SendActionsEmailRequest } from '@odudu/contracts/admin';
import { useMutation } from '@tanstack/react-query';
import {
  sendActionsEmail,
  sendPasswordReset,
  sendVerification,
} from '#/features/subjects/adapter/mail.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export type MailRequest =
  { kind: 'reset' } | { kind: 'verification' } | { kind: 'actions'; body: SendActionsEmailRequest };

export interface MailSend {
  busy: boolean;
  send: (request: MailRequest) => Promise<GatewayResult<undefined>>;
}

// A mail is never sent twice on its own: a lost answer is said, not retried.
export function useMailSend(tenant: string, id: string): MailSend {
  const { gateway } = useTransport();
  const mutation = useMutation({
    mutationFn: (request: MailRequest) => {
      switch (request.kind) {
        case 'reset':
          return sendPasswordReset(gateway, tenant, id);
        case 'verification':
          return sendVerification(gateway, tenant, id);
        case 'actions':
          return sendActionsEmail(gateway, tenant, id, request.body);
      }
    },
  });
  return { busy: mutation.isPending, send: (request) => mutation.mutateAsync(request) };
}

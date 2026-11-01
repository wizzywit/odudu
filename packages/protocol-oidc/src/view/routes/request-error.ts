import { type MessageValues } from '@odudu/i18n';
import { type FastifyReply } from 'fastify';
import { renderAuthorizeErrorPage } from '#/view/authorize-html';
import { sendHtml } from '#/view/html-response';
import { t, type MessageId } from '#/view/messages';
import { brandedRequestLocale, type ContinuationDeps } from '#/view/routes/continuation';

// The error page for a request that is no part of a parked sign-in: the
// sentence is the catalogue's, in the language the browser asked for.
export async function sendRequestError(
  reply: FastifyReply,
  deps: Pick<ContinuationDeps, 'findTenant' | 'resolveBranding' | 'resolveOverrides'>,
  tenantName: string,
  status: number,
  messageId: MessageId,
  values?: MessageValues,
): Promise<FastifyReply> {
  const locale = await brandedRequestLocale(deps, reply, tenantName);
  return sendHtml(
    reply,
    status,
    renderAuthorizeErrorPage('invalid_request', t(locale, messageId, values), undefined, locale),
  );
}

import { type FastifyReply } from 'fastify';
import { requestLocale } from '#/view/routes/continuation';
import { sendHtml } from '#/view/html-response';
import { renderPreviousAddressPage } from '#/view/previous-address-html';

// 410: the address was served and is not coming back. Never cached, because
// the same address serves its other paths for the rest of the window.
export function sendPreviousAddressPage(
  reply: FastifyReply,
  canonicalAddress: string,
): FastifyReply {
  return sendHtml(
    reply.header('cache-control', 'no-store').header('vary', 'Accept-Language, Cookie'),
    410,
    renderPreviousAddressPage(canonicalAddress, requestLocale(reply)),
  );
}

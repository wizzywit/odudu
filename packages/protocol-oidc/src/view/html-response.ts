import { pageHeaders, type RenderedPage } from '@odudu/kernel';
import { type FastifyReply } from 'fastify';

// The single exit for every page this server renders to an end-user, so the
// headers `pageHeaders` (`@odudu/kernel`) names cannot be forgotten on a
// page added later. A plain string is a page with no script of its own; a
// RenderedPage carries the nonce its own markup used, so the two halves are
// one value.
// `html-response.test.ts` holds the view layer to naming the HTML media
// type nowhere else.
export function sendHtml(
  reply: FastifyReply,
  status: number,
  page: string | RenderedPage,
): FastifyReply {
  const withHeaders = pageHeaders(page).reduce(
    (r, [name, value]) => r.header(name, value),
    reply.code(status).type('text/html'),
  );
  return withHeaders.send(typeof page === 'string' ? page : page.html);
}

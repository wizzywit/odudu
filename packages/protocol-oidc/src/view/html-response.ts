import { pageHeaders, type RenderedPage } from '@odudu/kernel';
import { type FastifyReply } from 'fastify';

// The single exit for every page this server renders to an end-user, so the
// headers `pageHeaders` (`@odudu/kernel`) names cannot be forgotten on a
// page added later. Every renderer returns a RenderedPage, which carries
// the nonce its own markup used, so the policy sent with a page can never
// name a script the page does not carry.
// `html-response.test.ts` holds the view layer to naming the HTML media
// type nowhere else.
export function sendHtml(reply: FastifyReply, status: number, page: RenderedPage): FastifyReply {
  const withHeaders = pageHeaders(page).reduce(
    (r, [name, value]) => r.header(name, value),
    reply.code(status).type('text/html'),
  );
  return withHeaders.send(page.html);
}

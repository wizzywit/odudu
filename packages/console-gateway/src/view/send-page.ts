import { pageHeaders, type RenderedPage } from '@odudu/kernel';
import { type FastifyReply } from 'fastify';

export function sendPage(reply: FastifyReply, status: number, page: RenderedPage): FastifyReply {
  const withHeaders = pageHeaders(page).reduce(
    (r, [name, value]) => r.header(name, value),
    reply.code(status).type('text/html; charset=utf-8'),
  );
  return withHeaders.send(page.html);
}

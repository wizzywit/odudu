import { pageHeaders, type RenderedPage } from '@odudu/kernel';
import { type FastifyReply } from 'fastify';
import { page } from '#/view/document';

export function sendVerificationHtml(
  reply: FastifyReply,
  status: number,
  rendered: RenderedPage,
): FastifyReply {
  const withHeaders = pageHeaders(rendered).reduce(
    (r, [name, value]) => r.header(name, value),
    reply.code(status).type('text/html'),
  );
  return withHeaders.send(rendered.html);
}

export function renderVerificationSucceededPage(): RenderedPage {
  return page(
    'Email verified',
    `<h1>Your email address is verified</h1>
<p>You can close this page and sign in.</p>`,
  );
}

export function renderVerificationFailedPage(): RenderedPage {
  return page(
    "Can't verify this link",
    `<h1>This link can't be used</h1>
<p>It may have already been used, expired, or no longer matches your email address. Request a new verification email and try again.</p>`,
  );
}

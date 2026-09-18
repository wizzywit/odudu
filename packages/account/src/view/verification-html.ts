import { pageHeaders } from '@odudu/kernel';
import { type FastifyReply } from 'fastify';

export function sendVerificationHtml(
  reply: FastifyReply,
  status: number,
  html: string,
): FastifyReply {
  const withHeaders = pageHeaders(html).reduce(
    (r, [name, value]) => r.header(name, value),
    reply.code(status).type('text/html'),
  );
  return withHeaders.send(html);
}

export function renderVerificationSucceededPage(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Email verified</title></head>
<body>
<h1>Your email address is verified</h1>
<p>You can close this page and sign in.</p>
</body>
</html>`;
}

export function renderVerificationFailedPage(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Can't verify this link</title></head>
<body>
<h1>This link can't be used</h1>
<p>It may have already been used, expired, or no longer matches your email address. Request a new verification email and try again.</p>
</body>
</html>`;
}

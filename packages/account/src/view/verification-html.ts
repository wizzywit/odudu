import { type FastifyReply } from 'fastify';

// RFC 6749 §10.13's framing defence, duplicated from
// packages/protocol-oidc/src/view/html-response.ts rather than imported:
// that module is a protocol package's internal, and no feature reaches into
// another's internals (CLAUDE.md, Layering). ADR 0018 has the reasoning.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
].join('; ');

export function sendVerificationHtml(
  reply: FastifyReply,
  status: number,
  html: string,
): FastifyReply {
  return (
    reply
      .code(status)
      .type('text/html')
      .header('content-security-policy', CONTENT_SECURITY_POLICY)
      .header('x-frame-options', 'DENY')
      // Defence in depth for the query-string tokens these pages carry: CSP's
      // default-src already stops a subresource request from leaking one via
      // Referer, but a link a user actually clicks away from this page — or a
      // browser extension, or a proxy — is not a subresource. no-referrer
      // means neither the origin nor the path is sent anywhere from here.
      .header('referrer-policy', 'no-referrer')
      .send(html)
  );
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

import { randomBytes } from 'node:crypto';
import { type FastifyReply } from 'fastify';

// RFC 6749 §10.13's framing defence for the pages rendered to an end-user.
// Almost all of these pages are markup only — no script, stylesheet, image
// or frame of their own — so `default-src 'none'` describes them exactly and
// a subresource added later breaks visibly. X-Frame-Options: DENY rides
// alongside `frame-ancestors 'none'` for agents with no CSP at all, and may
// only stay while the two agree. ADR 0018 has the reasoning for each
// directive and for the pairing.
const BASE_DIRECTIVES = [
  "default-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
];

// A WebAuthn page is the exception (ADR 0018's amendment): only a script
// can reach an authenticator, and `default-src 'none'` blocks an inline one
// silently — the page looks broken rather than refused. It gets a
// per-response nonce rather than 'unsafe-inline', which would licence every
// injected script on the page as well as the intended one, and
// `connect-src 'self'` for the one request the script makes.
export function scriptNonce(): string {
  return randomBytes(16).toString('base64');
}

function policyFor(nonce: string | undefined): string {
  const directives =
    nonce === undefined
      ? BASE_DIRECTIVES
      : [...BASE_DIRECTIVES, `script-src 'nonce-${nonce}'`, "connect-src 'self'"];
  return directives.join('; ');
}

// The single exit for every page this server renders to an end-user, so the
// headers above cannot be forgotten on a page added later.
// `html-response.test.ts` holds the view layer to naming the HTML media
// type nowhere else.
export function sendHtml(
  reply: FastifyReply,
  status: number,
  html: string,
  scriptNonce?: string,
): FastifyReply {
  return reply
    .code(status)
    .type('text/html')
    .header('content-security-policy', policyFor(scriptNonce))
    .header('x-frame-options', 'DENY')
    .send(html);
}

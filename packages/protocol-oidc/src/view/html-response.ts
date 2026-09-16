import { type RenderedPage } from '@odudu/kernel';
import { type FastifyReply } from 'fastify';

// RFC 6749 §10.13's framing defence for the pages rendered to an end-user.
// Almost all of these pages are markup only — no script, stylesheet, image
// or frame of their own — so `default-src 'none'` describes them exactly.
// X-Frame-Options: DENY rides alongside `frame-ancestors 'none'` for agents
// with no CSP at all, and may only stay while the two agree. ADR 0018 has
// the reasoning for each directive and for the pairing.
const BASE_DIRECTIVES = [
  "default-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
];

// A WebAuthn page is the exception (ADR 0018's amendment): only a script
// can reach an authenticator, and `default-src 'none'` blocks an inline one
// silently, so the page looks broken rather than refused. The page says
// what it carries and the policy is derived from that — never assembled
// beside it, which is how a header and an element come to disagree.
function policyFor(page: string | RenderedPage): string {
  const script = typeof page === 'string' ? null : page.script;
  if (script === null) return BASE_DIRECTIVES.join('; ');
  return [
    ...BASE_DIRECTIVES,
    `script-src 'nonce-${script.nonce}'`,
    // Only for a script that actually makes a request. A page handed its
    // options inline asks for nothing, and a directive licensing nothing
    // stops describing the page.
    ...(script.fetchesSameOrigin ? ["connect-src 'self'"] : []),
  ].join('; ');
}

// The single exit for every page this server renders to an end-user, so the
// headers above cannot be forgotten on a page added later. A plain string
// is a page with no script of its own; a RenderedPage carries the nonce its
// own markup used, so the two halves are one value.
// `html-response.test.ts` holds the view layer to naming the HTML media
// type nowhere else.
export function sendHtml(
  reply: FastifyReply,
  status: number,
  page: string | RenderedPage,
): FastifyReply {
  return reply
    .code(status)
    .type('text/html')
    .header('content-security-policy', policyFor(page))
    .header('x-frame-options', 'DENY')
    .send(typeof page === 'string' ? page : page.html);
}

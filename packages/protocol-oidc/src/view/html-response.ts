import { type FastifyReply } from 'fastify';

// RFC 6749 §10.13 obliges the authorization server to defend the pages it
// renders to the end-user against framing: an invisible overlay over a
// framed sign-in form harvests the credentials, or the click that grants
// authorization, while the end-user believes they are using the attacker's
// page.
//
// `frame-ancestors 'none'` is the countermeasure, and X-Frame-Options: DENY
// rides alongside it rather than instead of it. CSP is the mechanism still
// being specified and extended, and it is defined over the entire ancestor
// chain, so a page framed by a same-origin document that is itself framed
// by an attacker is still refused — X-Frame-Options only ever described the
// immediate parent, and its ALLOW-FROM form was never interoperable and is
// obsolete. Every user agent that implements CSP honours frame-ancestors
// and, where both are present, ignores X-Frame-Options; the older header is
// therefore only read by agents with no CSP at all, and DENY and 'none' say
// the same thing, which is the one pairing where X-Frame-Options' missing
// ancestor-chain semantics cannot make the two disagree.
//
// The rest of the policy is small because these pages are: markup only, no
// script, no stylesheet, no image, no frame of their own. `default-src
// 'none'` describes them exactly, so a subresource added later breaks
// visibly instead of quietly widening what injected markup could reach.
// `form-action 'self'` keeps the login form posting to this origin, and
// `base-uri 'none'` stops an injected `<base>` re-targeting its relative
// action — both narrow the blast radius of an escaping failure in
// authorize-html.ts rather than duplicating its escaping.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
].join('; ');

// The single exit for every page this server renders to an end-user: the
// login form and each of the error pages. Routes call this rather than
// setting a content type themselves, so the headers above cannot be
// forgotten on a page added later — `html-response.test.ts` holds the view
// layer to naming the HTML media type nowhere else.
export function sendHtml(reply: FastifyReply, status: number, html: string): FastifyReply {
  return reply
    .code(status)
    .type('text/html')
    .header('content-security-policy', CONTENT_SECURITY_POLICY)
    .header('x-frame-options', 'DENY')
    .send(html);
}

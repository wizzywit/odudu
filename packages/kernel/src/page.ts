// What a rendered page needs allowed, when it needs anything beyond
// markup. Returned by the renderer rather than decided by the caller, so
// the page and the policy sent with it cannot disagree — a Content
// Security Policy refusal is invisible in a response and shows up only in
// a real browser, so nothing else would catch a divergence (ADR 0018's
// amendment).
export interface PageScript {
  // The value the page's own <script> element carries.
  nonce: string;
  // Whether that script makes a request of its own. False for a page that
  // was handed everything it needs inline.
  fetchesSameOrigin: boolean;
}

export interface RenderedPage {
  html: string;
  script: PageScript | null;
}

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

// The one authority for the headers every rendered page carries, so a
// package's reply wrapper is two lines that spread this and cannot
// diverge from another package's. A plain string is a page with no script
// of its own; a RenderedPage carries the nonce its own markup used, so the
// two halves are one value.
export function pageHeaders(page: string | RenderedPage): readonly (readonly [string, string])[] {
  return [
    ['content-security-policy', policyFor(page)],
    ['x-frame-options', 'DENY'],
    // Defence in depth for the query-string tokens some of these pages
    // carry: default-src already stops a subresource leaking one via
    // Referer, but a link a user clicks away from is not a subresource.
    ['referrer-policy', 'no-referrer'],
  ];
}

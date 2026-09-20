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
  // The whole document, as the server sends it today.
  html: string;
  // Everything inside <body>. What a theme is allowed to place; see
  // ADR 0030 for why it is never handed the document.
  body: string;
  // The document's title, so a theme's own shell can set one.
  title: string;
  script: PageScript | null;
  // The exact origins this page's own markup frames. `frame-src` is derived
  // from it, so a policy can never license an origin the markup does not
  // embed, nor refuse one it does — the failure mode ADR 0018's amendment
  // describes for scripts, which is silent for frames in the same way.
  frames: readonly string[];
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
function policyFor(page: RenderedPage): string {
  const script = page.script;
  const directives =
    script === null
      ? [...BASE_DIRECTIVES]
      : [
          ...BASE_DIRECTIVES,
          `script-src 'nonce-${script.nonce}'`,
          // Only for a script that actually makes a request. A page handed
          // its options inline asks for nothing, and a directive licensing
          // nothing stops describing the page.
          ...(script.fetchesSameOrigin ? ["connect-src 'self'"] : []),
        ];
  // Two clients may register a logout URI on the same host, and the list is
  // built per relying party, so a duplicate origin is expected rather than
  // exceptional.
  const framed = [...new Set(page.frames)];
  if (framed.length > 0) directives.push(`frame-src ${framed.join(' ')}`);
  return directives.join('; ');
}

// The one authority for the headers every rendered page carries, so a
// package's reply wrapper is two lines that spread this and cannot
// diverge from another package's. Every renderer returns a RenderedPage —
// the nonce its own markup used travels with it, so the policy sent with a
// page can never name a script the page does not carry.
export function pageHeaders(page: RenderedPage): readonly (readonly [string, string])[] {
  return [
    ['content-security-policy', policyFor(page)],
    // Governs this page being framed, not this page framing others — that
    // direction is `frame-src`, above. Untouched by `frames`.
    ['x-frame-options', 'DENY'],
    // Defence in depth for the query-string tokens some of these pages
    // carry: default-src already stops a subresource leaking one via
    // Referer, but a link a user clicks away from is not a subresource.
    ['referrer-policy', 'no-referrer'],
  ];
}

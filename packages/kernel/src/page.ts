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

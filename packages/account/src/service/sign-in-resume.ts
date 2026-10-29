// The sign-in a browser still holds, as the composition root resolves it from
// the browser's cookie: the parked session and the authorize path rebuilt from
// the request it parked (null when that request cannot be rebuilt faithfully,
// as one bound to a subject by a hint cannot).
export interface HeldSignIn {
  readonly sessionId: string;
  readonly signInPath: string | null;
  // The OAuth client_id the parked request was made for: server-side state,
  // set when the request was accepted.
  readonly clientId: string;
}

// Resolved at the composition root, where the cookie's secret and the parked
// request are both reachable; `header` is the request's raw Cookie header.
export type FindHeldSignIn = (
  tenant: { readonly id: string; readonly name: string },
  header: string | undefined,
) => Promise<HeldSignIn | null>;

// Which sign-in a mailed link may name: the one this browser holds, and only
// when the page it asked from carried that same request. Two tabs signing in
// to different applications share one cookie, which names the later; the
// earlier tab's form carries its own request, they differ, and no link is
// tied to a request the person did not ask from.
export function referenceToResume(held: HeldSignIn | null, returnTo: string | null): string | null {
  if (held === null || returnTo === null || held.signInPath !== returnTo) return null;
  return held.sessionId;
}

// The client a mail queued out of this sign-in may wear: the held sign-in's
// own, under the same condition as the link back to it. It is never read from
// what the page carried, which only has to equal the held request.
export function clientOfHeldSignIn(held: HeldSignIn | null, returnTo: string | null): string | null {
  return referenceToResume(held, returnTo) === null ? null : (held?.clientId ?? null);
}

// Where a token's page may send the browser: the original request, only
// while this browser holds the very sign-in the token names. Anything else
// (another browser, an expired or finished sign-in, an administrator's link)
// reads the same, so the page cannot be used to tell them apart.
export function resumablePath(held: HeldSignIn | null, reference: string | null): string | null {
  if (held === null || reference === null || held.sessionId !== reference) return null;
  return held.signInPath;
}

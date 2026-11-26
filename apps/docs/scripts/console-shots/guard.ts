// Refuses a short list of known shapes, not a proof that a page holds no secret:
// the given strings, a filled password field, the console's "shown once"
// sentence, a generated-looking token (32+ characters, mixed case with a digit)
// and the setup banner's password line, before the shot's rewrite and after it.
// It cannot catch a secret under 32 characters, one without upper case, lower
// case or a digit (hex, a word-like password), a short token with four hyphens,
// one split across text nodes or drawn as an image, or a toast shown and gone
// between the two scans. Read each sidecar record for what a page held.
export interface Visible {
  // Every text node, hidden ones included.
  readonly text: string;
  // Every attribute value on the page.
  readonly attributes: readonly string[];
  readonly fieldValues: readonly string[];
  readonly passwordFieldsFilled: number;
}

// SecretDialog's own sentence, wherever it is rendered (a dialog, a toast, a panel).
const SHOWN_ONCE = /only time the .+ is shown/iu;
const PASSWORD_LINE = /^\s*password:\s*[A-Za-z0-9_-]{12,}\s*$/imu;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
// The public half of a published key: an EC point (x, y) or an RSA modulus (n)
// is as long and as random as a secret and is served to anybody. The private
// members (d, p, q, ...) are not named here, so they are still refused.
const PUBLIC_KEY_MEMBER = /"(?:x|y|n)"\s*:\s*"[A-Za-z0-9_-]+"/gu;
// A built chunk is named by what it holds and a hash, as in
// /console/assets/useGridSelectionCheckbox-RPsVRr9v.js, and is as long and as mixed as a secret.
const BUILT_ASSET = /\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)\b/gu;
// 24 random bytes as base64url, which is what a one-time password is.
const GENERATED = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/u;

// Random base64url mixes cases and digits and holds about one hyphen in sixty-four
// characters, so a long key holds several; an identifier such as a component
// id is words joined by hyphens, about one in eight characters.
function looksRandom(token: string): boolean {
  return (
    /\d/u.test(token) &&
    /[A-Z]/u.test(token) &&
    /[a-z]/u.test(token) &&
    token.split('-').length - 1 <= Math.max(3, token.length / 12)
  );
}

export function findSecrets(visible: Visible, known: readonly string[]): string[] {
  const found: string[] = [];
  const surfaces = [visible.text, ...visible.attributes, ...visible.fieldValues];
  for (const secret of known) {
    if (secret !== '' && surfaces.some((value) => value.includes(secret))) {
      found.push('the page shows a value it was given to refuse');
    }
  }
  if (visible.passwordFieldsFilled > 0) found.push('a password field is filled');
  // Text nodes arrive one per line, and the sentence spans several.
  if (SHOWN_ONCE.test(visible.text.replace(/\s+/gu, ' '))) {
    found.push('the page shows a secret once');
  }
  if (PASSWORD_LINE.test(visible.text)) found.push('a line shows a password');
  for (const value of surfaces) {
    const token = GENERATED.exec(
      value.replaceAll(UUID, '').replaceAll(PUBLIC_KEY_MEMBER, '').replaceAll(BUILT_ASSET, ''),
    )?.[0];
    if (token !== undefined && looksRandom(token)) {
      found.push(
        `a token the shape of a generated secret is on the page (${token.slice(0, 4)}…, ${String(token.length)} characters)`,
      );
    }
  }
  return found;
}

import { scriptNonce } from '#/ids';
import { PAGE_KINDS, type PageKind } from '#/page-kinds';
import { isPageTheme, pageThemeFromCookies, type PageTheme } from '#/page-theme';

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

// What a page is rendered for: the language it is written in and the
// direction it reads, negotiated per response by @odudu/i18n (whose own type
// holds those two and is assignable to this one), and the light or dark
// choice read from the request's cookie, which i18n knows nothing of.
// Declared here because the transport-free kernel cannot import i18n.
export interface PageLocale {
  readonly tag: string;
  readonly dir: 'ltr' | 'rtl';
  // The light or dark choice the person made in the console, when they made
  // one; absent means follow the operating system.
  readonly theme?: PageTheme;
  // The tenant's or client's own look, when one is published.
  readonly branding?: ResolvedBranding;
  // Told when a template of the branding could not be filled and the default
  // was used instead; whoever resolved the branding knows its scope to log.
  readonly templateFallback?: (kind: PageKind, reason: string) => void;
  // The tenant's own text for catalogue keys in `tag`, which a translator
  // reads before the catalogue; absent when the tenant wrote none.
  readonly overrides?: Readonly<Record<string, string>>;
}

// What a resolved theme hands a page. Every URL is a same-origin absolute
// path, written into a header and an attribute, so each is refused unless it
// passes `isSameOriginPath`.
export interface ResolvedBranding {
  // The origin the page is served from (the configured public base URL); a
  // mismatch leaves the page unstyled. CSP cannot name a bare path, so each
  // source is this origin plus the path. IPv6 literals are refused.
  readonly origin: string;
  // `logo.alt` must be escaped by the renderer; `templates` are checked when
  // saved and not validated here.
  readonly templates: Readonly<Partial<Record<PageKind, string>>>;
  // Data for the route that serves the hashed stylesheet, which carries it
  // along with the sanitised rules. Never written into a page: inline style
  // is refused by `style-src`.
  readonly tokensCss: string;
  readonly stylesheetUrl: string | null;
  readonly faviconUrl: string | null;
  readonly logo: {
    readonly url: string;
    readonly darkUrl: string | null;
    readonly alt: string;
  } | null;
  // Every image the page may load.
  readonly assetUrls: readonly string[];
}

export const MAX_BRANDING_URLS = 16;
// A valid DNS origin is about 267 characters at most.
const MAX_ORIGIN_LENGTH = 300;
const MAX_BRANDING_URL_LENGTH = 256;
// Not ending in `/`: a trailing slash is a prefix match in a CSP path source.
const SAME_ORIGIN_PATH = /^\/(?!\/)(?:[A-Za-z0-9._~!$&()+=:@/-]*[A-Za-z0-9._~!$&()+=:@-])$/u;

// Dot segments and doubled slashes never match a normalised request path, so
// they would only yield an unstyled page.
export function isSameOriginPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_BRANDING_URL_LENGTH &&
    SAME_ORIGIN_PATH.test(value) &&
    !value.includes('//') &&
    !value.split('/').some((segment) => segment === '.' || segment === '..')
  );
}

// A problem message quotes tenant input, so it quotes a bounded part of it,
// escaped to stay on one line and free of bidi and C1 controls, and at most
// QUOTE_LIMIT characters long.
const UNSAFE_IN_LOG =
  /[\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu;
const QUOTE_LIMIT = 120;

function quoted(value: string): string {
  const head = Array.from(value.slice(0, 256)).slice(0, 64).join('');
  const escaped = JSON.stringify(head).replace(
    UNSAFE_IN_LOG,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  const chars = Array.from(escaped);
  const cut = chars.length > QUOTE_LIMIT;
  const shown = cut ? chars.slice(0, QUOTE_LIMIT).join('') : escaped;
  return value.length <= 64 && !cut ? shown : `${shown}… (${String(value.length)} chars)`;
}

function isLength(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface Checked {
  readonly branding: ResolvedBranding | null;
  readonly problems: string[];
}

function urlProblem(field: string, value: unknown, nullable: boolean): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') return `${field} is not a string`;
  return isSameOriginPath(value) ? null : `${field} is not a same-origin path: ${quoted(value)}`;
}

// Each field is read once and the page uses the copy returned here, so a
// getter answering differently the second time cannot get past the check.
function readBranding(input: unknown): Checked {
  if (!isRecord(input) || Array.isArray(input)) {
    return { branding: null, problems: ['branding is not an object'] };
  }
  const { origin, templates, tokensCss, stylesheetUrl, faviconUrl, logo, assetUrls } = input;
  const problems: string[] = [];
  if (
    typeof origin !== 'string' ||
    !ORIGIN_SOURCE.test(origin.length > MAX_ORIGIN_LENGTH ? '' : origin)
  ) {
    problems.push(
      `origin is not an http(s) origin${typeof origin === 'string' ? `: ${quoted(origin)}` : ''}`,
    );
  }
  if (!isRecord(templates) || Array.isArray(templates)) problems.push('templates is not an object');
  if (typeof tokensCss !== 'string') problems.push('tokensCss is not a string');
  problems.push(
    ...[
      urlProblem('stylesheetUrl', stylesheetUrl, true),
      urlProblem('faviconUrl', faviconUrl, true),
    ].filter((problem) => problem !== null),
  );
  let logoUrl: unknown = null;
  let logoDark: unknown = null;
  let logoAlt: unknown = '';
  if (logo !== null) {
    if (!isRecord(logo) || Array.isArray(logo)) {
      problems.push('logo is not an object');
    } else {
      logoUrl = logo.url;
      logoDark = logo.darkUrl;
      logoAlt = logo.alt;
      const logoProblems = [
        urlProblem('logo.url', logoUrl, false),
        urlProblem('logo.darkUrl', logoDark, true),
        typeof logoAlt !== 'string' ? 'logo.alt is not a string' : null,
        typeof logoAlt === 'string' ? altProblem(logoAlt) : null,
      ];
      problems.push(...logoProblems.filter((problem) => problem !== null));
    }
  }
  const assets: unknown[] = [];
  // Read once and as a number: a coercible object would be re-read per use.
  const rawLength: unknown = Array.isArray(assetUrls) ? assetUrls.length : null;
  if (!Array.isArray(assetUrls)) {
    problems.push('assetUrls is not an array');
  } else if (!isLength(rawLength)) {
    problems.push('assetUrls has no valid length');
  } else if (rawLength > MAX_BRANDING_URLS) {
    problems.push(`more than ${String(MAX_BRANDING_URLS)} urls`);
  } else {
    for (let i = 0; i < rawLength; i += 1) {
      assets.push(assetUrls[i]);
      const problem = urlProblem(`assetUrls[${String(i)}]`, assets[i], false);
      if (problem !== null) problems.push(problem);
    }
  }
  const count = [stylesheetUrl, faviconUrl, logoUrl, logoDark, ...assets].filter(
    (url) => url !== null,
  ).length;
  if (count > MAX_BRANDING_URLS) {
    problems.push(`more than ${String(MAX_BRANDING_URLS)} urls`);
  }
  if (problems.length > 0) return { branding: null, problems };
  return {
    problems,
    branding: {
      origin: String(origin),
      templates: templates as ResolvedBranding['templates'],
      tokensCss: String(tokensCss),
      stylesheetUrl: stylesheetUrl as string | null,
      faviconUrl: faviconUrl as string | null,
      logo:
        logo === null
          ? null
          : {
              url: String(logoUrl),
              darkUrl: logoDark as string | null,
              alt: String(logoAlt),
            },
      assetUrls: assets as string[],
    },
  };
}

// The longest alt a theme body may carry, counted in code points as the
// theme body's schema counts it (domain-theme's MAX_ALT_LENGTH); the kernel
// cannot import that package. A string over twice that cannot be within it,
// so a huge one is refused without being iterated.
const MAX_ALT_LENGTH = 200;

function altProblem(alt: string): string | null {
  const tooLong = alt.length > 2 * MAX_ALT_LENGTH || Array.from(alt).length > MAX_ALT_LENGTH;
  if (tooLong) {
    return `logo.alt is longer than ${String(MAX_ALT_LENGTH)} characters: ${quoted(alt)}`;
  }
  return alt.trim() === '' ? 'logo.alt is empty' : null;
}

function checked(input: unknown): Checked {
  try {
    return readBranding(input);
  } catch {
    return { branding: null, problems: ['unreadable branding'] };
  }
}

// Every reason `branding` cannot be sent, empty when it can; total for any
// input. A resolver calls this and falls back to the default theme, since
// `pageHeaders` throws.
export function brandingProblems(branding: unknown): string[] {
  return checked(branding).problems;
}

function validBranding(input: unknown): ResolvedBranding {
  const { branding } = checked(input);
  if (branding === null) throw new Error('refusing to send an unvalidated branding');
  return branding;
}

export function withBranding(
  locale: PageLocale,
  branding: ResolvedBranding | null,
  templateFallback?: PageLocale['templateFallback'],
): PageLocale {
  if (branding === null) {
    return {
      tag: locale.tag,
      dir: locale.dir,
      ...(locale.theme === undefined ? {} : { theme: locale.theme }),
      ...(locale.overrides === undefined ? {} : { overrides: locale.overrides }),
    };
  }
  return templateFallback === undefined
    ? { ...locale, branding }
    : { ...locale, branding, templateFallback };
}

const STOCK_FAVICONS = ['/instrument/favicon.svg', '/instrument/favicon.ico'] as const;

// The icon links of a page whose theme names no favicon.
const STOCK_FAVICON_LINKS = [
  '<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">',
  '<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">',
] as const;

function attribute(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;');
}

// The element that links the tenant's stylesheet, one place so the preview
// can find the very markup the page was given.
export function stylesheetLink(url: string): string {
  return `<link rel="stylesheet" href="${attribute(url)}">`;
}

// The head markup that follows the Instrument stylesheet link: the tenant
// stylesheet after it so its rules win, and the favicon links.
export function brandingHead(locale: PageLocale): string {
  // Validated on its own read, apart from the header's: a getter could give
  // the two different brandings, which yields an unstyled page, never an
  // unvalidated value.
  const branding = locale.branding === undefined ? null : validBranding(locale.branding);
  const lines: string[] = [];
  if (branding?.stylesheetUrl) {
    lines.push(stylesheetLink(branding.stylesheetUrl));
  }
  if (branding?.faviconUrl) {
    lines.push(`<link rel="icon" href="${attribute(branding.faviconUrl)}">`);
  } else {
    lines.push(...STOCK_FAVICON_LINKS);
  }
  return lines.join('\n');
}

// The class of the shell's `<main>`. A themed page also names its kind, the
// hook `page-<kind>` a stylesheet styles one page by; an unthemed page, and a
// page outside any tenant, which has no kind, carry `page` alone. Only a key
// of PAGE_KINDS is ever written.
export function mainClass(locale: PageLocale, kind?: PageKind): string {
  if (kind === undefined || !Object.hasOwn(PAGE_KINDS, kind)) return 'page';
  // Validated on its own read, like the head and the brand line.
  if (locale.branding === undefined) return 'page';
  validBranding(locale.branding);
  return `page page-${kind}`;
}

// The brand line of the shell: the tenant's logo in place of the product's
// mark and name, one image per colour scheme when there are two, which
// the stylesheet chooses between. Validated on its own read, like the head.
export function brandMarkup(locale: PageLocale, defaultMark: string): string {
  const logo = locale.branding === undefined ? null : validBranding(locale.branding).logo;
  if (logo === null) {
    return `<p class="brand">${defaultMark}<span class="wordmark">${PRODUCT_NAME}</span></p>`;
  }
  const source = (url: string): string => `src="${attribute(url)}" alt="${attribute(logo.alt)}"`;
  const images =
    logo.darkUrl === null
      ? `<img class="logo" ${source(logo.url)}>`
      : `<img class="logo logo-light" ${source(logo.url)}>` +
        `<img class="logo logo-dark" ${source(logo.darkUrl)}>`;
  return `<p class="brand">${images}</p>`;
}

// The longest authorize path an account page is handed as `return_to`. The page
// that sends it and the page that accepts it read this one value. Encoded into
// a query a path of this length is at most three times as long (every byte
// `%XX`), about 12 KiB of the 16 KiB Node allows a request line and its headers
// together, leaving about 4 KiB for every header, cookies included. A request
// whose headers overflow that is refused with 431 whatever the link, and
// ordinary paths are far shorter than the bound.
export const MAX_SIGN_IN_PATH_LENGTH = 4096;

export const DEFAULT_PAGE_LOCALE: PageLocale = { tag: 'en', dir: 'ltr' };

// A page's theme rides with its negotiated language because every renderer
// already takes that value as its last argument, so a route cannot render a
// page without having been asked for both.
export function withPageTheme(locale: PageLocale, cookieHeader: unknown): PageLocale {
  const theme = pageThemeFromCookies(cookieHeader);
  return theme === undefined ? locale : { ...locale, theme };
}

export interface RenderedPage {
  // The whole document, as the server sends it today.
  html: string;
  // What the renderer put inside the page's <main>, without the shell's
  // own chrome. What a theme is allowed to place; see ADR 0030 for why it
  // is never handed the document.
  body: string;
  // The document's title, so a theme's own shell can set one.
  title: string;
  script: PageScript | null;
  // Rendered into `<html lang dir>` and sent as `Content-Language`.
  locale: PageLocale;
  // The exact origins this page's own markup frames. `frame-src` is derived
  // from it, so a policy can never license an origin the markup does not
  // embed, nor refuse one it does — the failure mode ADR 0018's amendment
  // describes for scripts, which is silent for frames in the same way.
  frames: readonly string[];
  // The validated redirect_uri of the authorization request this page's
  // form continues. Its POST can answer 302 there, and Chromium holds that
  // redirect to `form-action` too, so the policy names its origin.
  redirectsTo?: string;
}

const ORIGIN_SOURCE = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/u;
const SCHEME_SOURCE = /^[a-z][a-z0-9+.-]*:$/u;
// Schemes a redirect_uri never legitimately uses, which a scheme-source
// would license wholesale.
const UNSAFE_SCHEMES = new Set(['javascript:', 'data:', 'blob:', 'file:', 'filesystem:', 'about:']);

// The source expression for where a redirect URI points: its origin, or
// for a private-use scheme (RFC 8252 §7.1), which has no origin, the scheme
// itself. Anything not expressible exactly as one adds nothing.
function formActionSource(redirectUri: string): string | null {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return null;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return ORIGIN_SOURCE.test(url.origin) ? url.origin : null;
  }
  if (UNSAFE_SCHEMES.has(url.protocol)) return null;
  return SCHEME_SOURCE.test(url.protocol) ? url.protocol : null;
}

// The one stylesheet every page links, served by @odudu/instrument. A page
// reads no other style, font or image, and a path in a header could not be
// told apart from a typo in a link, so both name this constant.
export const INSTRUMENT_STYLESHEET = '/instrument/instrument.css';

// The product's name as the pages' brand line spells it.
export const PRODUCT_NAME = 'odudu';

function brandedSources(branding: ResolvedBranding): { style: string; img: string } {
  const at = (url: string): string => `${branding.origin}${url}`;
  const styles = [INSTRUMENT_STYLESHEET, branding.stylesheetUrl];
  const stock = branding.faviconUrl === null ? STOCK_FAVICONS : [];
  const images = [
    ...branding.assetUrls,
    branding.faviconUrl,
    branding.logo?.url ?? null,
    branding.logo?.darkUrl ?? null,
    ...stock,
  ];
  const list = (urls: readonly (string | null)[]): string =>
    [...new Set(urls.filter((url) => url !== null))].map(at).join(' ');
  return { style: list(styles), img: list(images) };
}

// RFC 6749 §10.13's framing defence for the pages rendered to an end-user.
// Almost all of these pages are markup only — no script or frame of their
// own — and take a style, font and image only from their own origin, so
// `default-src 'none'` plus three same-origin directives describes them
// exactly. Nothing inline, nothing remote (ADR 0029's amendment).
// X-Frame-Options: DENY rides alongside `frame-ancestors 'none'` for agents
// with no CSP at all, and may only stay while the two agree. ADR 0018 has
// the reasoning for each directive and for the pairing.
function baseDirectives(page: RenderedPage): string[] {
  const branded =
    page.locale.branding === undefined ? null : brandedSources(validBranding(page.locale.branding));
  const source = page.redirectsTo === undefined ? null : formActionSource(page.redirectsTo);
  return [
    "default-src 'none'",
    branded === null ? "style-src 'self'" : `style-src ${branded.style}`,
    "font-src 'self'",
    branded === null ? "img-src 'self'" : `img-src ${branded.img}`,
    "frame-ancestors 'none'",
    source === null ? "form-action 'self'" : `form-action 'self' ${source}`,
    "base-uri 'none'",
  ];
}

// A WebAuthn page is the exception (ADR 0018's amendment): only a script
// can reach an authenticator, and `default-src 'none'` blocks an inline one
// silently, so the page looks broken rather than refused. The page says
// what it carries and the policy is derived from that — never assembled
// beside it, which is how a header and an element come to disagree.
function policyFor(page: RenderedPage): string {
  const script = page.script;
  const base = baseDirectives(page);
  const directives =
    script === null
      ? base
      : [
          ...base,
          `script-src 'nonce-${script.nonce}'`,
          // Only for a script that actually makes a request. A page handed
          // its options inline asks for nothing, and a directive licensing
          // nothing stops describing the page.
          ...(script.fetchesSameOrigin ? ["connect-src 'self'"] : []),
        ];
  // Two clients may register a logout URI on the same host, and the list is
  // built per relying party, so a duplicate origin is expected rather than
  // exceptional.
  const framed = [...new Set(page.frames.filter((origin) => ORIGIN_SOURCE.test(origin)))];
  if (framed.length > 0) directives.push(`frame-src ${framed.join(' ')}`);
  return directives.join('; ');
}

// Every page is bound to a browser's own attempt: a form carrying an
// `auth_session_id`, a token in a query string, a session that was just
// ended. `no-store` (RFC 9111 §5.2.2.5) is the one directive that keeps such a
// page out of every cache. `Pragma` is not sent: RFC 9111 §5.4 deprecates it,
// and `no-cache` and `Expires: 0` only add what `no-store` already says.
// ADR 0029's amendment has what this does and does not stop.
const PAGE_CACHE_CONTROL = 'no-store';

// The one authority for the headers every rendered page carries, so a
// package's reply wrapper is two lines that spread this and cannot
// diverge from another package's. Every renderer returns a RenderedPage —
// the nonce its own markup used travels with it, so the policy sent with a
// page can never name a script the page does not carry.
// What may reach a header: a tag negotiated from the shipped list has this
// shape already, so anything else is a bug, never input.
const DIRECTIONS: ReadonlySet<string> = new Set(['ltr', 'rtl']);
const SAFE_TAG = /^[A-Za-z0-9-]{1,35}$/u;

export function pageHeaders(page: RenderedPage): readonly (readonly [string, string])[] {
  if (!SAFE_TAG.test(page.locale.tag) || !DIRECTIONS.has(page.locale.dir)) {
    throw new Error('refusing to send an unvalidated locale');
  }
  if (page.locale.theme !== undefined && !isPageTheme(page.locale.theme)) {
    throw new Error('refusing to send an unvalidated theme');
  }
  return [
    ['content-security-policy', policyFor(page)],
    // Governs this page being framed, not this page framing others — that
    // direction is `frame-src`, above. Untouched by `frames`.
    ['x-frame-options', 'DENY'],
    // Defence in depth for the query-string tokens some of these pages
    // carry: default-src already stops a subresource leaking one via
    // Referer, but a link a user clicks away from is not a subresource.
    ['referrer-policy', 'no-referrer'],
    ['cache-control', PAGE_CACHE_CONTROL],
    // The page's own type is the one it is served as; a browser has no
    // business guessing another from its bytes.
    ['x-content-type-options', 'nosniff'],
    ['content-language', page.locale.tag],
  ];
}

// A page restored from the back/forward cache is the DOM it was left with,
// so a form bound to an authentication session that has since expired comes
// back looking alive. `pageshow` with `persisted` is the one signal a
// restore gives; reloading re-requests the GET that started the attempt.
// The restored form shows for a moment first, which is acceptable for a
// form and would not be for a secret (ADR 0029's amendment). Apply it only
// to a page that answered a GET: a reload re-sends a POST.
const RELOAD_ON_RESTORE =
  "window.addEventListener('pageshow', function (event) { if (event.persisted) location.reload(); });";

export function reloadOnRestore(page: RenderedPage): RenderedPage {
  const nonce = page.script?.nonce ?? scriptNonce();
  const element = `<script nonce="${nonce}">${RELOAD_ON_RESTORE}</script>`;
  const end = page.html.lastIndexOf('</body>');
  return {
    ...page,
    html:
      end === -1
        ? `${page.html}\n${element}`
        : `${page.html.slice(0, end)}${element}\n${page.html.slice(end)}`,
    body: `${page.body}\n${element}`,
    script: page.script ?? { nonce, fetchesSameOrigin: false },
  };
}

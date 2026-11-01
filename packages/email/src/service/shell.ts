import { type PageLocale } from '@odudu/i18n';
import {
  mailColoursProblem,
  mailLogoProblem,
  type MailBranding,
  type MailColours,
  type MailLogo,
} from '@odudu/kernel';
import { escapeHtml } from '#/service/escape';
import { MARK_CID } from '#/service/mark';
import { bdi, t } from '#/service/messages';
import { MAIL_PALETTE } from '#/service/palette.generated';

export type Block =
  | { readonly kind: 'paragraph'; readonly html: string }
  | { readonly kind: 'list'; readonly items: readonly string[] };

export interface ShellInput {
  readonly locale: PageLocale;
  /** The tenant's display name as typed: it is escaped and isolated here. */
  readonly tenant: string;
  /** The send time; the footer's year is its UTC year. */
  readonly now: Date;
  /** Plain text, for the document title and the heading. */
  readonly heading: string;
  /** The inbox preview line: plain text, shown by no message body. */
  readonly preheader: string;
  /** Markup the caller built from the catalogue, already escaped. */
  readonly blocks: readonly Block[];
  readonly action?: { readonly label: string; readonly href: string } | undefined;
  /** Muted closing lines, as escaped markup. */
  readonly closing?: readonly string[];
  /** Why the recipient got this, as escaped markup. */
  readonly reason: string;
  /** The tenant's theme; absent, the mail is drawn in Odudu's own colours. */
  readonly branding?: MailBranding | null | undefined;
}

const SANS = 'system-ui,-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif';
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
const WIDTH = 560;
const CONTROLS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u;
const PREHEADER_PAD = '\u200c\u00a0'.repeat(80);
// A name or an address with no break opportunity wraps instead of widening the page.
const WRAP = 'word-break:break-word;overflow-wrap:anywhere';
const SCHEMES = ['light', 'dark'].join(' ');

// Codes, not sentences: they reach a developer's log, never a recipient.
const LINK_REFUSED = 'mail-link-not-absolute-web-address';
const TIME_REFUSED = 'mail-send-time-invalid';

// A link this package is handed is built by the server from its public base
// URL; the shell still refuses anything that is not a web address, because
// the href is the one place a mail's markup takes a URL.
export function safeHref(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new RangeError(LINK_REFUSED);
  }
  const web = url.protocol === 'https:' || url.protocol === 'http:';
  const bare = url.username === '' && url.password === '';
  if (!web || !bare || link !== link.trim() || CONTROLS.test(link)) {
    throw new RangeError(LINK_REFUSED);
  }
  return link;
}

export function sendYear(now: Date): number {
  if (Number.isNaN(now.getTime())) throw new RangeError(TIME_REFUSED);
  return now.getUTCFullYear();
}

function rule(selector: string, declarations: Partial<Record<string, string>>): string {
  const body = Object.entries(declarations)
    .map(([property, value]) => `${property}:${value ?? ''}!important`)
    .join(';');
  return `${selector}{${body}}`;
}

// Clients that read prefers-color-scheme swap every colour here; the rest keep
// the inline light values, which carry the whole design on their own.
function darkStyles(dark: MailColours): string {
  return [
    rule('.m-page', { 'background-color': dark.page }),
    rule('.m-panel', { 'background-color': dark.panel, 'border-color': dark.border }),
    rule('.m-sunken', { 'background-color': dark.sunken, 'border-color': dark.border }),
    rule('.m-ink', { color: dark.ink }),
    rule('.m-muted', { color: dark.muted }),
    rule('.m-link', { color: dark.link }),
    rule('.m-button', { 'background-color': dark.button }),
    rule('.m-button-link', { color: dark.buttonInk }),
  ].join('');
}

// Both logos are in the markup; the dark one starts hidden inline, so a client
// that drops this block shows the light one alone.
function logoStyles(swap: boolean): string {
  if (!swap) return '';
  return rule('.m-logo-light', { display: 'none' }) + rule('.m-logo-dark', { display: 'block' });
}

function headStyles(dark: MailColours, swapLogo: boolean): string {
  return `:root{color-scheme:${SCHEMES};supported-color-schemes:${SCHEMES}}@media (prefers-color-scheme:dark){${darkStyles(dark)}${logoStyles(swapLogo)}}`;
}

function paragraph(c: MailColours, start: string, html: string): string {
  return `<p class="m-ink" style="margin:0 0 16px;font:15px/1.5 ${SANS};color:${c.ink};text-align:${start};${WRAP}">${html}</p>`;
}

function list(c: MailColours, start: string, items: readonly string[]): string {
  const rows = items
    .map(
      (item) =>
        `<li class="m-ink" style="margin:0 0 6px;font:15px/1.5 ${SANS};color:${c.ink};${WRAP}">${item}</li>`,
    )
    .join('');
  return `<ul style="margin:0 0 16px;padding:0 20px;text-align:${start}">${rows}</ul>`;
}

function muted(c: MailColours, start: string, html: string, size = 13): string {
  return `<p class="m-muted" style="margin:0 0 12px;font:${String(size)}px/1.5 ${SANS};color:${c.muted};text-align:${start};${WRAP}">${html}</p>`;
}

function button(c: MailColours, label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px"><tr><td class="m-button" bgcolor="${c.button}" align="center" style="background-color:${c.button};border-radius:4px;padding:12px 24px;mso-padding-alt:12px 24px"><a class="m-button-link" href="${escapeHtml(href)}" target="_blank" style="display:inline-block;font:600 15px/20px ${SANS};color:${c.buttonInk};text-decoration:none;mso-line-height-rule:exactly">${escapeHtml(label)}</a></td></tr></table>`;
}

// The address, written out where it can be selected and copied, under the
// button that carries it.
function rawLink(c: MailColours, start: string, locale: PageLocale, href: string): string {
  const shown = escapeHtml(href);
  return `${muted(c, start, escapeHtml(t(locale, 'mail.linkFallback')))}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px"><tr><td class="m-sunken" bgcolor="${c.sunken}" style="background-color:${c.sunken};border:1px solid ${c.border};border-radius:4px;padding:10px 12px;font:13px/1.5 ${MONO};color:${c.link};word-break:break-all;overflow-wrap:anywhere;text-align:left" dir="ltr"><a class="m-link" href="${shown}" target="_blank" style="color:${c.link};text-decoration:underline;word-break:break-all">${shown}</a></td></tr></table>`;
}

function image(c: MailColours, logo: MailLogo, variant: 'light' | 'dark' | null): string {
  const hidden = variant === 'dark' ? 'display:none;mso-hide:all;' : 'display:block;';
  const klass = variant === null ? '' : ` class="m-logo-${variant}"`;
  const size = `width:${String(logo.width)}px;height:${String(logo.height)}px`;
  return `<img${klass} src="${escapeHtml(logo.src)}" width="${String(logo.width)}" height="${String(logo.height)}" alt="${escapeHtml(logo.alt)}" style="${hidden}${size};border:0;font:600 14px/${String(logo.height)}px ${SANS};color:${c.ink}">`;
}

// A logo that fails these checks is not drawn, whatever the theme says: the
// shell is where a stored address first becomes markup. That it is on this
// server's origin is the resolver's invariant (it writes the address as the
// public origin plus a hashed brand path); the shell checks only the shape.
function usable(logo: MailLogo | null | undefined): MailLogo | null {
  if (logo === null || logo === undefined || mailLogoProblem(logo) !== null) return null;
  try {
    safeHref(logo.src);
  } catch {
    return null;
  }
  return logo;
}

function mark(c: MailColours, input: ShellInput): string {
  const alt = escapeHtml(t(input.locale, 'mail.brand'));
  return `<img src="cid:${MARK_CID}" width="40" height="40" alt="${alt}" style="display:block;width:40px;height:40px;border:0;border-radius:8px;font:600 14px/40px ${SANS};color:${c.ink}">`;
}

function emblem(c: MailColours, input: ShellInput, logo: MailLogo | null, dark: MailLogo | null) {
  if (logo === null) return mark(c, input);
  return dark === null
    ? image(c, logo, null)
    : `${image(c, logo, 'light')}${image(c, dark, 'dark')}`;
}

function header(
  c: MailColours,
  input: ShellInput,
  start: string,
  logos: { logo: MailLogo | null; dark: MailLogo | null },
): string {
  const gap = start === 'left' ? 'right' : 'left';
  const emblemHtml = emblem(c, input, logos.logo, logos.dark);
  return `<tr><td style="padding:0 0 16px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" style="padding-${gap}:12px">${emblemHtml}</td><td valign="middle" class="m-ink" style="font:600 18px/1.3 ${SANS};color:${c.ink};text-align:${start};${WRAP}">${bdi(input.tenant)}</td></tr></table></td></tr>`;
}

function footer(c: MailColours, input: ShellInput, start: string): string {
  const year = String(sendYear(input.now));
  const copyright = escapeHtml(t(input.locale, 'mail.copyright', { year }));
  const powered = escapeHtml(t(input.locale, 'mail.poweredBy'));
  return `<tr><td style="padding:20px 0 0">${muted(c, start, input.reason, 12)}${muted(c, start, `${copyright} &middot; ${powered}`, 12)}</td></tr>`;
}

function blockHtml(c: MailColours, start: string, block: Block): string {
  return block.kind === 'paragraph' ? paragraph(c, start, block.html) : list(c, start, block.items);
}

function validColours(colours: MailColours | null | undefined): MailColours | null {
  return colours === null || colours === undefined || mailColoursProblem(colours) !== null
    ? null
    : colours;
}

export function renderShell(input: ShellInput): string {
  const themed = input.branding ?? null;
  const c = validColours(themed?.palette) ?? MAIL_PALETTE.light;
  const dark = validColours(themed?.darkPalette) ?? MAIL_PALETTE.dark;
  const logo = usable(themed?.logo);
  const darkLogo = logo === null ? null : usable(themed?.darkLogo);
  const dir = input.locale.dir;
  const start = dir === 'rtl' ? 'right' : 'left';
  const title = escapeHtml(input.heading);
  const href = input.action === undefined ? '' : safeHref(input.action.href);
  const action =
    input.action === undefined
      ? ''
      : button(c, input.action.label, href) + rawLink(c, start, input.locale, href);
  const preheader = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${c.page};opacity:0">${escapeHtml(input.preheader)}${PREHEADER_PAD}</div>`;
  const closing = (input.closing ?? []).map((line) => muted(c, start, line)).join('');
  const panel = `<tr><td class="m-panel" bgcolor="${c.panel}" style="background-color:${c.panel};border:1px solid ${c.border};border-radius:4px;padding:32px 28px"><h1 class="m-ink" style="margin:0 0 16px;font:600 20px/1.3 ${SANS};color:${c.ink};text-align:${start};${WRAP}">${title}</h1>${input.blocks.map((block) => blockHtml(c, start, block)).join('')}${action}${closing}</td></tr>`;
  return `<!doctype html><html lang="${escapeHtml(input.locale.tag)}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="${SCHEMES}"><meta name="supported-color-schemes" content="${SCHEMES}"><title>${title}</title><style>${headStyles(dark, darkLogo !== null)}</style></head><body class="m-page" style="margin:0;padding:0;background-color:${c.page}">${preheader}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="m-page" bgcolor="${c.page}" style="background-color:${c.page}"><tr><td align="center" style="padding:24px 16px"><!--[if mso]><table role="presentation" width="${String(WIDTH)}" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${String(WIDTH)}px;table-layout:fixed">${header(c, input, start, { logo, dark: darkLogo })}${panel}${footer(c, input, start)}</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}

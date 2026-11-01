import { mailColoursProblem, type MailBranding, type MailColours } from '@odudu/kernel';
import { MARK_CID } from '#/service/mark';
import { MARK_PNG_BASE64 } from '#/service/mark.generated';
import { MAIL_PALETTE } from '#/service/palette.generated';
import { type Scheme } from '#/service/palette';

export interface SchemeColours {
  readonly source: 'tenant' | 'default';
  readonly colours: MailColours;
}

function defaultColours(scheme: Scheme): MailColours {
  const { page, panel, sunken, border, ink, muted, link, button, buttonInk } = MAIL_PALETTE[scheme];
  return { page, panel, sunken, border, ink, muted, link, button, buttonInk };
}

// The nine colours a mail wears in one scheme and who supplies them: the
// theme's palette when the shell would accept it, else Odudu's own.
export function mailSchemeColours(branding: MailBranding | null, scheme: Scheme): SchemeColours {
  const own = scheme === 'dark' ? branding?.darkPalette : branding?.palette;
  if (own !== null && own !== undefined && mailColoursProblem(own) === null) {
    return { source: 'tenant', colours: own };
  }
  return { source: 'default', colours: defaultColours(scheme) };
}

// The theme as one scheme alone would dress the mail: a viewer has no way to
// set prefers-color-scheme inside a frame, so both schemes are made the one
// asked for and the mail looks the same whatever the viewer's setting is.
export function brandingInScheme(branding: MailBranding | null, scheme: Scheme): MailBranding {
  const { colours } = mailSchemeColours(branding, scheme);
  const logo =
    scheme === 'dark' ? (branding?.darkLogo ?? branding?.logo ?? null) : (branding?.logo ?? null);
  return { palette: colours, darkPalette: colours, logo, darkLogo: logo };
}

// A mail names its default mark as an attachment; a browser has none, so the
// preview carries the same picture as a data address.
export function inlineMark(html: string): string {
  return html.replaceAll(`cid:${MARK_CID}`, `data:image/png;base64,${MARK_PNG_BASE64}`);
}

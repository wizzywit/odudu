// The nine colours a mail is drawn from, one scheme. Mail clients read
// neither custom properties nor stylesheets reliably, so each is a literal
// `#rrggbb` the shell writes onto the element that uses it.
export interface MailColours {
  readonly page: string;
  readonly panel: string;
  readonly sunken: string;
  readonly border: string;
  readonly ink: string;
  readonly muted: string;
  readonly link: string;
  readonly button: string;
  readonly buttonInk: string;
}

// `src` is an absolute web address on the origin the server is served from:
// the mail names the image, it never carries it.
export interface MailLogo {
  readonly src: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

// A tenant's theme as its mail wears it. A scheme or logo the theme does not
// set is null and the mail keeps its own default there.
export interface MailBranding {
  readonly palette: MailColours | null;
  readonly darkPalette: MailColours | null;
  readonly logo: MailLogo | null;
  readonly darkLogo: MailLogo | null;
}

// The longest side an uploaded logo may have (domain-theme's ASSET_LIMITS).
export const MAIL_LOGO_MAX_SIDE = 1024;

const HEX = /^#[0-9a-f]{6}$/u;
const PLAIN_ADDRESS = /^https?:\/\/[^\s"'<>\\`]+$/u;

// Why a logo cannot be written into a mail's markup, or null when it can.
// The mail is the one place a theme-derived address leaves the server, so
// the address is checked as one a client will fetch, not trusted as stored.
export function mailLogoProblem(logo: MailLogo): string | null {
  let url: URL;
  try {
    url = new URL(logo.src);
  } catch {
    return 'src is not an absolute address';
  }
  const web = url.protocol === 'https:' || url.protocol === 'http:';
  if (!web || url.username !== '' || url.password !== '' || !PLAIN_ADDRESS.test(logo.src)) {
    return 'src is not a plain http(s) address';
  }
  for (const side of [logo.width, logo.height]) {
    if (!Number.isInteger(side) || side < 1 || side > MAIL_LOGO_MAX_SIDE) {
      return 'width and height are not whole numbers within the asset limit';
    }
  }
  return null;
}

export function mailColoursProblem(colours: MailColours): string | null {
  const values: string[] = [
    colours.page,
    colours.panel,
    colours.sunken,
    colours.border,
    colours.ink,
    colours.muted,
    colours.link,
    colours.button,
    colours.buttonInk,
  ];
  return values.every((value) => HEX.test(value)) ? null : 'a colour is not #rrggbb';
}

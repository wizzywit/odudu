export interface MailColoursView {
  page: string;
  panel: string;
  sunken: string;
  border: string;
  ink: string;
  muted: string;
  link: string;
  button: string;
  button_ink: string;
}

interface MailScheme {
  // `client` only on a client's own view: its published theme sets the palette.
  source: 'client' | 'tenant' | 'default';
  colours: MailColoursView;
}

export interface MailLogo {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface MailBrandingView {
  light: MailScheme;
  dark: MailScheme;
  logo: MailLogo | null;
  dark_logo: MailLogo | null;
}

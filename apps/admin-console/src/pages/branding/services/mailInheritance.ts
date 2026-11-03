import type { MailColoursView } from '#/pages/branding/types/mailBranding';

export const MAIL_INHERITS_TITLE = 'What the mail inherits';

// A mail takes the tenant's logo and colours, or a client's over them when its
// flow began inside that client's sign-in; this says which one is shown.
export function mailInheritsLead(clientName: string | null): string {
  const shown =
    clientName === null
      ? 'This shows the tenant’s own; choose a client to see the mail its sign-in sends.'
      : `This shows the mail a sign-in of ${clientName} sends.`;
  return `Mail takes the tenant’s published logo and colours, and its message overrides. A mail whose flow began inside a client’s sign-in takes that client’s logo and colours over these. ${shown} Never a stylesheet or a template. Where the theme sets nothing, the mail keeps Odudu’s own colours and mark.`;
}

export const MAIL_CLIENTS_NOTE =
  'A mail client chooses the light or the dark colours by its own setting, so each is listed here and the preview shows one at a time.';

type RoleKey = keyof MailColoursView;

const ROLES: readonly { key: RoleKey; label: string; used: string }[] = [
  { key: 'page', label: 'Page background', used: 'Around the message.' },
  { key: 'panel', label: 'Message background', used: 'The card the text sits on.' },
  { key: 'sunken', label: 'Link box background', used: 'Behind the address to copy.' },
  { key: 'border', label: 'Border', used: 'Around the card and the link box.' },
  { key: 'ink', label: 'Text', used: 'The heading and the message.' },
  { key: 'muted', label: 'Quiet text', used: 'The notes and the footer.' },
  { key: 'link', label: 'Link', used: 'The address, and a link in the text.' },
  { key: 'button', label: 'Button', used: 'The button’s fill.' },
  { key: 'button_ink', label: 'Button text', used: 'The words on the button.' },
];

export interface PaletteRow {
  role: RoleKey;
  label: string;
  used: string;
  colour: string;
}

export function paletteRows(colours: MailColoursView): readonly PaletteRow[] {
  return ROLES.map(({ key, label, used }) => ({ role: key, label, used, colour: colours[key] }));
}

export function sourceText(source: 'client' | 'tenant' | 'default'): string {
  if (source === 'client') return 'From the client’s published theme.';
  return source === 'tenant' ? 'From the tenant’s published theme.' : 'Odudu’s default.';
}

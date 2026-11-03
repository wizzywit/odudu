export interface PageShotCard {
  name: string;
  caption: string;
  alt: string;
  size: 'large' | 'small';
  note?: string;
}

export const PAGE_SHOTS: PageShotCard[] = [
  {
    name: 'sign-in',
    caption: 'Sign in',
    size: 'large',
    alt: 'The sign-in page: a username and a password, a Remember me box, and links to reset a password or create an account.',
  },
  {
    name: 'create-account',
    caption: 'Create an account',
    size: 'large',
    alt: 'The create-account page: a username, an email address and a password, with the rules the password has to meet.',
  },
  {
    name: 'reset-password',
    caption: 'Reset a password',
    size: 'small',
    note: 'A person asks for a link by email and chooses a new password.',
    alt: 'The reset page: an email address, a Send reset link button and a link back to sign in.',
  },
  {
    name: 'second-factor',
    caption: 'Second factor',
    size: 'small',
    note: 'Asked after the password: a code from an authenticator app, or a recovery code.',
    alt: 'The second-factor page: a field for the code from an authenticator app, and one for a recovery code.',
  },
];

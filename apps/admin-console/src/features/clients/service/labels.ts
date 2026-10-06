export { DESCRIPTION_MAX } from '@odudu/contracts/admin';

export const DESCRIPTION_RULE = 'Leave it empty for none.';

// ADR 0039: relying parties match on the identifier, and every token names it as `azp`.
export const CLIENT_ID_FIXED =
  "A client's ID is fixed once it is made: every relying party is configured with it, and the azp of every token issued to it names it.";

export const TYPE_FIXED =
  "A client's type is fixed once it is made: changing it would silently change the security model of a client already in use.";

export const CLIENT_ID_TAKEN = 'That client ID is taken';

export const BUILTIN_FIXED =
  "This is the tenant's built-in admin client, which every administrator signs in through: what could lock them out is fixed.";

export const REDIRECTS_RULE =
  'Where sign-in may send the browser back: an https address, an http address on this machine, or an application scheme such as com.example.app:/cb. A request must name one exactly; no other is followed.';

export const ORIGINS_RULE =
  "The origins a browser may call this client's endpoints from. An origin is a scheme and host with no path, such as https://app.example. Use + to allow the origin of every redirect URI above.";

export const PAGES_RULE =
  'Linked from the consent screen: an https address, or an http address on this machine. Leave one empty for none.';

export const NOT_BUILT = 'This tab is not built in this version of the console yet.';

export const POST_LOGOUT_NOTE =
  'Where a sign-out may send the browser back is set apart from these, under Logout.';

const REGISTERED: Readonly<Record<string, string>> = {
  seeded: 'Seeded from the command line',
  operator: 'Created by an administrator',
  anonymous: 'Registered dynamically, with no token',
  token: 'Registered dynamically, with a registration token',
};

export function registeredText(origin: string): string {
  return REGISTERED[origin] ?? origin;
}

export const TYPE_TEXT: Readonly<Record<string, string>> = {
  confidential: 'Confidential',
  public: 'Public',
};

export const SECTION = {
  details: 'Details',
  pages: 'Consent screen links',
  availability: 'Availability',
  consent: 'Consent',
  redirects: 'Redirect URIs',
  origins: 'Web origins',
} as const;

export const FIELD = {
  name: 'Name',
  description: 'Description',
  homePage: 'Home page',
  privacyPolicy: 'Privacy policy',
  termsOfService: 'Terms of service',
  enabled: 'Enabled',
  consentRequired: 'Consent required',
  redirectUris: 'Redirect URIs',
  webOrigins: 'Web origins',
} as const;

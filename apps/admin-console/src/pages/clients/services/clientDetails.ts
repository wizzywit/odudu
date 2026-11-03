// ADR 0039: relying parties match on the identifier, and every token names it as `azp`.
export const CLIENT_ID_FIXED =
  "A client's ID is fixed once it is made: every relying party is configured with it, and the azp of every token issued to it names it.";

export const TYPE_FIXED =
  "A client's type is fixed once it is made: changing it would silently change the security model of a client already in use.";

// Names a client's page before its record is read, and the area's trail.
export const CLIENT_TITLE = 'Client';

export const CLIENT_ID_TAKEN = 'That client ID is taken';

export const BUILTIN_FIXED =
  "This is the tenant's built-in admin client, which every administrator signs in through: what could lock them out is fixed.";

export const TYPE_TEXT: Readonly<Record<string, string>> = {
  confidential: 'Confidential',
  public: 'Public',
};

export const SECTION = {
  details: 'Details',
  translations: 'Translations',
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

export const ACTIVITY_NOTE =
  'Every change made to this client, and every change refused. A creation refused before the client existed names no client, so it is not here.';

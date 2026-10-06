export const SECTIONS_LOGOUT = {
  postLogout: 'After sign-out',
  backchannel: 'Back-channel logout',
  frontchannel: 'Front-channel logout',
} as const;

export const POST_LOGOUT_RULE =
  'Where a sign-out may send the browser back to. A request names one exactly; no other is followed.';

export const BACKCHANNEL_RULE =
  'An https address the server posts a signed logout token to when a session this client took part in ends. It must be absolute, with no fragment.';

export const BACKCHANNEL_SESSION_LABEL = 'Name the session in the logout token';
export const BACKCHANNEL_SESSION_RULE =
  'The token carries the session ID, so the application can end that one session rather than every one of the person.';

export const FRONTCHANNEL_RULE =
  'An https address the browser loads in a hidden frame while the person signs out. It must be absolute, with no fragment, and share its scheme, host and port with a registered redirect URI.';

export const FRONTCHANNEL_SESSION_LABEL = 'Name the session in the address';
export const FRONTCHANNEL_SESSION_RULE =
  'The address carries the issuer and the session ID, so the application can end that session.';

export const LOGOUT_FIELD = {
  postLogout: 'Post-logout redirect URIs',
  backchannel: 'Back-channel logout address',
  frontchannel: 'Front-channel logout address',
} as const;

export const POST_LOGOUT_NOUN = 'post-logout redirect URIs';

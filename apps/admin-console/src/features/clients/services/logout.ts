export const SECTIONS_LOGOUT = {
  postLogout: 'After sign-out',
  confirmation: 'Sign-out confirmation',
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

export const SKIP_LOGOUT_WARNING_ID = 'skip-logout-warning';
export const SKIP_LOGOUT_LABEL = 'Skip the sign-out confirmation';
export const SKIP_LOGOUT_HINT = 'Off: the person is always asked to confirm sign-out.';
export const SKIP_LOGOUT_HINT_ON =
  "On: signing out with this application's ID token ends the session without asking.";
export const SKIP_LOGOUT_WARNING =
  'When this is on, anyone who holds an ID token this application received, even an expired one, can sign its users out by opening a link while their session lasts, with no confirmation. Turn it on only for an application you run yourself whose ID tokens never reach a browser or a log.';

// Nothing where the setting is fixed: the reason it is fixed is shown instead.
export function skipLogoutHint(fixed: string | null, skipping: boolean): string | undefined {
  if (fixed !== null) return undefined;
  return skipping ? SKIP_LOGOUT_HINT_ON : SKIP_LOGOUT_HINT;
}

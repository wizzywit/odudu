export const AUDIENCES_RULE =
  'The resource servers tokens issued to this client are meant for, which a token names as its audience. A request may narrow them with a resource, never widen them.';

export const EXCHANGE_LABEL = 'Allow impersonation in token exchange';
export const EXCHANGE_RULE =
  'On, this client may exchange a token for one that stands for the subject with no actor named. Off, an exchange it makes names the client as the actor. It has no effect unless the client holds the token exchange grant.';

export const EXCHANGE_PUBLIC_LABEL = 'Allow a public client to use token exchange';
export const EXCHANGE_PUBLIC_RULE =
  'A public client holds no secret, so it is refused the token exchange grant unless this is on. It has no effect on a confidential client, or unless the client holds the token exchange grant.';

export const EXCHANGE_ACTOR_LABEL = 'Accept an actor token issued to another client';
export const EXCHANGE_ACTOR_RULE =
  'An actor token issued to another client is refused unless this is on. It has no effect unless the client holds the token exchange grant.';

export const FIXED_BY_DESIGN: readonly { label: string; value: string; why: string }[] = [
  {
    label: 'Response type',
    value: 'code',
    why: 'Every client signs people in with the authorization code flow; no token is ever returned through the browser.',
  },
  {
    label: 'PKCE',
    value: 'S256',
    why: 'An authorization request carries a code challenge, and the plain method is refused.',
  },
];
